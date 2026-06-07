import { useMemo } from "react";
import { feasibleSlots } from "../lib/engine";
import { HHMMSS, hmToSec } from "../lib/types";
import type { Obieg, BreakAssignment, Reserve } from "../lib/types";

interface Props {
  obieg: Obieg;
  assignment?: BreakAssignment;
  reserves: Reserve[];
  /** wszystkie przerwy wg rezerwowego — do wykrywania konfliktów czasowych */
  byReserve: Record<string, BreakAssignment[]>;
  /** efektywny próg „nie wcześniej niż" dla tego obiegu */
  earliest: number;
  /** override progu per-obieg (undefined = globalny) */
  earliestOverride?: number;
  onEarliestChange?: (sec?: number) => void;
  onChange: (a: BreakAssignment) => void;
  onClose: () => void;
  onRemove?: () => void;
}

export function BreakEditor({ obieg, assignment, reserves, byReserve, earliest, earliestOverride, onEarliestChange, onChange, onClose, onRemove }: Props) {
  const slots = useMemo(() => feasibleSlots(obieg, { earliest }), [obieg, earliest]);
  // rezerwowy tylko z tej samej stacji co przerwa (rezerwowy podmienia tam, gdzie stoi)
  const stationReserves = assignment ? reserves.filter((r) => r.station === assignment.station) : [];

  const currentSlotKey = assignment
    ? `${assignment.startT}|${assignment.station}|${assignment.kind}`
    : "";

  // Konflikt: rezerwowy zajęty INNĄ przerwą nakładającą się czasowo na [startT, startT+dur).
  // Wyklucza bieżącą przerwę (ten sam obieg + ten sam start). 1 maszynista = 1 pociąg naraz.
  const conflictAt = (rid: string, startT: number, durMin: number): BreakAssignment | null => {
    const end = startT + durMin * 60;
    for (const b of byReserve[rid] ?? []) {
      if (b.obiegId === obieg.id && b.startT === (assignment?.startT ?? -1)) continue;
      if (startT < b.startT + b.durationMin * 60 && b.startT < end) return b;
    }
    return null;
  };

  const pickSlot = (key: string) => {
    const s = slots.find((x) => `${x.startT}|${x.station}|${x.kind}` === key);
    if (!s) return;
    // przy zmianie czasu rezerwowy zostaje tylko, jeśli nadal wolny w nowym slocie; inaczej → BRAK
    const keepRes =
      assignment?.reserveId && !conflictAt(assignment.reserveId, s.startT, s.durationMin)
        ? assignment.reserveId
        : null;
    onChange({
      obiegId: obieg.id,
      station: s.station,
      dir: s.dir,
      startT: s.startT,
      kind: s.kind,
      durationMin: s.durationMin,
      reserveId: keepRes,
      manual: true,
    });
  };

  const pickReserve = (rid: string) => {
    if (!assignment) return;
    // blokada: nie pozwól przypisać rezerwowego zajętego w tym czasie (nie podmienia 2 pociągów naraz)
    if (rid && conflictAt(rid, assignment.startT, assignment.durationMin)) return;
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
        Rezerwowy (stacja {assignment?.station})
        <select
          value={assignment?.reserveId ?? ""}
          onChange={(e) => pickReserve(e.target.value)}
          disabled={!assignment}
        >
          <option value="">— BRAK —</option>
          {stationReserves.map((r) => {
            const c = assignment ? conflictAt(r.id, assignment.startT, assignment.durationMin) : null;
            const isCurrent = r.id === assignment?.reserveId;
            return (
              <option key={r.id} value={r.id} disabled={!!c && !isCurrent}>
                {r.name}
                {c ? ` — zajęty ${HHMMSS(c.startT)}–${HHMMSS(c.startT + c.durationMin * 60)} (${c.obiegId})` : ""}
              </option>
            );
          })}
        </select>
      </label>

      {assignment && stationReserves.length === 0 && (
        <p className="be-hint be-warn">
          ⚠ Brak rezerwowych na stacji {assignment.station} — dodaj ich w panelu po prawej.
        </p>
      )}
      {assignment &&
        stationReserves.length > 0 &&
        stationReserves.every(
          (r) => r.id !== assignment.reserveId && conflictAt(r.id, assignment.startT, assignment.durationMin)
        ) && (
          <p className="be-hint be-warn">
            ⚠ Wszyscy rezerwowi na {assignment.station} są zajęci o {HHMMSS(assignment.startT)} — zmień godzinę slotu
            albo dodaj rezerwowego na tej stacji.
          </p>
        )}

      {onEarliestChange && (
        <label>
          Najwcześniej (ten obieg)
          <span className="be-early">
            <input
              type="time"
              value={earliestOverride != null ? HHMMSS(earliestOverride) : ""}
              onChange={(e) => onEarliestChange(hmToSec(e.target.value))}
            />
            {earliestOverride != null && (
              <button
                type="button"
                className="be-early-clear"
                onClick={() => onEarliestChange(undefined)}
                title="wróć do progu globalnego"
              >
                ×
              </button>
            )}
          </span>
        </label>
      )}

      <div className="be-actions">
        {onRemove && (
          <button className="be-remove" onClick={onRemove}>
            Usuń przerwę
          </button>
        )}
        <button className="be-close" onClick={onClose}>
          Zamknij
        </button>
      </div>
    </div>
  );
}
