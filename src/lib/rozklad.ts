import * as XLSX from "xlsx";
import type { Obieg, ObiegType, StationEvent, Dir, BreakStation } from "./types";

/** Mapowanie kolumn arkusza (0-indeks) — ustalone na podstawie RJ_M1. */
const COL = {
  typ: 2,
  obieg: 4,
  // kierunek północ A1->A23 (w stronę Młocin); A23 = PRZYJAZD na kraniec północny (kol 12)
  n_A1: 5, n_A7: 8, n_A11: 9, n_A18: 11, n_A23: 12,
  // kierunek południe A23->A1 (w stronę Kabat); A23 = ODJAZD z krańca północnego na południe (kol 14 = „odjazd")
  // — bez tego pierwszym złapanym zdarzeniem po postoju na Młocinach było A18, nie A23 (np. start 2. zm. S33).
  s_A23: 14, s_A18: 16, s_A11: 18, s_A7: 19, s_A1: 20,
};

const VALID_OBIEG = /^(\d{1,2}|S\d+|D\d+)$/;

/** "05:20:30" lub "14:08" -> sekundy od północy; inne -> null */
function parseTime(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = +m[1], min = +m[2], s = m[3] ? +m[3] : 0;
  if (h > 47 || min > 59) return null;
  return h * 3600 + min * 60 + s;
}

function classify(id: string): ObiegType {
  if (id.startsWith("S")) return "S";
  if (id.startsWith("D")) return "D";
  return "full";
}

const SHIFT2_END = 22 * 3600;           // górna granica okna 2. zmiany
const SHIFT2_DEFAULT_START = 14 * 3600; // domyślny start maszynisty 2. zmiany (gdy brak w grafiku)
// Zjazd po tej godzinie = zmiennik na linii / 3. zmiana / całodobowy → maszynista NIE dowozi na zjazd
// sam, pracuje pełną zmianę → zawsze cała (priorytet). Próg = deklarowana zmiana na linii ~21:00.
const RELIEF_ON_LINE = 21 * 3600;
// REALNE przejęcie przez 3. zmianę (decyzja użytkownika 2026-06-13): całodobowych podmienia maszynista
// 3. zmiany TROCHĘ wcześniej niż z planu — ~20:45. Dlatego ich koła liczymy DO 20:45 (nie ∞), przez co
// wychodzi ~4,5 i są MNIEJ obciążeni niż D17–D20 (5,0). Nadal zawsze cała (flaga `throughShift` = priorytet).
// To także ICH REALNY KONIEC PRACY (do tail R3 „max 6h15 bez przerwy" — lastT to koniec doby, nie zjazd).
export const THIRD_SHIFT_RELIEF = 20 * 3600 + 45 * 60;

// Start maszynisty 2. zmiany wg grafiku (drużyna=obieg) — TYLKO dla obiegów jadących ciągiem
// (bez postoju w dzień), bo rozkład sam nie mówi, kiedy maszynista wsiada. Źródło: DRUZYNY-GODZINY.md.
// UWAGA: zależne od grafiku miesiąca — zweryfikuj przy zmianie rozkładu.
const SHIFT2_DRIVER_START: Record<string, number> = {
  D17: 13 * 3600, D18: 13 * 3600, D19: 13 * 3600, D20: 13 * 3600, // 13:00
  D22: 13 * 3600 + 30 * 60,                                       // 13:30 — zjeżdża sam (liczony)
};

/** Wjazd na linię na 2. zmianę: pierwsze zdarzenie po przerwie >60 min (po 12:00);
 *  jeśli obieg startuje dopiero po południu (D) — pierwsze zdarzenie; całodobowy bez przerwy → null. */
function afternoonEntry(ev: StationEvent[]): StationEvent | null {
  for (let i = 1; i < ev.length; i++) {
    if (ev[i].t - ev[i - 1].t > 3600 && ev[i].t >= 12 * 3600) return ev[i];
  }
  if (ev.length && ev[0].t >= 12 * 3600) return ev[0];
  return null;
}

// Pełny ruch popołudniowy zaczyna się ~15:00 — wtedy wszystkie pociągi są na linii. Koło w SZCZYCIE (16–18)
// jest ustalone (~84'), ale koła BRZEGOWE — rozruchowe (rano 88–94'), przejście ~14:30 i wieczorne (~19:xx,
// gdy ruch rzednie) — bywają wydłużone (86–88'). Mediana z całej doby (a nawet z całego okna PM) potrafi
// utknąć na takiej brzegowej wartości, przez co bliźniacze obiegi jadące jeden za drugim (D17–D20) wychodziły
// 84/86/88/85', mimo identycznego koła w szczycie. Dlatego bierzemy WARTOŚĆ DOMINUJĄCĄ (modalną) koła z pełnego
// ruchu popołudniowego — to faktyczne, najczęstsze koło, odporne na rzadsze koła rozruchowe/wieczorne
// (decyzja użytkownika 2026-06-09). [[project_metro_grafik]]
const FULL_SERVICE_FROM = 15 * 3600;

/** Najczęstsza (modalna) wartość — w minutach; remis rozstrzyga MNIEJSZA (szczyt = ciaśniejszy cykl). */
function modeMin(secs: number[]): number | null {
  if (!secs.length) return null;
  const cnt = new Map<number, number>();
  for (const s of secs) { const m = Math.round(s / 60); cnt.set(m, (cnt.get(m) ?? 0) + 1); }
  let best = Infinity, bestN = -1;
  for (const [v, n] of cnt) if (n > bestN || (n === bestN && v < best)) { best = v; bestN = n; }
  return best;
}

/** Czas jednego koła obiegu = DOMINUJĄCE koło (odstęp między kolejnymi odjazdami A1→Młociny) w PEŁNYM RUCHU
 *  popołudniowym (późniejszy odjazd ≥ 15:00; pomija postoje/przerwy >3h). Fallback: dominanta całodobowa,
 *  a gdy brak danych — 84 min. */
function lapDuration(ev: StationEvent[]): number {
  const a1n = ev.filter((e) => e.station === "A1" && e.dir === "Młociny").map((e) => e.t).sort((a, b) => a - b);
  const all: number[] = [];
  const pm: number[] = [];
  for (let i = 1; i < a1n.length; i++) {
    const g = a1n[i] - a1n[i - 1];
    if (g >= 3 * 3600) continue;                  // postój/przerwa — nie koło
    all.push(g);
    if (a1n[i] >= FULL_SERVICE_FROM) pm.push(g);  // koło w pełnym ruchu popołudniowym
  }
  const m = modeMin(pm) ?? modeMin(all) ?? 84;    // dominanta PM → dominanta całodobowa → 84'
  return m * 60;
}

/** Realny start maszynisty 2. zmiany: wjazd z rozkładu (postój w dzień) lub start z grafiku
 *  (obieg ciągły: SHIFT2_DRIVER_START), w ostateczności 14:00. Podstawa R3 (max 6h ciągłej pracy). */
function shift2Start(id: string, ev: StationEvent[]): number {
  const ae = afternoonEntry(ev);
  return ae ? ae.t : (SHIFT2_DRIVER_START[id] ?? SHIFT2_DEFAULT_START);
}

/** Koła 2. zmiany = PRZEJECHANY ODCINEK LINII w jednostkach pełnej pętli. Każda PÓŁPĘTLA kraniec↔kraniec
 *  (A1 Kabaty ↔ A23 Młociny) = 0,5 koła; liczymy je scalając przyjazd+odjazd na tym samym krańcu w jedną
 *  wizytę (zawrót), więc postój na krańcu NIE zawyża wyniku. Obiegi startujące/kończące NIE na krańcu dostają
 *  PROPORCJONALNY ułamek za odcinek dojazdu/zjazdu (czas odcinka / czas_koła) — „dolicz te odcinki" (decyzja
 *  użytkownika 2026-06-09). Przykłady: S33 rusza z Młocin (A23), kończy na Kabatach (A1) → 9 półpętli = 4,5;
 *  D17 rusza i kończy na A1 → 10 półpętli = 5,0; S28 rusza z A7 → +0,3 za odcinek A7→kraniec.
 *  (Dawna metryka czas/koło dawała 5,07–5,21 dla bliźniaczych D17–D20, bo zliczała postoje/przesunięcie w
 *  sekwencji, choć przejeżdżają tyle samo.) Całodobowy (jazda po 21:00) → koła liczone DO 20:45 (~4,5), nie ∞. */
function countLoops2nd(id: string, ev: StationEvent[], lapSec: number): number {
  const lastT = ev[ev.length - 1].t;
  // CAŁODOBOWY (zjazd ≥ 21:00): 3. zmiana przejmuje go ~20:45, więc koła liczymy DO 20:45 (decyzja
  // użytkownika 2026-06-13) — wychodzi ~4,5, MNIEJ niż D17–D20 (5,0). Flaga `throughShift` (zawsze cała,
  // priorytet) ustawiana osobno w parseObiegi; tu zwracamy realną, SKOŃCZONĄ liczbę kół do rankingu.
  // PRZEJĘCIE NA LINII vs START PO POSTOJU: obieg CIĄGŁY (brak postoju >60 min → afternoonEntry == null, np.
  // D17–D20) ma 2. zmianę PRZEJMOWANĄ od 1. zmiany na linii — punkt przejęcia jest przypadkowy (D20 łapie się
  // na A7), więc NIE doliczamy ułamka dojazdu/zjazdu: liczą się PEŁNE półpętle i bliźniacze obiegi wychodzą
  // równo (D17–D20 = 5,0). Obieg z POSTOJEM (afternoonEntry ≠ null, np. S33 z Młocin, S28 z A7, S23 z A11) ma
  // ŚWIEŻY start ze stacji re-wjazdu → ułamek za odcinek doliczamy („dolicz te odcinki"; decyzja 2026-06-09).
  const reliefOnLine = afternoonEntry(ev) == null;
  const cap = lastT >= RELIEF_ON_LINE ? THIRD_SHIFT_RELIEF : SHIFT2_END; // całodobowy → 20:45; reszta → 22:00
  return countLoopsWindow(ev, lapSec, shift2Start(id, ev), Math.min(lastT, cap), reliefOnLine);
}

/** Koła w ZADANYM oknie pracy [start, zjazd] — wspólny rdzeń countLoops2nd i applyWorkHours
 *  (półpętle kraniec↔kraniec = 0,5; ułamki za odcinki brzegowe tylko przy świeżym starcie). */
function countLoopsWindow(ev: StationEvent[], lapSec: number, start: number, zjazd: number, reliefOnLine: boolean): number {
  const seg = ev.filter((e) => e.t >= start - 60 && e.t <= zjazd);
  if (seg.length < 2) return 0;
  const isTerm = (s: BreakStation) => s === "A1" || s === "A23";
  // wizyty na krańcach (scalone): nowa wizyta tylko gdy zmienia się kraniec — A1↔A23↔A1…
  const visits: number[] = [];
  let prevTerm: BreakStation | null = null;
  for (const e of seg) {
    if (!isTerm(e.station)) continue;
    if (e.station !== prevTerm) { visits.push(e.t); prevTerm = e.station; }
  }
  if (visits.length < 2) return (zjazd - start) / lapSec; // brak dwóch krańców → fallback czasowy
  const full = 0.5 * (visits.length - 1);                 // każda półpętla kraniec↔kraniec = 0,5
  // ułamki za odcinki start/koniec poza krańcem — TYLKO przy starcie po postoju (przy przejęciu na linii = 0)
  const lead = reliefOnLine ? 0 : (visits[0] - seg[0].t) / lapSec;
  const tail = reliefOnLine ? 0 : (seg[seg.length - 1].t - visits[visits.length - 1]) / lapSec;
  return full + lead + tail;
}

/** RĘCZNE godziny pracy maszynisty 2. zmiany (od–do) per obieg — decyzja użytkownika 2026-06-12.
 *  Zwraca KOPIĘ obiegu z PRZELICZONYMI z rozkładu: kołami (w oknie [od, do]), `entry2nd` (= od) i
 *  `throughShift` (do ≥ 21:00 = zmiennik na linii → całozmianowy, ZAWSZE cała), oraz `workEnd` (= do; silnik
 *  nie planuje przerwy, z której pociąg wraca po tej godzinie). Brak obu godzin → obieg bez zmian.
 *  Całozmianowy ma koła liczone do 20:45 (THIRD_SHIFT_RELIEF) — jak auto (korekta 2026-06-13), nie ∞. */
export function applyWorkHours(o: Obieg, from?: number, to?: number): Obieg {
  if (from == null && to == null) return o;
  const start = from ?? o.entry2nd;
  const endRaw = to ?? o.lastT;
  const through = endRaw >= RELIEF_ON_LINE;
  // ułamki brzegowe jak w auto: obieg ciągły (przejęcie na linii) bez ułamków, start po postoju — z ułamkami
  const reliefOnLine = afternoonEntry(o.events) == null;
  const cap = through ? THIRD_SHIFT_RELIEF : SHIFT2_END; // całozmianowy → 20:45 (~4,5 koła), nie ∞
  const loops = countLoopsWindow(o.events, o.lapMin * 60, start, Math.min(endRaw, cap), reliefOnLine);
  return { ...o, entry2nd: start, throughShift: through, loops, workEnd: to };
}

/** Parsuje workbook SheetJS -> lista obiegów dla danego arkusza (typ dnia). */
export function parseObiegi(wb: XLSX.WorkBook, sheetName: string): Obieg[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Brak arkusza: ${sheetName}`);
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });

  const byId = new Map<string, StationEvent[]>();
  const firstRow = new Map<string, number>();
  const cleaningSet = new Set<string>(); // obiegi ze sprzątaniem (z UWAGI rozkładu)

  // pary [kolumna, stacja, kierunek]
  const northCols: [number, BreakStation][] = [
    [COL.n_A1, "A1"], [COL.n_A7, "A7"], [COL.n_A11, "A11"], [COL.n_A18, "A18"], [COL.n_A23, "A23"],
  ];
  const southCols: [number, BreakStation][] = [
    [COL.s_A23, "A23"], [COL.s_A18, "A18"], [COL.s_A11, "A11"], [COL.s_A7, "A7"], [COL.s_A1, "A1"],
  ];

  for (let i = 5; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const id = (r[COL.obieg] ?? "").toString().trim();
    if (!VALID_OBIEG.test(id)) continue;
    if (!firstRow.has(id)) firstRow.set(id, i);
    // sprzątanie/odstawienie — wykryte z UWAGI w wierszu obiegu
    if (/sprz/i.test(r.join(" "))) cleaningSet.add(id);

    const ev = byId.get(id) ?? [];
    const pushDir = (cols: [number, BreakStation][], dir: Dir) => {
      for (const [c, station] of cols) {
        let t = parseTime(r[c]);
        if (t == null) continue;
        // ruch metra ~04:00–24:00+; kursy po północy zawijają się do 00:xx → dodaj dobę
        if (t < 3 * 3600) t += 24 * 3600;
        ev.push({ t, station, dir });
      }
    };
    pushDir(northCols, "Młociny");
    pushDir(southCols, "Kabaty");
    byId.set(id, ev);
  }

  const obiegi: Obieg[] = [];
  for (const [id, ev] of byId) {
    ev.sort((a, b) => a.t - b.t);
    if (ev.length === 0) continue;
    const lapSec = lapDuration(ev); // mediana czasu jednego koła tego obiegu
    obiegi.push({
      id,
      type: classify(id),
      events: ev,
      firstT: ev[0].t,
      lastT: ev[ev.length - 1].t,
      firstRow: firstRow.get(id) ?? 0,
      a1North: 0,
      seqOrder: 0,
      // sprzątanie dotyczy planu tylko dla S/D (7,13 = całodobowe sprzątane PO przerwach)
      cleaning: cleaningSet.has(id) && classify(id) !== "full",
      // koło = okrążenie 2. zmiany (wjazd→zjazd) — decyduje o połówce/całej (najmniej kół → połówka)
      loops: countLoops2nd(id, ev, lapSec),
      lapMin: Math.round(lapSec / 60), // czas koła (mediana) w minutach — do wglądu
      throughShift: ev[ev.length - 1].t >= RELIEF_ON_LINE, // zmiennik na linii / całodobowy → cała
      entry2nd: shift2Start(id, ev), // realny start 2. zmiany — R3 (max 6h)
    });
  }

  // Kolejność „wszystkie na linii": sort wg odjazdu z A1 (północ) w pierwszej pętli,
  // w której KAŻDY obieg ma odjazd z A1 (u nas ~15:14). Robust: testujemy kolejne odjazdy obiegu „1".
  const a1NorthAfter = (o: Obieg, after: number): number | null =>
    o.events.find((e) => e.station === "A1" && e.dir === "Młociny" && e.t >= after)?.t ?? null;
  const LAP = 95 * 60;
  const one = obiegi.find((o) => o.id === "1");
  let T0 = 0;
  if (one) {
    const cand = one.events
      .filter((e) => e.station === "A1" && e.dir === "Młociny")
      .map((e) => e.t)
      .sort((a, b) => a - b);
    for (const T of cand) {
      if (obiegi.every((o) => { const t = a1NorthAfter(o, T); return t != null && t <= T + LAP; })) {
        T0 = T;
        break;
      }
    }
    if (!T0 && cand.length) T0 = cand[Math.min(1, cand.length - 1)];
  }
  for (const o of obiegi) o.a1North = a1NorthAfter(o, T0) ?? Number.MAX_SAFE_INTEGER;
  obiegi.sort((a, b) => a.a1North - b.a1North || a.firstRow - b.firstRow);
  obiegi.forEach((o, i) => (o.seqOrder = i));
  return obiegi;
}

export function readWorkbook(buf: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(new Uint8Array(buf), { type: "array", cellDates: false });
}
