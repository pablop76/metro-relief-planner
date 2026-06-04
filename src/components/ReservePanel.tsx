import { useState } from "react";
import { BREAK_STATIONS, MAX_RESERVE_LOAD_MIN, driverFullName } from "../lib/types";
import type { Reserve, BreakStation, Driver } from "../lib/types";

const STATION_NAMES: Record<BreakStation, string> = {
  A1: "Kabaty",
  A7: "Wilanowska",
  A11: "Politechnika",
  A18: "Plac Wilsona",
  A23: "Młociny",
};

interface Props {
  reserves: Reserve[];
  onChange: (r: Reserve[]) => void;
  drivers: Driver[];
  load?: Record<string, number>;
  count?: Record<string, number>;
}

const newId = () =>
  (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
  `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

export function ReservePanel({ reserves, onChange, drivers, load, count }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const add = (station: BreakStation) => {
    const typed = (drafts[station] ?? "").trim();
    if (!typed) return;
    // dopasuj do maszynisty z listy (po pełnej nazwie)
    const driver = drivers.find((d) => driverFullName(d).toLowerCase() === typed.toLowerCase());
    onChange([
      ...reserves,
      { id: newId(), name: driver ? driverFullName(driver) : typed, station, driverId: driver?.id },
    ]);
    setDrafts((d) => ({ ...d, [station]: "" }));
  };
  const remove = (id: string) => onChange(reserves.filter((r) => r.id !== id));

  return (
    <div className="reserve-panel">
      <datalist id="pm-roster">
        {drivers.map((d) => (
          <option key={d.id} value={driverFullName(d)} />
        ))}
      </datalist>

      <h2>Rezerwowi na stacjach</h2>
      {BREAK_STATIONS.map((st) => {
        const here = reserves.filter((r) => r.station === st);
        return (
          <div key={st} className="rp-station">
            <div className="rp-station-head">
              <span className="rr-code">{st}</span>
              <span className="rr-name">{STATION_NAMES[st]}</span>
              <span className="rp-cnt">{here.length}</span>
            </div>
            <ul className="rp-names">
              {here.map((r) => {
                const min = load?.[r.id] ?? 0;
                const c = count?.[r.id] ?? 0;
                const full = min >= MAX_RESERVE_LOAD_MIN;
                return (
                  <li key={r.id} className={full ? "rp-full" : ""}>
                    <span className="rp-nm">{r.name}</span>
                    <span className="rp-load" title="podmiany · minuty">
                      {c}× · {min}′
                    </span>
                    <button className="rp-x" onClick={() => remove(r.id)} title="usuń">
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="rp-add">
              <input
                list="pm-roster"
                placeholder="+ wybierz maszynistę"
                value={drafts[st] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [st]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && add(st)}
              />
              <button onClick={() => add(st)}>Dodaj</button>
            </div>
          </div>
        );
      })}
      <div className="reserve-total">
        Razem: <strong>{reserves.length}</strong> rezerwowych
        {reserves.length > 15 && <span className="hint"> · Centrum (A13) dostępne</span>}
      </div>
    </div>
  );
}
