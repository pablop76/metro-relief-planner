// Model danych dla planowania przerw M1

/** Kierunek jazdy pociągu. Północ = w stronę Młocin (A23), Południe = w stronę Kabat (A1). */
export type Dir = "Kabaty" | "Młociny";

/** Rodzaje przerw wg ZASADY.md */
export type BreakKind = "cała" | "połówka" | "szczeniak";

/** Typ obiegu wg oznaczenia w rozkładzie. */
export type ObiegType = "full" | "S" | "D";

/** Linie metra — rezerwowy może być z M1 lub M2 (mamy dwie linie). */
export type MetroLine = "M1" | "M2";

/** Typy taboru do autoryzacji maszynisty. */
export type TrainType = "81" | "Inspiro" | "Škoda" | "Metropolis";
export const TRAIN_TYPES: TrainType[] = ["81", "Inspiro", "Škoda", "Metropolis"];

/** Stacje przerwowe (mają rezerwowych). */
export const BREAK_STATIONS = ["A1", "A7", "A11", "A18", "A23"] as const;
export type BreakStation = (typeof BREAK_STATIONS)[number];

/** Pojedyncze minięcie stacji przerwowej przez pociąg. */
export interface StationEvent {
  /** sekundy od północy */
  t: number;
  station: BreakStation;
  dir: Dir;
}

/** Znormalizowany obieg z osi czasu zdarzeń na stacjach przerwowych. */
export interface Obieg {
  id: string;
  type: ObiegType;
  /** wszystkie minięcia stacji przerwowych w ciągu doby, posortowane po czasie */
  events: StationEvent[];
  /** pierwsze i ostatnie zdarzenie (sekundy od północy) */
  firstT: number;
  lastT: number;
  /** indeks pierwszego wiersza w xlsx — do kolejności wg rozkładu */
  firstRow: number;
  /** pozycja w kolejności (sort wg odjazdu z A1 w pętli „wszystkie na linii") */
  seqOrder: number;
  /** godzina odjazdu z A1 na północ w pętli odniesienia (podstawa kolejności); MAX gdy brak */
  a1North: number;
  /** pociąg idzie na sprzątanie/odstawienie (nie zjazd na STP) — wykryte z UWAGI rozkładu */
  cleaning: boolean;
  /** liczba kół (okrążeń) w ciągu dnia — mało kół = szczyt, kandydat na połówkę */
  loops: number;
}

/** Maszynista (stała lista wszystkich) — z pliku maszynisci.json, edytowalny. */
export interface Driver {
  id: string;
  imie: string;
  nazwisko: string;
  /** numer prawa kierowania pojazdem metra */
  nrPrawa: string;
  telefon: string;
}

export const driverFullName = (d: Driver): string => `${d.imie} ${d.nazwisko}`.trim();

/** Maszynista rezerwowy (imienny) z macierzystą stacją. */
export interface Reserve {
  id: string;
  name: string;
  station: BreakStation;
  /** powiązanie z maszynistą z listy (telefon/nr prawa do powiadomień) */
  driverId?: string;
  /** wykluczony z podmian (nie przydzielać automatycznie) */
  blocked?: boolean;
  /** maksymalna liczba podmian (oprócz limitu 4,5h) */
  maxJobs?: number;
  /** wymuszone obiegi do podmiany przez tego rezerwowego (lista id) — silnik je respektuje */
  pins?: string[];
  /** tylko ręcznie: robi WYŁĄCZNIE wpisane piny, silnik nie dokłada mu nic automatycznie */
  manualOnly?: boolean;
  /** linia macierzysta rezerwowego (mamy dwie linie: M1/M2) */
  line?: MetroLine;
  /** dostępność: od której godziny pracuje (sekundy od północy) — R18 */
  availFrom?: number;
  /** dostępność: do której godziny pracuje (sekundy od północy) — R18 */
  availTo?: number;
  /** autoryzacje na typy taboru — rezerwowy podmienia tylko pociąg, na który ma autoryzację */
  auth?: TrainType[];
  /** dowolny opis autoryzacji — pojawia się przy ikonce pociągu na belce rezerwowego */
  authNote?: string;
}

/** Pula rezerwowych — lista imienna. */
export type ReservePool = Reserve[];

/** Maksymalny łączny czas podmian jednego rezerwowego (R13) — ~4,5 h. */
export const MAX_RESERVE_LOAD_MIN = 270;

/** Zaplanowana podmiana na przerwę. */
export interface BreakAssignment {
  obiegId: string;
  station: BreakStation;
  dir: Dir;
  /** start przerwy (sekundy od północy) */
  startT: number;
  kind: BreakKind;
  durationMin: number;
  /** przydzielony rezerwowy (null = nieobsadzony / „BRAK") */
  reserveId: string | null;
  /** czy ustawione ręcznie przez dyspozytora (hybryda) */
  manual?: boolean;
}

/** Maksymalna liczba przerw na jeden obieg (R16). */
export const MAX_BREAKS_PER_OBIEG = 2;

/** Wynik planowania. */
export interface PlanResult {
  /** klucz = id obiegu → LISTA przerw (R16: obieg może mieć kilka) */
  assignments: Record<string, BreakAssignment[]>;
  /** obiegi bez obsadzonego rezerwowego */
  unassigned: string[];
  /** obciążenie rezerwowych w minutach: klucz = reserveId */
  reserveLoadMin: Record<string, number>;
  /** liczba podmian rezerwowego: klucz = reserveId */
  reserveCount: Record<string, number>;
}

export const HHMMSS = (sec: number): string => {
  if (sec == null || Number.isNaN(sec)) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** "HH:MM" → sekundy od północy; undefined gdy puste/niepoprawne. */
export const hmToSec = (v: string): number | undefined => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return undefined;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60;
};
