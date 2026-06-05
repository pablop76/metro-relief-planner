import { useState } from "react";
import { HHMMSS } from "../lib/types";
import type { Obieg, StationEvent, BreakAssignment, Reserve } from "../lib/types";
import { BreakEditor } from "./BreakEditor";

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
  assignment?: BreakAssignment;
  reserves: Reserve[];
  onAssignmentChange: (a: BreakAssignment) => void;
  trainNo?: string;
  onTrainChange?: (v: string) => void;
  cleaning?: boolean;
  onCleaningToggle?: () => void;
}

export function ObiegCard({ obieg, assignment, reserves, onAssignmentChange, trainNo, onTrainChange, cleaning, onCleaningToggle }: Props) {
  const [open, setOpen] = useState(false);
  const entry = afternoonEntry(obieg.events);
  const exit = obieg.events[obieg.events.length - 1];
  const isFull = obieg.type === "full";
  const reserve = assignment?.reserveId ? reserves.find((r) => r.id === assignment.reserveId) : null;
  const brak = assignment && !assignment.reserveId;

  return (
    <div className={`obieg-card type-${obieg.type}`}>
      <div className="oc-head">
        <div className="oc-id-row">
          <span className="oc-id">{obieg.id}</span>
          <input
            className="oc-train"
            value={trainNo ?? ""}
            placeholder="poc."
            onChange={(e) => onTrainChange?.(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            title="numer pociągu / składu"
          />
        </div>
        <span className="oc-entry">
          {isFull ? (
            <em>całodobowy</em>
          ) : (
            <>
              {HHMMSS(entry.t)} <em>{entry.station}</em>
            </>
          )}
        </span>
      </div>

      <div
        className={`oc-body${assignment ? ` kind-${assignment.kind}` : ""}${brak ? " is-brak" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="kliknij, aby edytować"
      >
        {assignment ? (
          <>
            <span className={`oc-kind kind-${assignment.kind}`}>{KIND_SHORT[assignment.kind]}</span>
            <span className="oc-time">{HHMMSS(assignment.startT)}</span>
            <span className="oc-stat">
              {assignment.station} · {DIR_ARROW[assignment.dir]}
            </span>
            <span className="oc-res">
              {reserve ? reserve.name : "⚠ BRAK"}
              {assignment.manual && <i className="oc-manual" title="ręcznie">✎</i>}
            </span>
            <div
              className="oc-when"
              title={`${whenLabel(whenPct(assignment.startT))} (${HHMMSS(assignment.startT)})`}
            >
              <span className="when-dot" style={{ left: `${whenPct(assignment.startT)}%` }} />
            </div>
          </>
        ) : (
          <span className="oc-placeholder">— przerwa —</span>
        )}
      </div>

      {open && (
        <BreakEditor
          obieg={obieg}
          assignment={assignment}
          reserves={reserves}
          onChange={onAssignmentChange}
          onClose={() => setOpen(false)}
        />
      )}

      <div className="oc-foot">
        {cleaning ? (
          <span className="oc-clean">🧹 sprzątanie {exit.station}</span>
        ) : (
          <span className="oc-exit">zjazd na STP {HHMMSS(exit.t)}</span>
        )}
        <button
          className={`oc-broom${cleaning ? " on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onCleaningToggle?.();
          }}
          title="przełącz: zjazd na STP / sprzątanie"
        >
          🧹
        </button>
      </div>
    </div>
  );
}
