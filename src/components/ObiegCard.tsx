import { useState } from "react";
import { HHMMSS } from "../lib/types";
import type { Obieg, StationEvent, BreakAssignment, Reserve, BreakKind } from "../lib/types";
import { BreakEditor } from "./BreakEditor";
import { feasibleSlots } from "../lib/engine";

const NOON = 12 * 3600;

/** Wjazd na linię (popołudniu): pierwsze zdarzenie po przerwie >60 min, inaczej pierwsze w ogóle. */
function afternoonEntry(events: StationEvent[]): StationEvent {
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].t - events[i - 1].t;
    if (gap > 60 * 60 && events[i].t >= NOON) return events[i];
  }
  return events[0];
}

const KIND_SHORT: Record<string, string> = { "cała": "CAŁA", "połówka": "POŁ", "szczeniak": "SZCZ" };
const DIR_ARROW: Record<string, string> = { Kabaty: "↓ Kabaty", Młociny: "↑ Młociny" };

// okno wizualizacji pozycji przerwy: 14:00–20:00
const WIN_FROM = 14 * 3600;
const WIN_TO = 20 * 3600;
const whenPct = (t: number) => Math.max(0, Math.min(100, ((t - WIN_FROM) / (WIN_TO - WIN_FROM)) * 100));
const whenLabel = (p: number) => (p < 33 ? "wcześnie" : p < 66 ? "w połowie" : "późno");

interface Props {
  obieg: Obieg;
  breaks: BreakAssignment[];
  reserves: Reserve[];
  onBreaksChange: (breaks: BreakAssignment[]) => void;
  trainNo?: string;
  onTrainChange?: (v: string) => void;
  forceKind?: BreakKind;
  onCycleKind?: () => void;
}

export function ObiegCard({ obieg, breaks, reserves, onBreaksChange, trainNo, onTrainChange, forceKind, onCycleKind }: Props) {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const entry = afternoonEntry(obieg.events);
  const exit = obieg.events[obieg.events.length - 1];
  const isFull = obieg.type === "full";

  const sorted = [...breaks].sort((a, b) => a.startT - b.startT);
  const loopClass = obieg.loops <= 8 ? "loops-few" : obieg.loops <= 11 ? "loops-mid" : "loops-many";

  const updateBreak = (i: number, a: BreakAssignment) => {
    const next = sorted.slice();
    next[i] = a;
    onBreaksChange(next);
  };
  const removeBreak = (i: number) => {
    onBreaksChange(sorted.filter((_, k) => k !== i));
    setEditIdx(null);
  };
  const addBreak = () => {
    const s = feasibleSlots(obieg)[0];
    if (!s) return;
    const nb: BreakAssignment = {
      obiegId: obieg.id, station: s.station, dir: s.dir, startT: s.startT,
      kind: s.kind, durationMin: s.durationMin, reserveId: null, manual: true,
    };
    onBreaksChange([...sorted, nb]);
    setEditIdx(sorted.length);
  };

  return (
    <div className={`obieg-card type-${obieg.type} ${loopClass}`}>
      <div className="oc-head">
        <div className="oc-id-row">
          <span className="oc-id">{obieg.id}</span>
          <input
            className="oc-train"
            value={trainNo ?? ""}
            placeholder="poc."
            onChange={(e) => onTrainChange?.(e.target.value)}
            title="numer pociągu / składu"
          />
          <button
            className={`oc-half k-${forceKind ?? "auto"}`}
            onClick={(e) => {
              e.stopPropagation();
              onCycleKind?.();
            }}
            title="wymuś rodzaj: auto → połówka → cała"
          >
            {forceKind === "połówka" ? "½" : forceKind === "cała" ? "C" : "·"}
          </button>
        </div>
        <span className="oc-entry">
          {isFull ? <em>całodobowy</em> : <>{HHMMSS(entry.t)} <em>{entry.station}</em></>}
          <span className="oc-loops" title={`${obieg.loops} kół (okrążeń) w ciągu dnia`}>🔁{obieg.loops}</span>
        </span>
      </div>

      <div className="oc-breaks">
        {sorted.length === 0 && <span className="oc-placeholder">— brak —</span>}
        {sorted.map((a, i) => {
          const reserve = a.reserveId ? reserves.find((r) => r.id === a.reserveId) : null;
          const brak = !a.reserveId;
          return (
            <div
              key={i}
              className={`oc-brk kind-${a.kind}${brak ? " is-brak" : ""}${editIdx === i ? " open" : ""}`}
              onClick={() => setEditIdx(editIdx === i ? null : i)}
              title="kliknij, aby edytować"
            >
              <div className="oc-brk-top">
                <span className={`oc-kind kind-${a.kind}`}>{KIND_SHORT[a.kind]}</span>
                <span className="oc-time">{HHMMSS(a.startT)}</span>
                <span className="oc-stat">{a.station} {DIR_ARROW[a.dir]}</span>
              </div>
              <span className="oc-res">
                {reserve ? reserve.name : "⚠ BRAK"}
                {a.manual && <i className="oc-manual" title="ręcznie">✎</i>}
              </span>
              <div className="oc-when" title={`${whenLabel(whenPct(a.startT))} (${HHMMSS(a.startT)})`}>
                <span className="when-dot" style={{ left: `${whenPct(a.startT)}%` }} />
              </div>
            </div>
          );
        })}
        <button className="oc-add" onClick={addBreak} title="dodaj kolejną przerwę">+ przerwa</button>
      </div>

      {editIdx !== null && sorted[editIdx] && (
        <BreakEditor
          obieg={obieg}
          assignment={sorted[editIdx]}
          reserves={reserves}
          onChange={(a) => updateBreak(editIdx, a)}
          onClose={() => setEditIdx(null)}
          onRemove={() => removeBreak(editIdx)}
        />
      )}

      <div className="oc-foot">
        {obieg.cleaning ? (
          <span className="oc-clean">🧹 sprzątanie {exit.station} {HHMMSS(exit.t)}</span>
        ) : (
          <span className="oc-exit">zjazd na STP {HHMMSS(exit.t)}</span>
        )}
      </div>
    </div>
  );
}
