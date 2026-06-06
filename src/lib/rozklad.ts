import * as XLSX from "xlsx";
import type { Obieg, ObiegType, StationEvent, Dir, BreakStation } from "./types";

/** Mapowanie kolumn arkusza (0-indeks) — ustalone na podstawie RJ_M1. */
const COL = {
  typ: 2,
  obieg: 4,
  // kierunek północ A1->A23 (w stronę Młocin)
  n_A1: 5, n_A7: 8, n_A11: 9, n_A18: 11, n_A23: 12,
  // kierunek południe A23->A1 (w stronę Kabat)
  s_A18: 16, s_A11: 18, s_A7: 19, s_A1: 20,
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
    [COL.s_A18, "A18"], [COL.s_A11, "A11"], [COL.s_A7, "A7"], [COL.s_A1, "A1"],
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
      // koło = odjazd z A1 na północ (start okrążenia)
      loops: ev.filter((e) => e.station === "A1" && e.dir === "Młociny").length,
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
