import type {
  Obieg, Reserve, BreakAssignment, PlanResult, BreakKind, Dir, BreakStation,
} from "./types";
import { MAX_RESERVE_LOAD_MIN } from "./types";
import { STATIONS, DURATION, DOWNGRADE, stationSupports } from "./stations";

const hms = (h: number, m: number) => h * 3600 + m * 60;

export const PREF_START = hms(14, 30);   // preferowany start (R2)
const EARLIEST_DEFAULT = hms(14, 0);     // 2. zmiana / start liczenia 6h (R3)
const LATEST_DEFAULT = hms(20, 0);       // 14:00 + 6h (R3)

export interface PlanOptions {
  earliest?: number;
  latest?: number;
  pref?: number;
  /** czy Centrum A13 dostępne (R8) — na razie bez slotów (brak kolumny w xlsx) */
  centrumEnabled?: boolean;
}

/** Wjazd na linię po południu: pierwsze zdarzenie po przerwie >60 min (po 12:00), inaczej pierwsze. */
export function afternoonEntryT(o: Obieg): number {
  const e = o.events;
  for (let i = 1; i < e.length; i++) {
    if (e[i].t - e[i - 1].t > 3600 && e[i].t >= 12 * 3600) return e[i].t;
  }
  return e.length ? e[0].t : 0;
}

/** Pożądany rodzaj przerwy wg typu obiegu (R10/R11). */
function desiredKind(o: Obieg): BreakKind {
  return o.type === "S" ? "połówka" : "cała"; // S → połówka; całodobowe + D → cała
}

interface Slot {
  station: BreakStation;
  dir: Dir;
  startT: number;
  kind: BreakKind;
  durationMin: number;
}

/** Sloty kandydujące dla obiegu i rodzaju przerwy. */
function candidateSlots(o: Obieg, kind: BreakKind, earliest: number, latest: number): Slot[] {
  const durSec = DURATION[kind] * 60;
  const minStart = Math.max(earliest, afternoonEntryT(o));
  const out: Slot[] = [];
  for (const ev of o.events) {
    if (ev.t < minStart || ev.t > latest) continue;
    if (!stationSupports(ev.station, kind, ev.dir)) continue;
    if (ev.t + durSec > o.lastT) continue; // R7: pociąg musi wrócić przed zjazdem
    out.push({ station: ev.station, dir: ev.dir, startT: ev.t, kind, durationMin: DURATION[kind] });
  }
  return out;
}

/** Wszystkie dopuszczalne sloty obiegu (wszystkie rodzaje) — do ręcznej edycji w UI. */
export function feasibleSlots(o: Obieg, opts: PlanOptions = {}): Slot[] {
  const earliest = opts.earliest ?? EARLIEST_DEFAULT;
  const latest = opts.latest ?? LATEST_DEFAULT;
  const all: Slot[] = [];
  for (const kind of DOWNGRADE) all.push(...candidateSlots(o, kind, earliest, latest));
  return all.sort((a, b) => a.startT - b.startT || b.durationMin - a.durationMin);
}

export type { Slot };

interface RState {
  ref: Reserve;
  loadMin: number;
  count: number;
  busyUntil: number;
  station: BreakStation;
}

/** Wybór rezerwowego do slotu: wolny czasowo, w limicie 4,5h (R13), najmniej obciążony. */
function pickReserve(rs: RState[], slot: Slot): RState | null {
  const startSec = slot.startT;
  const eligible = rs.filter(
    (r) => r.busyUntil <= startSec && r.loadMin + slot.durationMin <= MAX_RESERVE_LOAD_MIN
  );
  if (eligible.length === 0) return null;
  // najpierw rezerwowi już stojący na stacji slotu; gdy brak — „pożyczamy" z innej stacji
  const local = eligible.filter((r) => r.station === slot.station);
  const pool = local.length ? local : eligible;
  pool.sort((a, b) => a.loadMin - b.loadMin || a.count - b.count);
  return pool[0];
}

/** Główny algorytm planowania przerw. */
export function planBreaks(obiegi: Obieg[], reserves: Reserve[], opts: PlanOptions = {}): PlanResult {
  const earliest = opts.earliest ?? EARLIEST_DEFAULT;
  const latest = opts.latest ?? LATEST_DEFAULT;
  const pref = opts.pref ?? PREF_START;
  const score = (s: Slot) => Math.abs(s.startT - pref);

  // kolejność przetwarzania: zacznij od obiegu 1 → całodobowe (1..13) rosnąco, potem D, potem S.
  // Całodobowe jeżdżą najdłużej, więc jako pierwsze łapią całe przerwy blisko 14:30 (R10).
  const typeRank = (o: Obieg) => (o.type === "full" ? 0 : o.type === "D" ? 1 : 2);
  const numOf = (id: string) => parseInt(id.replace(/\D/g, ""), 10) || 0;
  const order = [...obiegi].sort(
    (a, b) => typeRank(a) - typeRank(b) || numOf(a.id) - numOf(b.id)
  );

  const rs: RState[] = reserves.map((r) => ({
    ref: r, loadMin: 0, count: 0, busyUntil: 0, station: r.station,
  }));

  const assignments: Record<string, BreakAssignment> = {};
  const unassigned: string[] = [];

  for (const o of order) {
    const desired = desiredKind(o);
    const kinds = DOWNGRADE.slice(DOWNGRADE.indexOf(desired)); // od pożądanego w dół
    let placed = false;
    let fallback: Slot | null = null;

    for (const kind of kinds) {
      const slots = candidateSlots(o, kind, earliest, latest).sort((a, b) => score(a) - score(b));
      if (slots.length && !fallback) fallback = slots[0];
      for (const slot of slots) {
        const r = pickReserve(rs, slot);
        if (!r) continue;
        // przydziel
        r.busyUntil = slot.startT + slot.durationMin * 60;
        r.loadMin += slot.durationMin;
        r.count += 1;
        r.station = slot.station; // po pętli wraca na tę stację
        assignments[o.id] = {
          obiegId: o.id, station: slot.station, dir: slot.dir, startT: slot.startT,
          kind: slot.kind, durationMin: slot.durationMin, reserveId: r.ref.id,
        };
        placed = true;
        break;
      }
      if (placed) break;
    }

    if (!placed) {
      // brak wolnego rezerwowego — pokaż zamierzoną przerwę bez obsady
      if (fallback) {
        assignments[o.id] = {
          obiegId: o.id, station: fallback.station, dir: fallback.dir, startT: fallback.startT,
          kind: fallback.kind, durationMin: fallback.durationMin, reserveId: null,
        };
      }
      unassigned.push(o.id);
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
