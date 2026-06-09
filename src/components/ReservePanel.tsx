import { useState } from "react";
import { BREAK_STATIONS, reserveFull, TRAIN_TYPES, driverFullName, HHMMSS, hmToSec } from "../lib/types";
import type { Reserve, BreakStation, Driver, BreakAssignment, MetroLine, TrainType } from "../lib/types";
import { DURATION } from "../lib/stations";
import { sampleReserves, SAMPLE_DEFAULT } from "../lib/sampleReserves";

// piktogram długości przerwy
const KIND_GLYPH: Record<string, string> = { "cała": "●", "godzinka": "◕", "połówka": "◐", "szczeniak": "○" };
// R20: szybki przeskok na drugi peron (~5 min) — kolejna podmiana z przeciwnego toru
const XFER_TITLE = "⚠ szybki przeskok na drugi peron (~5 min) — kolejna podmiana z przeciwnego toru; w razie czego dogadaj się z pociągiem";

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
  loadEq?: Record<string, number>;
  count?: Record<string, number>;
  byReserve?: Record<string, BreakAssignment[]>;
  obiegIds?: string[];
  /** układ poziomy — stacje obok siebie (panel pod tabelą) zamiast pionowego sidebaru */
  horizontal?: boolean;
}

const newId = () =>
  (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
  `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

export function ReservePanel({ reserves, onChange, drivers, load, loadEq, count, byReserve, obiegIds, horizontal }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [warn, setWarn] = useState("");
  const [openCfg, setOpenCfg] = useState<string | null>(null);
  const [sampleCount, setSampleCount] = useState(SAMPLE_DEFAULT);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStation, setOverStation] = useState<BreakStation | null>(null);

  const update = (id: string, patch: Partial<Reserve>) =>
    onChange(reserves.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // opis autoryzacji generowany z zaznaczonych checkboxów taboru (kolejność jak TRAIN_TYPES)
  const autoAuthNote = (arr?: TrainType[]) =>
    TRAIN_TYPES.filter((t) => arr?.includes(t)).join(", ");

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

  // wczytaj N przykładowych rezerwowych do testów (pomija już obecnych — po id lub nazwie)
  const loadSamples = (count: number) => {
    const haveIds = new Set(reserves.map((r) => r.id));
    const haveNames = new Set(reserves.map((r) => r.name.toLowerCase()));
    const add = sampleReserves(count).filter((s) => !haveIds.has(s.id) && !haveNames.has(s.name.toLowerCase()));
    if (!add.length) {
      setWarn("Ci przykładowi rezerwowi są już wczytani");
      return;
    }
    onChange([...reserves, ...add]);
    setWarn("");
  };

  // usuń TYLKO przykładowych (demo-…), zostaw realnych rezerwowych
  const demoCount = reserves.filter((r) => r.id.startsWith("demo-")).length;
  const clearSamples = () => {
    onChange(reserves.filter((r) => !r.id.startsWith("demo-")));
    setConfirmClear(false);
    setWarn("");
  };

  // przeciągnięcie rezerwowego na inną stację (drag & drop między stacjami)
  const moveToStation = (station: BreakStation) => {
    const id = dragId;
    setDragId(null);
    setOverStation(null);
    if (!id) return;
    const r = reserves.find((x) => x.id === id);
    if (!r || r.station === station) return;
    // flaga „rezerwa ruchowa" dotyczy tylko Kabat (A1) — przy zejściu z A1 ją czyścimy
    update(id, { station, ...(station !== "A1" && r.rolling ? { rolling: undefined } : {}) });
  };

  return (
    <div className={`reserve-panel${horizontal ? " horizontal" : ""}`}>
      <datalist id="pm-roster">
        {available.map((d) => (
          <option key={d.id} value={driverFullName(d)} />
        ))}
      </datalist>

      <div className="rp-head">
        <h2>Rezerwowi na stacjach</h2>
        <div className="rp-sample-ctl">
          <input
            type="number"
            min={1}
            value={sampleCount}
            title="ilu przykładowych rezerwowych wczytać (bez limitu)"
            onChange={(e) =>
              setSampleCount(Math.max(1, parseInt(e.target.value, 10) || 1))
            }
          />
          <button
            className="rp-sample"
            onClick={() => loadSamples(sampleCount)}
            title={`wczytaj ${sampleCount} przykładowych rezerwowych (równomiernie po stacjach) do testów`}
          >
            🧪 Wczytaj
          </button>
          {demoCount > 0 && (
            <button
              className="rp-sample rp-clear"
              onClick={() => setConfirmClear(true)}
              title={`usuń ${demoCount} przykładowych rezerwowych (demo)`}
            >
              🧹 Usuń demo
            </button>
          )}
        </div>
      </div>

      {confirmClear && (
        <div className="modal-backdrop" onClick={() => setConfirmClear(false)}>
          <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Usunąć przykładowych?</h2>
              <button className="modal-x" onClick={() => setConfirmClear(false)}>
                ×
              </button>
            </div>
            <div className="confirm-body">
              <p>
                Usunąć <strong>{demoCount}</strong> przykładowych (demo) rezerwowych? Realni rezerwowi
                zostaną nietknięci.
              </p>
            </div>
            <div className="confirm-actions">
              <button className="btn-reset" onClick={() => setConfirmClear(false)}>
                Anuluj
              </button>
              <button className="btn-danger" onClick={clearSamples}>
                🧹 Usuń demo
              </button>
            </div>
          </div>
        </div>
      )}
      {warn && <div className="rp-warn">⚠ {warn}</div>}
      {BREAK_STATIONS.map((st) => {
        const here = reserves.filter((r) => r.station === st);
        return (
          <div
            key={st}
            className={`rp-station${dragId ? " drop-active" : ""}${overStation === st ? " drop-over" : ""}`}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              if (overStation !== st) setOverStation(st);
            }}
            onDrop={() => moveToStation(st)}
          >
            <div className="rp-station-head">
              <span className="rr-code">{st}</span>
              <span className="rr-name">{STATION_NAMES[st]}</span>
              <span className="rp-cnt">{here.length}</span>
            </div>
            <ul className="rp-names">
              {here.map((r) => {
                const min = load?.[r.id] ?? 0;
                const eq = loadEq?.[r.id] ?? 0;
                const c = count?.[r.id] ?? 0;
                const full = reserveFull(eq);
                const jobs = byReserve?.[r.id] ?? [];
                const cfgOpen = openCfg === r.id;
                return (
                  <li key={r.id} className={`${full ? "rp-full" : ""}${r.blocked ? " rp-blocked" : ""}${dragId === r.id ? " rp-dragging" : ""}`}>
                    <div
                      className="rp-row1"
                      draggable
                      onDragStart={() => setDragId(r.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStation(null);
                      }}
                    >
                      <i className="rp-drag" title="przeciągnij na inną stację">⠿</i>
                      <span className="rp-nm">
                        {r.name}
                        {r.blocked && <i className="rp-badge rp-b-block" title="wykluczony">⊘</i>}
                        {(r.pins?.length ?? 0) > 0 && (
                          <i className="rp-badge rp-b-pin" title={`obiegi: ${r.pins!.join(", ")}`}>📌{r.pins!.length}</i>
                        )}
                        {r.maxJobs != null && <i className="rp-badge" title="limit podmian">≤{r.maxJobs}</i>}
                        {r.rolling && <i className="rp-badge rp-b-roll" title="rezerwa ruchowa (A1) — domyślnie 1 koło (R17)">⟳1</i>}
                        {r.line && <i className="rp-badge" title="linia">{r.line}</i>}
                        {r.availTo != null && <i className="rp-badge" title="pracuje do">⏲{HHMMSS(r.availTo)}</i>}
                        {((r.auth?.length ?? 0) > 0 || r.authNote) && (
                          <i
                            className="rp-badge rp-b-auth"
                            title={`autoryzacje: ${(r.auth ?? []).join(", ") || "—"}${r.authNote ? " · " + r.authNote : ""}`}
                          >
                            🚆{r.auth?.length ? r.auth.length : ""}
                            {r.authNote ? ` ${r.authNote}` : ""}
                          </i>
                        )}
                      </span>
                      <span className="rp-load" title={`${c} podmian · ${min} min · limit 3 całe`}>
                        {c}× · {(Math.round(eq * 10) / 10).toString().replace(".", ",")}/3
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
                        {jobs.map((a) => {
                          const cross = !!a.crossTrack; // R20 — auto (kolejna podmiana z przeciwnego toru ≤5 min) lub ręcznie
                          return (
                            <span
                              key={`${a.obiegId}-${a.startT}`}
                              className={`rp-job kind-${a.kind}${cross ? " is-cross" : ""}`}
                              title={`${a.kind} ~${DURATION[a.kind]}′ (realnie ${a.durationMin}′) o ${HHMMSS(a.startT)} (${a.station})${cross ? "\n" + XFER_TITLE : ""}`}
                            >
                              <i className="rp-job-g">{KIND_GLYPH[a.kind]}</i>
                              {a.obiegId}
                              {cross && <i className="rp-job-xfer">⚠</i>}
                            </span>
                          );
                        })}
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
                          Wyklucz z podmian (standby)
                        </label>
                        <label className="rp-cfg-row">
                          <input
                            type="checkbox"
                            checked={!!r.manualOnly}
                            onChange={(e) => update(r.id, { manualOnly: e.target.checked })}
                          />
                          Tylko moje obiegi (bez auto)
                        </label>
                        {r.station === "A1" && (
                          <label className="rp-cfg-row" title="R17: ten jeden rezerwowy z Kabat zostaje pod ręką — domyślnie 1 koło (pole Max podmian nadpisuje)">
                            <input
                              type="checkbox"
                              checked={!!r.rolling}
                              onChange={(e) => update(r.id, { rolling: e.target.checked || undefined })}
                            />
                            Rezerwa ruchowa (A1 — limit 1 koło)
                          </label>
                        )}
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
                          Linia
                          <select
                            value={r.line ?? ""}
                            onChange={(e) =>
                              update(r.id, { line: (e.target.value || undefined) as MetroLine | undefined })
                            }
                          >
                            <option value="">—</option>
                            <option value="M1">M1</option>
                            <option value="M2">M2</option>
                          </select>
                        </label>
                        <label className="rp-cfg-row">
                          Pracuje od
                          <input
                            type="time"
                            value={r.availFrom != null ? HHMMSS(r.availFrom) : ""}
                            onChange={(e) => update(r.id, { availFrom: hmToSec(e.target.value) })}
                          />
                        </label>
                        <label className="rp-cfg-row">
                          Pracuje do
                          <input
                            type="time"
                            value={r.availTo != null ? HHMMSS(r.availTo) : ""}
                            onChange={(e) => update(r.id, { availTo: hmToSec(e.target.value) })}
                          />
                        </label>
                        <div className="rp-cfg-row rp-auth">
                          <span>Autoryzacje (tabor)</span>
                          <div className="rp-auth-list">
                            {TRAIN_TYPES.map((t) => (
                              <label key={t} className="rp-auth-chk">
                                <input
                                  type="checkbox"
                                  checked={r.auth?.includes(t) ?? false}
                                  onChange={(e) => {
                                    const cur = new Set<TrainType>(r.auth ?? []);
                                    if (e.target.checked) cur.add(t);
                                    else cur.delete(t);
                                    const next = cur.size ? TRAIN_TYPES.filter((x) => cur.has(x)) : undefined;
                                    // zachowaj ręczny opis; w przeciwnym razie wypełnij z zaznaczonych inputów
                                    const manual = r.authNote && r.authNote !== autoAuthNote(r.auth);
                                    update(r.id, {
                                      auth: next,
                                      authNote: manual ? r.authNote : autoAuthNote(next) || undefined,
                                    });
                                  }}
                                />
                                {t}
                              </label>
                            ))}
                          </div>
                        </div>
                        <label className="rp-cfg-row">
                          Opis autoryzacji
                          <input
                            type="text"
                            value={r.authNote ?? ""}
                            placeholder="np. tylko Inspiro/Škoda"
                            onChange={(e) => update(r.id, { authNote: e.target.value || undefined })}
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
