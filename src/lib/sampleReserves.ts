import type { Reserve, BreakStation } from "./types";

/** Pula przykładowych nazwisk per stacja (do testów). Kolejność = priorytet doboru.
 *  Pełna pula daje docelowy rozkład A1×3, A7×2, A11×5, A18×1, A23×1 (razem 12). */
const POOL: Record<BreakStation, string[]> = {
  A1: ["Nowak", "Wiśniewski", "Wójcik"],
  A7: ["Kowalczyk", "Kamiński"],
  A11: ["Lewandowski", "Zieliński", "Szymański", "Woźniak", "Dąbrowski"],
  A18: ["Kozłowski"],
  A23: ["Mazur"],
};

/** Stała kolejność doboru: round-robin po stacjach — przy małym `count` rezerwowi
 *  rozkładają się równomiernie po wszystkich stacjach, a pełne 12 daje rozkład z puli. */
const ORDER: Reserve[] = (() => {
  const stations = Object.keys(POOL) as BreakStation[];
  const out: Reserve[] = [];
  for (let i = 0; ; i++) {
    let added = false;
    for (const st of stations) {
      const name = POOL[st][i];
      if (name) {
        out.push({ id: `demo-${st.toLowerCase()}-${i + 1}`, name, station: st });
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
})();

/** Maksymalna liczba przykładowych rezerwowych (suma puli = 12). */
export const SAMPLE_MAX = ORDER.length;

/** Zwraca pierwszych `count` przykładowych rezerwowych (równomiernie po stacjach). */
export function sampleReserves(count: number = SAMPLE_MAX): Reserve[] {
  const n = Math.max(0, Math.min(Math.floor(count) || 0, SAMPLE_MAX));
  return ORDER.slice(0, n).map((r) => ({ ...r }));
}
