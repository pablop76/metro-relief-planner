import type { Reserve, BreakStation } from "./types";

/** Pula przykładowych nazwisk per stacja (do testów). Kolejność = priorytet doboru.
 *  Pełna pula daje docelowy rozkład A1×3, A7×2, A11×5, A18×1, A23×1 (razem 12).
 *  Po wyczerpaniu puli generujemy syntetyczne nazwiska, więc `count` jest bez limitu. */
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
 *  Najpierw nazwiska z puli, a po jej wyczerpaniu syntetyczne („Rezerwowy N"). */
export function sampleReserves(count: number = SAMPLE_DEFAULT): Reserve[] {
  const n = Math.max(0, Math.floor(count) || 0);
  const out: Reserve[] = [];
  for (let i = 0; out.length < n; i++) {
    for (const st of STATIONS) {
      if (out.length >= n) break;
      const name = POOL[st][i] ?? `Rezerwowy ${st} ${i + 1}`;
      out.push({ id: `demo-${st.toLowerCase()}-${i + 1}`, name, station: st });
    }
  }
  return out;
}
