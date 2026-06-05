import { useEffect, useMemo, useRef, useState } from "react";
import { parseObiegi, readWorkbook } from "./lib/rozklad";
import { planBreaks } from "./lib/engine";
import type { Obieg, Reserve, BreakAssignment, Driver } from "./lib/types";
import * as XLSX from "xlsx";
import { ReservePanel } from "./components/ReservePanel";
import { ObiegCard } from "./components/ObiegCard";
import { DriversManager } from "./components/DriversManager";

const DEFAULT_FILE = "/RJ_M1_A1_od_13_05_2026.xlsx";
const DRIVERS_FILE = "/maszynisci.json";
const BUILD = __BUILD_TIME__;
const LS = {
  res: "pm_reserves",
  manual: "pm_manual",
  drivers: "pm_drivers",
  delay: "pm_global_delay",
  order: "pm_order5", // v5: kolejność wg odjazdu z A1 w pętli 15:14
  sbW: "pm_sb_w",
  sbCol: "pm_sb_col",
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

function computeLoads(assignments: Record<string, BreakAssignment>) {
  const load: Record<string, number> = {};
  const count: Record<string, number> = {};
  for (const a of Object.values(assignments)) {
    if (!a.reserveId) continue;
    load[a.reserveId] = (load[a.reserveId] ?? 0) + a.durationMin;
    count[a.reserveId] = (count[a.reserveId] ?? 0) + 1;
  }
  return { load, count };
}

export default function App() {
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [sheet, setSheet] = useState<string>("");
  const [reserves, setReserves] = useState<Reserve[]>(() => loadLS<Reserve[]>(LS.res, []));
  const [drivers, setDrivers] = useState<Driver[]>(() => loadLS<Driver[]>(LS.drivers, []));
  const [showDrivers, setShowDrivers] = useState(false);
  const [manual, setManual] = useState<Record<string, BreakAssignment>>(() =>
    loadLS<Record<string, BreakAssignment>>(LS.manual, {})
  );
  const [assignments, setAssignments] = useState<Record<string, BreakAssignment>>({});
  const [globalDelay, setGlobalDelay] = useState<number>(() => loadLS<number>(LS.delay, 0));
  const [order, setOrder] = useState<string[]>(() => loadLS<string[]>(LS.order, []));
  const [dragId, setDragId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => loadLS<number>(LS.sbW, 360));
  const [sbCollapsed, setSbCollapsed] = useState<boolean>(() => loadLS<boolean>(LS.sbCol, false));
  const [error, setError] = useState<string>("");

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
  const delayed = useMemo(
    () => (globalDelay ? obiegi.map((o) => shift(o, globalDelay * 60)) : obiegi),
    [obiegi, globalDelay]
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

  const generate = (currentManual = manual) => {
    if (!delayed.length) return;
    const res = planBreaks(delayed, reserves);
    const merged: Record<string, BreakAssignment> = { ...res.assignments };
    for (const [id, a] of Object.entries(currentManual)) merged[id] = a;
    setAssignments(merged);
    setPlanDirty(false);
  };

  // generuj plan automatycznie tylko gdy zmieni się ROZKŁAD/dzień (nie przy zmianie rezerwowych)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => generate(), [delayed]);

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
  useEffect(() => localStorage.setItem(LS.sbW, JSON.stringify(sidebarWidth)), [sidebarWidth]);
  useEffect(() => localStorage.setItem(LS.sbCol, JSON.stringify(sbCollapsed)), [sbCollapsed]);

  const onAssignmentChange = (a: BreakAssignment) => {
    setManual((m) => ({ ...m, [a.obiegId]: a }));
    setAssignments((prev) => ({ ...prev, [a.obiegId]: a }));
  };

  const resetManual = () => {
    setManual({});
    const res = planBreaks(delayed, reserves);
    setAssignments(res.assignments);
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

  const { load, count } = useMemo(() => computeLoads(assignments), [assignments]);
  const byReserve = useMemo(() => {
    const m: Record<string, BreakAssignment[]> = {};
    for (const a of Object.values(assignments)) if (a.reserveId) (m[a.reserveId] ??= []).push(a);
    for (const k in m) m[k].sort((x, y) => x.startT - y.startT);
    return m;
  }, [assignments]);
  const unassigned = Object.values(assignments).filter((a) => !a.reserveId).length;
  const planned = Object.values(assignments).filter((a) => a.reserveId).length;
  const def = defaultOrder(obiegi);
  const orderChanged = order.length > 0 && order.some((id, i) => def[i] !== id);
  // dwa równe rzędy (jak w arkuszu): liczba kolumn = połowa obiegów
  const cols = Math.max(1, Math.ceil(ordered.length / 2));

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
          <label className="delay-ctl" title="opóźnienie całej linii w minutach">
            ⏱ opóźnienie
            <input
              type="number"
              value={globalDelay}
              onChange={(e) => setGlobalDelay(parseInt(e.target.value, 10) || 0)}
            />
            min
          </label>
          <button
            className={`btn-gen${planDirty ? " dirty" : ""}`}
            onClick={() => generate()}
            title={planDirty ? "Zmieniłeś rezerwowych — kliknij, by przeliczyć plan" : "Przelicz plan"}
          >
            ⟳ Generuj plan{planDirty ? " •" : ""}
          </button>
          {Object.keys(manual).length > 0 && (
            <button className="btn-reset" onClick={resetManual} title="usuń ręczne korekty">
              Reset korekt
            </button>
          )}
          {orderChanged && (
            <button className="btn-reset" onClick={resetOrder} title="przywróć kolejność wg rozkładu">
              Reset kolejności
            </button>
          )}
          <button className="btn-drivers" onClick={() => setShowDrivers(true)}>
            👤 Maszyniści ({drivers.length})
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

      {error && <div className="error">⚠ {error}</div>}

      <div className="layout">
        <main className="grid-area">
          <div className="summary">
            <strong>{obiegi.length}</strong> obiegów&nbsp;·&nbsp;
            <span className="ok">{planned} obsadzonych</span>
            {unassigned > 0 && <span className="bad">&nbsp;·&nbsp;{unassigned} BRAK</span>}
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
                  assignment={assignments[o.id]}
                  reserves={reserves}
                  onAssignmentChange={onAssignmentChange}
                />
              </div>
            ))}
          </div>
        </main>

        {sbCollapsed ? (
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
                count={count}
                byReserve={byReserve}
                obiegIds={ordered.map((o) => o.id)}
              />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
