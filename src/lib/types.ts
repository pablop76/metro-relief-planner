// Model danych dla planowania przerw M1

/** Kierunek jazdy pociągu. Północ = w stronę Młocin (A23), Południe = w stronę Kabat (A1). */
export type Dir = "Kabaty" | "Młociny";

/** Rodzaje przerw wg ZASADY.md. „godzinka" (~1h) na A7→Młociny i A18→Kabaty (jazda do krańca i powrót). */
export type BreakKind = "cała" | "godzinka" | "połówka" | "szczeniak";

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
  /** liczba kół 2. zmiany (wjazd→zjazd) — mało kół = szczyt, kandydat na połówkę.
   *  Infinity dla obiegów przechodzących z 1. zmiany (pracują całą 2. zmianę → zawsze cała). */
  loops: number;
  /** czas jednego koła tego obiegu (mediana, w minutach) — podstawa liczenia kół */
  lapMin: number;
  /** obieg jedzie ciągiem przez zmianę (brak postoju w środku dnia) — przechodzi z 1. zmiany;
   *  NIE startuje na 2. zmianie, więc kół nie liczymy — z definicji dostaje całą. */
  throughShift: boolean;
  /** realny start maszynisty 2. zmiany (sekundy od północy) — wjazd z rozkładu albo start z grafiku.
   *  Podstawa R3 (max 6h ciągłej pracy: 1. przerwa najpóźniej start+6h). */
  entry2nd: number;
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
  /** rezerwa ruchowa A1 (R17): ten JEDEN rezerwowy z Kabat zostaje pod ręką → domyślny limit 1 koło.
   *  Bez tej flagi silnik wskazuje pierwszego niezablokowanego rezerwowego A1. `maxJobs` zawsze nadpisuje. */
  rolling?: boolean;
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

/** Maksymalny łączny czas podmian jednego rezerwowego (R13) — ~4,5 h. (informacyjnie, do wyświetlania) */
export const MAX_RESERVE_LOAD_MIN = 270;

/** Limit pracy rezerwowego liczony w RÓWNOWARTOŚCI CAŁYCH (nie w realnych minutach — te są zmienne
 *  z rozkładu, np. połówka na A11 ≠ 45 min). cała=1, połówka=0,5, szczeniak=⅓.
 *  „Pełny" = 3 całe: 6 połówek = 2 całe+2 połówki = 1 cała+4 połówki = 3 całe. */
export const CALA_EQ: Record<BreakKind, number> = { "cała": 1, "godzinka": 2 / 3, "połówka": 0.5, "szczeniak": 1 / 3 };
export const MAX_RESERVE_LOAD_EQ = 3;
const LOAD_EPS = 1e-6;
/** Czy rezerwowy wyrobił limit (≥ 3 całe). */
export const reserveFull = (loadEq: number) => loadEq >= MAX_RESERVE_LOAD_EQ - LOAD_EPS;
/** Czy zmieści się jeszcze przerwa danego rodzaju w limicie 3 całych. */
export const fitsLoad = (loadEq: number, kind: BreakKind) =>
  loadEq + CALA_EQ[kind] <= MAX_RESERVE_LOAD_EQ + LOAD_EPS;

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
  /** R20: podmiana wymaga przejścia na przeciwny peron (powrót w przeciwnym kierunku) → bufor ~5 min.
   *  Silnik ustawia to dla przerw innych niż „cała". UI pokazuje przy niej alert ⚠. */
  crossTrack?: boolean;
}

/** Maksymalna liczba przerw na jeden obieg (R16). */
export const MAX_BREAKS_PER_OBIEG = 2;

/** R20: zakładany bufor na przejście między peronami przy podmianie „po przeciwnym torze" (minuty). */
export const XFER_BUFFER_MIN = 5;
/** Czy podmiana wymaga przejścia na przeciwny peron (powrót w przeciwnym kierunku) — R20.
 *  „cała" wraca tym samym torem (ten sam peron, ten sam pociąg) → bez bufora;
 *  połówka/godzinka/szczeniak wracają w przeciwnym kierunku → bufor ~5 min + alert ⚠. */
export const isCrossTrackBreak = (kind: BreakKind): boolean => kind !== "cała";

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
