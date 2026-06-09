import type {
  Obieg, Reserve, BreakAssignment, PlanResult, BreakKind, Dir, BreakStation,
} from "./types";
import { CALA_EQ, MAX_BREAKS_PER_OBIEG, MAX_RESERVE_LOAD_EQ, fitsLoad, returnsOppositeTrack, XFER_BUFFER_MIN } from "./types";
import { STATIONS, DOWNGRADE, stationSupports } from "./stations";

const hms = (h: number, m: number) => h * 3600 + m * 60;

// Rodzaje brane pod uwagę AUTOMATYCZNIE: TYLKO **cała → połówka** (potwierdzone 2026-06-08, z doświadczenia).
// Godzinka i szczeniak NIE są nadawane automatycznie — godzinka to większy wysiłek planistyczny i większe
// ryzyko, że awaria rozsypie układ (brak pociągu do podmiany); szczeniak (~30 min) jest po prostu za słaby.
// Strategia: całe na wszystkich stacjach oprócz A11, a na A11 połówki + całe (A11 uciągnie nawet ~30 połówek
// na 5 maszynistów). Godzinkę/szczeniaka można wybrać tylko ręcznie w edytorze.
const AUTO_KINDS: BreakKind[] = DOWNGRADE.filter((k) => k === "cała" || k === "połówka");

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
const EARLIEST_DEFAULT = hms(14, 30);    // „zacznij od" — domyślny start przerw (R2)
// „ZACZNIJ OD" + TOLERANCJA (decyzja użytkownika 2026-06-09): ustawienie „nie wcześniej niż" jest CELEM
// startu, nie tylko twardą granicą. Sloty w oknie [próg, próg + 15 min] są równie dobre (score 0); dopiero
// powyżej tolerancji score rośnie. Daje to 15-min luz na lepsze upakowanie rezerwowych blisko docelowego startu.
const START_TOLERANCE = 15 * 60;
// PREFEROWANY KIERUNEK (tor) podmiany na stacji — MIĘKKO (decyzja użytkownika 2026-06-09: „to nie jest
// sztywna zasada, można mieszać jeśli potrzeba"). Tor 1 = Młociny, tor 2 = Kabaty.
// A1 i A7 → Kabaty (tor 2); A18 i A23 → Młociny (tor 1); A11 → OBA tory (bez preferencji).
const DIR_PREF: Partial<Record<BreakStation, Dir>> = { A1: "Kabaty", A7: "Kabaty", A18: "Młociny", A23: "Młociny" };
// Kara za niepreferowany tor: na tyle mała, że ustępuje pokryciu i znacząco lepszemu czasowi startu,
// ale rozstrzyga remisy (np. w oknie tolerancji) na korzyść preferowanego toru.
const DIR_PENALTY = 6 * 60;
// DWA OKNA startu (R2, model potwierdzony 2026-06-07): okno PIERWSZEJ (= jedynej gwarantowanej) przerwy
// jest krótsze — start najpóźniej 18:20. Okno DRUGIEJ (dodatkowej) przerwy jest dłuższe (może startować
// później); i tak ogranicza je fizycznie R7 (pociąg musi wrócić przed zjazdem). Druga = zawsze połówka.
const LATEST_FIRST = hms(18, 20);  // 1. (a zarazem JEDYNA gwarantowana) przerwa: twardo do 18:20.
                                   // Reguła: jedyna przerwa NIE może startować po 18:20 (pokrycie = 1 przerwa).
const LATEST_SECOND = hms(20, 0);  // DRUGA (dodatkowa) przerwa: dłuższe okno (realnie limituje R7/zjazd)

// ROZKŁADANIE startów (R2): preferujemy NAJWCZEŚNIEJSZY slot od progu startu stacji w górę (earliestByStation
// > earliest globalny; domyślnie 14:30 — użytkownik ustawia próg sam). Moc rezerwowych wypełnia się od dołu,
// a naturalna serializacja (jeden maszynista = jeden pociąg naraz) i tak rozkłada przerwy po popołudniu.
// (Dawniej był „magnes" na 16:00, potem pełznący kursor — kursor przy bottlenecku A11 uciekał przed wolną
// wczesną mocą i robił BRAK mimo zapasu, więc wrócono do prostego „od progu w górę".)

// SCARCITY A11: połówka/godzinka/szczeniak są możliwe TYLKO na A11 (jedyna stacja z połówką), więc moc
// A11 jest wąskim gardłem. CAŁĄ można zrobić na każdej stacji, którą obieg mija — więc całe ODPYCHAMY
// z A11 (duża kara w score), żeby nie zjadały miejsca dla połówek. Kara tylko DEPRIORYTETYZUJE: gdy poza
// A11 nie ma już wolnego rezerwowego, cała i tak wejdzie na A11 (nadmiar). 12 h ≫ każdy dystans czasowy.
const A11_CALA_PENALTY = 12 * 3600;

export interface PlanOptions {
  /** globalny próg „nie wcześniej niż" (sekundy od północy); domyślnie 14:30 */
  earliest?: number;
  /** próg „nie wcześniej niż" PER STACJA (klucz = kod stacji) — nadpisuje globalny dla slotów na tej
   *  stacji; jest też kotwicą rozkładania (od tej godziny pełznie cel startu danej stacji). */
  earliestByStation?: Partial<Record<BreakStation, number>>;
  /** ręczny override progu per obieg (klucz = id) — najsilniejszy, pozwala zacząć wcześniej/później */
  earliestByObieg?: Record<string, number>;
  pref?: number;
  /** czy Centrum A13 dostępne (R8) — na razie bez slotów (brak kolumny w xlsx) */
  centrumEnabled?: boolean;
  /** ręcznie wymuszony rodzaj przerwy dla obiegu (klucz = id); brak = auto */
  forcedKinds?: Record<string, BreakKind>;
  /** ręczne oznaczenie obiegu jako CAŁOZMIANOWY (ustawia pomocnik): true = wymuś (jak całodobowy →
   *  zawsze cała, priorytet), false = wymuś zwykły (mimo auto-wykrycia), brak klucza = auto z rozkładu. */
  throughShiftOverride?: Record<string, boolean>;
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
function candidateSlots(o: Obieg, kind: BreakKind, earliest: number | ((s: BreakStation) => number), latest: number): Slot[] {
  const floorAt = typeof earliest === "function" ? earliest : () => earliest;
  const ae = afternoonEntryT(o);
  const sameDir = kind === "cała";
  const out: Slot[] = [];
  for (let i = 0; i < o.events.length; i++) {
    const ev = o.events[i];
    // próg startu jest PER STACJA (floorAt) — różne stacje obiegu mogą mieć różne „nie wcześniej niż"
    if (ev.t < Math.max(floorAt(ev.station), ae) || ev.t > latest) continue;
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
  const g = opts.earliest ?? EARLIEST_DEFAULT;
  // próg startu slotu: override per-obieg > per-stacja > globalny
  const floor = (s: BreakStation) => opts.earliestByObieg?.[o.id] ?? opts.earliestByStation?.[s] ?? g;
  const all: Slot[] = [];
  for (const kind of DOWNGRADE) all.push(...candidateSlots(o, kind, floor, LATEST_SECOND));
  return all.sort((a, b) => a.startT - b.startT || b.durationMin - a.durationMin);
}

export type { Slot };

interface RState {
  ref: Reserve;
  loadMin: number;  // realne minuty (informacyjnie / do wyświetlania)
  loadEq: number;   // równowartość całych (limit pracy = 3) — cała=1, połówka=0,5, szczeniak=⅓
  count: number;
  jobs: Array<{ s: number; e: number; obiegId: string }>; // zajęte interwały (+id obiegu) — sprawdzamy realne
                                         // NAKŁADANIE, nie pojedynczy „busyUntil"; dzięki temu rezerwowy może brać
                                         // podmiany w DOWOLNEJ kolejności czasowej (np. wczesną CAŁĄ po późnej
                                         // POŁÓWCE) — kluczowe dla wolnej mocy przy bottleneck-first. obiegId → pass naprawczy.
  station: BreakStation;
  cap: number;      // limit liczby podmian (R17: rezerwa ruchowa A1 = 1; reszta = Infinity / 3 koła)
}

/** Czy rezerwowy jest wolny w całym przedziale [s, e) (brak nakładania z żadną już przypisaną podmianą). */
const freeAt = (r: RState, s: number, e: number): boolean => !r.jobs.some((j) => s < j.e && j.s < e);

/** Wybór rezerwowego do slotu: TYLKO z tej samej stacji co slot (rezerwowy podmienia tam, gdzie stoi),
 *  wolny czasowo (bez nakładania), w limicie 4,5h (R13) i limicie własnym (cap/maxJobs), nie zablokowany. */
function pickReserve(rs: RState[], slot: Slot): RState | null {
  const endSec = slot.startT + slot.durationMin * 60;
  const eligible = rs.filter(
    (r) =>
      !r.ref.blocked &&
      !r.ref.manualOnly && // „tylko ręcznie" — pomijany w automatycznym doborze (robi tylko piny)
      r.station === slot.station && // brak „pożyczania" z innej stacji
      freeAt(r, slot.startT, endSec) && // brak nakładania z inną podmianą tego rezerwowego
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
  // próg „nie wcześniej niż": per-stacja nadpisuje globalny (jest też kotwicą rozkładania)
  const stationEarliest = (s: BreakStation) => opts.earliestByStation?.[s] ?? earliest;
  // efektywny próg slotu: override per-obieg > per-stacja > globalny (R2)
  const floorOf = (o: Obieg, s: BreakStation) => opts.earliestByObieg?.[o.id] ?? stationEarliest(s);
  // scarcity: odepchnij CAŁE z A11 (A11 zostawiamy na połówki — jedyne miejsce, gdzie są możliwe)
  const scarcity = (s: Slot) => (s.kind === "cała" && s.station === "A11" ? A11_CALA_PENALTY : 0);
  // SCORE (mniejszy = lepszy): po scarcity preferuj start w oknie [„zacznij od", +15 min tolerancji] danej
  // stacji. Próg „zacznij od" = USTAWIENIE „nie wcześniej niż" (opts.earliest / per-stacja) — to ono steruje,
  // kiedy ruszają przerwy (decyzja użytkownika 2026-06-09). Sloty w [próg, próg+15] = score 0 (luz na lepsze
  // upakowanie); powyżej tolerancji score rośnie liniowo, więc dalsze starty są tym gorsze. Osobny próg 3,5
  // koła (coverWindow) pilnuje, by SAMOTNA połówka długodystansowca nie była pierwszą podmianą.
  // opts.pref = stary „magnes" na konkretną godzinę (back-compat, nieużywany przez UI).
  // miękka kara za niepreferowany tor na danej stacji (A11 = oba tory, bez preferencji)
  const dirPenalty = (s: Slot) => (DIR_PREF[s.station] && s.dir !== DIR_PREF[s.station] ? DIR_PENALTY : 0);
  const score = (s: Slot) => {
    if (opts.pref != null) return Math.abs(s.startT - opts.pref);
    const over = s.startT - stationEarliest(s.station) - START_TOLERANCE; // > 0 dopiero poza tolerancją
    return scarcity(s) + dirPenalty(s) + (over > 0 ? over : 0);
  };
  const forced = opts.forcedKinds ?? {};
  // CAŁOZMIANOWY (throughShift) — auto z rozkładu (zjazd ≥ 21:00 → loops=∞) LUB ręczne wskazanie pomocnika
  // (override). Taki obieg traktujemy jak całodobowy: ZAWSZE cała (wykluczony z racjonowania), priorytet
  // pokrycia (criticalRank), a do sortowania „najdłuższe pierwsze" jego efektywne koła = ∞.
  const isThrough = (o: Obieg) => opts.throughShiftOverride?.[o.id] ?? o.throughShift;
  const effLoops = (o: Obieg) => (isThrough(o) ? Infinity : o.loops);
  // klucz sortowania malejąco po kołach (∞ → największy); dwa ∞ = remis (rozstrzyga dalszy tie-break)
  const loopKey = (o: Obieg) => (Number.isFinite(effLoops(o)) ? effLoops(o) : 1e9);

  // R17 — wskazanie rezerwy ruchowej A1 (limit 1 koło): jawny flag `rolling` > pierwszy niezablokowany
  // rezerwowy A1. Pozostali rezerwowi A1 = bez limitu liczby (ogranicza ich tylko 3 koła, fitsLoad).
  const rollingA1Id =
    reserves.find((r) => r.station === "A1" && r.rolling && !r.blocked)?.id ??
    reserves.find((r) => r.station === "A1" && !r.blocked)?.id;
  // Limit liczby podmian rezerwowego: ręczny maxJobs > (rezerwa ruchowa A1 = 1) > bez limitu (Infinity).
  const capOf = (r: Reserve): number =>
    r.maxJobs ?? (r.id === rollingA1Id ? A1_MOBILE_MAX_JOBS : Infinity);


  // RODZAJ PRZERWY — BILANS NADRZĘDNY + sprawiedliwość wg kół (decyzja użytkownika 2026-06-08/09):
  // • Domyślnie KAŻDY obieg dostaje PEŁNĄ przerwę (cała; na A11 — 2 połówki). „Daj jak najwięcej całych."
  // • TWARDY próg (R10 E3): ≤ 3 koła = POŁÓWKA ZAWSZE (pracuje krótko, pełna by się nie zmieściła / byłaby
  //   marnotrawstwem). To JEDYNE połówki przy NADWYŻCE mocy — reszta (w tym szczyty 3–4 koła) dostaje pełną.
  // RACJONOWANIE przy DEFICYCIE: gdy mocy nie starcza na pełne przerwy dla wszystkich >3 kół, TNIEMY całe na
  // połówki „NAJMNIEJ kół najpierw" — rozszerzamy zbiór połówek W GÓRĘ po kołach (najpierw 4-kołowe szczyty,
  // potem wyżej), aż zapotrzebowanie (eq) zejdzie do dostępnej mocy. (Bilans nadrzędny: jeśli matematycznie
  // się mieści — silnik musi upakować; jeśli nie — cięcie wg kół, nie losowo.) Każde cięcie cała→połówka = −0,5 eq.
  // KLUCZOWE: próg jest BILANSOWY, nie sztywny — przy nadwyżce rezerwowych 4-kołowy szczyt dostaje CAŁĄ
  // (eliminuje to „obiegi z połówką", gdy moc pozwala na pełne), a dopiero deficyt schodzi na połówki od dołu.
  const HARD_POL_LOOPS = 3; // ≤ 3 koła = połówka ZAWSZE (twardy próg R10 E3)
  const eligible = [...obiegi]
    .filter((o) => !forced[o.id] && !isThrough(o) && Number.isFinite(o.loops)) // całozmianowe poza racjonowaniem
    .sort((a, b) => a.loops - b.loops || a.firstT - b.firstT);
  // MOC do bilansu = rezerwowi „do pełnej dyspozycji" × 3 koła. Rezerwa ruchowa A1 (Kopyt, rollingA1Id) NIE
  // wchodzi do mocy — jej 1 koło to bufor pod ręką (R17), nie planowana moc. Dzięki temu bilans = 10×3 = 30
  // (tak liczy pomocnik instruktora), a bufor Kopyta amortyzuje niedoskonałość pakowania.
  const capacity = reserves.reduce(
    (s, r) => s + (r.blocked || r.id === rollingA1Id ? 0 : Math.min(MAX_RESERVE_LOAD_EQ, capOf(r))), 0
  );
  const autoPolowka = new Set(eligible.filter((o) => o.loops <= HARD_POL_LOOPS).map((o) => o.id));
  // eqDemand respektuje też RĘCZNE/NAWROTOWE cięcia (forced=połówka) — patrz RETRY niżej
  const eqDemand = () => obiegi.reduce((s, o) => s + (forced[o.id] === "połówka" || autoPolowka.has(o.id) ? 0.5 : 1), 0);
  // PRZY ZEROWEJ MOCY (brak obsady, capacity = 0) NIE racjonujemy: bilans nie ma o co się oprzeć (połówka też
  // wymaga rezerwowego — przy 0 obsady i tak wszystko = BRAK). Podgląd ma pokazywać CEL („daj jak najwięcej
  // całych"): każdy obieg = CAŁA, połówka tylko z twardego progu ≤3 koła. Dopiero realna moc „dociska" rodzaje
  // w dół, od najmniej kół (decyzja użytkownika 2026-06-09).
  for (const o of eligible) {
    if (capacity <= 0) break;                     // 0 obsady → pokaż cel, nie najgorszy przypadek
    if (o.loops <= HARD_POL_LOOPS) continue;     // ≤3 koła już są połówkami (twardy próg)
    if (eqDemand() <= capacity) break;            // bilans się spina (nadwyżka) → nie tnij więcej, reszta = całe
    autoPolowka.add(o.id);                         // deficyt: utnij temu (najmniej kół z pozostałych) → połówka
  }
  const dk = (o: Obieg) => forced[o.id] ?? (autoPolowka.has(o.id) ? "połówka" : "cała"); // ręczny mark > auto

  // R3 — okno 1. (głównej) przerwy: najpóźniejszy START = min(18:20, realny_start + 6h).
  const latestFirstOf = (o: Obieg) => Math.min(LATEST_FIRST, o.entry2nd + MAX_CONTINUOUS);
  // OKNO POKRYCIA (1./JEDYNEJ przerwy) dla DANEGO rodzaju. Dół = próg per-stacja (floorOf); dla POŁÓWKI
  // dodatkowo ≥ 1. pełne koło (§4a krok4: „tylko połówka NIE na 1. kole"). Góra = min(18:20, start+6h)
  // (reguła „jedyna przerwa ≤ 18:20"); połówka jako jedyna też ≤ 18:15 (ONLY_POL_LATEST). 2. (dodatkowa)
  // przerwa NIE używa tego okna — ma własne, szersze (R16, do LATEST_SECOND).
  // Próg „samotna połówka nie pierwsza" (decyzja użytkownika 2026-06-09): obieg robiący ≥ 3,5 koła nie może
  // dostać połówki jako PIERWSZEJ podmiany — dopiero po 1. pełnym kole (entry2nd + koło). Obieg < 3,5 koła
  // (drobny szczyt) może mieć połówkę wcześnie, od progu z ustawień.
  // WYJĄTEK: gdy rezerwowych jest MNIEJ NIŻ 10, reguła znika — przy ciasnej obsadzie pakujemy wszystko jak
  // najwcześniej, by się zmieściło (decyzja użytkownika 2026-06-09: „zostaw, chyba że < 10 rezerwowych").
  const POL_LATE_LOOPS = 3.5;
  const enoughReserves = reserves.filter((r) => !r.blocked).length >= 10;
  const coverWindow = (o: Obieg, kind: BreakKind): { floor: (s: BreakStation) => number; hi: number } => {
    if (kind === "połówka") {
      // po 1. kole tylko gdy: dość rezerwowych (≥10) ORAZ obieg ≥ 3,5 koła; inaczej połówka może startować wcześnie
      const polLo = enoughReserves && effLoops(o) >= POL_LATE_LOOPS ? o.entry2nd + o.lapMin * 60 : 0;
      return { floor: (s) => Math.max(floorOf(o, s), polLo), hi: Math.min(latestFirstOf(o), ONLY_POL_LATEST) };
    }
    return { floor: (s) => floorOf(o, s), hi: latestFirstOf(o) };
  };

  // AUTO: na A11 NIE nadajemy CAŁYCH — A11 to stacja POŁÓWEK (decyzja użytkownika 2026-06-08). Obieg,
  // który chciałby całą, ale nie mieści się poza A11, jest na A11 obsługiwany jako POŁÓWKA (a w R16 może
  // dostać 2. połówkę → równowartość całej). Dwie połówki (~45 min) zamiast jednej całej (~90 min) dają
  // drobniejsze bloki → ciaśniejsze pakowanie rezerwowych i WIĘCEJ opcji podmian (cała@A11 blokowała
  // rezerwowego na ~85 min i wypierała połówki, np. D22). Ręczny edytor (feasibleSlots) wciąż pozwala na
  // cała@A11 — to ograniczenie tylko dla automatu.
  const autoSlots = (o: Obieg, kind: BreakKind, floor: number | ((s: BreakStation) => number), hi: number) =>
    candidateSlots(o, kind, floor, hi).filter((s) => !(s.kind === "cała" && s.station === "A11"));

  // Kolejność przetwarzania — CAŁE PIERWSZE (jak liczy pomocnik instruktora, §4a krok2→3; ZASADY.md R2a).
  // Bilans daje 24 całe + 12 połówek; najpierw rozdajemy CAŁE na stacjach ≠ A11 (A1/A7/A18/A23), a połówki
  // lądują na A11 w DRUGIEJ kolejności — to, co z matematyki zostaje po rozłożeniu całych. W obrębie całych
  // CAŁODOBOWE (loops=∞ / throughShift) idą NA PRZEDZIE: jeżdżą całą dobę i można je obsadzić TYLKO całą,
  // więc mają najmniej alternatyw — muszą zająć moc poza A11, zanim zrobią to obiegi liczone (które mogą
  // awaryjnie zejść na połówkę@A11). lastT całodobowych (~24:00) to KONIEC DOBY, nie ograniczenie zjazdu —
  // dlatego NIE sortujemy ich po nim na koniec. (Dawniej: bottleneck-first = połówki/szczyty pierwsze —
  // przez to całodobowe trafiały na sam koniec i szły na BRAK, a szczyty dostawały po 2 przerwy.)
  // Połówki na A11 i tak pilnuje scarcity (A11_CALA_PENALTY odpycha całe) + coverWindow (§4a krok4).
  const kindRank = (o: Obieg) => (dk(o) === "cała" ? 0 : 1); // CAŁA przed połówką (krok2 przed krok3)
  const criticalRank = (o: Obieg) => (isThrough(o) || !Number.isFinite(o.loops) ? 0 : 1); // całozmianowe najpierw
  const typeRank = (o: Obieg) => (o.type === "S" ? 0 : o.type === "full" ? 1 : 2);
  const numOf = (id: string) => parseInt(id.replace(/\D/g, ""), 10) || 0;
  const slotCount = (o: Obieg) =>
    AUTO_KINDS.slice(AUTO_KINDS.indexOf(dk(o))).reduce((n, k) => {
      const { floor, hi } = coverWindow(o, k);
      return n + autoSlots(o, k, floor, hi).length;
    }, 0);
  // Wśród CAŁYCH (po criticalRank) — NAJDŁUŻSZE pierwsze (malejąco po kołach): długodystansowce zajmują
  // całe off-A11 przed szczytami (uwaga 5: całozmianowy/wysoko-kołowy ma pierwszeństwo do całej, kosztem
  // szczytów). slotCount pozostaje dalszym tie-breakiem (obiegi z mniejszą liczbą opcji wcześniej).
  const order = [...obiegi].sort(
    (a, b) =>
      kindRank(a) - kindRank(b) ||
      criticalRank(a) - criticalRank(b) ||
      loopKey(b) - loopKey(a) ||
      slotCount(a) - slotCount(b) ||
      a.lastT - b.lastT ||
      typeRank(a) - typeRank(b) ||
      numOf(a.id) - numOf(b.id)
  );

  const rs: RState[] = reserves.map((r) => ({
    ref: r, loadMin: 0, loadEq: 0, count: 0, jobs: [], station: r.station, cap: capOf(r),
  }));

  const assignments: Record<string, BreakAssignment[]> = {};
  const driverFreeAt: Record<string, number> = {}; // kiedy maszynista obiegu wraca z ostatniej przerwy
  const unassigned: string[] = [];

  const commit = (o: Obieg, slot: Slot, r: RState, manual = false) => {
    r.jobs.push({ s: slot.startT, e: slot.startT + slot.durationMin * 60, obiegId: o.id });
    r.loadMin += slot.durationMin;
    r.loadEq += CALA_EQ[slot.kind];
    r.count += 1;
    (assignments[o.id] ??= []).push({
      obiegId: o.id, station: slot.station, dir: slot.dir, startT: slot.startT,
      kind: slot.kind, durationMin: slot.durationMin, reserveId: r.ref.id, manual,
    });
    driverFreeAt[o.id] = slot.startT + slot.durationMin * 60;
  };

  // Próba przydzielenia obiegowi PIERWSZEJ przerwy PO powrocie maszynisty, najwcześniej jak się da (R2).
  // Okno 1. przerwy = coverWindow(o, kind): górna granica = min(18:20, start+6h) (R3); dla szczytu z samą
  // połówką dolna = 1. pełne koło, górna = 18:15 (§4a krok4). Pokrycie: ma sloty, brak rez. → BRAK; nie schodź niżej.
  const tryAssign = (o: Obieg, allowA11Cala = false): boolean => {
    const after = driverFreeAt[o.id] ?? 0; // próg startu egzekwuje candidateSlots (per stacja/rodzaj)
    const src = allowA11Cala ? candidateSlots : autoSlots; // faza 3: dopuść cała@A11 (pełna przerwa overflow)
    for (const kind of AUTO_KINDS.slice(AUTO_KINDS.indexOf(dk(o)))) {
      const { floor, hi } = coverWindow(o, kind);
      const slots = src(o, kind, floor, hi)
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

  // POKRYCIE AWARYJNE (R9 > preferencja rodzaju): gdy preferowany rodzaj nie złapał rezerwowego, zejdź na
  // krótszy (połówka/szczeniak), byle obieg dostał JAKĄKOLWIEK przerwę. Okno to samo co coverage (≤18:20 —
  // jedyna przerwa nie może być później), tylko z pełnym downgrade rodzaju. Lepszy krótszy break niż BRAK.
  const tryCover = (o: Obieg): boolean => {
    const after = driverFreeAt[o.id] ?? 0;
    for (const kind of AUTO_KINDS.slice(AUTO_KINDS.indexOf(dk(o)))) {
      const { floor, hi } = coverWindow(o, kind);
      const slots = autoSlots(o, kind, floor, hi)
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
      const after = driverFreeAt[o.id] ?? 0;
      let done = false;
      for (const kind of AUTO_KINDS.slice(AUTO_KINDS.indexOf(dk(o)))) {
        const slots = candidateSlots(o, kind, (s) => floorOf(o, s), LATEST_SECOND)
          .filter((s) => s.station === r.station && s.startT >= after)
          .sort((a, b) => score(a) - score(b));
        for (const slot of slots) {
          if (freeAt(r, slot.startT, slot.startT + slot.durationMin * 60) && fitsLoad(r.loadEq, slot.kind) && r.count < r.cap) {
            commit(o, slot, r, true);
            done = true;
            break;
          }
        }
        if (done) break;
      }
    }
  }

  // 1. POKRYCIE — każdy obieg dostaje ≥1 przerwę; inaczej BRAK. Kolejność FAZ = metoda pomocnika
  // instruktora (§4a krok2→3): (1) CAŁE poza A11 (całodobowe pierwsze, najmniej alternatyw); (2) dedykowane
  // POŁÓWKI na A11 — zajmują A11, ZANIM wejdzie tam nadmiar całych; (3) NADMIAR całych (niezmieszczonych
  // poza A11) → na A11 jako POŁÓWKA (rozbicie całej na ½). Dzięki temu szczyty (A11-only, najbardziej
  // ograniczone) nie są wypierane z A11 przez nadmiar całych, a całodobowe mają pierwszeństwo poza A11.
  const fallbackBrak = (o: Obieg) => {
    let fb: Slot | null = null;
    for (const kind of AUTO_KINDS.slice(AUTO_KINDS.indexOf(dk(o)))) {
      const { floor: ffloor, hi: fhi } = coverWindow(o, kind);
      const s = autoSlots(o, kind, ffloor, fhi).sort((a, b) => score(a) - score(b))[0];
      if (s) { fb = s; break; }
    }
    if (fb) {
      assignments[o.id] = [{
        obiegId: o.id, station: fb.station, dir: fb.dir, startT: fb.startT,
        kind: fb.kind, durationMin: fb.durationMin, reserveId: null,
      }];
    }
    unassigned.push(o.id);
  };

  // FAZA 1 — CAŁE poza A11 (autoSlots blokuje cała@A11). BEZ downgrade: niezmieszczone czekają na fazę 3,
  // żeby nie zajmować A11 przed dedykowanymi połówkami.
  const pendingCala: Obieg[] = [];
  for (const o of order) {
    if (dk(o) !== "cała" || assignments[o.id]?.length) continue; // pin/inny rodzaj
    if (!tryAssign(o)) pendingCala.push(o);
  }
  // FAZA 2 — dedykowane POŁÓWKI na A11 (claim A11 przed nadmiarem całych).
  for (const o of order) {
    if (dk(o) === "cała" || assignments[o.id]?.length) continue;
    if (tryAssign(o)) continue;
    if (tryCover(o)) continue;
    fallbackBrak(o);
  }
  // FAZA 3 — NADMIAR całych (niezmieszczonych poza A11): NA A11 NIE dajemy cała@A11 (zajmuje rezerwowego na
  // ~90 min, mało elastyczne). Zamiast tego dostają PIERWSZĄ POŁÓWKĘ@A11 (po 1. kole, w oknie preferencji),
  // a R16 dokłada DRUGĄ POŁÓWKĘ → 2×½ = pełna przerwa („rozbicie całej na dwie połówki — więcej opcji
  // podmian", decyzja użytkownika 2026-06-09). Drobniejsze bloki = ciaśniejsze pakowanie. Kolejność: cała
  // off-A11 (gdyby się zwolniło) → połówka@A11. Gdy nic nie wchodzi → BRAK (sygnał „dodać rezerwowego").
  for (const o of pendingCala) {
    if (assignments[o.id]?.length) continue;
    if (tryAssign(o)) continue;   // cała poza A11 (preferowane — to jest „cała")
    if (tryCover(o)) continue;    // overflow → połówka@A11 (1. połowa; R16 dopełni do 2×½ = pełna przerwa)
    fallbackBrak(o);
  }

  // 1b. PASS NAPRAWCZY (eviction 1-poziomowy): dla każdego BRAK obiegu spróbuj ZWOLNIĆ rezerwowego,
  // przenosząc jego dotychczasową (jedyną) podmianę na innego wolnego rezerwowego / inny slot. Greedy bywa
  // zachłanny i zostawia BRAK mimo istnienia wolnej mocy (elastyczny obieg obsłużony na końcu trafia w czasowo
  // zapełnione okno ≤18:20). Pass działa PRZED R16, więc każdy obsadzony obieg ma dokładnie 1 przerwę.
  const removeJob = (r: RState, a: BreakAssignment) => {
    r.jobs = r.jobs.filter((j) => !(j.s === a.startT && j.e === a.startT + a.durationMin * 60 && j.obiegId === a.obiegId));
    r.loadMin -= a.durationMin; r.loadEq -= CALA_EQ[a.kind]; r.count -= 1;
  };
  // Przenieś pokrycie obiegu o2 GDZIE INDZIEJ (dowolny rodzaj/stacja/rezerwowy), byle nie na `avoidR` w oknie
  // [aS, aE) (bo to okno ma zwolnić się dla BRAK-obiegu). Zwraca true, gdy o2 dostał nową przerwę.
  const placeElsewhere = (o2: Obieg, avoidR: RState, aS: number, aE: number): boolean => {
    // ZACHOWAJ WIELKOŚĆ przerwy o2 — BEZ downgrade: długodystansowiec/całodobowy relokuje się tylko na
    // CAŁĄ (off-A11 lub @A11), szczyt na POŁÓWKĘ. Eviction nie może skrzywdzić nikogo pojedynczą połówką
    // (sprawiedliwość wg kół). candidateSlots → dopuszcza cała@A11 jako miejsce relokacji.
    const { floor, hi } = coverWindow(o2, dk(o2));
    const slots = candidateSlots(o2, dk(o2), floor, hi).sort((a, b) => score(a) - score(b));
    for (const slot of slots) {
      const sE = slot.startT + slot.durationMin * 60;
      const r = pickReserve(rs, slot);
      if (r && !(r === avoidR && slot.startT < aE && aS < sE)) { commit(o2, slot, r); return true; }
    }
    return false;
  };
  const repair = (o: Obieg): boolean => {
    for (const kind of [dk(o)]) { // tylko DOCELOWA wielkość (bez downgrade) — sprawiedliwość wg kół
      const { floor, hi } = coverWindow(o, kind);
      for (const so of candidateSlots(o, kind, floor, hi).sort((a, b) => score(a) - score(b))) { // dopuść cała@A11
        const soE = so.startT + so.durationMin * 60;
        for (const r of rs) {
          if (r.station !== so.station || r.ref.blocked || r.ref.manualOnly) continue;
          if (r.ref.availFrom != null && so.startT < r.ref.availFrom) continue;
          if (r.ref.availTo != null && soE > r.ref.availTo) continue;
          if (!fitsLoad(r.loadEq, so.kind) || r.count >= r.cap) continue; // moc/limit muszą się zgadzać
          const overlap = r.jobs.filter((j) => so.startT < j.e && j.s < soE);
          if (overlap.length !== 1) continue; // tylko prosta kolizja: jedna podmiana do przeniesienia
          const o2 = obiegi.find((x) => x.id === overlap[0].obiegId);
          const a2 = o2 && (assignments[o2.id] ?? []).find((a) => a.startT === overlap[0].s && a.reserveId === r.ref.id);
          if (!o2 || !a2 || a2.manual || (assignments[o2.id]?.length ?? 0) !== 1) continue; // nie ruszaj pinów / 2-przerwowych
          // spróbuj przenieść podmianę o2 — najpierw wycofaj ją, potem szukaj nowego miejsca
          removeJob(r, a2);
          assignments[o2.id] = [];
          const prevFree = driverFreeAt[o2.id]; delete driverFreeAt[o2.id];
          if (placeElsewhere(o2, r, so.startT, soE)) {
            const rr = pickReserve(rs, so); // r (lub inny) powinien być teraz wolny na so
            if (rr) { commit(o, so, rr); return true; }
            return false; // o2 przeniesiony, ale o i tak się nie zmieścił — zostaw (o2 ok)
          }
          // przywróć stan o2
          assignments[o2.id] = [a2];
          r.jobs.push({ s: a2.startT, e: a2.startT + a2.durationMin * 60, obiegId: a2.obiegId });
          r.loadMin += a2.durationMin; r.loadEq += CALA_EQ[a2.kind]; r.count += 1;
          if (prevFree !== undefined) driverFreeAt[o2.id] = prevFree;
        }
      }
    }
    return false;
  };
  for (const id of [...unassigned]) {
    const o = obiegi.find((x) => x.id === id);
    if (!o || (assignments[id] ?? []).some((a) => a.reserveId)) continue;
    const fallback = assignments[id];
    assignments[id] = []; // wyczyść slot BRAK, by commit() dodał czysto
    if (repair(o)) {
      const i = unassigned.indexOf(id); if (i >= 0) unassigned.splice(i, 1);
    } else {
      assignments[id] = fallback ?? []; // przywróć slot BRAK do wyświetlenia
    }
  }

  // 1c. NAWRÓT „cięcie wg kół" (R9 + sprawiedliwość): jeśli mimo wszystko został BRAK, to w praktyce
  // „za mało maszynistów do podmian" — zgodnie z decyzją użytkownika TNIEMY kolejnego NAJMNIEJ-KOŁOWEGO
  // z jeszcze-całych na połówkę (forced) i planujemy OD NOWA. Połówka zwalnia moc poza A11 (mniejszy blok),
  // co domyka pokrycie. Bierzemy wynik tylko, gdy realnie zmniejsza BRAK (inaczej nie tniemy na zapas).
  // Rekursja zbieżna: każdy nawrót tnie jeden obieg więcej; głębokość ≤ liczba całych.
  const brakNow = obiegi.filter((o) => !(assignments[o.id] ?? []).some((a) => a.reserveId));
  if (brakNow.length) {
    const nextCut = eligible.filter((o) => !autoPolowka.has(o.id) && dk(o) === "cała")
      .sort((a, b) => a.loops - b.loops || a.firstT - b.firstT)[0];
    if (nextCut) {
      const retry = planBreaks(obiegi, reserves, { ...opts, forcedKinds: { ...forced, [nextCut.id]: "połówka" } });
      const retryBrak = obiegi.filter((o) => !(retry.assignments[o.id] ?? []).some((a) => a.reserveId)).length;
      if (retryBrak < brakNow.length) return retry; // cięcie pomogło → użyj planu z nawrotu
    }
  }

  // 2. R16 — pokrycie + MAKSYMALNE WYKORZYSTANIE MOCY (~4,5 h = 3 koła/rezerwowego, R13; decyzja użytkownika
  // 2026-06-09: „maszyniści rezerwowi wykorzystani na maxa"). DWIE FAZY (bramka: brak realnego BRAK):
  //  • PASS A — „dobij WSZYSTKICH do pełnej": obieg z dk="cała", który ma dopiero JEDNĄ POŁÓWKĘ@A11 (overflow
  //    z fazy 3), dostaje DRUGĄ POŁÓWKĘ → 2×½ = pełna przerwa. Najpierw wszyscy mają pełną (sprawiedliwość).
  //  • PASS B — „wypełnij rezerwowych do 3 kół": obiegowi dk="cała" z 1 przerwą dokładamy 2. przerwę,
  //    NAJDŁUŻSZE pierwsze (całozmianowe/∞ → wysokie koła; pracują najdłużej, R3). PREFERUJEMY POŁÓWKĘ → 1,5
  //    („najlepiej rozbijaj na półtorej", uwaga 4); gdy połówki się nie da — CAŁĄ → 2×cała (dobicie rezerwowych
  //    OFF-A11 A1/A7/A18/A23, których połówką nie zapełnimy — połówka jest tylko na A11). Szczyt (dk="połówka")
  //    2. przerwy NIE dostaje (#4). Pass B rusza po Pass A, więc nikt nie dostaje 2. przerwy, póki inni nie
  //    mają pełnej (kolejność longest-first dodatkowo chroni sprawiedliwość).
  // Okno 2. przerwy dłuższe (start do LATEST_SECOND; realnie limituje R7/zjazd). Dwie połówki rozsuwamy ~2,5 h.
  const SPACING_POLOWKI = hms(2, 30);
  const hasBrak = () => obiegi.some((o) => !(assignments[o.id] ?? []).some((a) => a.reserveId));
  // Dołożenie 2. przerwy danego rodzaju do obiegu o (rozsuw `target`). Zwraca true, gdy dołożono.
  const addSecond = (o: Obieg, kind: BreakKind, target: number): boolean => {
    const cur = assignments[o.id];
    if (!cur || cur.length === 0 || cur.length >= MAX_BREAKS_PER_OBIEG) return false;
    if (cur.some((a) => !a.reserveId)) return false; // BRAK — nie dokładaj
    const after = driverFreeAt[o.id] ?? 0;
    const slots = autoSlots(o, kind, (s) => floorOf(o, s), LATEST_SECOND)
      .filter((s) => s.startT >= after)
      .sort((a, b) => Math.abs(a.startT - target) - Math.abs(b.startT - target));
    for (const slot of slots) {
      const r = pickReserve(rs, slot);
      if (r) { commit(o, slot, r); return true; }
    }
    return false;
  };
  if (!hasBrak()) {
    // PASS A — dopełnij każdą samotną połówkę (dk="cała") do 2×½ = pełna przerwa. Iteruj do nasycenia.
    let progressA = true;
    while (progressA) {
      progressA = false;
      for (const o of order) {
        const cur = assignments[o.id];
        if (!cur || cur.length !== 1 || dk(o) !== "cała" || cur[0].kind !== "połówka") continue;
        if (addSecond(o, "połówka", cur[0].startT + SPACING_POLOWKI)) progressA = true;
      }
    }
    // PASS B — wypełnij rezerwowych do maksimum (NAJDŁUŻSZE pierwsze). Preferuj połówkę (1,5), inaczej cała (2×cała).
    const byLoopsDesc = [...obiegi].sort((a, b) => loopKey(b) - loopKey(a) || numOf(a.id) - numOf(b.id));
    let progressB = true;
    while (progressB) {
      progressB = false;
      for (const o of byLoopsDesc) {
        const cur = assignments[o.id];
        if (!cur || cur.length !== 1 || dk(o) !== "cała") continue; // szczyt (dk=połówka) bez 2. przerwy
        const tgt = cur[0].kind === "połówka" ? cur[0].startT + SPACING_POLOWKI : driverFreeAt[o.id] ?? 0;
        if (addSecond(o, "połówka", tgt)) { progressB = true; continue; }     // → 1,5 (lub 2×½ dla utkniętej połówki)
        if (addSecond(o, "cała", driverFreeAt[o.id] ?? 0)) progressB = true;  // → 2×cała (dobicie off-A11)
      }
    }
  }

  // R20 — auto-wykrycie „łapania pociągu z drugiej strony peronu na kolejną podmianę".
  // Liczy się NIE sam powrót pociągu z przerwy, tylko MOMENT MIĘDZY podmianami: rezerwowy oddaje
  // pociąg (koniec poprzedniej) → musi przejść na drugą stronę toru → zdążyć na wsiadanie do następnej.
  // Dla każdego rezerwowego sortujemy podmiany po czasie; gdy peron WSIADANIA do kolejnej ≠ peron, na
  // którym ODDAŁ poprzednią, a ma na przejście ≤ bufor (5 min) → crossTrack (alert ⚠). To częsty,
  // normalny przypadek (łapanie szybko, bez rozciągania przerw) — informacja dla maszynisty, nie błąd.
  // Peron oddania poprzedniej: cała wraca tym samym torem; połówka/godzinka/szczeniak — przeciwnym
  // (ale to tylko po to, by wiedzieć GDZIE STOI po oddaniu — nie jest to samo w sobie alarm).
  // Pierwsza podmiana nigdy nie jest „ciasna" (rezerwowy ustawił się na peronie wcześniej).
  // Ręczny crossTrack ustawia planista w edytorze (BreakEditor).
  const opp = (d: Dir): Dir => (d === "Kabaty" ? "Młociny" : "Kabaty");
  const XFER = XFER_BUFFER_MIN * 60;
  const jobsByRes: Record<string, BreakAssignment[]> = {};
  for (const list of Object.values(assignments))
    for (const a of list) if (a.reserveId) (jobsByRes[a.reserveId] ??= []).push(a);
  for (const jobs of Object.values(jobsByRes)) {
    jobs.sort((x, y) => x.startT - y.startT);
    for (let i = 1; i < jobs.length; i++) {
      const prev = jobs[i - 1], cur = jobs[i];
      // KRAŃCÓWKI (A1 Kabaty, A23 Młociny): oba kierunki odjeżdżają z krańca, pociąg i tak tam zawraca —
      // nie ma „przeskoku na drugi tor". Dlatego nie oznaczamy crossTrack, gdy kolejną wsiada na krańcówce.
      if (cur.station === "A1" || cur.station === "A23") continue;
      const handoverDir = returnsOppositeTrack(prev.kind) ? opp(prev.dir) : prev.dir; // gdzie stoi po oddaniu
      const gap = cur.startT - (prev.startT + prev.durationMin * 60);               // czas na przejście
      if (cur.dir !== handoverDir && gap <= XFER) cur.crossTrack = true;            // inny peron + ciasno
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
