import { useEffect, useMemo, useState } from "react";
import { parseObiegi, readWorkbook } from "./lib/rozklad";
import { planBreaks } from "./lib/engine";
import type { Obieg, Reserve, BreakAssignment } from "./lib/types";
import * as XLSX from "xlsx";
import { ReservePanel } from "./components/ReservePanel";
import { ObiegCard } from "./components/ObiegCard";

const DEFAULT_FILE = "/RJ_M1_A1_od_13_05_2026.xlsx";
const LS_RES = "pm_reserves";
const LS_MANUAL = "pm_manual";

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Sumuje obciążenie rezerwowych z aktualnego planu (uwzględnia ręczne korekty). */
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
  const [reserves, setReserves] = useState<Reserve[]>(() => loadLS<Reserve[]>(LS_RES, []));
  const [manual, setManual] = useState<Record<string, BreakAssignment>>(() =>
    loadLS<Record<string, BreakAssignment>>(LS_MANUAL, {})
  );
  const [assignments, setAssignments] = useState<Record<string, BreakAssignment>>({});
  const [error, setError] = useState<string>("");

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

  const obiegi: Obieg[] = useMemo(() => {
    if (!wb || !sheet) return [];
    try {
      return parseObiegi(wb, sheet);
    } catch (e) {
      setError(String((e as Error).message));
      return [];
    }
  }, [wb, sheet]);

  // generowanie planu: auto przy zmianie obiegów/rezerwowych, z zachowaniem ręcznych korekt
  const generate = (currentManual = manual) => {
    if (!obiegi.length) return;
    const res = planBreaks(obiegi, reserves);
    const merged: Record<string, BreakAssignment> = { ...res.assignments };
    for (const [id, a] of Object.entries(currentManual)) merged[id] = a;
    setAssignments(merged);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => generate(), [obiegi, reserves]);

  useEffect(() => localStorage.setItem(LS_RES, JSON.stringify(reserves)), [reserves]);
  useEffect(() => localStorage.setItem(LS_MANUAL, JSON.stringify(manual)), [manual]);

  const onAssignmentChange = (a: BreakAssignment) => {
    const nextManual = { ...manual, [a.obiegId]: a };
    setManual(nextManual);
    setAssignments((prev) => ({ ...prev, [a.obiegId]: a }));
  };

  const resetManual = () => {
    setManual({});
    const res = planBreaks(obiegi, reserves);
    setAssignments(res.assignments);
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
  const unassigned = Object.values(assignments).filter((a) => !a.reserveId).length;
  const planned = Object.values(assignments).filter((a) => a.reserveId).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="m-badge">M1</span>
          <h1>Przerwy maszynistów</h1>
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
          <button className="btn-gen" onClick={() => generate()}>
            ⟳ Generuj plan
          </button>
          {Object.keys(manual).length > 0 && (
            <button className="btn-reset" onClick={resetManual} title="usuń ręczne korekty">
              Reset korekt
            </button>
          )}
          <label className="file-btn">
            Wczytaj rozkład…
            <input type="file" accept=".xlsx" onChange={onFile} hidden />
          </label>
        </div>
      </header>

      {error && <div className="error">⚠ {error}</div>}

      <div className="layout">
        <main className="grid-area">
          <div className="summary">
            <strong>{obiegi.length}</strong> obiegów&nbsp;·&nbsp;
            <span className="ok">{planned} obsadzonych</span>
            {unassigned > 0 && <span className="bad">&nbsp;·&nbsp;{unassigned} BRAK</span>}
          </div>
          <div className="obiegi-grid">
            {obiegi.map((o) => (
              <ObiegCard
                key={o.id}
                obieg={o}
                assignment={assignments[o.id]}
                reserves={reserves}
                onAssignmentChange={onAssignmentChange}
              />
            ))}
          </div>
        </main>

        <aside className="sidebar">
          <ReservePanel reserves={reserves} onChange={setReserves} load={load} count={count} />
        </aside>
      </div>
    </div>
  );
}
