import { useState } from "react";
import { BREAK_STATIONS, MAX_RESERVE_LOAD_MIN, driverFullName, HHMMSS } from "../lib/types";
import type { Reserve, BreakStation, Driver, BreakAssignment } from "../lib/types";

// piktogram długości przerwy
const KIND_GLYPH: Record<string, string> = { "cała": "●", "połówka": "◐", "szczeniak": "○" };

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
  byReserve?: Record<string, BreakAssignment[]>;
  obiegIds?: string[];
}

const newId = () =>
  (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
  `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

export function ReservePanel({ reserves, onChange, drivers, load, count, byReserve, obiegIds }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [warn, setWarn] = useState("");
  const [openCfg, setOpenCfg] = useState<string | null>(null);

  const update = (id: string, patch: Partial<Reserve>) =>
    onChange(reserves.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // maszyniści już przypisani jako rezerwowi (nie można drugi raz)
  const usedIds = new Set(reserves.map((r) => r.driverId).filter(Boolean) as string[]);
  const usedNames = new Set(reserves.map((r) => r.name.toLowerCase()));
  const available = drivers.filter(
    (d) => !usedIds.has(d.id) && !usedNames.has(driverFullName(d).toLowerCase())
  );

  const add = (station: BreakStation) => {
    const typed = (drafts[station] ?? "").trim();
    if (!typed) return;
    const driver = drivers.find((d) => driverFullName(d).toLowerCase() === typed.toLowerCase());
    const name = driver ? driverFullName(driver) : typed;
    const dup = driver ? usedIds.has(driver.id) || usedNames.has(name.toLowerCase()) : usedNames.has(name.toLowerCase());
    if (dup) {
      setWarn(`${name} jest już rezerwowy — nie można dodać drugi raz`);
      return;
    }
    onChange([...reserves, { id: newId(), name, station, driverId: driver?.id }]);
    setDrafts((d) => ({ ...d, [station]: "" }));
    setWarn("");
  };
  const remove = (id: string) => onChange(reserves.filter((r) => r.id !== id));

  return (
    <div className="reserve-panel">
      <datalist id="pm-roster">
        {available.map((d) => (
          <option key={d.id} value={driverFullName(d)} />
        ))}
      </datalist>

      <h2>Rezerwowi na stacjach</h2>
      {warn && <div className="rp-warn">⚠ {warn}</div>}
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
                const jobs = byReserve?.[r.id] ?? [];
                const cfgOpen = openCfg === r.id;
                return (
                  <li key={r.id} className={`${full ? "rp-full" : ""}${r.blocked ? " rp-blocked" : ""}`}>
                    <div className="rp-row1">
                      <span className="rp-nm">
                        {r.name}
                        {r.blocked && <i className="rp-badge rp-b-block" title="wykluczony">⊘</i>}
                        {(r.pins?.length ?? 0) > 0 && (
                          <i className="rp-badge rp-b-pin" title={`obiegi: ${r.pins!.join(", ")}`}>📌{r.pins!.length}</i>
                        )}
                        {r.maxJobs != null && <i className="rp-badge" title="limit podmian">≤{r.maxJobs}</i>}
                      </span>
                      <span className="rp-load" title="podmiany · minuty">
                        {c}× · {min}′
                      </span>
                      <button
                        className={`rp-cfg${cfgOpen ? " on" : ""}`}
                        onClick={() => setOpenCfg(cfgOpen ? null : r.id)}
                        title="ustawienia"
                      >
                        ⚙
                      </button>
                      <button className="rp-x" onClick={() => remove(r.id)} title="usuń">
                        ×
                      </button>
                    </div>

                    {jobs.length > 0 && (
                      <div className="rp-jobs">
                        {jobs.map((a) => (
                          <span
                            key={a.obiegId}
                            className={`rp-job kind-${a.kind}`}
                            title={`${a.kind} ${a.durationMin}′ o ${HHMMSS(a.startT)} (${a.station})`}
                          >
                            <i className="rp-job-g">{KIND_GLYPH[a.kind]}</i>
                            {a.obiegId}
                          </span>
                        ))}
                      </div>
                    )}

                    {cfgOpen && (
                      <div className="rp-cfg-box">
                        <label className="rp-cfg-row">
                          <input
                            type="checkbox"
                            checked={!!r.blocked}
                            onChange={(e) => update(r.id, { blocked: e.target.checked })}
                          />
                          Wyklucz z podmian
                        </label>
                        <label className="rp-cfg-row">
                          Max podmian
                          <input
                            type="number"
                            min={0}
                            value={r.maxJobs ?? ""}
                            placeholder="bez limitu"
                            onChange={(e) =>
                              update(r.id, {
                                maxJobs: e.target.value === "" ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0),
                              })
                            }
                          />
                        </label>
                        <label className="rp-cfg-row">
                          Obiegi do podmiany
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) update(r.id, { pins: [...(r.pins ?? []), e.target.value] });
                            }}
                          >
                            <option value="">+ dodaj…</option>
                            {(obiegIds ?? [])
                              .filter((id) => !(r.pins ?? []).includes(id))
                              .map((id) => (
                                <option key={id} value={id}>
                                  {id}
                                </option>
                              ))}
                          </select>
                        </label>
                        {(r.pins?.length ?? 0) > 0 && (
                          <div className="rp-pin-chips">
                            {r.pins!.map((id) => (
                              <span key={id} className="rp-pinchip">
                                📌{id}
                                <button
                                  onClick={() => update(r.id, { pins: (r.pins ?? []).filter((x) => x !== id) })}
                                  title="usuń"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
