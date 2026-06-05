import type {
  Obieg, Reserve, BreakAssignment, PlanResult, BreakKind, Dir, BreakStation,
} from "./types";
import { MAX_RESERVE_LOAD_MIN } from "./types";
import { STATIONS, DURATION, DOWNGRADE, stationSupports } from "./stations";

const hms = (h: number, m: number) => h * 3600 + m * 60;

export const PREF_START = hms(14, 30);   // preferowany start (R2)
const EARLIEST_DEFAULT = hms(14, 30);    // przerwa NIE wcześniej niż 14:30 (R2)
const LATEST_DEFAULT = hms(18, 30);      // przerwa NIE później niż 18:30 (R2)

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

/** Wybór rezerwowego do slotu: TYLKO z tej samej stacji co slot (rezerwowy podmienia tam, gdzie stoi),
 *  wolny czasowo, w limicie 4,5h (R13) i limicie własnym (maxJobs), nie zablokowany, najmniej obciążony. */
function pickReserve(rs: RState[], slot: Slot): RState | null {
  const startSec = slot.startT;
  const eligible = rs.filter(
    (r) =>
      !r.ref.blocked &&
      r.station === slot.station && // brak „pożyczania" z innej stacji
      r.busyUntil <= startSec &&
      r.loadMin + slot.durationMin <= MAX_RESERVE_LOAD_MIN &&
      (r.ref.maxJobs == null || r.count < r.ref.maxJobs)
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
  const latest = opts.latest ?? LATEST_DEFAULT;
  const pref = opts.pref ?? PREF_START;
  const score = (s: Slot) => Math.abs(s.startT - pref);

  // Kolejność przetwarzania: NAJPIERW szczyty (S) — są najbardziej ograniczone (połówka tylko na A11
  // i krótkie okno), więc muszą złapać swoje połówki, zanim obiegi D/całodobowe zajmą A11.
  // Potem całodobowe (1..13) i D — łapią całe na krańcówkach/A7/A18 (R10), tych S nie blokują.
  const typeRank = (o: Obieg) => (o.type === "S" ? 0 : o.type === "full" ? 1 : 2);
  const numOf = (id: string) => parseInt(id.replace(/\D/g, ""), 10) || 0;
  const order = [...obiegi].sort(
    (a, b) => typeRank(a) - typeRank(b) || numOf(a.id) - numOf(b.id)
  );

  const rs: RState[] = reserves.map((r) => ({
    ref: r, loadMin: 0, count: 0, busyUntil: 0, station: r.station,
  }));

  const assignments: Record<string, BreakAssignment> = {};
  const unassigned: string[] = [];
  const handled = new Set<string>(); // obiegi obsłużone pinem

  // 0. PINY — wymuś wskazanego rezerwowego na konkretnym obiegu (na jego stacji).
  for (const r of rs) {
    const pinId = r.ref.pin;
    if (!pinId || r.ref.blocked) continue;
    const o = obiegi.find((x) => x.id === pinId);
    if (!o) continue;
    const kinds = DOWNGRADE.slice(DOWNGRADE.indexOf(desiredKind(o)));
    let done = false;
    for (const kind of kinds) {
      const slots = candidateSlots(o, kind, earliest, latest)
        .filter((s) => s.station === r.station) // pin tylko gdy obieg jest na stacji rezerwowego
        .sort((a, b) => score(a) - score(b));
      for (const slot of slots) {
        if (
          r.busyUntil <= slot.startT &&
          r.loadMin + slot.durationMin <= MAX_RESERVE_LOAD_MIN &&
          (r.ref.maxJobs == null || r.count < r.ref.maxJobs)
        ) {
          r.busyUntil = slot.startT + slot.durationMin * 60;
          r.loadMin += slot.durationMin;
          r.count += 1;
          assignments[o.id] = {
            obiegId: o.id, station: slot.station, dir: slot.dir, startT: slot.startT,
            kind: slot.kind, durationMin: slot.durationMin, reserveId: r.ref.id, manual: true,
          };
          handled.add(o.id);
          done = true;
          break;
        }
      }
      if (done) break;
    }
  }

  for (const o of order) {
    if (handled.has(o.id)) continue;
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
