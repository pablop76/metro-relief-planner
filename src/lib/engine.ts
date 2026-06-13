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
// może zostać pod ręką, by wprowadzić skład za pociąg, który uległ awarii / wymaga sprzątania. Ten robi
// wtedy tylko 1 koło (jedną całą). UWAGA (2026-06-10): to OPT-IN — TYLKO gdy pomocnik zaznaczy `rolling`
// (checkbox w panelu). DOMYŚLNIE wszyscy rezerwowi (też A1) mają MAKSYMALNY limit. `maxJobs` nadpisuje.
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
// „ZACZNIJ OD" = ZALECENIE „nie wcześniej niż" (decyzja użytkownika 2026-06-12, usunięto tolerancję +15′):
// próg jest twardą dolną granicą slotów, a w score po prostu „wcześniej = lepiej" od progu w górę —
// bez plateau. Pomocnik steruje startem wyłącznie tym inputem (globalnie / per obieg).
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
const SHIFT2_END = hms(22, 0);     // koniec 2. zmiany — górna granica RĘCZNEGO wyboru slotu (feasibleSlots)

// ROZKŁADANIE startów (R2): preferujemy NAJWCZEŚNIEJSZY slot od progu startu w górę (earliest globalny;
// domyślnie 14:30 — użytkownik ustawia próg sam). Moc rezerwowych wypełnia się od dołu,
// a naturalna serializacja (jeden maszynista = jeden pociąg naraz) i tak rozkłada przerwy po popołudniu.
// (Dawniej był „magnes" na 16:00, potem pełznący kursor — kursor przy bottlenecku A11 uciekał przed wolną
// wczesną mocą i robił BRAK mimo zapasu, więc wrócono do prostego „od progu w górę".)

// SCARCITY A11: połówka/godzinka/szczeniak są możliwe TYLKO na A11 (jedyna stacja z połówką), więc moc
// A11 jest wąskim gardłem. CAŁĄ można zrobić na każdej stacji, którą obieg mija — więc całe ODPYCHAMY
// z A11 (duża kara w score), żeby nie zjadały miejsca dla połówek. Kara tylko DEPRIORYTETYZUJE: gdy poza
// A11 nie ma już wolnego rezerwowego, cała i tak wejdzie na A11 (nadmiar). 12 h ≫ każdy dystans czasowy.
const A11_CALA_PENALTY = 12 * 3600;

// Optymalizator MOŻE ściąć obieg na połówkę (downgrade) tylko gdy ma < 4,5 koła. Długodystansowców (≥4,5)
// nigdy nie krzywdzi połówką (sprawiedliwość wg kół) — gdy nie mieści się jako cała, idzie BRAK → nawrót.
const OPT_DOWNGRADE_MAX = 4.5;

export interface PlanOptions {
  /** globalny próg „nie wcześniej niż" (sekundy od północy); domyślnie 14:30 */
  earliest?: number;
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
  /** WARIANT planu (decyzja użytkownika 2026-06-10): ziarno losowości do tie-breaków optymalizatora.
   *  Każda wartość daje INNĄ, równie dobrą kombinację (ta sama minimalna liczba downgrade'ów). Domyślnie 0. */
  seed?: number;
  /** ręczna godzina rozpoczęcia pracy maszynisty 2. zmiany per obieg (klucz = id, sekundy od północy) —
   *  nadpisuje wykryty `entry2nd` jako dolną granicę RĘCZNEGO wstawiania przerwy (feasibleSlots manual). */
  entry2ndByObieg?: Record<string, number>;
  /** R20: bufor na przeskok na drugi peron przy kolejnej podmianie (minuty); domyślnie XFER_BUFFER_MIN (5). */
  xferBufferMin?: number;
  /** OPCJA „nie zaczynaj od szczytów" (decyzja użytkownika 2026-06-11): szczyt (obieg < `PEAK_NOT_FIRST_LOOPS`
   *  koła) NIE może być PIERWSZĄ podmianą — jego przerwa startuje dopiero po 1. pełnym kole, więc wczesne sloty
   *  (pierwsza fala) zajmują długodystansowcy/całozmianowi, a szczyt wchodzi po pierwszej podmianie. */
  peaksNotFirst?: boolean;
  /** WEWNĘTRZNE — wspólny deadline (ms timestamp) na CAŁY plan łącznie z rekurencją nawrotu, by łączny czas
   *  był ograniczony (UI nie zamarza nawet przy głębokim cięciu w deficycie). Ustawiany automatycznie. */
  deadline?: number;
  /** WEWNĘTRZNE — wywołanie z pętli nawrotu (lookahead): nie uruchamiaj własnego nawrotu (pętla na
   *  najwyższym poziomie sama dokłada kolejne cięcia). */
  noRecut?: boolean;
  /** WEWNĘTRZNE — szybki skan lookahead: liczy się TYLKO pokrycie (BRAK); pomiń porządkowanie i dokładki
   *  (fairBrakSwap/rebalans/promote/swap/PASS A–C) — zwycięskie cięcia są potem przeliczane w pełni. */
  scanOnly?: boolean;
}

/** Deterministyczny PRNG (mulberry32) — ze stałego ziarna ten sam ciąg → powtarzalny wariant planu. */
function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
  const ae = afternoonEntryT(o);
  const sameDir = kind === "cała";
  const out: Slot[] = [];
  for (let i = 0; i < o.events.length; i++) {
    const ev = o.events[i];
    if (ev.t < Math.max(earliest, ae) || ev.t > latest) continue;
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
    // „pracuje do" (workEnd, 2026-06-12): maszynista musi ODEBRAĆ pociąg przed końcem swojej pracy
    if (o.workEnd != null && returnT > o.workEnd) continue;
    out.push({
      station: ev.station, dir: ev.dir, startT: ev.t, kind, durationMin: Math.round((returnT - ev.t) / 60),
    });
  }
  return out;
}

/** Wszystkie dopuszczalne sloty obiegu (wszystkie rodzaje) — do ręcznej edycji w UI.
 *  `manual` (RĘCZNY wybór, decyzja użytkownika 2026-06-10): okno = GODZINY PRACY MASZYNISTY 2. ZMIANY,
 *  czyli [`entry2nd` (realny wjazd), `SHIFT2_END` 22:00]. Bez progu „zacznij od" („nie ograniczaj od kiedy
 *  mogę wstawić"), ale ograniczone do realnej zmiany maszynisty (nie wcześniej niż jego wjazd, nie później
 *  niż koniec 2. zmiany). Bez flagi: zwykły próg „zacznij od" i okno do LATEST_SECOND. */
export function feasibleSlots(o: Obieg, opts: PlanOptions = {}, manual = false): Slot[] {
  const g = opts.earliest ?? EARLIEST_DEFAULT;
  // próg startu slotu: ręczny = ręcznie ustawiona godzina rozpoczęcia pracy maszynisty 2. zmiany
  // (entry2ndByObieg) > wykryty entry2nd; inaczej override per-obieg > globalny
  const driverStart = opts.entry2ndByObieg?.[o.id] ?? o.entry2nd;
  const floor = manual ? driverStart : opts.earliestByObieg?.[o.id] ?? g;
  const latest = manual ? SHIFT2_END : LATEST_SECOND; // ręczny: do końca 2. zmiany (22:00)
  const all: Slot[] = [];
  for (const kind of DOWNGRADE) all.push(...candidateSlots(o, kind, floor, latest));
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
  // PRZY BRAKU OBSADY (zero niezablokowanych rezerwowych) NIE pokazujemy nic — żadnych slotów BRAK ani
  // podglądu rodzaju. Karty zostają puste („— brak —"). Połówka/cała też wymaga maszynisty, więc bez obsady
  // jakikolwiek podgląd jest tylko mylący (decyzja użytkownika 2026-06-09: „przy braku obsady zostaw puste").
  if (reserves.every((r) => r.blocked)) {
    return { assignments: {}, unassigned: obiegi.map((o) => o.id), reserveLoadMin: {}, reserveCount: {} };
  }
  // DEADLINE wspólny dla całej rekurencji (nawrót cięcia) — łączny czas planu ograniczony (~700 ms), UI płynne.
  const planDeadline = opts.deadline ?? Date.now() + 450;
  // Osobny deadline DOCIĄŻANIA (R16: rebalans/promote/drabina) — ustawiany na świeży minimalny budżet w
  // chwili startu R16 (fix 2026-06-12): głęboki nawrót cięcia zjadał cały planDeadline i zwycięski plan
  // wychodził BEZ dociążenia (rezerwowi A11 na 2,5 mimo wolnej mocy). Płaci tylko plan z 0 BRAK (kandydat).
  let r16Deadline = planDeadline;
  const earliest = opts.earliest ?? EARLIEST_DEFAULT;
  // efektywny próg slotu: override per-obieg > globalny (R2); nie schodzi poniżej startu
  // pracy maszynisty (entry2nd — może być ręcznie ustawiony jako „pracuje od", 2026-06-12)
  const floorOf = (o: Obieg) =>
    Math.max(opts.earliestByObieg?.[o.id] ?? earliest, o.entry2nd ?? 0);
  // scarcity: odepchnij CAŁE z A11 (A11 zostawiamy na połówki — jedyne miejsce, gdzie są możliwe) — ALE
  // TYLKO gdy połówki REALNIE są (reserveA11ForPolowki, ustawiane po bilansie). Przy 0 połówek (moc =
  // zapotrzebowanie, wszyscy na całe) A11 jest ZWYKŁĄ stacją całych (kara = 0) — inaczej 12-h kara odpychała
  // całe z A11, głodziła rezerwowych A1/A7 i zostawiała ich na 2,0–2,5/3 zamiast maksymalnego obciążenia.
  let reserveA11ForPolowki = false;
  const scarcity = (s: Slot) => (reserveA11ForPolowki && s.kind === "cała" && s.station === "A11" ? A11_CALA_PENALTY : 0);
  // SCORE (mniejszy = lepszy): po scarcity preferuj NAJWCZEŚNIEJSZY start od progu „zacznij od"
  // w górę. Próg = USTAWIENIE „nie wcześniej niż" (opts.earliest / per-obieg) — to ono
  // steruje, kiedy ruszają przerwy; to ZALECENIE dolnej granicy, nie sztywna godzina (decyzja użytkownika
  // 2026-06-12, tolerancja +15′ usunięta). Osobny próg 3,5 koła (coverWindow) pilnuje, by SAMOTNA połówka
  // długodystansowca nie była pierwszą podmianą.
  // opts.pref = stary „magnes" na konkretną godzinę (back-compat, nieużywany przez UI).
  // miękka kara za niepreferowany tor na danej stacji (A11 = oba tory, bez preferencji)
  const dirPenalty = (s: Slot) => (DIR_PREF[s.station] && s.dir !== DIR_PREF[s.station] ? DIR_PENALTY : 0);
  const score = (s: Slot) => {
    if (opts.pref != null) return Math.abs(s.startT - opts.pref);
    const over = s.startT - earliest; // wcześniej = lepiej, od progu w górę
    return scarcity(s) + dirPenalty(s) + (over > 0 ? over : 0);
  };
  const forced = opts.forcedKinds ?? {};
  // CAŁOZMIANOWY (throughShift) — auto z rozkładu (zjazd ≥ 21:00) LUB ręczne wskazanie pomocnika (override).
  // ZAWSZE cała (wykluczony z racjonowania/cięcia), ale do RANKINGU używa REALNYCH kół (~4,5 dla całodobowych,
  // liczone do 20:45 — korekta 2026-06-13: „w praktyce robią 4,5, mniej niż 5-kołowe"). NIE jest już ∞ — przez
  // to D17–D20 (5,0) mają pierwszeństwo przed całodobowymi.
  const isThrough = (o: Obieg) => opts.throughShiftOverride?.[o.id] ?? o.throughShift;
  // klucz sortowania malejąco po kołach; obroniony przed ∞ (gdyby gdzieś zostało) — wtedy 4,5 jako sensowne koła
  const loopKey = (o: Obieg) => (Number.isFinite(o.loops) ? o.loops : 4.5);
  const effLoops = loopKey; // alias zgodności: dawniej ∞ dla throughShift, teraz realne koła

  // R17 — rezerwa ruchowa A1 (limit 1 koło) TYLKO gdy pomocnik JAWNIE zaznaczy `rolling` (checkbox).
  // Decyzja użytkownika 2026-06-10: „dawaj WSZYSTKIM maksymalny limit; rezerwę ruchową / standby / tylko-moje
  // zaznaczam sam". Usunięto auto-fallback (pierwszy niezablokowany A1 → rolling), który bezzasadnie ścinał A1
  // do 1 koła → ciągły DEFICYT na A1. Domyślnie ŻADEN rezerwowy nie jest ograniczany liczbą podmian.
  const rollingA1Id = reserves.find((r) => r.station === "A1" && r.rolling && !r.blocked)?.id;
  // Limit liczby podmian: ręczny maxJobs > (jawna rezerwa ruchowa A1 = 1) > bez limitu (Infinity, do 3 kół).
  const capOf = (r: Reserve): number =>
    r.maxJobs ?? (r.id === rollingA1Id ? A1_MOBILE_MAX_JOBS : Infinity);


  // RODZAJ PRZERWY — BILANS = MAKSYMALIZUJ OBCIĄŻENIE (decyzja użytkownika 2026-06-11, KLUCZOWA korekta
  // potwierdzona ręcznym planem: 12 rez × 3 = 36 obiegów → WSZYSCY po 3 CAŁE, 0 połówek):
  // • Domyślnie KAŻDY obieg = CAŁA (też <4 koła!). Zniesiono dawny twardy próg „<4 koła = połówka ZAWSZE" —
  //   niepotrzebnie kradł całe ze stacji A1/A7/A23 (np. S31→cała@A1) i wrzucał fragmenty na A11, przez co
  //   rezerwowi zostawali na 2,0–2,5/3 zamiast pełnych 3,0. Cała daje WIĘCEJ obciążenia niż połówka (1 vs ½),
  //   więc „jak najwięcej całych" = „maksymalnie obciążeni rezerwowi" (czego chce użytkownik).
  // • POŁÓWKI TYLKO przy DEFICYCIE (moc < zapotrzebowanie): tniemy całe→połówki NAJMNIEJ-KOŁOWE NAJPIERW
  //   (S31, S34, S23, S28, …), aż eqDemand ≤ capacity. Cięcie cała→połówka = −0,5 eq. Przy moc ≥ demand —
  //   ZERO cięć (reszta całymi). To eliminuje „obiegi z połówką, gdy moc pozwala na pełne".
  // Genuine timing-infeasibility (obieg fizycznie nie zmieści całej — brak powrotu pełną pętlą przed zjazdem)
  // i tak rozwiązuje PLACEMENT (candidateSlots nie wygeneruje całej → optymalizator zejdzie na połówkę dg=1),
  // więc bilans NIE musi z góry forsować połówek.
  const eligible = [...obiegi]
    .filter((o) => !forced[o.id] && !isThrough(o) && Number.isFinite(o.loops)) // całozmianowe poza racjonowaniem
    .sort((a, b) => a.loops - b.loops || a.firstT - b.firstT);                  // najmniej kół = tnij pierwsze
  // MOC do bilansu = rezerwowi „do pełnej dyspozycji" × 3 koła. Rezerwa ruchowa A1 (rollingA1Id, jeśli jawnie
  // zaznaczona) NIE wchodzi do mocy — jej 1 koło to bufor pod ręką (R17), nie planowana moc.
  const capacity = reserves.reduce(
    (s, r) => s + (r.blocked || r.id === rollingA1Id ? 0 : Math.min(MAX_RESERVE_LOAD_EQ, capOf(r))), 0
  );
  const autoPolowka = new Set<string>();           // START: nikt nie jest połówką (wszyscy całe → max obciążenie)
  // eqDemand respektuje też RĘCZNE/NAWROTOWE cięcia (forced=połówka) — patrz RETRY niżej
  const eqDemand = () => obiegi.reduce((s, o) => s + (forced[o.id] === "połówka" || autoPolowka.has(o.id) ? 0.5 : 1), 0);
  for (const o of eligible) {                       // RACJONOWANIE: tnij najmniej-kołowe, dopóki nie zmieści się w mocy
    if (eqDemand() <= capacity) break;              // moc starcza (nadwyżka) → reszta zostaje CAŁYMI (max obciążenie)
    autoPolowka.add(o.id);                          // deficyt: utnij najmniej-kołowy z pozostałych → połówka
  }
  // NADWYŻKA MOCY policzona Z GÓRY (decyzja użytkownika 2026-06-12): gdy moc > zapotrzebowanie, znamy od
  // startu liczbę NADMIAROWYCH POŁÓWEK do rozdania (eq nadwyżki × 2). Te połówki wpadną jako 2. przerwy do
  // najbardziej kołowych obiegów (drabina R16) i są możliwe TYLKO na A11 — więc A11 trzeba zarezerwować pod
  // nie JUŻ przy rozkładaniu całych (całe odpychane z A11 → wypełniają moc off-A11, np. A1). Bez tego całe
  // zjadały A11, nadwyżka nie miała gdzie wejść i rezerwowi off-A11 zostawali niedociążeni (np. 2,0/3).
  const extraHalves = Math.max(0, Math.floor((capacity - eqDemand()) * 2 + 1e-6));
  // A11 rezerwujemy na połówki gdy jakieś będą: deficyt/ręczne/nawrót LUB nadwyżka (2. połówki). Przy 0
  // połówek kara A11_CALA_PENALTY znika → A11 to zwykła stacja całych (inaczej całe uciekały z A11, głodząc A1/A7).
  reserveA11ForPolowki = autoPolowka.size > 0 || extraHalves > 0 || Object.values(forced).some((k) => k === "połówka");
  const dk = (o: Obieg) => forced[o.id] ?? (autoPolowka.has(o.id) ? "połówka" : "cała"); // ręczny mark > auto
  // RĘCZNE wymuszenie rodzaju jest TWARDE (fix 2026-06-12): obieg z `forced` dostaje TYLKO ten rodzaj —
  // bez downgrade'u. Wcześniej tryAssign/tryCover/B&B potrafiły wymuszoną CAŁĄ ściąć na połówkę (przy
  // deficycie wymuszenie „nie działało" — plan wychodził identyczny). Teraz: wymuszona cała → cała albo BRAK.
  const kindsFor = (o: Obieg): BreakKind[] =>
    forced[o.id] ? [forced[o.id]] : AUTO_KINDS.slice(AUTO_KINDS.indexOf(dk(o)));

  // R3 — okno 1. (głównej) przerwy: najpóźniejszy START = min(18:20, realny_start + 6h).
  const latestFirstOf = (o: Obieg) => Math.min(LATEST_FIRST, o.entry2nd + MAX_CONTINUOUS);
  // OKNO POKRYCIA (1./JEDYNEJ przerwy) dla DANEGO rodzaju. Dół = próg „zacznij od" (floorOf); dla POŁÓWKI
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
  // OPCJA „nie zaczynaj od szczytów" (decyzja użytkownika 2026-06-11): szczyt = obieg < 4,5 koła (nie
  // całozmianowy). NIE twardy próg czasowy (ścinał pełne obciążenie do połówek), tylko MIĘKKIE PRZESUNIĘCIE:
  // szczyt woli PÓŹNIEJSZY slot (sortowanie placements malejąco po czasie), więc wczesne sloty zajmują
  // długodystansowcy/całozmianowi, a szczyt wchodzi po pierwszej podmianie. Miękko = nie psuje upakowania
  // (wszyscy nadal po 3 całe), tylko zmienia KTO bierze wczesny slot.
  const PEAK_NOT_FIRST_LOOPS = 4.5;
  const isPeakLate = (o: Obieg) =>
    !!opts.peaksNotFirst && !isThrough(o) && effLoops(o) < PEAK_NOT_FIRST_LOOPS; // całodobowy to nie szczyt
  // `relax` (2026-06-12) — POKRYCIE > jakość: w passach ratunkowych (fairBrakSwap) znosimy regułę „połówka
  // ≥3,5 koła nie pierwsza" (POL_LATE), bo lepiej dać wysokokołowemu wczesną połówkę niż zostawić go BRAK.
  const coverWindow = (o: Obieg, kind: BreakKind, relax = false): { floor: number; hi: number } => {
    if (kind === "połówka") {
      // po 1. kole tylko gdy: dość rezerwowych (≥10) ORAZ obieg ≥ 3,5 koła; inaczej połówka może startować wcześnie
      const polLo = !relax && enoughReserves && effLoops(o) >= POL_LATE_LOOPS ? o.entry2nd + o.lapMin * 60 : 0;
      return { floor: Math.max(floorOf(o), polLo), hi: Math.min(latestFirstOf(o), ONLY_POL_LATEST) };
    }
    return { floor: floorOf(o), hi: latestFirstOf(o) };
  };

  // AUTO: na A11 NIE nadajemy CAŁYCH — A11 to stacja POŁÓWEK (decyzja użytkownika 2026-06-08). Obieg,
  // który chciałby całą, ale nie mieści się poza A11, jest na A11 obsługiwany jako POŁÓWKA (a w R16 może
  // dostać 2. połówkę → równowartość całej). Dwie połówki (~45 min) zamiast jednej całej (~90 min) dają
  // drobniejsze bloki → ciaśniejsze pakowanie rezerwowych i WIĘCEJ opcji podmian (cała@A11 blokowała
  // rezerwowego na ~85 min i wypierała połówki, np. D22). Ręczny edytor (feasibleSlots) wciąż pozwala na
  // cała@A11 — to ograniczenie tylko dla automatu.
  const autoSlots = (o: Obieg, kind: BreakKind, floor: number, hi: number) =>
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
  // CAŁODOBOWE NIE idą już na sam przód (korekta 2026-06-13): robią ~4,5 koła, więc D17–D20 (5,0) mają
  // pierwszeństwo. criticalRank = TIE-BREAK: przy RÓWNYCH kołach całodobowy ustępuje zwykłemu obiegowi
  // („potem całodobowe" — preferencja użytkownika). Główny porządek daje loopKey (malejąco po realnych kołach).
  const criticalRank = (o: Obieg) => (isThrough(o) ? 1 : 0); // równe koła: zwykły przed całodobowym
  const typeRank = (o: Obieg) => (o.type === "S" ? 0 : o.type === "full" ? 1 : 2);
  const numOf = (id: string) => parseInt(id.replace(/\D/g, ""), 10) || 0;
  const slotCount = (o: Obieg) =>
    kindsFor(o).reduce((n, k) => {
      const { floor, hi } = coverWindow(o, k);
      return n + autoSlots(o, k, floor, hi).length;
    }, 0);
  // Wśród CAŁYCH (po criticalRank) — NAJDŁUŻSZE pierwsze (malejąco po kołach): długodystansowce zajmują
  // całe off-A11 przed szczytami (uwaga 5: całozmianowy/wysoko-kołowy ma pierwszeństwo do całej, kosztem
  // szczytów). slotCount pozostaje dalszym tie-breakiem (obiegi z mniejszą liczbą opcji wcześniej).
  const order = [...obiegi].sort(
    (a, b) =>
      kindRank(a) - kindRank(b) ||
      loopKey(b) - loopKey(a) ||          // NAJWIĘCEJ KÓŁ pierwszy (5,0 przed całodobowymi 4,5)
      criticalRank(a) - criticalRank(b) || // równe koła: zwykły przed całodobowym
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
    // monotoniczny max — 2. połówka może być PRZED całą (2026-06-12), a kursor „od kiedy wolny" nie może się cofać
    driverFreeAt[o.id] = Math.max(driverFreeAt[o.id] ?? 0, slot.startT + slot.durationMin * 60);
  };

  // Próba przydzielenia obiegowi PIERWSZEJ przerwy PO powrocie maszynisty, najwcześniej jak się da (R2).
  // Okno 1. przerwy = coverWindow(o, kind): górna granica = min(18:20, start+6h) (R3); dla szczytu z samą
  // połówką dolna = 1. pełne koło, górna = 18:15 (§4a krok4). Pokrycie: ma sloty, brak rez. → BRAK; nie schodź niżej.
  const tryAssign = (o: Obieg, allowA11Cala = false): boolean => {
    const after = driverFreeAt[o.id] ?? 0; // próg startu egzekwuje candidateSlots (per rodzaj)
    const src = allowA11Cala ? candidateSlots : autoSlots; // faza 3: dopuść cała@A11 (pełna przerwa overflow)
    for (const kind of kindsFor(o)) {
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
    for (const kind of kindsFor(o)) {
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
      for (const kind of kindsFor(o)) {
        const slots = candidateSlots(o, kind, floorOf(o), LATEST_SECOND)
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
    for (const kind of kindsFor(o)) {
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

  // 1*. OPTYMALIZATOR (branch-and-bound / CSP, decyzja użytkownika 2026-06-10). KLUCZ: optimum = ZERO
  // downgrade'ów — każdy obieg dostaje swój DOCELOWY rodzaj dk (cała→cała, połówka→połówka), więc liczba
  // połówek = dokładnie bilans (np. 6), a nie greedy ~13. Pytanie sprowadza się do CSP: czy ISTNIEJE pełne,
  // bezkolizyjne upakowanie wszystkich obiegów docelowym rodzajem? Jeśli tak — przeszukiwanie z nawrotami je
  // znajdzie (greedy go gubił przy zerowym luzie, bo połówki fragmentowały A11). MRV (najmniej kandydatów
  // pierwsze) + dedup symetrycznych rezerwowych + pakowanie busiest-first tną drzewo; BUDŻET węzłów/czasu +
  // fallback do greedy gwarantują, że UI nigdy nie zamarza. Sukces ⇒ 0 BRAK i 0 downgrade (eviction/nawrót
  // poniżej stają się no-opem). Porażka/niewykonalność/budżet ⇒ greedy faza 1/2/3 (dawne, z downgrade'ami).
  // WARIANT (seed≠0, decyzja użytkownika 2026-06-10: „Generuj plan" ma dawać różne kombinacje). Wariujemy
  // TYLKO wybór rezerwowego wśród remisów obciążenia (resKey), NIE kolejność slotów — dzięki temu każdy
  // wariant ma tę samą MINIMALNĄ liczbę downgrade'ów (jakość zachowana), a zmienia się KTO obsługuje obieg
  // (kaskadowo też część stacji/czasów). Jitter slotów testowany i ODRZUCONY: psuł jakość (seed bywał 3 zamiast 2).
  // Seed=0 (domyślny/auto) → resKey=0 → plan deterministyczny, niezmieniony.
  const vary = ((opts.seed ?? 0) | 0) !== 0;
  const rng = mulberry32((opts.seed ?? 0) | 0);
  const resKey = new Map(rs.map((r) => [r.ref.id, vary ? rng() : 0] as const));

  type Place = { slot: Slot; dg: number }; // dg=1 → downgrade (dk=cała obsłużony połówką)
  const optimizeExact = (): boolean => {
    const toAssign = order.filter((o) => !(assignments[o.id]?.length)); // bez pinów
    // PLACEMENTS: docelowy rodzaj dk (dg=0) + dla dk=cała także połówka (dg=1, downgrade). cała dopuszcza A11.
    const place = new Map<string, Place[]>();
    for (const o of toAssign) {
      const after = driverFreeAt[o.id] ?? 0;
      const arr: Place[] = [];
      const kc = dk(o);
      { const { floor, hi } = coverWindow(o, kc); const src = kc === "cała" ? candidateSlots : autoSlots;
        for (const s of src(o, kc, floor, hi)) if (s.startT >= after) arr.push({ slot: s, dg: 0 }); }
      // DOWNGRADE (cała→połówka) jako opcja TYLKO dla obiegów < 4,5 koła — DŁUGODYSTANSOWCÓW (≥4,5) silnik
      // NIGDY nie ścina na połówkę (sprawiedliwość wg kół; decyzja użytkownika: „nie krzywdź wysokokołowych").
      // Bez tego, przy zerowym luzie (cap=demand) optymalizator minimalizujący LICZBĘ downgrade'ów potrafił
      // ściąć D17/D20 (5,0). Gdy długodystansowiec nie mieści się jako cała → BRAK → nawrót tnie najniżej-kołowy.
      // RĘCZNIE wymuszony rodzaj (forced) jest TWARDY — bez opcji downgrade (fix 2026-06-12).
      if (kc === "cała" && !forced[o.id] && !isThrough(o) && effLoops(o) < OPT_DOWNGRADE_MAX) { const { floor, hi } = coverWindow(o, "połówka");
        for (const s of autoSlots(o, "połówka", floor, hi)) if (s.startT >= after) arr.push({ slot: s, dg: 1 }); }
      // „nie zaczynaj od szczytów": szczyt woli PÓŹNIEJSZY slot (sort malejąco po czasie) — matcher/B&B najpierw
      // próbują dla niego późnych slotów, więc wczesne zostają dla długodystansowców (miękko, nie psuje upakowania).
      arr.sort((a, b) => a.dg - b.dg || (isPeakLate(o) ? b.slot.startT - a.slot.startT : score(a.slot) - score(b.slot)));
      if (arr.length === 0) return false; // obieg bez żadnego slotu → greedy (BRAK + nawrót)
      place.set(o.id, arr);
    }
    const vars = [...toAssign].sort((a, b) => place.get(a.id)!.length - place.get(b.id)!.length); // MRV
    const jobs = new Map<string, Array<{ s: number; e: number }>>();
    const load = new Map<string, number>(), cnt = new Map<string, number>();
    for (const r of rs) { jobs.set(r.ref.id, r.jobs.map((j) => ({ s: j.s, e: j.e }))); load.set(r.ref.id, r.loadEq); cnt.set(r.ref.id, r.count); }
    // rezerwowi per stacja policzeni RAZ (blocked/manualOnly są statyczne); avail sprawdzamy per slot
    const byStation = new Map<BreakStation, RState[]>();
    for (const r of rs) if (!r.ref.blocked && !r.ref.manualOnly) (byStation.get(r.station) ?? byStation.set(r.station, []).get(r.station)!).push(r);
    const elig = (slot: Slot) =>
      (byStation.get(slot.station) ?? []).filter((r) =>
        (r.ref.availFrom == null || slot.startT >= r.ref.availFrom) &&
        (r.ref.availTo == null || slot.startT + slot.durationMin * 60 <= r.ref.availTo));
    const free = (rid: string, s: number, e: number) => !jobs.get(rid)!.some((j) => s < j.e && j.s < e);
    const canTake = (r: RState, slot: Slot) =>
      load.get(r.ref.id)! + CALA_EQ[slot.kind] <= MAX_RESERVE_LOAD_EQ + 1e-6 &&
      cnt.get(r.ref.id)! < r.cap && free(r.ref.id, slot.startT, slot.startT + slot.durationMin * 60);

    // FAST PATH — pełne dopasowanie BEZ downgrade (augmenting paths / Kuhn). Naiwny B&B niżej NIE znajduje
    // upakowania przy ZEROWYM luzie (12 rez × 3 = 36 obiegów: 2,6 mln węzłów bez ani jednego pełnego liścia),
    // bo bez inkumbenta nie ma czym przycinać, a forward-check bada obiegi pojedynczo. Dopasowanie z nawrotami
    // (ścieżki powiększające) jest UKIERUNKOWANE: każdemu obiegowi szuka jego DOCELOWEGO rodzaju (dg=0),
    // w razie kolizji RELOKUJĄC już przypisane (rekurencyjnie, jak Kuhn). Sukces (wszyscy dopasowani) ⇒ 0
    // downgrade = MAKSYMALNE obciążenie (każdy rezerwowy do 3 kół — potwierdzony ręczny plan użytkownika).
    // Porażka (zostaje nieobsadzony) ⇒ false → B&B/greedy (deficyt, piny itp. — bez zmian). Pomijamy, gdy są
    // już przypisania na rezerwowych (piny) — wtedy model lokalny nie odzwierciedla obciążenia; idzie B&B.
    const tryFullMatch = (): boolean => {
      if (opts.deadline != null) return false; // wywołanie zagnieżdżone (nawrót cięcia) — deficyt, matcher i tak
                                                // nie złoży pełnego dopasowania; pomijamy, by nie mnożyć kosztu
      if (rs.some((r) => r.jobs.length > 0)) return false; // piny/preassign → model lokalny nie odda obciążenia → B&B
      const zeroPlace = new Map<string, Slot[]>();
      for (const o of toAssign) {
        const z = place.get(o.id)!.filter((p) => p.dg === 0).map((p) => p.slot);
        if (z.length === 0) return false; // obieg bez docelowego slotu → nie ma pełnego dopasowania
        zeroPlace.set(o.id, z);
      }
      type AJob = { oid: string; s: number; e: number; slot: Slot };
      // LIMITY rezerwowego w dopasowaniu (fix 2026-06-12): DWA OSOBNE — RÓWNOWARTOŚĆ (≤ 3,0 eq) i LICZBA
      // podmian (maxJobs/rolling). Dawny wspólny cap `min(3, maxJobs)` liczył SZTUKI, nie eq — przy
      // połówkach (deficyt z indywidualnymi limitami, np. maxJobs=2 na A11) zaniżał pojemność (2 całe +
      // 2 połówki = 4 sztuki = LEGALNE 3,0 eq), matcher nie składał planu i spadało do greedy/nawrotu,
      // który tnął za dużo i zostawiał resztę rezerwowych na 2,0–2,5 (skarga użytkownika 2026-06-12).
      const capCnt = new Map(rs.map((r) => [r.ref.id, r.cap] as const));
      const availOk = (r: RState, s: Slot) =>
        (r.ref.availFrom == null || s.startT >= r.ref.availFrom) &&
        (r.ref.availTo == null || s.startT + s.durationMin * 60 <= r.ref.availTo);
      // augment (Kuhn dla interwałów): umieść `oid` na slocie dg=0. Jeśli rezerwowy jest zajęty czasowo,
      // RELOKUJ kolidujące obiegi. KLUCZ poprawności+pełności: `oid` wstawiamy NAJPIERW (zajmuje zwolnione
      // miejsce), POTEM relokujemy kolidujące — skoro nachodzą na slot `oid`, nie mogą wrócić na tego
      // rezerwowego, więc capacity NIE rośnie powyżej capN (liczba = stara − kolizje + 1), a relokacja zostaje
      // PEŁNA (mogą iść na innych rezerwowych). Cykle blokuje `moving` (obieg w łańcuchu nie jest relokowany
      // ponownie). Interwały łamią pełność czystego matchingu, więc przy porażce restart z inną kolejnością.
      let mnodes = 0; const PER_TRY = 120_000;            // budżet WĘZŁÓW na pojedynczą próbę (reset co restart)
      let asg = new Map<string, AJob[]>();
      // BUFOR „przeskok toru" jako TWARDE ograniczenie dopasowania (decyzja użytkownika 2026-06-11): rezerwowy
      // NIE dostanie dwóch podmian, między którymi musiałby przeskoczyć na drugi peron w oknie ≤ bufor. Taka
      // para to KONFLIKT (jak kolizja czasowa) → silnik relokuje jedną, dobierając inny slot (w razie potrzeby
      // z luzem / połówkę). Dzięki temu zmiana bufora REALNIE zmienia plan (nie tylko ⚠). Krańcówki (A1/A23)
      // bez przeskoku. Tylko obiegi NIE nakładające się czasowo (nakładanie łapie osobny warunek).
      const oppDir = (d: Dir): Dir => (d === "Kabaty" ? "Młociny" : "Kabaty");
      const XFM = (opts.xferBufferMin ?? XFER_BUFFER_MIN) * 60;
      const crossTight = (a: AJob, b: { s: number; e: number; slot: Slot }, station: BreakStation): boolean => {
        if (XFM <= 0 || station === "A1" || station === "A23") return false;
        const [x, y] = a.s <= b.s ? [a, b] : [b, a];               // x wcześniejszy, y późniejszy
        const handover = returnsOppositeTrack(x.slot.kind) ? oppDir(x.slot.dir) : x.slot.dir; // gdzie stoi po oddaniu
        return y.slot.dir !== handover && y.s - x.e > 0 && y.s - x.e <= XFM; // inny peron + ciasno (i bez nakładania)
      };
      // `moving` MONOTONICZNE w obrębie jednej próby (jak visited w Kuhn): obieg raz wpisany do łańcucha nie jest
      // relokowany ponownie → gwarancja zakończenia (≤ N obiegów). Pełność dorównuje restart z inną kolejnością.
      // zpCur/bsCur — źródła slotów/rezerwowych bieżącej próby (późne próby tasują je dla pełności, patrz pętla)
      let zpCur = zeroPlace, bsCur = byStation;
      const augment = (oid: string, moving: Set<string>, depth: number): boolean => {
        if (++mnodes > PER_TRY || depth > toAssign.length + 2) return false;
        moving.add(oid);
        for (const slot of zpCur.get(oid)!) {
          const s = slot.startT, e = slot.startT + slot.durationMin * 60;
          const nb = { s, e, slot };
          for (const r of bsCur.get(slot.station) ?? []) {
            const rid = r.ref.id;
            if (!availOk(r, slot)) continue;
            const cur = asg.get(rid)!;
            // KONFLIKT = kolizja czasowa LUB zbyt ciasny przeskok toru (bufor) na tym rezerwowym
            const baseConf = cur.filter((j) => (s < j.e && j.s < e) || crossTight(j, nb, r.ref.station));
            if (baseConf.some((c) => moving.has(c.oid))) continue;      // konflikt z obiegiem już w łańcuchu → pomiń
            // RELOKACJA Z POWODU POJEMNOŚCI (fix 2026-06-12): gdy po odjęciu kolizji czasowych nowy slot
            // i tak nie mieści się w limicie EQ (≤3,0) lub LICZBY podmian (maxJobs/rolling), wytypuj do
            // relokacji DODATKOWE podmiany (nie-moving, największe eq pierwsze = najmniej relokacji).
            // Bez tego matcher umiał wypierać tylko kolizje czasowe i nie składał ciasnych planów z
            // połówkami (deficyt z indywidualnymi limitami) → spadał do greedy/nawrotu, który tnął za
            // dużo i zostawiał resztę rezerwowych na 2,0–2,5 (skarga użytkownika).
            const keep = cur.filter((j) => !baseConf.includes(j));
            let eqKeep = keep.reduce((q, j) => q + CALA_EQ[j.slot.kind], 0) + CALA_EQ[slot.kind];
            let cntKeep = keep.length + 1;
            const extra: AJob[] = [];
            if (eqKeep > MAX_RESERVE_LOAD_EQ + 1e-6 || cntKeep > capCnt.get(rid)!) {
              const movable = keep.filter((j) => !moving.has(j.oid))
                .sort((a, b) => CALA_EQ[b.slot.kind] - CALA_EQ[a.slot.kind]);
              for (const j of movable) {
                if (eqKeep <= MAX_RESERVE_LOAD_EQ + 1e-6 && cntKeep <= capCnt.get(rid)!) break;
                extra.push(j); eqKeep -= CALA_EQ[j.slot.kind]; cntKeep -= 1;
              }
              if (eqKeep > MAX_RESERVE_LOAD_EQ + 1e-6 || cntKeep > capCnt.get(rid)!) continue; // nie zmieści się
            }
            const conflicts = [...baseConf, ...extra];
            const cset = new Set(conflicts);
            const saved = new Map([...asg].map(([k, v]) => [k, v.slice()] as const)); // pełny snapshot (relokacje mutują wielu)
            asg.set(rid, [...cur.filter((j) => !cset.has(j)), { oid, s, e, slot }]); // oid NAJPIERW (zajmuje miejsce)
            let ok = true;
            for (const c of conflicts) if (!augment(c.oid, moving, depth + 1)) { ok = false; break; }
            if (ok) return true;
            asg = saved;  // pełne cofnięcie nieudanej gałęzi (też zagnieżdżonych relokacji) — bez duplikatów
          }
        }
        return false;
      };
      const baseMRV = [...toAssign].sort((a, b) => zeroPlace.get(a.id)!.length - zeroPlace.get(b.id)!.length); // MRV
      // STRATEGIA 2 (fix 2026-06-12): NAJTRUDNIEJSI NAJPIERW — całozmianowi/najwięcej kół na przedzie (jak
      // `order` w greedy). MRV stawia całozmianowych (najwięcej slotów) na KOŃCU — przy pełnej saturacji z
      // połówkami (indywidualne limity) padali ostatni, bo kaskadowych relokacji broni monotoniczne `moving`.
      // Wstawieni PIERWSI zajmują moc bez relokacji, a elastyczne obiegi i tak się dopasują.
      const baseHard = [...toAssign].sort(
        (a, b) => loopKey(b) - loopKey(a) || criticalRank(a) - criticalRank(b) ||
                  zeroPlace.get(a.id)!.length - zeroPlace.get(b.id)!.length
      );
      const rngM = mulberry32(((opts.seed ?? 0) | 0) ^ 0x9e3779b9);
      // Budżet ~250 ms: stan pełnego obciążenia trafia od razu (próba 0, ~3 tys. węzłów / kilkanaście ms);
      // ciasne plany z połówkami (po racjonowaniu = zero-luz z limitami) potrzebują kilkudziesięciu restartów.
      const RESTARTS = 400;
      const matchDeadline = Math.min(planDeadline, Date.now() + 250);
      for (let attempt = 0; attempt < RESTARTS; attempt++) {
        if (Date.now() > matchDeadline) break;
        mnodes = 0;                                       // świeży budżet na każdą próbę (kolejność może utknąć)
        asg = new Map(rs.map((r) => [r.ref.id, [] as AJob[]]));
        // WARIANT (seed): seed=0 → próba 0 = czyste MRV, próba 1 = najtrudniejsi-najpierw (deterministyczne).
        // seed≠0 → potrząsamy od razu (Fisher–Yates wg seeda) — inny seed = INNE pełne dopasowanie = inny
        // wariant planu („Generuj plan"). Kolejne próby potrząsane, na przemian z obu kolejności bazowych.
        const ord = (attempt % 2 === 0 ? baseMRV : baseHard).slice();
        if (attempt > 1 || vary) for (let i = ord.length - 1; i > 0; i--) { const j = Math.floor(rngM() * (i + 1)); [ord[i], ord[j]] = [ord[j], ord[i]]; }
        zpCur = zeroPlace; bsCur = byStation;
        let full = true;
        for (const o of ord) if (!augment(o.id, new Set(), 0)) { full = false; break; }
        if (full) {
          for (const [rid, list] of asg)
            for (const a of list) commit(obiegi.find((x) => x.id === a.oid)!, a.slot, rs.find((x) => x.ref.id === rid)!);
          return true;
        }
      }
      return false;
    };
    if (tryFullMatch()) return true; // pełne dopasowanie bez downgrade (maks. obciążenie) — pomijamy B&B/greedy

    // minimalny downgrade osiągalny dla obiegu w bieżącym stanie (∞ = nie ma gdzie go obsadzić → ten branch BRAK)
    const minDg = (o: Obieg): number => {
      let m = Infinity;
      for (const p of place.get(o.id)!) { if (p.dg >= m) continue; if (elig(p.slot).some((r) => canTake(r, p.slot))) m = p.dg; }
      return m;
    };
    let nodes = 0, aborted = false;
    // BUDŻET — prymarnie WĘZŁOWY (deterministyczny wynik: ta sama obsada → ten sam plan, niezależnie od
    // szybkości maszyny). Optimum trafia się zwykle natychmiast (REAL 12: dg=2 przy 76 węźle / 10 ms), więc
    // głównym hamulcem jest STALL: gdy przez STALL_NODES nie ma poprawy inkumbenta, kończymy (na łatwych
    // szybko, na trudnych dłużej). NODE_BUDGET i czas to twarde zabezpieczenia, by UI nie zamarzło; po
    // wyczerpaniu — fallback do greedy. Wszystkie progi w WĘZŁACH (deterministyczne), czas tylko awaryjnie.
    // STALL_NODES dobrane empirycznie 2026-06-10: optimum trafia się przy ~76 węźle, więc 4000 węzłów bez
    // poprawy wystarcza — TA SAMA jakość co 30 000 (downgr identyczne na wszystkich testach), ale ~70 ms
    // zamiast ~460 ms. Usuwa „zacięcie" przy zmianie opóźnienia/ustawień (regeneracja na żywo).
    // NO_INCUMBENT_BAIL: stan pełnego obciążenia rozwiązuje już matcher (wyżej). Gdy matcher odpadł (DEFICYT),
    // B&B zwykle też nie złoży kompletu (to samo zero-luzu) i tylko miele do deadline'u — a wynik i tak da greedy.
    // Więc gdy po tylu węzłach NIE ma ŻADNEGO inkumbenta, odpuszczamy szybko (greedy) zamiast laga. Łatwe scenariusze
    // (z luzem) trafiają inkumbenta < 1 tys. węzłów, więc ich to nie dotyczy.
    const NODE_BUDGET = 4_000_000, STALL_NODES = 4_000, NO_INCUMBENT_BAIL = 20_000;
    type Pick = { o: Obieg; slot: Slot; rid: string };
    let bestCost = Infinity; let bestChosen: Pick[] | null = null; let lastImprove = 0;
    const cur: Array<{ o: Obieg; slot: Slot; rid: string }> = [];
    const dfs = (i: number, dgSoFar: number): void => {
      if (aborted) return;
      if (++nodes > NODE_BUDGET || (bestChosen && nodes - lastImprove > STALL_NODES) ||
          (!bestChosen && nodes > NO_INCUMBENT_BAIL) ||
          ((nodes & 1023) === 0 && Date.now() > planDeadline)) { aborted = true; return; }
      if (dgSoFar >= bestCost) return; // przycięcie inkumbentem
      if (i === vars.length) { bestCost = dgSoFar; bestChosen = cur.slice(); lastImprove = nodes; return; }
      // DOLNE OGRANICZENIE + forward-check: suma minDg pozostałych; ∞ → branch prowadzi do BRAK (odetnij)
      let lb = dgSoFar;
      for (let j = i; j < vars.length; j++) { const m = minDg(vars[j]); if (m === Infinity) return; lb += m; if (lb >= bestCost) return; }
      const o = vars[i];
      for (const p of place.get(o.id)!) {
        if (dgSoFar + p.dg >= bestCost) break; // placements sort: dg rośnie → dalej nie będzie lepiej
        const e = p.slot.startT + p.slot.durationMin * 60;
        const cands = elig(p.slot).filter((r) => canTake(r, p.slot))
          .sort((a, b) => load.get(b.ref.id)! - load.get(a.ref.id)! || resKey.get(a.ref.id)! - resKey.get(b.ref.id)!);
        let emptyTried = false; // symetria: świeży (pusty) rezerwowy danej stacji jest wymienny — próbuj tylko JEDNEGO
        for (const r of cands) {
          const rid = r.ref.id;
          if (jobs.get(rid)!.length === 0) { if (emptyTried) continue; emptyTried = true; }
          jobs.get(rid)!.push({ s: p.slot.startT, e }); load.set(rid, load.get(rid)! + CALA_EQ[p.slot.kind]); cnt.set(rid, cnt.get(rid)! + 1);
          cur.push({ o, slot: p.slot, rid });
          dfs(i + 1, dgSoFar + p.dg);
          cur.pop(); jobs.get(rid)!.pop(); load.set(rid, load.get(rid)! - CALA_EQ[p.slot.kind]); cnt.set(rid, cnt.get(rid)! - 1);
          if (aborted) return;
        }
      }
    };
    dfs(0, 0);
    const sol = bestChosen as Pick[] | null; // cast: CFA nie widzi przypisania w domknięciu dfs
    if (sol == null) return false; // nic nie znaleziono (budżet bez pełnego rozwiązania) → greedy
    for (const { o, slot, rid } of sol) commit(o, slot, rs.find((x) => x.ref.id === rid)!);
    return true;
  };

  if (!optimizeExact()) {
    // FAZA 1 — CAŁE poza A11 (autoSlots blokuje cała@A11). Niezmieszczone → pendingCala (nadmiar dla A11).
    // Greedy „całe-first na A11" testowany 2026-06-10 — odrzucony: głodził połówki (BRAK) i ścinał na połówkę
    // nawet długodystansowców 5,0. Dlatego najmniej elastyczne A11-only połówki idą PIERWSZE (faza 2).
    const pendingCala: Obieg[] = [];
    for (const o of order) {
      if (dk(o) !== "cała" || assignments[o.id]?.length) continue; // pin/inny rodzaj
      if (!tryAssign(o)) pendingCala.push(o);
    }
    // FAZA 2 — dedykowane POŁÓWKI na A11 (claim A11 — najmniej elastyczne, połówka możliwa TYLKO na A11).
    for (const o of order) {
      if (dk(o) === "cała" || assignments[o.id]?.length) continue;
      if (tryAssign(o)) continue;
      if (tryCover(o)) continue;
      fallbackBrak(o);
    }
    // FAZA 3 — NADMIAR całych (niezmieszczonych poza A11): ląduje jako CAŁA@A11 (a11 też może być cała).
    // Kolejność: cała off-A11 → cała@A11 → (ostateczność) połówka@A11 → BRAK (sygnał „dodać rezerwowego").
    for (const o of pendingCala) {
      if (assignments[o.id]?.length) continue;
      if (tryAssign(o)) continue;        // cała poza A11 (preferowane)
      if (tryAssign(o, true)) continue;  // overflow → CAŁA@A11
      if (tryCover(o)) continue;         // ostateczność: pokrycie awaryjne (połówka@A11)
      fallbackBrak(o);
    }
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

  // 1c. NAWRÓT „cięcie wg kół" — ITERACYJNY Z LOOKAHEAD (przebudowa 2026-06-12; R9 + sprawiedliwość):
  // bilans eq NIE widzi OKIEN czasowych — np. rezerwowy A11 zmieści w oknie jedynej przerwy (≤18:20)
  // tylko ~5 połówek, więc bywa, że pełne pokrycie wymaga cięcia ZNACZNIE głębiej, niż wskazuje moc,
  // przechodząc przez PLATEAU (kolejne cięcie chwilowo nie zmniejsza BRAK — stary nawrót się wtedy
  // zatrzymywał i np. przy 9 rezerwowych zostawał BRAK 3–4 mimo osiągalnego 0). Tniemy kolejnych
  // NAJMNIEJ-KOŁOWYCH (forced) i bierzemy NAJLEPSZY plan (najmniej BRAK); stop: 0 BRAK / STALL_CUTS
  // cięć bez poprawy / deadline. Zagnieżdżone plany mają `noRecut` (pętla sama dokłada cięcia).
  const brakNow = obiegi.filter((o) => !(assignments[o.id] ?? []).some((a) => a.reserveId));
  if (brakNow.length && !opts.noRecut) {
    const STALL_CUTS = 12;
    const recutDeadline = Math.max(planDeadline, Date.now() + 600); // deficyt: wynik ważniejszy niż ~1 s planowania
    const brakOf = (p: PlanResult) =>
      obiegi.filter((o) => !(p.assignments[o.id] ?? []).some((a) => a.reserveId)).length;
    const toCut = eligible.filter((o) => !autoPolowka.has(o.id) && dk(o) === "cała"); // już posortowani rosnąco po kołach
    // UTRWAL cięcia bilansowe jako wymuszone: bez tego bilans w retry ZMNIEJSZAŁ swoje auto-cięcia o tyle,
    // ile wymusiła pętla (zbiór ciętych tylko zmieniał skład, nie rósł) i realna głębokość zaczynała się
    // dopiero po wyczerpaniu zbioru bilansowego — marnując budżet skanów. Teraz każda iteracja tnie GŁĘBIEJ o 1.
    const cuts: Record<string, BreakKind> = { ...forced };
    for (const id of autoPolowka) cuts[id] = "połówka";
    let bestCuts: Record<string, BreakKind> | null = null;
    let bestBrak = brakNow.length;
    let stall = 0;
    for (const c of toCut) {
      if (bestBrak === 0 || stall >= STALL_CUTS || Date.now() > recutDeadline) break;
      cuts[c.id] = "połówka";
      // szybki SKAN (scanOnly): liczy się tylko pokrycie — bez porządkowania/dokładek (te dostanie zwycięzca)
      const retry = planBreaks(obiegi, reserves, { ...opts, deadline: recutDeadline, noRecut: true, scanOnly: true, forcedKinds: { ...cuts } });
      const rb = brakOf(retry);
      if (rb < bestBrak) { bestBrak = rb; bestCuts = { ...cuts }; stall = 0; } else stall++;
    }
    // zwycięskie cięcia przeliczone W PEŁNI (porządkowanie + dociążanie, świeży budżet)
    if (bestCuts) return planBreaks(obiegi, reserves, {
      ...opts, deadline: Math.max(planDeadline, Date.now() + 300), noRecut: true, forcedKinds: bestCuts,
    });
  }

  // 2. R16 — NADWYŻKA jako 2. POŁÓWKI (przebudowa 2026-06-12 wg użytkownika): liczba nadmiarowych połówek
  // jest znana Z GÓRY z bilansu (extraHalves), a A11 było pod nie zarezerwowane już przy rozkładaniu całych.
  // KLUCZOWE ZMIANY vs 2026-06-11:
  //  • Połówka NIE musi być druga chronologicznie — MOŻE BYĆ PIERWSZA (wczesna, od progu „zacznij od");
  //    obieg z 1,5 przerwy może dostać połówkę tuż po progu (np. wjazd 13:00, próg 14:00 → połówka ~14:00),
  //    a całą później. Zniesiono filtr `startT >= after` (koniec 1. przerwy).
  //  • ZERO wymuszonego rozsuwu (usunięto SPACING_POLOWKI ~2,5 h): „może być od razu — jeden maszynista robi
  //    od razu półtorej — albo po jakimś czasie, na tej samej lub innej stacji; pełna dowolność". Jedyny
  //    warunek: przerwy tego samego obiegu (maszynisty) NIE nakładają się.
  //  • Gdy wczesne sloty połówki kolidują z już ustawioną całą obiegu — silnik próbuje PRZESUNĄĆ całą na
  //    inny slot (para połówka+cała planowana łącznie), z zachowaniem reguły „pierwsza z pary w oknie
  //    1. przerwy" (≤ min(18:20, entry+6h)).
  // Okno połówki: od progu „zacznij od" (floorOf) do LATEST_SECOND (realnie limituje R7/zjazd).
  const hasBrak = () => obiegi.some((o) => !(assignments[o.id] ?? []).some((a) => a.reserveId));
  const ownBusy = (o: Obieg) => (assignments[o.id] ?? []).map((a) => ({ s: a.startT, e: a.startT + a.durationMin * 60 }));
  const overlapsOwn = (o: Obieg, s: number, e: number) => ownBusy(o).some((j) => s < j.e && j.s < e);
  // Dołożenie NADMIAROWEJ połówki do obiegu (→ 1,5 koła). Zwraca true, gdy dołożono.
  const addExtraHalf = (o: Obieg): boolean => {
    const cur = assignments[o.id];
    if (!cur || cur.length === 0 || cur.length >= MAX_BREAKS_PER_OBIEG) return false;
    if (cur.some((a) => !a.reserveId)) return false; // BRAK — nie dokładaj
    const a0 = cur[0];
    const slots = autoSlots(o, "połówka", floorOf(o), LATEST_SECOND)
      .sort((a, b) => score(a) - score(b)); // najwcześniejsza najlepsza — połówka może być PIERWSZA
    for (const slot of slots) {
      const sE = slot.startT + slot.durationMin * 60;
      if (!overlapsOwn(o, slot.startT, sE)) {
        const r = pickReserve(rs, slot);
        if (r) { commit(o, slot, r); return true; }
        continue;
      }
      // slot koliduje z własną (jedyną, automatyczną) przerwą → spróbuj RELOKOWAĆ ją na inny slot
      if (cur.length !== 1 || a0.manual) continue;
      const r0 = rs.find((r) => r.ref.id === a0.reserveId);
      if (!r0) continue;
      removeJob(r0, a0);
      assignments[o.id] = [];
      const rh = pickReserve(rs, slot);
      if (rh) {
        commit(o, slot, rh);
        // nowe miejsce dla dotychczasowej przerwy: ta sama WIELKOŚĆ (bez downgrade), bez nakładania
        // z połówką; PIERWSZA chronologicznie przerwa pary musi mieścić się w oknie 1. przerwy (R3/18:20).
        const lf = latestFirstOf(o);
        const fulls = candidateSlots(o, a0.kind, floorOf(o), LATEST_SECOND)
          .filter((f) => !overlapsOwn(o, f.startT, f.startT + f.durationMin * 60) &&
                         Math.min(f.startT, slot.startT) <= lf)
          .sort((a, b) => score(a) - score(b));
        for (const f of fulls) {
          const rf = pickReserve(rs, f);
          if (rf) { commit(o, f, rf); return true; }
        }
        // przerwy nie da się przełożyć → cofnij połówkę
        const ah = assignments[o.id][assignments[o.id].length - 1];
        const rhBack = rs.find((r) => r.ref.id === ah.reserveId);
        if (rhBack) removeJob(rhBack, ah);
        assignments[o.id] = [];
      }
      // przywróć pierwotną przerwę
      assignments[o.id] = [a0];
      r0.jobs.push({ s: a0.startT, e: a0.startT + a0.durationMin * 60, obiegId: a0.obiegId });
      r0.loadMin += a0.durationMin; r0.loadEq += CALA_EQ[a0.kind]; r0.count += 1;
    }
    return false;
  };
  const targetEq = (r: RState) => Math.min(MAX_RESERVE_LOAD_EQ, capOf(r.ref)); // cel obciążenia (respektuje maxJobs)
  // Przeniesienie ZAANGAŻOWANEJ przerwy `a` z rezerwowego `from` na `to` (ta sama stacja i czas — driverFreeAt
  // bez zmian). Lustrzanie aktualizuje obciążenie obu rezerwowych i `reserveId` przydziału.
  const moveJob = (a: BreakAssignment, from: RState, to: RState) => {
    removeJob(from, a);
    to.jobs.push({ s: a.startT, e: a.startT + a.durationMin * 60, obiegId: a.obiegId });
    to.loadMin += a.durationMin; to.loadEq += CALA_EQ[a.kind]; to.count += 1;
    a.reserveId = to.ref.id;
  };
  // REBALANS w obrębie stacji (BEZ nowych przerw): pakuje pojedyncze przydziały, dobijając rezerwowych
  // najbliższych pełna kosztem najmniej obciążonych TEJ SAMEJ stacji (rezerwowy podmienia tylko u siebie).
  // Maksymalizuje liczbę rezerwowych na min(3, maxJobs); nadmiarowi zostają widocznie wolni (do zwolnienia).
  // Nie zmienia rodzajów/slotów → zero kolizji z regułami (sprawiedliwość, scarcity A11, piny). Bez RNG.
  const rebalanceStations = () => {
    const groups = new Map<BreakStation, RState[]>();
    for (const r of rs) if (!r.ref.blocked && !r.ref.manualOnly)
      (groups.get(r.station) ?? groups.set(r.station, []).get(r.station)!).push(r);
    for (const group of groups.values()) {
      let moved = true, guard = 0;
      while (moved && guard++ < 1000 && Date.now() <= r16Deadline) {
        moved = false;
        const fill = group.filter((r) => r.loadEq + 1e-6 < targetEq(r)).sort((a, b) => b.loadEq - a.loadEq)[0];
        if (!fill) break;                                              // wszyscy na stacji pełni → koniec
        const donors = group.filter((r) => r !== fill && r.loadEq > 1e-6).sort((a, b) => a.loadEq - b.loadEq);
        for (const donor of donors) {
          let did = false;
          for (const j of [...donor.jobs]) {
            const arr = assignments[j.obiegId];
            if (!arr || arr.length !== 1) continue;                    // pin / 2 przerwy — nie ruszaj
            const a = arr[0];
            if (a.reserveId !== donor.ref.id || a.manual) continue;
            const e = a.startT + a.durationMin * 60;
            if (!freeAt(fill, a.startT, e) || !fitsLoad(fill.loadEq, a.kind) || fill.count >= fill.cap) continue;
            if (fill.ref.availFrom != null && a.startT < fill.ref.availFrom) continue;
            if (fill.ref.availTo != null && e > fill.ref.availTo) continue;
            moveJob(a, donor, fill); moved = did = true; break;
          }
          if (did) break;
        }
      }
    }
  };
  // DOCIĄŻANIE nadmiarowymi połówkami — SPRAWIEDLIWIE (2026-06-11/12): każdy obieg dobijamy do 1,5 koła
  // POŁÓWKĄ (możliwa TYLKO na A11 → dociąża rezerwowych A11), w kolejności OD NAJWIĘCEJ KÓŁ (`loopKey`
  // malejąco; całozmianowi = ∞ pierwsi). Połówka może wypaść PRZED lub PO dotychczasowej przerwie (pełna
  // dowolność, bez rozsuwu — addExtraHalf wyżej). NIKT nie dostaje 2,0 (2. zawsze połówka) — to wyrównuje
  // (równo-kołowi traktowani tak samo), a nadwyżkowa moc off-A11 (połówki tam nie wejdą) zostaje WOLNA
  // (widoczni wolni rezerwowi do zwolnienia). Bramka `roomLeft`: nie dokładamy ponad moc. Bez RNG (determinizm).
  const roomLeft = () => rs.some((r) => !r.ref.blocked && !r.ref.manualOnly && r.loadEq + 1e-6 < targetEq(r));
  // PROMOTE połówek → CAŁA (fix 2026-06-12, skarga „przy indywidualnych limitach reszta nie ma pełnego
  // obciążenia"): przy ciasnym upakowaniu (matcher nie składa, B&B pada) nawrót tnie WIĘCEJ obiegów, niż
  // wynika z bilansu — rezerwowi stacji „od całych" (np. A1) zostają na 2,0 mimo wolnej mocy, bo połówka
  // możliwa tylko na A11. Naprawa: AUTOMATYCZNE połówki obiegu (najbardziej kołowi pierwsi — odwracamy
  // cięcie od góry) zamieniamy na CAŁĄ u wolnego rezerwowego (pickReserve), o ile jest na nią moc;
  // zwolniona moc A11 wraca do puli (drabina niżej dołoży z niej 2. połówki). Wymuszonych (forced) i
  // ręcznych (manual) nie ruszamy. Netto obciążenie tylko rośnie (cała 1,0 ≥ zdjęte połówki).
  const promoteToCala = () => {
    const byLoops = [...obiegi].sort((a, b) => loopKey(b) - loopKey(a) || numOf(a.id) - numOf(b.id));
    let prog = true;
    while (prog && Date.now() <= r16Deadline) {
      prog = false;
      for (const o of byLoops) {
        if (forced[o.id]) continue;                       // twarde wymuszenie rodzaju — nie zmieniamy
        const cur = assignments[o.id] ?? [];
        if (!cur.length || cur.some((a) => !a.reserveId || a.manual || a.kind !== "połówka")) continue;
        const { floor, hi } = coverWindow(o, "cała");
        const slots = candidateSlots(o, "cała", floor, hi).sort((a, b) => score(a) - score(b));
        if (!slots.length) continue;
        const olds = cur.map((a) => ({ a, r: rs.find((x) => x.ref.id === a.reserveId)! }));
        for (const { a, r } of olds) removeJob(r, a);      // zdejmij połówki (do ewentualnego przywrócenia)
        assignments[o.id] = [];
        let placed = false;
        for (const slot of slots) {
          const r = pickReserve(rs, slot);
          if (r) { commit(o, slot, r); placed = true; break; }
        }
        if (placed) { prog = true; continue; }
        assignments[o.id] = olds.map((x) => x.a);          // nie wyszło — przywróć połówki bez zmian
        for (const { a, r } of olds) {
          r.jobs.push({ s: a.startT, e: a.startT + a.durationMin * 60, obiegId: a.obiegId });
          r.loadMin += a.durationMin; r.loadEq += CALA_EQ[a.kind]; r.count += 1;
        }
      }
    }
  };
  // KROK 0c — SPRAWIEDLIWA ZAMIANA OFIAR CIĘCIA (2026-06-12, skarga „D16 pół, D19 pół"): pokrycie
  // awaryjne (tryCover) i eviction potrafią pociąć obieg WYSOKOKOŁOWY na połówkę, choć NIŻEJ-kołowy
  // trzyma całą — łamie to porządek „tnij najmniej kół najpierw". Naprawa: obieg na samotnej połówce
  // (eq<1, auto) dostaje CAŁĄ, a najmniej-kołowy posiadacz auto-całej schodzi na połówkę@A11 (staje
  // się ofiarą zgodną z bilansem). Obie strony tylko AUTO (bez forced/manual/całozmianowych). Pełny
  // rollback, gdy któraś strona zamiany się nie mieści.
  const swapCutVictims = () => {
    const byLoops = [...obiegi].sort((a, b) => loopKey(b) - loopKey(a) || numOf(a.id) - numOf(b.id));
    const eqOf = (o: Obieg) => (assignments[o.id] ?? []).filter((a) => a.reserveId).reduce((s, a) => s + CALA_EQ[a.kind], 0);
    let prog = true;
    while (prog && Date.now() <= r16Deadline) {
      prog = false;
      const victims = byLoops.filter((o) =>
        !forced[o.id] && !isThrough(o) && eqOf(o) > 0 && eqOf(o) < 1 - 1e-6 &&
        (assignments[o.id] ?? []).every((a) => a.reserveId && !a.manual && a.kind === "połówka"));
      for (const x of victims) {
        const donors = [...obiegi]
          .filter((z) => z !== x && !forced[z.id] && !isThrough(z) && loopKey(z) < loopKey(x) &&
            (assignments[z.id] ?? []).length === 1 &&
            (assignments[z.id] ?? []).every((a) => a.reserveId && !a.manual && a.kind === "cała"))
          .sort((a, b) => loopKey(a) - loopKey(b) || numOf(a.id) - numOf(b.id)); // najmniej kół oddaje całą pierwszy
        let swapped = false;
        for (const z of donors) {
          const ax = (assignments[x.id] ?? []).map((a) => ({ a, r: rs.find((q) => q.ref.id === a.reserveId)! }));
          const az = (assignments[z.id] ?? []).map((a) => ({ a, r: rs.find((q) => q.ref.id === a.reserveId)! }));
          for (const { a, r } of [...ax, ...az]) removeJob(r, a);
          assignments[x.id] = []; assignments[z.id] = [];
          let okX = false;
          { const { floor, hi } = coverWindow(x, "cała");
            for (const s of candidateSlots(x, "cała", floor, hi).sort((p, q) => score(p) - score(q))) {
              const r = pickReserve(rs, s); if (r) { commit(x, s, r); okX = true; break; } } }
          let okZ = false;
          if (okX) { const { floor, hi } = coverWindow(z, "połówka");
            for (const s of autoSlots(z, "połówka", floor, hi).sort((p, q) => score(p) - score(q))) {
              const r = pickReserve(rs, s); if (r) { commit(z, s, r); okZ = true; break; } } }
          if (okX && okZ) { swapped = true; break; }
          // rollback: zdejmij co weszło, przywróć oryginały obu stron
          for (const o2 of [x, z]) {
            for (const a of (assignments[o2.id] ?? [])) { const r = rs.find((q) => q.ref.id === a.reserveId); if (r) removeJob(r, a); }
            assignments[o2.id] = [];
          }
          for (const { a, r } of [...ax, ...az]) {
            (assignments[a.obiegId] ??= []).push(a);
            r.jobs.push({ s: a.startT, e: a.startT + a.durationMin * 60, obiegId: a.obiegId });
            r.loadMin += a.durationMin; r.loadEq += CALA_EQ[a.kind]; r.count += 1;
          }
        }
        if (swapped) { prog = true; break; }                           // od nowa — listy ofiar/dawców się zmieniły
      }
    }
  };
  // 1d. SPRAWIEDLIWY BRAK (`fairBrakSwap`, 2026-06-12, skarga „D19 BRAK, a inne mają całe"): gdy BRAK
  // trafił obieg WYŻEJ-kołowy (całozmianowy/D19), a NIŻEJ-kołowy ma przerwę — przejmij pokrycie: zdejmij
  // jedyną (automatyczną) przerwę najmniej-kołowego z obsadzonych, obsadź wysokokołowego (rodzaj wg
  // kindsFor, okno 1. przerwy, cała@A11 dozwolona). Zdetronizowany próbuje się jeszcze załapać gdzie
  // indziej; inaczej to ON zostaje BRAK — ofiary zawsze od najmniej kół (R9-fair).
  // Próba obsadzenia obiegu BRAK na WOLNEJ mocy (bez zabierania nikomu) — okno RELAX (połówka może być
  // wczesna): lepsza wczesna połówka niż BRAK. Zwraca true, gdy obsadzono. Używane w fairBrakSwap.
  const tryPlaceRelaxed = (x: Obieg): boolean => {
    const fbX = assignments[x.id];
    assignments[x.id] = [];
    for (const kind of kindsFor(x)) {
      const { floor, hi } = coverWindow(x, kind, true); // relax: znieś POL_LATE (pokrycie > jakość)
      const src = kind === "cała" ? candidateSlots : autoSlots; // cała może wejść na A11 (overflow)
      for (const s of src(x, kind, floor, hi).sort((p, q) => score(p) - score(q))) {
        const r = pickReserve(rs, s);
        if (r) { commit(x, s, r); const ix = unassigned.indexOf(x.id); if (ix >= 0) unassigned.splice(ix, 1); return true; }
      }
    }
    assignments[x.id] = fbX ?? [];
    return false;
  };
  // SPRAWIEDLIWA ZAMIANA BRAK (pairwise): wysokokołowy x bez przerwy przejmuje pokrycie od niżej-kołowego z
  // (single-break, auto) — zdejmij przerwę z, obsadź x na ZWOLNIONYM slocie; z próbuje się przenieść gdzie
  // indziej, inaczej to ON zostaje BRAK (ofiara wg porządku kół). NIE zmienia LICZBY pokrytych (czysta
  // zamiana) → bez ryzyka regresji pokrycia. Okno x/z RELAX (pokrycie wysokokołowego > jakość połówki).
  const fairBrakSwap = () => {
    let prog = true, guard = 0;
    while (prog && guard++ < 80 && Date.now() <= r16Deadline) {
      prog = false;
      const brakOb = obiegi.filter((o) => !(assignments[o.id] ?? []).some((a) => a.reserveId))
        .sort((a, b) => loopKey(b) - loopKey(a) || numOf(a.id) - numOf(b.id)); // wysokokołowi pierwsi
      for (const x of brakOb) {
        if (tryPlaceRelaxed(x)) { prog = true; break; }              // 1) wolna moc (zysk pokrycia)
        const donors = obiegi
          .filter((z) => loopKey(z) < loopKey(x) &&
            (assignments[z.id] ?? []).length === 1 &&
            (assignments[z.id] ?? []).every((a) => a.reserveId && !a.manual))
          .sort((a, b) => loopKey(a) - loopKey(b) || numOf(a.id) - numOf(b.id)); // najmniej kołowy oddaje pierwszy
        let fixed = false;
        for (const z of donors) {
          const az = assignments[z.id][0];
          const rz = rs.find((r) => r.ref.id === az.reserveId)!;
          removeJob(rz, az);
          assignments[z.id] = [];
          const fbX = assignments[x.id]; // ewentualny slot BRAK (reserveId=null) do wyświetlania
          assignments[x.id] = [];
          let okX = false;
          for (const kind of kindsFor(x)) {
            const { floor, hi } = coverWindow(x, kind, true); // relax: pokrycie wysokokołowego > jakość
            for (const s of candidateSlots(x, kind, floor, hi).sort((p, q) => score(p) - score(q))) {
              const r = pickReserve(rs, s);
              if (r) { commit(x, s, r); okX = true; break; }
            }
            if (okX) break;
          }
          if (okX) {
            const ix = unassigned.indexOf(x.id); if (ix >= 0) unassigned.splice(ix, 1);
            // zdetronizowany z: spróbuj obsadzić gdzie indziej (pełny łańcuch rodzajów); inaczej BRAK
            let okZ = false;
            for (const kind of kindsFor(z)) {
              const { floor, hi } = coverWindow(z, kind, true);
              for (const s of candidateSlots(z, kind, floor, hi).sort((p, q) => score(p) - score(q))) {
                const r = pickReserve(rs, s);
                if (r) { commit(z, s, r); okZ = true; break; }
              }
              if (okZ) break;
            }
            if (!okZ) fallbackBrak(z); // z → BRAK (ofiara wg porządku kół) + slot do wyświetlenia
            fixed = prog = true;
            break;
          }
          // x nie wszedł — pełny rollback
          assignments[x.id] = fbX ?? [];
          assignments[z.id] = [az];
          rz.jobs.push({ s: az.startT, e: az.startT + az.durationMin * 60, obiegId: az.obiegId });
          rz.loadMin += az.durationMin; rz.loadEq += CALA_EQ[az.kind]; rz.count += 1;
        }
        if (fixed) break; // listy się zmieniły — od nowa
      }
    }
  };
  // MAKSYMALNE POKRYCIE Z PRIORYTETEM KÓŁ (`maxCoverMatch`, 2026-06-12, skarga „D19 BRAK, inne mają całe"):
  // gdy greedy/nawrót zostawił BRAK, budujemy DOPASOWANIE ścieżkami powiększającymi (Kuhn) na świeżym modelu
  // lokalnym, przetwarzając obiegi OD NAJWIĘCEJ KÓŁ — wysokokołowy zajmuje miejsce pierwszy, a augmentacja
  // (relokacja kolidujących) NIE wypycha go później, więc nieobsadzeni to NAJMNIEJ kołowi (overflow). Placements
  // = dk + downgrade (relax okno: pokrycie > „połówka nie pierwsza"); limity eq≤3 i liczby podmian respektowane.
  // Adoptujemy wynik TYLKO gdy pokrywa WIĘCEJ obiegów niż bieżący (nie regresuje), potem pełne dokładki/porządki.
  const maxCoverMatch = (): boolean => {
    const pinnedIds = new Set(rs.flatMap((r) => r.jobs.map((j) => j.obiegId))
      .filter((id) => (assignments[id] ?? []).some((a) => a.manual)));
    const cand = obiegi.filter((o) => !pinnedIds.has(o.id) && !(assignments[o.id] ?? []).some((a) => a.manual));
    type M = { rid: string; slot: Slot };
    // POKRYCIE jest nadrzędne (100% gdy fizycznie możliwe): placements wszystkich rodzajów, sort po SCORE
    // (nie po downgrade) — preferowanie całych (większy blok, 1,0 eq) ZMNIEJSZAŁOby liczbę pokrytych, a użytkownik
    // chce maks. pokrycia. Sprawiedliwość RODZAJU (wysokokołowy=cała) naprawia osobny pass swapCutVictims PO
    // dopasowaniu, bez zmiany liczby pokrytych.
    const place = new Map<string, Slot[]>();
    for (const o of cand) {
      const slots: Slot[] = [];
      for (const kind of kindsFor(o)) {
        const { floor, hi } = coverWindow(o, kind, true);
        const src = kind === "cała" ? candidateSlots : autoSlots;
        for (const s of src(o, kind, floor, hi)) slots.push(s);
      }
      slots.sort((a, b) => score(a) - score(b));
      place.set(o.id, slots);
    }
    // model lokalny rezerwowych (piny/manual już zajmują miejsce — wliczone w startowe jobs/eq/cnt)
    const seats = new Map<string, Array<{ s: number; e: number; oid: string; kind: BreakKind }>>();
    const eqM = new Map<string, number>(), cntM = new Map<string, number>();
    for (const r of rs) {
      seats.set(r.ref.id, r.jobs.filter((j) => (assignments[j.obiegId] ?? []).some((a) => a.manual))
        .map((j) => ({ s: j.s, e: j.e, oid: j.obiegId, kind: (assignments[j.obiegId] ?? [])[0]?.kind ?? "cała" })));
      const base = seats.get(r.ref.id)!;
      eqM.set(r.ref.id, base.reduce((q, j) => q + CALA_EQ[j.kind], 0));
      cntM.set(r.ref.id, base.length);
    }
    const byStation = new Map<BreakStation, RState[]>();
    for (const r of rs) if (!r.ref.blocked && !r.ref.manualOnly) (byStation.get(r.station) ?? byStation.set(r.station, []).get(r.station)!).push(r);
    const matchOf = new Map<string, M>();
    let mnodes = 0;
    const augment = (oid: string, moving: Set<string>): boolean => {
      if (++mnodes > 200_000 || Date.now() > r16Deadline) return false;
      moving.add(oid);
      for (const slot of place.get(oid)!) {
        const e = slot.startT + slot.durationMin * 60;
        for (const r of byStation.get(slot.station) ?? []) {
          if (r.ref.availFrom != null && slot.startT < r.ref.availFrom) continue;
          if (r.ref.availTo != null && e > r.ref.availTo) continue;
          const rid = r.ref.id;
          const conflicts = seats.get(rid)!.filter((j) => slot.startT < j.e && j.s < e);
          if (conflicts.some((c) => moving.has(c.oid))) continue;
          const evEq = conflicts.reduce((q, c) => q + CALA_EQ[c.kind], 0);
          if (eqM.get(rid)! - evEq + CALA_EQ[slot.kind] > MAX_RESERVE_LOAD_EQ + 1e-6) continue;
          if (cntM.get(rid)! - conflicts.length + 1 > r.cap) continue;
          const saved = seats.get(rid)!.slice();
          const savedM = conflicts.map((c) => [c.oid, matchOf.get(c.oid)] as const);
          seats.set(rid, [...saved.filter((j) => !conflicts.includes(j)), { s: slot.startT, e, oid, kind: slot.kind }]);
          eqM.set(rid, eqM.get(rid)! - evEq + CALA_EQ[slot.kind]);
          cntM.set(rid, cntM.get(rid)! - conflicts.length + 1);
          for (const c of conflicts) matchOf.delete(c.oid);
          matchOf.set(oid, { rid, slot });
          let ok = true;
          for (const c of conflicts) if (!augment(c.oid, moving)) { ok = false; break; }
          if (ok) return true;
          // rollback
          seats.set(rid, saved);
          eqM.set(rid, saved.reduce((q, j) => q + CALA_EQ[j.kind], 0));
          cntM.set(rid, saved.length);
          matchOf.delete(oid);
          for (const [cid, m] of savedM) if (m) matchOf.set(cid, m);
        }
      }
      return false;
    };
    const ordDesc = [...cand].sort((a, b) => loopKey(b) - loopKey(a) ||
      place.get(a.id)!.length - place.get(b.id)!.length || numOf(a.id) - numOf(b.id));
    for (const o of ordDesc) augment(o.id, new Set());
    const curCovered = obiegi.filter((o) => (assignments[o.id] ?? []).some((a) => a.reserveId)).length;
    const newCovered = matchOf.size + pinnedIds.size;
    if (newCovered <= curCovered) return false;                       // nie poprawia pokrycia → zostaw greedy
    // ADOPTUJ: wyczyść auto-przydziały, odtwórz z dopasowania (piny/manual zostają)
    for (const r of rs) { r.jobs = r.jobs.filter((j) => (assignments[j.obiegId] ?? []).some((a) => a.manual)); }
    for (const r of rs) { r.loadMin = 0; r.loadEq = 0; r.count = 0;
      for (const j of r.jobs) { const a = (assignments[j.obiegId] ?? [])[0]; if (a) { r.loadMin += a.durationMin; r.loadEq += CALA_EQ[a.kind]; r.count++; } } }
    for (const o of cand) { assignments[o.id] = (assignments[o.id] ?? []).filter((a) => a.manual); }
    unassigned.length = 0;
    for (const o of cand) {
      const m = matchOf.get(o.id);
      if (m) commit(o, m.slot, rs.find((r) => r.ref.id === m.rid)!);
      else fallbackBrak(o);
    }
    return true;
  };

  // Porządkowanie planu (świeży minimalny budżet — nawrót mógł zjeść planDeadline). FAIR-BRAK, REBALANS,
  // PROMOTE i ZAMIANA OFIAR działają TAKŻE przy BRAK (nie dokładają 2. przerw — tylko pakują/przestawiają
  // rodzaje wg porządku kół; przy deficycie wysokokołowi nie mogą tkwić na 0,5/BRAK, gdy niżej-kołowy ma
  // przerwę). `scanOnly` (szybki skan lookahead) pomija CAŁĄ tę sekcję — liczy się tylko pokrycie.
  if (!opts.scanOnly) {
  r16Deadline = Math.max(planDeadline, Date.now() + 200);
  if (hasBrak()) maxCoverMatch();                 // maks. pokrycie z priorytetem kół (deficyt)
  r16Deadline = Math.max(planDeadline, Date.now() + 200); // świeży budżet na porządkowanie po dopasowaniu
  fairBrakSwap();
  rebalanceStations();
  promoteToCala();
  r16Deadline = Math.max(planDeadline, Date.now() + 200); // świeży budżet na zamianę ofiar (kind-fairness)
  swapCutVictims();
  if (!hasBrak()) {
    const byLoopsDesc = [...obiegi].sort((a, b) => loopKey(b) - loopKey(a) || numOf(a.id) - numOf(b.id));
    // PASS A — NAJPIERW WSZYSCY DO PEŁNEJ (sprawiedliwość, przywrócone 2026-06-12 po skardze „D16 pół,
    // D19 pół, a całodobowe półtora"): obieg z samą połówką (0,5 — pocięty/awaryjny) dostaje 2. POŁÓWKĘ
    // → 2×½ = pełna przerwa, ZANIM ktokolwiek dostanie 1,5. Wysokokołowi pierwsi (byLoopsDesc).
    let progA = true;
    while (progA && roomLeft() && Date.now() <= r16Deadline) {
      progA = false;
      for (const o of byLoopsDesc) {
        const cur = assignments[o.id];
        if (!cur || cur.length !== 1 || cur.some((a) => !a.reserveId)) continue;
        if (CALA_EQ[cur[0].kind] >= 1 - 1e-6) continue;                // ma już pełną — to kandydat do 1,5 (PASS B)
        if (addExtraHalf(o)) progA = true;
      }
    }
    // PASS B — dopiero teraz 1,5: obiegi z CAŁĄ dobijane 2. połówką, OD NAJWIĘCEJ KÓŁ.
    let prog2nd = true;
    while (prog2nd && roomLeft() && Date.now() <= r16Deadline) {
      prog2nd = false;
      for (const o of byLoopsDesc) {                                   // NAJWIĘCEJ KÓŁ pierwszy → 1,5
        const cur = assignments[o.id];
        if (!cur || cur.length !== 1 || cur.some((a) => !a.reserveId)) continue; // już 2 przerwy / BRAK
        if (addExtraHalf(o)) prog2nd = true;
      }
    }
    // PASS C — REDYSTRYBUCJA SPRAWIEDLIWOŚCI (2026-06-12, skarga „D16 pół, D19 pół, a całodobowe
    // półtora"): jeśli mimo PASS A jakiś obieg tkwi na samej połówce (0,5 — jego okno nie zgrało się
    // z wolną mocą A11), a ktoś inny dostał 1,5 — ZABIERZ 2. połówkę (auto) obiegowi z 1,5 (od
    // najmniej kołowych z 1,5) i spróbuj dobić nią obieg na 0,5. Nie wyszło → przywróć. NIKT nie
    // powinien siedzieć poniżej pełnej, gdy inni dostają dodatki.
    const oEq = (o: Obieg) => (assignments[o.id] ?? []).filter((a) => a.reserveId).reduce((s, a) => s + CALA_EQ[a.kind], 0);
    const stuck = () => byLoopsDesc.filter((o) => { const e = oEq(o); return e > 0 && e < 1 - 1e-6; });
    const donors15 = () => [...obiegi]
      .filter((o) => {
        const cur = assignments[o.id] ?? [];
        return oEq(o) >= 1.5 - 1e-6 && cur.length === 2 && cur.every((a) => a.reserveId) &&
               cur.some((a) => a.kind === "połówka" && !a.manual);
      })
      .sort((a, b) => loopKey(a) - loopKey(b) || numOf(a.id) - numOf(b.id)); // najmniej kołowi z 1,5 oddają pierwsi
    outer: for (const x of stuck()) {
      if (Date.now() > r16Deadline) break;
      for (const y of donors15()) {
        // próbuj KAŻDĄ auto-połówkę dawcy (wczesna z pary może zwalniać dokładnie tę moc, której
        // potrzebuje okno obiegu x — zdjęcie tylko późnej często nic nie daje)
        const halves = (assignments[y.id] ?? []).filter((a) => a.kind === "połówka" && !a.manual && a.reserveId)
          .sort((a, b) => a.startT - b.startT);
        for (const ay of halves) {
          const ry = rs.find((r) => r.ref.id === ay.reserveId)!;
          removeJob(ry, ay);
          assignments[y.id] = (assignments[y.id] ?? []).filter((a) => a !== ay);
          if (addExtraHalf(x)) continue outer;                         // x dobity do pełnej — y wraca do 1,0
          assignments[y.id] = [...(assignments[y.id] ?? []), ay];      // nie pomogło — przywróć dawcy
          ry.jobs.push({ s: ay.startT, e: ay.startT + ay.durationMin * 60, obiegId: ay.obiegId });
          ry.loadMin += ay.durationMin; ry.loadEq += CALA_EQ[ay.kind]; ry.count += 1;
        }
      }                                                                // żaden dawca nie pasuje → x zostaje 0,5 (fizyka)
    }
    swapCutVictims();  // egzekwuj porządek „tnij najmniej kół" także po dobitkach (PASS A–C mogły go zmienić)
  }
  } // koniec sekcji porządkowania/dokładek (pomijanej przy scanOnly)

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
  const XFER = (opts.xferBufferMin ?? XFER_BUFFER_MIN) * 60; // bufor przeskoku na drugi peron (konfigurowalny)

  // R20b — UWZGLĘDNIJ BUFOR W ROZPLANOWANIU (decyzja użytkownika 2026-06-11: „bufor ma być brany pod uwagę
  // przy rozplanowaniu, gdy go zmieniam"). Gdy kolejna podmiana rezerwowego wymaga przeskoku na drugi peron
  // w oknie ≤ bufor, PRZESUŃ ją na inny slot TEGO SAMEGO obiegu (ta sama stacja/rodzaj/rezerwowy), który
  // poszerza okno (ten sam peron co po oddaniu LUB przerwa > bufor) — bez zmiany obciążenia/pokrycia (wszyscy
  // nadal po tyle samo kół). Zmiana bufora zmienia plan (inne ciasne pary → inne przesunięcia). Ruszamy tylko
  // proste, jednoprzerwowe, automatyczne podmiany; pinów/ręcznych/2-przerwowych nie tykamy. Best-effort: gdy
  // nie ma wolnego slotu rozwiązującego ciasnotę, zostaje (oznaczona ⚠ niżej).
  if (XFER > 0) {
    const byRes: Record<string, BreakAssignment[]> = {};
    for (const list of Object.values(assignments))
      for (const a of list) if (a.reserveId) (byRes[a.reserveId] ??= []).push(a);
    for (const jobs of Object.values(byRes)) {
      jobs.sort((x, y) => x.startT - y.startT);
      for (let i = 1; i < jobs.length; i++) {
        const prev = jobs[i - 1], cur = jobs[i], next = jobs[i + 1];
        if (cur.station === "A1" || cur.station === "A23" || cur.manual) continue;
        const handoverDir = returnsOppositeTrack(prev.kind) ? opp(prev.dir) : prev.dir;
        const prevEnd = prev.startT + prev.durationMin * 60;
        if (!(cur.dir !== handoverDir && cur.startT - prevEnd <= XFER)) continue; // nie ciasny przeskok → zostaw
        const o = obiegi.find((x) => x.id === cur.obiegId);
        if (!o || (assignments[o.id]?.length ?? 0) !== 1) continue; // tylko jednoprzerwowe
        const others = jobs.filter((j) => j !== cur).map((j) => ({ s: j.startT, e: j.startT + j.durationMin * 60 }));
        const { floor, hi } = coverWindow(o, cur.kind);
        const cands = candidateSlots(o, cur.kind, floor, hi)
          .filter((s) => s.station === cur.station && s.startT >= prevEnd) // po oddaniu poprzedniej, w oknie obiegu
          .sort((a, b) => Math.abs(a.startT - cur.startT) - Math.abs(b.startT - cur.startT)); // najmniejsze przesunięcie
        for (const ns of cands) {
          const nS = ns.startT, nE = nS + ns.durationMin * 60;
          if (others.some((j) => nS < j.e && j.s < nE)) continue;          // kolizja z inną podmianą rezerwowego
          if (!(ns.dir === handoverDir || nS - prevEnd > XFER)) continue;  // nadal ciasny przeskok → szukaj dalej
          if (next && next.station !== "A1" && next.station !== "A23") {   // nie twórz NOWEJ ciasnoty z następną
            const hd2 = returnsOppositeTrack(ns.kind) ? opp(ns.dir) : ns.dir;
            if (next.dir !== hd2 && next.startT - nE <= XFER) continue;
          }
          cur.startT = nS; cur.dir = ns.dir; cur.durationMin = ns.durationMin; // przesuń (obciążenie bez zmian)
          break;
        }
      }
    }
  }

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
