import type {
  Obieg, Reserve, BreakAssignment, PlanResult, BreakKind, Dir, BreakStation,
} from "./types";
import { CALA_EQ, MAX_BREAKS_PER_OBIEG, MAX_RESERVE_LOAD_EQ, fitsLoad, isCrossTrackBreak } from "./types";
import { STATIONS, DOWNGRADE, stationSupports } from "./stations";

const hms = (h: number, m: number) => h * 3600 + m * 60;

// R17 — rezerwa ruchowa A1 (Kabaty): na A1 stoi pociąg rezerwy ruchowej; JEDEN maszynista z obsady
// musi zostać pod ręką, by wprowadzić skład za pociąg, który uległ awarii / wymaga sprzątania. Ten
// JEDEN robi DOMYŚLNIE tylko 1 koło (jedną całą); POZOSTALI rezerwowi z A1 pracują normalnie do 3 kół.
// Którego dotyczy limit: jawny flag `rolling` > pierwszy niezablokowany rezerwowy A1. `maxJobs` nadpisuje.
const A1_MOBILE_MAX_JOBS = 1;

// R3 — maksymalnie 6 h ciągłej pracy bez przerwy, liczone od REALNEGO startu maszynisty (entry2nd).
// 1. (główna) przerwa musi wystartować najpóźniej start+6h (przy starcie 13:00 → 19:00 itd.).
const MAX_CONTINUOUS = 6 * 3600;
// §4a krok 4 — szczyt mający TYLKO połówkę: nie dawaj jej jako pierwszej; zaplanuj między 1. pełnym
// kołem (entry2nd + czas koła) a 18:15 (nie od razu na starcie zmiany).
const ONLY_POL_LATEST = hms(18, 15);

// Preferowane OKNO startu (R2, poprawione 2026-06-07): najlepsze przerwy startują ~16:00–17:30,
// NIE „jak najbliżej 14:30". Slot w oknie = score 0; poza oknem = odległość do najbliższej krawędzi.
export const PREF_WINDOW: [number, number] = [hms(16, 0), hms(17, 30)];
export const PREF_START = PREF_WINDOW[0]; // zachowane dla zgodności eksportu
const EARLIEST_DEFAULT = hms(14, 30);    // granica: przerwa NIE wcześniej niż 14:30 (R2)
// DWA OKNA startu (R2, model potwierdzony 2026-06-07): okno PIERWSZEJ (głównej) przerwy jest krótsze
// — start najpóźniej 18:30. Okno DRUGIEJ (dodatkowej) przerwy jest dłuższe (może startować później);
// i tak ogranicza je fizycznie R7 (pociąg musi wrócić przed zjazdem). Druga = zawsze połówka.
const LATEST_FIRST = hms(18, 30);  // pierwsza przerwa: twardo do 18:30 (R2: „19:10 = za późno")
const LATEST_SECOND = hms(20, 0);  // druga przerwa: dłuższe okno (realnie limituje R7/zjazd)

export interface PlanOptions {
  /** globalny próg „nie wcześniej niż" (sekundy od północy); domyślnie 14:30 */
  earliest?: number;
  /** ręczny override progu per obieg (klucz = id) — pozwala zacząć wcześniej niż próg globalny */
  earliestByObieg?: Record<string, number>;
  pref?: number;
  /** czy Centrum A13 dostępne (R8) — na razie bez slotów (brak kolumny w xlsx) */
  centrumEnabled?: boolean;
  /** ręcznie wymuszony rodzaj przerwy dla obiegu (klucz = id); brak = auto */
  forcedKinds?: Record<string, BreakKind>;
}

/** Wjazd na linię po południu: pierwsze zdarzenie po przerwie >60 min (po 12:00), inaczej pierwsze. */
export function afternoonEntryT(o: Obieg): number {
  const e = o.events;
  for (let i = 1; i < e.length; i++) {
    if (e[i].t - e[i - 1].t > 3600 && e[i].t >= 12 * 3600) return e[i].t;
  }
  return e.length ? e[0].t : 0;
}

interface Slot {
  station: BreakStation;
  dir: Dir;
  startT: number;
  kind: BreakKind;
  durationMin: number;
}

/** Sloty kandydujące dla obiegu i rodzaju przerwy. `latest` = najpóźniejszy START (okno 1. lub 2. przerwy).
 *  Długość liczona z REALNEGO rozkładu (nie sztywne 90/45/30): rezerwowy jest zajęty od wejścia w obieg
 *  do faktycznego POWROTU pociągu na tę stację. cała = następne minięcie tej stacji w TYM SAMYM kierunku
 *  (pełna pętla); połówka/szczeniak = najbliższe minięcie w PRZECIWNYM kierunku (pół pętli / krótki nawrót).
 *  Dwa pociągi dzielą minutę tylko mijając się w przeciwnych kierunkach, więc powrót tego samego obiegu
 *  jest jednoznaczny i zachowuje kolejność (pociąg jadący z tyłu wraca po pociągu z przodu). */
function candidateSlots(o: Obieg, kind: BreakKind, earliest: number, latest: number): Slot[] {
  const minStart = Math.max(earliest, afternoonEntryT(o));
  const sameDir = kind === "cała";
  const out: Slot[] = [];
  for (let i = 0; i < o.events.length; i++) {
    const ev = o.events[i];
    if (ev.t < minStart || ev.t > latest) continue;
    if (!stationSupports(ev.station, kind, ev.dir)) continue;
    // realny powrót na tę stację (R7: musi wrócić, zanim zjedzie — czyli zdarzenie istnieje w rozkładzie)
    let returnT = -1;
    for (let j = i + 1; j < o.events.length; j++) {
      const e2 = o.events[j];
      if (e2.station === ev.station && (sameDir ? e2.dir === ev.dir : e2.dir !== ev.dir)) {
        returnT = e2.t;
        break;
      }
    }
    if (returnT < 0) continue; // pociąg nie wraca już na tę stację (zjazd) → ta przerwa niemożliwa
    out.push({
      station: ev.station, dir: ev.dir, startT: ev.t, kind, durationMin: Math.round((returnT - ev.t) / 60),
    });
  }
  return out;
}

/** Wszystkie dopuszczalne sloty obiegu (wszystkie rodzaje) — do ręcznej edycji w UI. */
export function feasibleSlots(o: Obieg, opts: PlanOptions = {}): Slot[] {
  const earliest = opts.earliestByObieg?.[o.id] ?? opts.earliest ?? EARLIEST_DEFAULT;
  const all: Slot[] = [];
  for (const kind of DOWNGRADE) all.push(...candidateSlots(o, kind, earliest, LATEST_SECOND));
  return all.sort((a, b) => a.startT - b.startT || b.durationMin - a.durationMin);
}

export type { Slot };

interface RState {
  ref: Reserve;
  loadMin: number;  // realne minuty (informacyjnie / do wyświetlania)
  loadEq: number;   // równowartość całych (limit pracy = 3) — cała=1, połówka=0,5, szczeniak=⅓
  count: number;
  busyUntil: number;
  station: BreakStation;
  cap: number;      // limit liczby podmian (R17: rezerwa ruchowa A1 = 1; reszta = Infinity / 3 koła)
}

/** Wybór rezerwowego do slotu: TYLKO z tej samej stacji co slot (rezerwowy podmienia tam, gdzie stoi),
 *  wolny czasowo, w limicie 4,5h (R13) i limicie własnym (cap/maxJobs), nie zablokowany, najmniej obciążony. */
function pickReserve(rs: RState[], slot: Slot): RState | null {
  const startSec = slot.startT;
  const eligible = rs.filter(
    (r) =>
      !r.ref.blocked &&
      !r.ref.manualOnly && // „tylko ręcznie" — pomijany w automatycznym doborze (robi tylko piny)
      r.station === slot.station && // brak „pożyczania" z innej stacji
      r.busyUntil <= startSec &&
      (r.ref.availFrom == null || slot.startT >= r.ref.availFrom) && // R18: okno dostępności rezerwowego
      (r.ref.availTo == null || slot.startT + slot.durationMin * 60 <= r.ref.availTo) &&
      fitsLoad(r.loadEq, slot.kind) && // limit 3 całe (R13) — w równowartości całych, nie minutach
      r.count < r.cap // limit liczby podmian: rezerwa ruchowa A1 = 1, reszta = bez limitu (R17)
  );
  if (eligible.length === 0) return null;
  // PAKOWANIE: najpierw dobijamy już pracujących (max wykorzystanie, do 6 połówek / limitu 4,5h),
  // zostawiając świeżych rezerwowych wolnych na trudniejsze, późniejsze obiegi → lepsze pokrycie.
  eligible.sort((a, b) => b.loadMin - a.loadMin || b.count - a.count);
  return eligible[0];
}

/** Główny algorytm planowania przerw. */
export function planBreaks(obiegi: Obieg[], reserves: Reserve[], opts: PlanOptions = {}): PlanResult {
  const earliest = opts.earliest ?? EARLIEST_DEFAULT;
  // próg „nie wcześniej niż" per obieg: override > próg globalny (R2)
  const earliestOf = (o: Obieg) => opts.earliestByObieg?.[o.id] ?? earliest;
  // Score slotu (R2): 0 wewnątrz preferowanego okna 16:00–17:30, poza — odległość do krawędzi.
  // opts.pref (jeśli podane) wymusza pojedynczy punkt preferencji (back-compat, UI tego nie używa).
  const [prefLo, prefHi] = opts.pref != null ? [opts.pref, opts.pref] : PREF_WINDOW;
  const score = (s: Slot) =>
    s.startT < prefLo ? prefLo - s.startT : s.startT > prefHi ? s.startT - prefHi : 0;
  const forced = opts.forcedKinds ?? {};

  // R17 — wskazanie rezerwy ruchowej A1 (limit 1 koło): jawny flag `rolling` > pierwszy niezablokowany
  // rezerwowy A1. Pozostali rezerwowi A1 = bez limitu liczby (ogranicza ich tylko 3 koła, fitsLoad).
  const rollingA1Id =
    reserves.find((r) => r.station === "A1" && r.rolling && !r.blocked)?.id ??
    reserves.find((r) => r.station === "A1" && !r.blocked)?.id;
  // Limit liczby podmian rezerwowego: ręczny maxJobs > (rezerwa ruchowa A1 = 1) > bez limitu (Infinity).
  const capOf = (r: Reserve): number =>
    r.maxJobs ?? (r.id === rollingA1Id ? A1_MOBILE_MAX_JOBS : Infinity);

  // BILANS MOCY (tok pomocnika instruktora, §4a krok1): moc = Σ min(3 koła, cap); deficyt → 2× połówek.
  // Rezerwa ruchowa A1 wnosi tylko 1 koło → moc ≈ (rezerwowi−1)×3 + 1.
  const capacity = reserves.reduce(
    (s, r) => s + (r.blocked ? 0 : Math.min(MAX_RESERVE_LOAD_EQ, capOf(r))),
    0
  );
  const deficit = obiegi.length - capacity;

  // PRÓG POŁÓWKI (R10/E3) — liczony na realnych kołach 2. zmiany (countLoops2nd), bez sztywnej listy S:
  //   • ≤ 3 koła  → połówka ZAWSZE (twardy próg), niezależnie od liczby rezerwowych,
  //   • 3–4 koła  → ELASTYCZNIE: przy nadwyżce rezerwy → cała; przy deficycie schodzą na połówkę,
  //   • > 4 koła  → cała ZAWSZE (deficyt nigdy nie spycha ich na połówkę),
  //   • Infinity (jazda po 21:00 / całodobowe) → cała (poza kwalifikacją).
  const POL_HARD_LOOPS = 3;     // ≤3 koła = połówka bezwarunkowo
  const POL_ELASTIC_LOOPS = 4;  // 3–4 koła = kandydat na połówkę tylko przy deficycie
  const polEligible = (o: Obieg) => !forced[o.id] && Number.isFinite(o.loops);
  const hardPol = obiegi.filter((o) => polEligible(o) && o.loops <= POL_HARD_LOOPS).length;
  const elasticPol = obiegi.filter(
    (o) => polEligible(o) && o.loops > POL_HARD_LOOPS && o.loops <= POL_ELASTIC_LOOPS
  ).length;
  // deficyt zwiększa liczbę połówek o 2× deficyt, ale tylko w obrębie pasma elastycznego
  // (cap = hardPol + elasticPol); nadwyżka (deficyt ≤ 0) → polCount = hardPol (same twarde ≤3).
  const polCount = Math.min(hardPol + elasticPol, Math.max(hardPol, Math.max(0, deficit * 2)));
  // połówki dostają obiegi z NAJMNIEJSZĄ liczbą kół (szczyty); kolejność z rozkładu, bez sztywnej listy (D7).
  const autoPolowka = new Set(
    [...obiegi]
      .filter(polEligible)
      .sort((a, b) => a.loops - b.loops || a.firstT - b.firstT)
      .slice(0, polCount)
      .map((o) => o.id)
  );
  const dk = (o: Obieg) => forced[o.id] ?? (autoPolowka.has(o.id) ? "połówka" : "cała"); // ręczny mark > auto bilans

  // R3 — okno 1. (głównej) przerwy: najpóźniejszy START = min(18:30, realny_start + 6h).
  const latestFirstOf = (o: Obieg) => Math.min(LATEST_FIRST, o.entry2nd + MAX_CONTINUOUS);
  // OKNO 1. przerwy [od, do] dla obiegu. §4a krok4: szczyt z samą połówką (dk = połówka) nie dostaje jej
  // jako pierwszej — dolna granica = 1. pełne koło (entry2nd + czas koła), górna = 18:15.
  const firstWindow = (o: Obieg): [number, number] => {
    if (dk(o) === "połówka") {
      const lo = Math.max(earliestOf(o), o.entry2nd + o.lapMin * 60);
      const hi = Math.min(latestFirstOf(o), ONLY_POL_LATEST);
      return [lo, hi];
    }
    return [earliestOf(o), latestFirstOf(o)];
  };

  // Kolejność przetwarzania (R2a): NAJPIERW obiegi z całą, dopiero potem z połówką/szczeniakiem
  // („nie zaczynaj przerw od pociągów z połówkami"). To zgodne z tokiem pomocnika instruktora
  // (§4a: Krok 2 = całe, Krok 3 = połówki na A11). Połówki idą głównie na A11 (osobna pula rez.),
  // więc nie konkurują o tych samych rezerwowych co całe → bezpieczne dla pokrycia.
  // W obrębie jednej grupy: NAJBARDZIEJ OGRANICZONE najpierw (najmniej slotów), potem najwcześniejszy zjazd,
  // żeby ciasne obiegi złapały rezerwowego, zanim elastyczne całodobowe zajmą stacje.
  const kindRank = (o: Obieg) => DOWNGRADE.indexOf(dk(o)); // cała=0, połówka=1, szczeniak=2
  const typeRank = (o: Obieg) => (o.type === "S" ? 0 : o.type === "full" ? 1 : 2);
  const numOf = (id: string) => parseInt(id.replace(/\D/g, ""), 10) || 0;
  const slotCount = (o: Obieg) => {
    const [lo, hi] = firstWindow(o);
    return DOWNGRADE.slice(DOWNGRADE.indexOf(dk(o))).reduce((n, k) => n + candidateSlots(o, k, lo, hi).length, 0);
  };
  const order = [...obiegi].sort(
    (a, b) =>
      kindRank(a) - kindRank(b) ||
      slotCount(a) - slotCount(b) ||
      a.lastT - b.lastT ||
      typeRank(a) - typeRank(b) ||
      numOf(a.id) - numOf(b.id)
  );

  const rs: RState[] = reserves.map((r) => ({
    ref: r, loadMin: 0, loadEq: 0, count: 0, busyUntil: 0, station: r.station, cap: capOf(r),
  }));

  const assignments: Record<string, BreakAssignment[]> = {};
  const driverFreeAt: Record<string, number> = {}; // kiedy maszynista obiegu wraca z ostatniej przerwy
  const unassigned: string[] = [];

  const commit = (o: Obieg, slot: Slot, r: RState, manual = false) => {
    r.busyUntil = slot.startT + slot.durationMin * 60;
    r.loadMin += slot.durationMin;
    r.loadEq += CALA_EQ[slot.kind];
    r.count += 1;
    (assignments[o.id] ??= []).push({
      obiegId: o.id, station: slot.station, dir: slot.dir, startT: slot.startT,
      kind: slot.kind, durationMin: slot.durationMin, reserveId: r.ref.id, manual,
      crossTrack: isCrossTrackBreak(slot.kind), // R20: powrót w przeciwnym kierunku → bufor ~5 min
    });
    driverFreeAt[o.id] = slot.startT + slot.durationMin * 60;
  };

  // Próba przydzielenia obiegowi PIERWSZEJ przerwy PO powrocie maszynisty, wg preferowanego okna 16:00–17:30 (R2).
  // Okno 1. przerwy = firstWindow(o): górna granica = min(18:30, start+6h) (R3); dla szczytu z samą
  // połówką dolna = 1. pełne koło, górna = 18:15 (§4a krok4). Pokrycie: ma sloty, brak rez. → BRAK; nie schodź niżej.
  const tryAssign = (o: Obieg): boolean => {
    const [lo, hi] = firstWindow(o);
    const after = Math.max(driverFreeAt[o.id] ?? 0, lo);
    for (const kind of DOWNGRADE.slice(DOWNGRADE.indexOf(dk(o)))) {
      const slots = candidateSlots(o, kind, lo, hi)
        .filter((s) => s.startT >= after)
        .sort((a, b) => score(a) - score(b));
      if (slots.length === 0) continue; // brak slotów → prawdziwy downgrade (nie ma fizycznej możliwości)
      for (const slot of slots) {
        const r = pickReserve(rs, slot);
        if (r) { commit(o, slot, r); return true; }
      }
      return false; // ma sloty, brak wolnego rez. → spróbuj pokrycia awaryjnego (tryCover)
    }
    return false;
  };

  // POKRYCIE AWARYJNE (R9 > preferencja rodzaju): gdy preferowany rodzaj nie złapał rezerwowego,
  // zejdź na krótszy (połówka/szczeniak) i/lub szersze okno (do LATEST_SECOND), byle obieg dostał
  // JAKĄKOLWIEK przerwę. Lepszy krótszy/późniejszy break niż BRAK. Nie schodzi przy braku slotów.
  const tryCover = (o: Obieg): boolean => {
    const after = driverFreeAt[o.id] ?? 0;
    for (const kind of DOWNGRADE.slice(DOWNGRADE.indexOf(dk(o)))) {
      const slots = candidateSlots(o, kind, earliestOf(o), LATEST_SECOND)
        .filter((s) => s.startT >= after)
        .sort((a, b) => score(a) - score(b));
      for (const slot of slots) {
        const r = pickReserve(rs, slot);
        if (r) { commit(o, slot, r); return true; }
      }
    }
    return false;
  };

  // 0. PINY — wymuszone obiegi do podmiany przez rezerwowego (po kolei, na jego stacji).
  for (const r of rs) {
    if (r.ref.blocked) continue;
    for (const pinId of r.ref.pins ?? []) {
      const o = obiegi.find((x) => x.id === pinId);
      if (!o) continue;
      const after = Math.max(r.busyUntil, driverFreeAt[o.id] ?? 0);
      let done = false;
      for (const kind of DOWNGRADE.slice(DOWNGRADE.indexOf(dk(o)))) {
        const slots = candidateSlots(o, kind, earliestOf(o), LATEST_SECOND)
          .filter((s) => s.station === r.station && s.startT >= after)
          .sort((a, b) => score(a) - score(b));
        for (const slot of slots) {
          if (fitsLoad(r.loadEq, slot.kind) && r.count < r.cap) {
            commit(o, slot, r, true);
            done = true;
            break;
          }
        }
        if (done) break;
      }
    }
  }

  // 1. POKRYCIE — każdy obieg dostaje ≥1 przerwę (najbliżej 14:30); inaczej BRAK.
  for (const o of order) {
    if (assignments[o.id]?.length) continue; // już ma (pin)
    if (tryAssign(o)) continue;
    if (tryCover(o)) continue; // R9: pokrycie obowiązkowe — downgrade zanim oznaczysz BRAK
    let fb: Slot | null = null;
    const [flo, fhi] = firstWindow(o);
    for (const kind of DOWNGRADE.slice(DOWNGRADE.indexOf(dk(o)))) {
      const s = candidateSlots(o, kind, flo, fhi).sort((a, b) => score(a) - score(b))[0];
      if (s) { fb = s; break; }
    }
    if (fb) {
      assignments[o.id] = [{
        obiegId: o.id, station: fb.station, dir: fb.dir, startT: fb.startT,
        kind: fb.kind, durationMin: fb.durationMin, reserveId: null,
        crossTrack: isCrossTrackBreak(fb.kind),
      }];
    }
    unassigned.push(o.id);
  }

  // 2. R16 — DODATKOWA (druga) przerwa: maks. wykorzystanie rezerwowych, do MAX_BREAKS_PER_OBIEG na obieg.
  // Dozwolone kombinacje 2 przerw: {cała+połówka} (DOWOLNA kolejność), {cała+godzinka}, {połówka+połówka};
  // szczeniak dopuszczalny jako dokładka „gdy trzeba". {cała+cała} TYLKO przy nadmiarze (pełne pokrycie).
  // Okno 2. przerwy dłuższe (start do LATEST_SECOND; realnie limituje R7/zjazd). Rozmieszczenie (R2):
  // dwie połówki ~2,5 h od siebie; pozostałe kombinacje — blisko powrotu maszynisty (mały odstęp).
  const SPACING_POLOWKI = hms(2, 30);
  let progress = true;
  while (progress) {
    progress = false;
    for (const o of order) {
      const cur = assignments[o.id];
      if (!cur || cur.length === 0 || cur.length >= MAX_BREAKS_PER_OBIEG) continue;
      if (cur.some((a) => !a.reserveId)) continue; // BRAK — nie dokładaj
      const first = cur[cur.length - 1];
      const after = driverFreeAt[o.id] ?? 0;
      // CEL (potwierdzone 2026-06-07): poza A1 dobić każdego rezerwowego do PEŁNYCH 3 kół, sumując
      // wszystkie rodzaje przerw. Pokrycie (R9) jest już zapewnione wyżej, a ewentualny BRAK to brak
      // rezerwowego NA KONKRETNEJ stacji (innych stacji nie zasila — R14), więc dokładanie 2. przerwy
      // gdzie indziej nikomu nie odbiera pokrycia. Dlatego {cała+cała} jest dozwolona zawsze (nie tylko
      // przy nadmiarze), żeby domknąć rezerwowemu limit. Preferencja kombinacji bez zmian:
      // {cała+połówka} najlepsza, ale cała dostępna do dopełnienia 3 kół.
      const secondKinds: BreakKind[] =
        first.kind === "cała"
          ? ["połówka", "godzinka", "cała", "szczeniak"]
          : first.kind === "połówka"
          ? ["cała", "godzinka", "połówka", "szczeniak"]
          : ["połówka", "godzinka", "cała", "szczeniak"]; // 1.=godzinka/szczeniak
      let placed = false;
      for (const kind of secondKinds) {
        // dwie połówki rozsuń ~2,5 h; pozostałe kombinacje kładź blisko powrotu (mały odstęp).
        const target =
          first.kind === "połówka" && kind === "połówka" ? first.startT + SPACING_POLOWKI : after;
        const slots = candidateSlots(o, kind, earliestOf(o), LATEST_SECOND)
          .filter((s) => s.startT >= after)
          .sort((a, b) => Math.abs(a.startT - target) - Math.abs(b.startT - target));
        for (const slot of slots) {
          const r = pickReserve(rs, slot);
          if (r) { commit(o, slot, r); placed = true; break; }
        }
        if (placed) break; // dokładka położona — nie próbuj mniejszych rodzajów
      }
      if (placed) progress = true;
    }
  }

  const reserveLoadMin: Record<string, number> = {};
  const reserveCount: Record<string, number> = {};
  for (const r of rs) {
    reserveLoadMin[r.ref.id] = r.loadMin;
    reserveCount[r.ref.id] = r.count;
  }

  return { assignments, unassigned, reserveLoadMin, reserveCount };
}

// reużycie w UI
export { STATIONS };
