import type { Reserve } from "./types";

/** Przykładowi rezerwowi do testów planu.
 *  Rozkład wg stacji: A1 (Kabaty) ×3, A7 (Wilanowska) ×2, A11 (Politechnika) ×5,
 *  A18 (Plac Wilsona) ×1, A23 (Młociny) ×1 — razem 12.
 *  Wczytywane ręcznie przyciskiem w panelu rezerwowych; stałe id (`demo-…`) chronią
 *  przed dublowaniem przy ponownym wczytaniu. Nie wpływają na realne dane. */
export const SAMPLE_RESERVES: Reserve[] = [
  // A1 — Kabaty (krańcówka)
  { id: "demo-a1-1", name: "Nowak", station: "A1" },
  { id: "demo-a1-2", name: "Wiśniewski", station: "A1" },
  { id: "demo-a1-3", name: "Wójcik", station: "A1" },
  // A7 — Wilanowska
  { id: "demo-a7-1", name: "Kowalczyk", station: "A7" },
  { id: "demo-a7-2", name: "Kamiński", station: "A7" },
  // A11 — Politechnika
  { id: "demo-a11-1", name: "Lewandowski", station: "A11" },
  { id: "demo-a11-2", name: "Zieliński", station: "A11" },
  { id: "demo-a11-3", name: "Szymański", station: "A11" },
  { id: "demo-a11-4", name: "Woźniak", station: "A11" },
  { id: "demo-a11-5", name: "Dąbrowski", station: "A11" },
  // A18 — Plac Wilsona
  { id: "demo-a18-1", name: "Kozłowski", station: "A18" },
  // A23 — Młociny (krańcówka)
  { id: "demo-a23-1", name: "Mazur", station: "A23" },
];
