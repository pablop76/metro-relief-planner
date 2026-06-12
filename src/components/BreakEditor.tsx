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
  /** override progu per-obieg (undefined = globalny) */
  earliestOverride?: number;
  onEarliestChange?: (sec?: number) => void;
  /** ręczna godzina rozpoczęcia pracy maszynisty 2. zmiany (override; undefined = wykryty entry2nd) */
  driverStartOverride?: number;
  onDriverStartChange?: (sec?: number) => void;
  /** ręczny koniec pracy maszynisty 2. zmiany („pracuje do"; undefined = zjazd z rozkładu) */
  workEndOverride?: number;
  onWorkEndChange?: (sec?: number) => void;
  onChange: (a: BreakAssignment) => void;
  onClose: () => void;
  onRemove?: () => void;
}

export function BreakEditor({ obieg, assignment, reserves, byReserve, earliestOverride, onEarliestChange, driverStartOverride, onDriverStartChange, workEndOverride, onWorkEndChange, onChange, onClose, onRemove }: Props) {
  // RĘCZNY wybór: okno = godziny pracy maszynisty 2. zmiany [start (ręczny override ?? wykryty entry2nd), 22:00].
  // Bez progu „zacznij od". Decyzja użytkownika 2026-06-10.
  const driverStart = driverStartOverride ?? obieg.entry2nd;
  const slots = useMemo(
    () => feasibleSlots(obieg, { entry2ndByObieg: { [obieg.id]: driverStart } }, true),
    [obieg, driverStart]
  );
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
    // rezerwowy zostaje po zmianie slotu; ewentualny konflikt jest tylko sygnalizowany (nie blokuje)
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
    // dozwolone nawet gdy „zajęty" — łańcuch: kończy obieg 6 i bierze S34 jadące tuż za nim; tylko ostrzegamy
    onChange({ ...assignment, reserveId: rid || null, manual: true });
  };

  // konflikt aktualnie wybranego rezerwowego — do OSTRZEŻENIA, nie blokady
  const currentConflict =
    assignment?.reserveId ? conflictAt(assignment.reserveId, assignment.startT, assignment.durationMin) : null;

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
            return (
              <option key={r.id} value={r.id}>
                {r.name}
                {c ? ` — zajęty ${HHMMSS(c.startT)}–${HHMMSS(c.startT + c.durationMin * 60)} (${c.obiegId})` : ""}
              </option>
            );
          })}
        </select>
      </label>

      {assignment && (
        <label className="be-check" title="R20: zaznacz, gdy ta podmiana opiera się na złapaniu pociągu z przeciwnego toru (drugi peron) w ciasnym oknie — pokaże alert ⚠">
          <input
            type="checkbox"
            checked={!!assignment.crossTrack}
            onChange={(e) => onChange({ ...assignment, crossTrack: e.target.checked, manual: true })}
          />
          ⚠ Przeciwny tor — łapię pociąg z drugiego peronu (~5 min)
        </label>
      )}

      {assignment && stationReserves.length === 0 && (
        <p className="be-hint be-warn">
          ⚠ Brak rezerwowych na stacji {assignment.station} — dodaj ich w panelu po prawej.
        </p>
      )}
      {currentConflict && (
        <p className="be-hint be-warn">
          ⚠ Ten rezerwowy ma już przerwę {currentConflict.obiegId} {HHMMSS(currentConflict.startT)}–
          {HHMMSS(currentConflict.startT + currentConflict.durationMin * 60)} — upewnij się, że zdąży (łańcuch dozwolony,
          np. kolejny pociąg tuż za poprzednim).
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

      {onDriverStartChange && (
        <label title="Godzina rozpoczęcia pracy maszynisty 2. zmiany — pracuje od (np. 13:00/13:30, domyślnie ~14:00). Ustawienie PRZELICZA koła obiegu z rozkładu i jest dolną granicą przerw. Domyślnie wykryta z rozkładu.">
          Pracuje od (2. zmiana)
          <span className="be-early">
            <input
              type="time"
              value={HHMMSS(driverStart)}
              onChange={(e) => onDriverStartChange(hmToSec(e.target.value))}
            />
            {driverStartOverride != null && (
              <button
                type="button"
                className="be-early-clear"
                onClick={() => onDriverStartChange(undefined)}
                title="wróć do godziny wykrytej z rozkładu"
              >
                ×
              </button>
            )}
          </span>
        </label>
      )}

      {onWorkEndChange && (
        <label title="Koniec pracy maszynisty 2. zmiany — pracuje do (np. wcześniejszy zjazd / zmiennik). Ustawienie PRZELICZA koła obiegu z rozkładu w oknie od–do; silnik nie zaplanuje przerwy, z której pociąg wraca po tej godzinie. Godzina ≥ 21:00 = zmiennik na linii → całozmianowy. Domyślnie zjazd z rozkładu.">
          Pracuje do (2. zmiana)
          <span className="be-early">
            <input
              type="time"
              value={HHMMSS(workEndOverride ?? Math.min(obieg.lastT, 22 * 3600))}
              onChange={(e) => onWorkEndChange(hmToSec(e.target.value))}
            />
            {workEndOverride != null && (
              <button
                type="button"
                className="be-early-clear"
                onClick={() => onWorkEndChange(undefined)}
                title="wróć do zjazdu z rozkładu"
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
