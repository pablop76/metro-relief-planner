import type { Reserve, BreakStation, Driver } from "./types";
import { driverFullName } from "./types";

/** Pula zapasowych nazwisk per stacja (gdy brakuje realnych maszynistów). Kolejność = priorytet.
 *  Pełna pula daje rozkład A1×3, A7×2, A11×5, A18×1, A23×1 (razem 12). */
const POOL: Record<BreakStation, string[]> = {
  A1: ["Nowak", "Wiśniewski", "Wójcik"],
  A7: ["Kowalczyk", "Kamiński"],
  A11: ["Lewandowski", "Zieliński", "Szymański", "Woźniak", "Dąbrowski"],
  A18: ["Kozłowski"],
  A23: ["Mazur"],
};

const STATIONS = Object.keys(POOL) as BreakStation[];

/** Domyślna liczba przykładowych rezerwowych (pełna pula = 12). */
export const SAMPLE_DEFAULT = STATIONS.reduce((n, st) => n + POOL[st].length, 0);

/** Zwraca `count` przykładowych rezerwowych — round-robin po stacjach, bez górnego limitu.
 *  Nazwiska bierze z przekazanej listy realnych maszynistów (kolejno), a gdy ich
 *  zabraknie — z puli zapasowej, a na końcu syntetyczne („Rezerwowy <stacja> N"). */
export function sampleReserves(count: number = SAMPLE_DEFAULT, drivers: Driver[] = []): Reserve[] {
  const n = Math.max(0, Math.floor(count) || 0);
  const out: Reserve[] = [];
  let d = 0; // wskaźnik na kolejnego realnego maszynistę
  for (let i = 0; out.length < n; i++) {
    for (const st of STATIONS) {
      if (out.length >= n) break;
      const id = `demo-${st.toLowerCase()}-${i + 1}`;
      const driver = drivers[d];
      if (driver) {
        d++;
        out.push({ id, name: driverFullName(driver), station: st, driverId: driver.id });
      } else {
        const name = POOL[st][i] ?? `Rezerwowy ${st} ${i + 1}`;
        out.push({ id, name, station: st });
      }
    }
  }
  return out;
}
