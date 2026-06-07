import type { BreakKind, BreakStation, Dir } from "./types";

/** Długości przerw w minutach (ZASADY.md §3). Realny czas liczy silnik z rozkładu — to wartości nominalne. */
export const DURATION: Record<BreakKind, number> = {
  "cała": 90,
  "godzinka": 60,
  "połówka": 45,
  "szczeniak": 30,
};

/** Kolejność skracania przerwy gdy brakuje rezerwowych (od najdłuższej do najkrótszej). */
export const DOWNGRADE: BreakKind[] = ["cała", "godzinka", "połówka", "szczeniak"];

export interface StationBreakOption {
  kind: BreakKind;
  /** dozwolone kierunki podmiany; "any" = krańcówka, dowolny kierunek */
  dirs: Dir[] | "any";
}

export interface StationCfg {
  code: BreakStation;
  name: string;
  terminus: boolean;
  options: StationBreakOption[];
}

/** Konfiguracja stacji przerwowych (mirror data/stations.json, ZASADY.md §3, R12). */
export const STATIONS: Record<BreakStation, StationCfg> = {
  A1: {
    code: "A1", name: "Kabaty", terminus: true,
    options: [{ kind: "cała", dirs: "any" }],
  },
  A7: {
    code: "A7", name: "Wilanowska", terminus: false,
    options: [
      { kind: "cała", dirs: ["Kabaty", "Młociny"] },
      { kind: "godzinka", dirs: ["Młociny"] }, // ~1h: jazda do Młocin (A23) i powrót na A7
      { kind: "szczeniak", dirs: ["Kabaty"] }, // szczeniak na A7 w stronę Kabat
    ],
  },
  A11: {
    code: "A11", name: "Politechnika", terminus: false,
    options: [
      { kind: "cała", dirs: ["Kabaty", "Młociny"] },     // na A11 można też robić całe
      { kind: "połówka", dirs: ["Kabaty", "Młociny"] },
    ],
  },
  A18: {
    code: "A18", name: "Plac Wilsona", terminus: false,
    options: [
      { kind: "cała", dirs: ["Kabaty", "Młociny"] },
      { kind: "godzinka", dirs: ["Kabaty"] }, // ~1h: jazda do Kabat (A1) i powrót na A18
      { kind: "szczeniak", dirs: ["Młociny"] }, // szczeniak na A18 w stronę Młocin
    ],
  },
  A23: {
    code: "A23", name: "Młociny", terminus: true,
    options: [{ kind: "cała", dirs: "any" }],
  },
};

/** Czy stacja obsługuje dany rodzaj przerwy w danym kierunku? */
export function stationSupports(station: BreakStation, kind: BreakKind, dir: Dir): boolean {
  const cfg = STATIONS[station];
  return cfg.options.some(
    (o) => o.kind === kind && (o.dirs === "any" || o.dirs.includes(dir))
  );
}
