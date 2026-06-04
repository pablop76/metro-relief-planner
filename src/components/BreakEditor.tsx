import { useMemo } from "react";
import { feasibleSlots } from "../lib/engine";
import { HHMMSS } from "../lib/types";
import type { Obieg, BreakAssignment, Reserve } from "../lib/types";

interface Props {
  obieg: Obieg;
  assignment?: BreakAssignment;
  reserves: Reserve[];
  onChange: (a: BreakAssignment) => void;
  onClose: () => void;
}

export function BreakEditor({ obieg, assignment, reserves, onChange, onClose }: Props) {
  const slots = useMemo(() => feasibleSlots(obieg), [obieg]);

  const currentSlotKey = assignment
    ? `${assignment.startT}|${assignment.station}|${assignment.kind}`
    : "";

  const pickSlot = (key: string) => {
    const s = slots.find((x) => `${x.startT}|${x.station}|${x.kind}` === key);
    if (!s) return;
    onChange({
      obiegId: obieg.id,
      station: s.station,
      dir: s.dir,
      startT: s.startT,
      kind: s.kind,
      durationMin: s.durationMin,
      reserveId: assignment?.reserveId ?? null,
      manual: true,
    });
  };

  const pickReserve = (rid: string) => {
    if (!assignment) return;
    onChange({ ...assignment, reserveId: rid || null, manual: true });
  };

  return (
    <div className="break-editor" onClick={(e) => e.stopPropagation()}>
      <label>
        Slot przerwy
        <select value={currentSlotKey} onChange={(e) => pickSlot(e.target.value)}>
          {!assignment && <option value="">— wybierz —</option>}
          {slots.map((s) => {
            const key = `${s.startT}|${s.station}|${s.kind}`;
            return (
              <option key={key} value={key}>
                {HHMMSS(s.startT)} · {s.station} · {s.kind} → {s.dir}
              </option>
            );
          })}
        </select>
      </label>

      <label>
        Rezerwowy
        <select
          value={assignment?.reserveId ?? ""}
          onChange={(e) => pickReserve(e.target.value)}
          disabled={!assignment}
        >
          <option value="">— BRAK —</option>
          {reserves.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.station})
            </option>
          ))}
        </select>
      </label>

      <button className="be-close" onClick={onClose}>
        Zamknij
      </button>
    </div>
  );
}
