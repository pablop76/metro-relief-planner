import { useEffect, useMemo, useRef, useState } from "react";
import { parseObiegi, readWorkbook, applyWorkHours } from "./lib/rozklad";
import { planBreaks } from "./lib/engine";
import type { Obieg, Reserve, BreakAssignment, Driver, BreakKind, BreakStation } from "./lib/types";
import { HHMMSS, hmToSec, CALA_EQ, BREAK_STATIONS } from "./lib/types";
import * as XLSX from "xlsx";
import { ReservePanel } from "./components/ReservePanel";
import { ObiegCard } from "./components/ObiegCard";
import { DriversManager } from "./components/DriversManager";

const DEFAULT_FILE = "/RJ_M1_A1_od_13_05_2026.xlsx";
const DRIVERS_FILE = "/maszynisci.json";
const BUILD = __BUILD_TIME__;
const DEFAULT_EARLIEST = 14 * 3600 + 30 * 60; // 14:30 — domyślny próg „nie wcześniej niż"
const LS = {
  res: "pm_reserves",
  manual: "pm_manual",
  drivers: "pm_drivers",
  delay: "pm_global_delay",
  order: "pm_order5", // v5: kolejność wg odjazdu z A1 w pętli 15:14
  sbW: "pm_sb_w",
  sbCol: "pm_sb_col",
  trains: "pm_trains",
  forceKind: "pm_forcekind",
  throughShift: "pm_throughshift",
  rows: "pm_rows",
  fontScale: "pm_fontscale",
  earliest: "pm_earliest",
  earliestStation: "pm_earliest_station",
  earliestObieg: "pm_earliest_obieg",
  entry2ndObieg: "pm_entry2nd_obieg",
  workEndObieg: "pm_workend_obieg",
  xferBuffer: "pm_xfer_buffer",
  peaksNotFirst: "pm_peaks_not_first",
  layout: "pm_layout",
};

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Przesuwa całą oś czasu obiegu o `sec` sekund (opóźnienie). */
function shift(o: Obieg, sec: number): Obieg {
  if (!sec) return o;
  return {
    ...o,
    events: o.events.map((e) => ({ ...e, t: e.t + sec })),
    firstT: o.firstT + sec,
    lastT: o.lastT + sec,
  };
}

/** Domyślna kolejność: wg seqOrder z parsera (obieg 1 pierwszy, dalej „wszystkie na linii"). */
function defaultOrder(obiegi: Obieg[]): string[] {
  return [...obiegi].sort((a, b) => a.seqOrder - b.seqOrder).map((o) => o.id);
}

function computeLoads(assignments: Record<string, BreakAssignment[]>) {
  const load: Record<string, number> = {};
  const loadEq: Record<string, number> = {};
  const count: Record<string, number> = {};
  for (const list of Object.values(assignments))
    for (const a of list) {
      if (!a.reserveId) continue;
      load[a.reserveId] = (load[a.reserveId] ?? 0) + a.durationMin;
      loadEq[a.reserveId] = (loadEq[a.reserveId] ?? 0) + CALA_EQ[a.kind];
      count[a.reserveId] = (count[a.reserveId] ?? 0) + 1;
    }
  return { load, loadEq, count };
}

export default function App() {
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [sheet, setSheet] = useState<string>("");
  const [reserves, setReserves] = useState<Reserve[]>(() => loadLS<Reserve[]>(LS.res, []));
  const [drivers, setDrivers] = useState<Driver[]>(() => loadLS<Driver[]>(LS.drivers, []));
  const [showDrivers, setShowDrivers] = useState(false);
  const [manual, setManual] = useState<Record<string, BreakAssignment[]>>(() =>
    loadLS<Record<string, BreakAssignment[]>>(LS.manual, {})
  );
  const [assignments, setAssignments] = useState<Record<string, BreakAssignment[]>>({});
  const [trainNumbers, setTrainNumbers] = useState<Record<string, string>>(() =>
    loadLS<Record<string, string>>(LS.trains, {})
  );
  const [forceKind, setForceKind] = useState<Record<string, BreakKind>>(() =>
    loadLS<Record<string, BreakKind>>(LS.forceKind, {})
  );
  // ręczne oznaczenie obiegu jako całozmianowy (ustawia pomocnik): true/false = override, brak = auto
  const [throughShiftBy, setThroughShiftBy] = useState<Record<string, boolean>>(() =>
    loadLS<Record<string, boolean>>(LS.throughShift, {})
  );
  const [rows, setRows] = useState<number>(() => loadLS<number>(LS.rows, 2));
  const [fontScale, setFontScale] = useState<number>(() => loadLS<number>(LS.fontScale, 1));
  const [globalDelay, setGlobalDelay] = useState<number>(() => loadLS<number>(LS.delay, 0));
  const [earliestStart, setEarliestStart] = useState<number>(() => loadLS<number>(LS.earliest, DEFAULT_EARLIEST));
  const [earliestByStation, setEarliestByStation] = useState<Partial<Record<BreakStation, number>>>(() =>
    loadLS<Partial<Record<BreakStation, number>>>(LS.earliestStation, {})
  );
  // ręczne GODZINY PRACY maszynisty 2. zmiany per obieg (od–do). „Od" (entry2ndByObieg) i „do"
  // (workEndByObieg) przeliczają obiegowi KOŁA z rozkładu (applyWorkHours) i ograniczają sloty przerw.
  const [entry2ndByObieg, setEntry2ndByObieg] = useState<Record<string, number>>(() =>
    loadLS<Record<string, number>>(LS.entry2ndObieg, {})
  );
  const [workEndByObieg, setWorkEndByObieg] = useState<Record<string, number>>(() =>
    loadLS<Record<string, number>>(LS.workEndObieg, {})
  );
  // R20: konfigurowalny bufor na przeskok na drugi peron (minuty); domyślnie 5
  const [xferBufferMin, setXferBufferMin] = useState<number>(() => loadLS<number>(LS.xferBuffer, 5));
  const [peaksNotFirst, setPeaksNotFirst] = useState<boolean>(() => loadLS<boolean>(LS.peaksNotFirst, false));
  // WARIANT planu: każde kliknięcie „Generuj plan" zwiększa seed → inna, równie dobra kombinacja
  const [planSeed, setPlanSeed] = useState<number>(0);
  const [earliestByObieg, setEarliestByObieg] = useState<Record<string, number>>(() =>
    loadLS<Record<string, number>>(LS.earliestObieg, {})
  );
  const [order, setOrder] = useState<string[]>(() => loadLS<string[]>(LS.order, []));
  const [dragId, setDragId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => loadLS<number>(LS.sbW, 360));
  const [sbCollapsed, setSbCollapsed] = useState<boolean>(() => loadLS<boolean>(LS.sbCol, false));
  const [layout, setLayout] = useState<"side" | "bottom">(() => loadLS<"side" | "bottom">(LS.layout, "side"));
  const [error, setError] = useState<string>("");
  const [showReset, setShowReset] = useState(false);
  const [showGenConfirm, setShowGenConfirm] = useState(false); // twarde potwierdzenie „Generuj plan"
  const [copyMsg, setCopyMsg] = useState(""); // komunikat po „kopiuj plan"

  // pełny reset: usuń WSZYSTKIE dane aplikacji z localStorage i przeładuj do ustawień domyślnych
  const clearAllMemory = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("pm_"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* localStorage niedostępny — i tak przeładuj */
    }
    location.reload();
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(640, Math.max(240, window.innerWidth - ev.clientX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    fetch(DEFAULT_FILE)
      .then((r) => {
        if (!r.ok) throw new Error("Brak domyślnego rozkładu");
        return r.arrayBuffer();
      })
      .then((buf) => {
        const w = readWorkbook(buf);
        setWb(w);
        setSheet(w.SheetNames[0]);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  // lista maszynistów: z localStorage, a gdy pusta — domyślna z pliku
  useEffect(() => {
    if (drivers.length) return;
    fetch(DRIVERS_FILE)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Driver[]) => Array.isArray(d) && d.length && setDrivers(d))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreDrivers = () => {
    fetch(DRIVERS_FILE)
      .then((r) => r.json())
      .then((d: Driver[]) => setDrivers(d))
      .catch(() => {});
  };

  const obiegi: Obieg[] = useMemo(() => {
    if (!wb || !sheet) return [];
    try {
      return parseObiegi(wb, sheet);
    } catch (e) {
      setError(String((e as Error).message));
      return [];
    }
  }, [wb, sheet]);

  // opóźnienie linii (globalne) → przesunięta oś czasu wszystkich obiegów
  const shifted = useMemo(
    () => (globalDelay ? obiegi.map((o) => shift(o, globalDelay * 60)) : obiegi),
    [obiegi, globalDelay]
  );
  // ręczne godziny pracy od–do per obieg → PRZELICZONE koła/entry2nd/throughShift z rozkładu w tym oknie
  // (applyWorkHours). Zmiana godzin automatycznie przelicza plan (useEffect niżej zależy od `delayed`).
  const delayed = useMemo(
    () => shifted.map((o) => applyWorkHours(o, entry2ndByObieg[o.id], workEndByObieg[o.id])),
    [shifted, entry2ndByObieg, workEndByObieg]
  );

  // kolejność wyświetlania (ręczna, drag & drop) — nie wpływa na sam plan
  const ordered = useMemo(() => {
    if (!order.length) return delayed;
    const idx = new Map(order.map((id, i) => [id, i]));
    return [...delayed].sort((a, b) => (idx.get(a.id) ?? 1e9) - (idx.get(b.id) ?? 1e9));
  }, [delayed, order]);

  // domyślna kolejność = obieg 1, dalej wg rozkładu — gdy brak zapisanej / niespójna
  useEffect(() => {
    if (!obiegi.length) return;
    const ids = obiegi.map((o) => o.id);
    setOrder((prev) =>
      prev.length === ids.length && prev.every((id) => ids.includes(id)) ? prev : defaultOrder(obiegi)
    );
  }, [obiegi]);

  const [planDirty, setPlanDirty] = useState(false);
  const [lastGenAt, setLastGenAt] = useState<number | null>(null); // kiedy ostatnio przeliczono (widoczny ślad)

  const generate = (currentManual = manual, currentForce = forceKind, currentThrough = throughShiftBy, seed = planSeed) => {
    if (!delayed.length) return;
    const res = planBreaks(delayed, reserves, {
      forcedKinds: currentForce,
      throughShiftOverride: currentThrough,
      earliest: earliestStart,
      earliestByStation,
      earliestByObieg,
      xferBufferMin,
      peaksNotFirst,
      seed,
    });
    const merged: Record<string, BreakAssignment[]> = { ...res.assignments };
    for (const [id, a] of Object.entries(currentManual)) merged[id] = a;
    setAssignments(merged);
    setPlanDirty(false);
    setLastGenAt(Date.now());
  };

  // ręczny mark rodzaju: auto → połówka → cała → auto; natychmiast przelicza
  const cycleKind = (id: string) => {
    const cur = forceKind[id];
    const nextVal: BreakKind | undefined =
      cur === undefined ? "połówka" : cur === "połówka" ? "cała" : undefined;
    const next = { ...forceKind };
    if (nextVal) next[id] = nextVal;
    else delete next[id];
    setForceKind(next);
    generate(manual, next);
  };

  // ręczny mark całozmianowy: auto → wymuś całozmianowy (true) → wymuś zwykły (false) → auto; przelicza
  const cycleThroughShift = (id: string) => {
    const cur = throughShiftBy[id];
    const next = { ...throughShiftBy };
    if (cur === undefined) next[id] = true;
    else if (cur === true) next[id] = false;
    else delete next[id];
    setThroughShiftBy(next);
    generate(manual, forceKind, next);
  };

  // generuj plan automatycznie tylko gdy zmieni się ROZKŁAD/dzień (nie przy zmianie rezerwowych)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => generate(), [delayed, earliestStart, earliestByStation, earliestByObieg, xferBufferMin, peaksNotFirst]);

  // zmiana rezerwowych NIE przebudowuje planu sama — oznacz go jako nieaktualny (kliknij „Generuj")
  const firstResRef = useRef(true);
  useEffect(() => {
    if (firstResRef.current) {
      firstResRef.current = false;
      return;
    }
    setPlanDirty(true);
  }, [reserves]);

  useEffect(() => localStorage.setItem(LS.res, JSON.stringify(reserves)), [reserves]);
  useEffect(() => localStorage.setItem(LS.manual, JSON.stringify(manual)), [manual]);
  useEffect(() => localStorage.setItem(LS.drivers, JSON.stringify(drivers)), [drivers]);
  useEffect(() => localStorage.setItem(LS.delay, JSON.stringify(globalDelay)), [globalDelay]);
  useEffect(() => localStorage.setItem(LS.order, JSON.stringify(order)), [order]);
  useEffect(() => localStorage.setItem(LS.trains, JSON.stringify(trainNumbers)), [trainNumbers]);
  useEffect(() => localStorage.setItem(LS.forceKind, JSON.stringify(forceKind)), [forceKind]);
  useEffect(() => localStorage.setItem(LS.throughShift, JSON.stringify(throughShiftBy)), [throughShiftBy]);
  useEffect(() => localStorage.setItem(LS.rows, JSON.stringify(rows)), [rows]);
  useEffect(() => localStorage.setItem(LS.fontScale, JSON.stringify(fontScale)), [fontScale]);
  useEffect(() => localStorage.setItem(LS.earliest, JSON.stringify(earliestStart)), [earliestStart]);
  useEffect(() => localStorage.setItem(LS.earliestStation, JSON.stringify(earliestByStation)), [earliestByStation]);
  useEffect(() => localStorage.setItem(LS.earliestObieg, JSON.stringify(earliestByObieg)), [earliestByObieg]);
  useEffect(() => localStorage.setItem(LS.entry2ndObieg, JSON.stringify(entry2ndByObieg)), [entry2ndByObieg]);
  useEffect(() => localStorage.setItem(LS.workEndObieg, JSON.stringify(workEndByObieg)), [workEndByObieg]);
  useEffect(() => localStorage.setItem(LS.xferBuffer, JSON.stringify(xferBufferMin)), [xferBufferMin]);
  useEffect(() => localStorage.setItem(LS.peaksNotFirst, JSON.stringify(peaksNotFirst)), [peaksNotFirst]);
  useEffect(() => localStorage.setItem(LS.sbW, JSON.stringify(sidebarWidth)), [sidebarWidth]);
  useEffect(() => localStorage.setItem(LS.sbCol, JSON.stringify(sbCollapsed)), [sbCollapsed]);
  useEffect(() => localStorage.setItem(LS.layout, JSON.stringify(layout)), [layout]);

  // ręczna zmiana całej listy przerw obiegu (edycja/dodanie/usunięcie) — utrwala jako override
  const onBreaksChange = (obiegId: string, breaks: BreakAssignment[]) => {
    setManual((m) => ({ ...m, [obiegId]: breaks }));
    setAssignments((prev) => ({ ...prev, [obiegId]: breaks }));
  };

  // override progu „nie wcześniej niż" dla pojedynczego obiegu (undefined = wróć do globalnego)
  const setObiegEarliest = (id: string, sec?: number) =>
    setEarliestByObieg((prev) => {
      const next = { ...prev };
      if (sec == null) delete next[id];
      else next[id] = sec;
      return next;
    });

  // „Kopiuj plan" — zrzut całego planu (z ręcznymi korektami) do schowka jako tekst, do analizy/przekazania.
  const copyPlan = () => {
    const resName = (id: string | null) => (id ? reserves.find((r) => r.id === id)?.name ?? id : "BRAK");
    const lines: string[] = [];
    for (const o of ordered) {
      const list = (assignments[o.id] ?? []).slice().sort((a, b) => a.startT - b.startT);
      const k = Number.isFinite(o.loops) ? `${o.loops.toFixed(1)} kół` : "całozmianowy";
      const brk = list.length
        ? list.map((a) => `${a.kind}@${a.station} ${HHMMSS(a.startT)} ${resName(a.reserveId)}`).join("  |  ")
        : "— brak —";
      lines.push(`${o.id} (${k}): ${brk}`);
    }
    const eq: Record<string, number> = {};
    for (const list of Object.values(assignments)) for (const a of list) if (a.reserveId) eq[a.reserveId] = (eq[a.reserveId] ?? 0) + CALA_EQ[a.kind];
    lines.push("", "— obciążenie rezerwowych (koła) —");
    for (const r of reserves) lines.push(`${r.station} ${r.name}: ${(eq[r.id] ?? 0).toFixed(1)}/3`);
    const text = lines.join("\n");
    navigator.clipboard?.writeText(text).then(() => setCopyMsg("skopiowano ✓"), () => setCopyMsg("błąd kopiowania"));
    setTimeout(() => setCopyMsg(""), 2500);
  };

  // reset ręcznych korekt + pełne przeliczenie tymi samymi opcjami co generate (fix 2026-06-12 —
  // wcześniej pomijał xferBufferMin/peaksNotFirst/seed i plan po resecie różnił się od „Generuj")
  const resetManual = () => {
    setManual({});
    generate({});
  };

  const resetOrder = () => setOrder(defaultOrder(obiegi));

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setOrder((prev) => {
      const ids = (prev.length ? prev : ordered.map((o) => o.id)).slice();
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      ids.splice(from, 1);
      ids.splice(to, 0, dragId);
      return ids;
    });
    setDragId(null);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const w = readWorkbook(buf);
    setWb(w);
    setSheet(w.SheetNames[0]);
    setError("");
  };

  const { load, loadEq, count } = useMemo(() => computeLoads(assignments), [assignments]);
  const byReserve = useMemo(() => {
    const m: Record<string, BreakAssignment[]> = {};
    for (const list of Object.values(assignments))
      for (const a of list) if (a.reserveId) (m[a.reserveId] ??= []).push(a);
    for (const k in m) m[k].sort((x, y) => x.startT - y.startT);
    return m;
  }, [assignments]);
  const allBreaks = Object.values(assignments).flat();
  // OBIEGI (suma = liczba obiegów): obsadzony = ma ≥1 podmianę z rezerwowym; BRAK = nie ma żadnej.
  const coveredObiegi = obiegi.filter((o) => (assignments[o.id] ?? []).some((a) => a.reserveId)).length;
  const brakObiegi = obiegi.length - coveredObiegi;
  // PODMIANY (sloty, łącznie z 2. przerwami) — inna jednostka niż obiegi (stąd „32 ≠ 36 − 9").
  const plannedJobs = allBreaks.filter((a) => a.reserveId).length;
  // rozbicie BRAK wg stacji (ze slotu fallbackowego bez rezerwowego; obieg bez żadnego slotu = „?")
  const brakByStation: Record<string, number> = {};
  for (const o of obiegi) {
    const list = assignments[o.id] ?? [];
    if (list.some((a) => a.reserveId)) continue;
    const st = list.find((a) => !a.reserveId)?.station ?? "?";
    brakByStation[st] = (brakByStation[st] ?? 0) + 1;
  }
  // pomijamy „?" (obieg bez żadnego slotu, np. przy braku obsady) — liczy się w sumie BRAK, ale nie zaśmieca rozbicia
  const brakBreakdown = Object.entries(brakByStation).filter(([s]) => s !== "?").map(([s, n]) => `${s}×${n}`).join(", ");
  const def = defaultOrder(obiegi);
  const orderChanged = order.length > 0 && order.some((id, i) => def[i] !== id);
  // liczba kolumn = obiegi / wybrana liczba rzędów
  const cols = Math.max(1, Math.ceil(ordered.length / rows));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="m-badge">M1</span>
          <h1>Przerwy maszynistów</h1>
          <span className="build-tag" title="czas builda — jeśli stary, odśwież z Disable cache (F12 → Network)">
            build {BUILD}
          </span>
        </div>
        <div className="controls">
          {wb && (
            <select value={sheet} onChange={(e) => setSheet(e.target.value)}>
              {wb.SheetNames.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <label className="delay-ctl" title="liczba rzędów kafelków">
            ▦ rzędy
            <select value={rows} onChange={(e) => setRows(parseInt(e.target.value, 10))}>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
              <option value={6}>6</option>
            </select>
          </label>
          <label className="delay-ctl" title="powiększenie czcionek / kafelków">
            🔍 font
            <select value={fontScale} onChange={(e) => setFontScale(parseFloat(e.target.value))}>
              <option value={1}>100%</option>
              <option value={1.15}>115%</option>
              <option value={1.3}>130%</option>
              <option value={1.5}>150%</option>
              <option value={1.75}>175%</option>
              <option value={2}>200%</option>
            </select>
          </label>
          <label className="delay-ctl" title="opóźnienie całej linii w minutach">
            ⏱ opóźnienie
            <input
              type="number"
              value={globalDelay}
              onChange={(e) => {
                const next = parseInt(e.target.value, 10) || 0;
                // auto-podmiany przesuwają się przez regenerację (delayed); RĘCZNE mają absolutny czas —
                // przesuwamy je o DELTĘ opóźnienia, żeby też nadążały za linią (decyzja użytkownika 2026-06-10).
                const deltaSec = (next - globalDelay) * 60;
                if (deltaSec !== 0) {
                  setManual((m) => {
                    const out: Record<string, BreakAssignment[]> = {};
                    for (const [id, list] of Object.entries(m))
                      out[id] = list.map((a) => ({ ...a, startT: a.startT + deltaSec }));
                    return out;
                  });
                }
                setGlobalDelay(next);
              }}
            />
            min
          </label>
          <label className="delay-ctl" title="ZACZNIJ OD tej godziny — zalecenie: nie wcześniej niż (nie sztywna godzina); próg globalny — per-stacja niżej, override per-obieg w edytorze przerwy">
            ⏰ zacznij od
            <input
              type="time"
              value={HHMMSS(earliestStart)}
              onChange={(e) => setEarliestStart(hmToSec(e.target.value) ?? earliestStart)}
            />
          </label>
          <label className="delay-ctl" title="R20: ile minut ma rezerwowy na przeskok na drugi peron, by zdążyć na kolejną podmianę z przeciwnego toru (alert ⚠ gdy ciaśniej)">
            ⚠ przeskok toru
            <input
              type="number"
              min={0}
              value={xferBufferMin}
              onChange={(e) => setXferBufferMin(Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
            min
          </label>
          <label className="delay-ctl" title="Szczyt (obieg < 4,5 koła) nie będzie PIERWSZĄ podmianą rezerwowego — wczesne sloty zajmują długodystansowcy/całozmianowi, szczyt wchodzi po pierwszej podmianie. Obciążenie bez zmian (wszyscy nadal po 3 koła).">
            <input
              type="checkbox"
              checked={peaksNotFirst}
              onChange={(e) => setPeaksNotFirst(e.target.checked)}
            />
            nie zaczynaj od szczytów
          </label>
          <div className="station-earliest" title="zacznij od — PER STACJA (zalecenie: nie wcześniej niż); puste pole = jak globalny">
            <span className="se-lbl">per stacja:</span>
            {BREAK_STATIONS.map((s) => (
              <label key={s} className="se-item">
                <span>{s}</span>
                <input
                  type="time"
                  value={earliestByStation[s] != null ? HHMMSS(earliestByStation[s]!) : ""}
                  placeholder={HHMMSS(earliestStart)}
                  onChange={(e) => {
                    const v = hmToSec(e.target.value);
                    setEarliestByStation((prev) => {
                      const next = { ...prev };
                      if (v == null) delete next[s];
                      else next[s] = v;
                      return next;
                    });
                  }}
                />
              </label>
            ))}
          </div>
          <button
            className={`btn-gen${planDirty ? " dirty" : ""}`}
            onClick={() => setShowGenConfirm(true)}
            title={planDirty ? "Zmieniłeś rezerwowych — kliknij, by przeliczyć plan (z potwierdzeniem)" : "Przelicz plan (z potwierdzeniem)"}
          >
            ⟳ Generuj plan{planDirty ? " •" : ""}
          </button>
          {lastGenAt && (
            <span className="gen-stamp" title="czas ostatniego przeliczenia planu">
              ✓ {new Date(lastGenAt).toLocaleTimeString("pl-PL")}
            </span>
          )}
          {Object.keys(manual).length > 0 && (
            <button className="btn-reset" onClick={resetManual} title="usuń ręczne korekty">
              Reset korekt
            </button>
          )}
          <button className="btn-reset" onClick={copyPlan} title="skopiuj cały plan (z korektami) do schowka jako tekst">
            📋 Kopiuj plan
          </button>
          {copyMsg && <span className="gen-stamp">{copyMsg}</span>}
          {orderChanged && (
            <button className="btn-reset" onClick={resetOrder} title="przywróć kolejność wg rozkładu">
              Reset kolejności
            </button>
          )}
          <button className="btn-drivers" onClick={() => setShowDrivers(true)}>
            👤 Maszyniści ({drivers.length})
          </button>
          <button
            className="btn-clear"
            onClick={() => setShowReset(true)}
            title="wyczyść całą pamięć aplikacji (reset do ustawień domyślnych)"
          >
            🧹 Wyczyść pamięć
          </button>
          <button
            className="btn-layout"
            onClick={() => setLayout((l) => (l === "side" ? "bottom" : "side"))}
            title="panel rezerwowych: z boku / pod tabelą (poziomo)"
          >
            {layout === "side" ? "▭ panel: dół" : "▥ panel: bok"}
          </button>
          <label className="file-btn">
            Wczytaj rozkład…
            <input type="file" accept=".xlsx" onChange={onFile} hidden />
          </label>
        </div>
      </header>

      {showDrivers && (
        <DriversManager
          drivers={drivers}
          onChange={setDrivers}
          onRestore={restoreDrivers}
          onClose={() => setShowDrivers(false)}
        />
      )}

      {showReset && (
        <div className="modal-backdrop" onClick={() => setShowReset(false)}>
          <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>⚠ Wyczyścić całą pamięć?</h2>
              <button className="modal-x" onClick={() => setShowReset(false)}>
                ×
              </button>
            </div>
            <div className="confirm-body">
              <p>
                To nieodwracalnie usunie z pamięci przeglądarki <strong>wszystkie</strong> dane
                aplikacji:
              </p>
              <ul>
                <li>rezerwowych i ich ustawienia,</li>
                <li>maszynistów (wrócą domyślni z pliku),</li>
                <li>ręczne korekty przerw,</li>
                <li>kolejność, opóźnienie, progi godzin i układ panelu.</li>
              </ul>
              <p className="confirm-note">
                Rozkład i lista maszynistów zostaną pobrane na nowo z plików domyślnych, a strona się
                przeładuje.
              </p>
            </div>
            <div className="confirm-actions">
              <button className="btn-reset" onClick={() => setShowReset(false)}>
                Anuluj
              </button>
              <button className="btn-danger" onClick={clearAllMemory}>
                🧹 Tak, wyczyść wszystko
              </button>
            </div>
          </div>
        </div>
      )}

      {showGenConfirm && (
        <div className="modal-backdrop" onClick={() => setShowGenConfirm(false)}>
          <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>⟳ Przeliczyć plan od nowa?</h2>
              <button className="modal-x" onClick={() => setShowGenConfirm(false)}>
                ×
              </button>
            </div>
            <div className="confirm-body">
              <p>
                Automatyczny przydział przerw zostanie <strong>wygenerowany ponownie</strong> wg
                aktualnego rozkładu, rezerwowych i ustawień — nadpisze obecny układ.
              </p>
              <p className="confirm-note">
                Ręczne korekty (✎) <strong>zostają</strong> zachowane. Operacji nie cofniesz inaczej
                niż kolejnym przeliczeniem.
              </p>
              {Object.keys(manual).length > 0 && (
                <p className="confirm-note">
                  ⚠ Masz <strong>{Object.keys(manual).length}</strong>{" "}
                  {Object.keys(manual).length === 1 ? "obieg z ręczną korektą" : "obiegów z ręcznymi korektami"} —
                  ich przerwy <strong>nie zmienią się</strong> mimo przeliczenia (wymuszenia rodzaju, bufor itd.
                  ich nie dotyczą). Pełne przeliczenie: najpierw „Reset korekt".
                </p>
              )}
            </div>
            <div className="confirm-actions">
              <button className="btn-reset" onClick={() => setShowGenConfirm(false)}>
                Anuluj
              </button>
              <button
                className="btn-danger"
                onClick={() => {
                  const s = planSeed + 1; // nowy WARIANT przy każdym ręcznym przeliczeniu
                  setPlanSeed(s);
                  generate(manual, forceKind, throughShiftBy, s);
                  setShowGenConfirm(false);
                }}
              >
                ⟳ Tak, przelicz plan (inny wariant)
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="error">⚠ {error}</div>}

      <div className={`layout layout-${layout}`}>
        <main className="grid-area" style={{ zoom: fontScale }}>
          <div className="summary">
            <strong>{obiegi.length}</strong> obiegów&nbsp;·&nbsp;
            <span className="ok">{coveredObiegi} obsadzonych</span>
            {brakObiegi > 0 && (
              <span className="bad" title="obiegi bez rezerwowego, rozbite wg stacji">
                &nbsp;·&nbsp;{brakObiegi} BRAK{brakBreakdown ? ` (${brakBreakdown})` : ""}
              </span>
            )}
            &nbsp;·&nbsp;{plannedJobs} podmian
            {globalDelay !== 0 && <span className="bad">&nbsp;·&nbsp;linia +{globalDelay} min</span>}
            <span className="hint-drag">&nbsp;·&nbsp;przeciągaj karty, by zmienić kolejność</span>
          </div>
          <div
            className="obiegi-grid two-rows"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(82px, 1fr))` }}
          >
            {ordered.map((o) => (
              <div
                key={o.id}
                className={`drag-wrap${dragId === o.id ? " dragging" : ""}`}
                draggable
                onDragStart={() => setDragId(o.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(o.id)}
                onDragEnd={() => setDragId(null)}
              >
                <ObiegCard
                  obieg={o}
                  breaks={assignments[o.id] ?? []}
                  reserves={reserves}
                  byReserve={byReserve}
                  onBreaksChange={(b) => onBreaksChange(o.id, b)}
                  trainNo={trainNumbers[o.id] ?? ""}
                  onTrainChange={(v) => setTrainNumbers((t) => ({ ...t, [o.id]: v }))}
                  forceKind={forceKind[o.id]}
                  onCycleKind={() => cycleKind(o.id)}
                  throughShiftOverride={throughShiftBy[o.id]}
                  onToggleThroughShift={() => cycleThroughShift(o.id)}
                  earliestOverride={earliestByObieg[o.id]}
                  onEarliestChange={(sec) => setObiegEarliest(o.id, sec)}
                  driverStartOverride={entry2ndByObieg[o.id]}
                  onDriverStartChange={(sec) =>
                    setEntry2ndByObieg((m) => {
                      const n = { ...m };
                      if (sec == null) delete n[o.id];
                      else n[o.id] = sec;
                      return n;
                    })
                  }
                  workEndOverride={workEndByObieg[o.id]}
                  onWorkEndChange={(sec) =>
                    setWorkEndByObieg((m) => {
                      const n = { ...m };
                      if (sec == null) delete n[o.id];
                      else n[o.id] = sec;
                      return n;
                    })
                  }
                />
              </div>
            ))}
          </div>
        </main>

        {layout === "side" && (sbCollapsed ? (
          <button className="sidebar-expand" onClick={() => setSbCollapsed(false)} title="rozwiń panel">
            ‹ Rezerwowi
          </button>
        ) : (
          <>
            <div className="resizer" onMouseDown={startResize} title="przeciągnij, aby zmienić szerokość" />
            <aside className="sidebar" style={{ width: sidebarWidth }}>
              <button className="sidebar-collapse" onClick={() => setSbCollapsed(true)} title="zwiń panel">
                ›
              </button>
              <ReservePanel
                reserves={reserves}
                onChange={setReserves}
                drivers={drivers}
                load={load}
                loadEq={loadEq}
                count={count}
                byReserve={byReserve}
                obiegIds={ordered.map((o) => o.id)}
              />
            </aside>
          </>
        ))}
      </div>

      {layout === "bottom" && (
        <aside className="bottom-panel">
          <ReservePanel
            reserves={reserves}
            onChange={setReserves}
            drivers={drivers}
            load={load}
            loadEq={loadEq}
            count={count}
            byReserve={byReserve}
            obiegIds={ordered.map((o) => o.id)}
            horizontal
          />
        </aside>
      )}
    </div>
  );
}
