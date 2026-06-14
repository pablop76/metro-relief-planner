// Szybki test: czy plan REAGUJE na forcedKinds (S31=cała) i xferBufferMin. npx tsx tools/react_check.ts
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseObiegi, THIRD_SHIFT_RELIEF } from "../src/lib/rozklad.ts";
import { planBreaks } from "../src/lib/engine.ts";
import type { Reserve, BreakStation } from "../src/lib/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wb = XLSX.read(readFileSync(resolve(__dirname, "../data/RJ_M1_A1_od_13_05_2026.xlsx")), { type: "buffer" });
const obiegi = parseObiegi(wb, "powszedni");
const R = (id: string, station: BreakStation): Reserve => ({ id, name: id, station });
const reserves: Reserve[] = [
  R("Kopyt", "A1"), R("Żeńca", "A1"), R("Gnas", "A1"), R("Jówko", "A7"),
  R("Kornaszewski", "A11"), R("Łada", "A11"), R("Szczepanik", "A11"), R("Kępa", "A11"), R("Mańkowski", "A11"),
  R("Miros", "A18"), R("Bogucki", "A18"), R("H.Galicki", "A23"),
];
const OPTS = { earliest: 14 * 3600 + 30 * 60 };
const sig = (p: ReturnType<typeof planBreaks>) => Object.entries(p.assignments)
  .flatMap(([id, l]) => l.map((a) => `${id}:${a.kind}@${a.station}:${a.startT}:${a.reserveId ?? "-"}`)).sort().join("|");
const s31 = (p: ReturnType<typeof planBreaks>) =>
  (p.assignments["S31"] ?? []).map((a) => `${a.kind}@${a.station} ${a.reserveId}`).join(" | ");

// 1. baza vs wymuszenie S31
const base = planBreaks(obiegi, reserves, OPTS);
const fCala = planBreaks(obiegi, reserves, { ...OPTS, forcedKinds: { S31: "cała" } });
const fPol = planBreaks(obiegi, reserves, { ...OPTS, forcedKinds: { S31: "połówka" } });
console.log("S31 baza:        ", s31(base));
console.log("S31 forced cała: ", s31(fCala), sig(base) === sig(fCala) ? "(plan IDENTYCZNY)" : "(plan ZMIENIONY)");
console.log("S31 forced poł.: ", s31(fPol), sig(base) === sig(fPol) ? "(plan IDENTYCZNY)" : "(plan ZMIENIONY)");

// 2. deficyt (− 1 rezerwowy A11) — tu S31 powinna być cięta jako najmniej-kołowa
const deficit = reserves.filter((r) => r.id !== "Mańkowski");
const dBase = planBreaks(obiegi, deficit, OPTS);
const dCala = planBreaks(obiegi, deficit, { ...OPTS, forcedKinds: { S31: "cała" } });
console.log("\nDEFICYT (11 rez) S31 baza:   ", s31(dBase));
console.log("DEFICYT S31 forced cała:     ", s31(dCala), sig(dBase) === sig(dCala) ? "(plan IDENTYCZNY)" : "(plan ZMIENIONY)");

// 3. xferBufferMin 5 vs 30 (baza i nadwyżka)
for (const [label, rv] of [["baza 12", reserves], ["nadwyżka 14", [...reserves, R("A1-E", "A1"), R("A11-E", "A11")]]] as const) {
  const p5 = planBreaks(obiegi, rv as Reserve[], { ...OPTS, xferBufferMin: 5 });
  const p30 = planBreaks(obiegi, rv as Reserve[], { ...OPTS, xferBufferMin: 30 });
  console.log(`\nxfer 5 vs 30 (${label}): ${sig(p5) === sig(p30) ? "plan IDENTYCZNY" : "plan ZMIENIONY"}`);
}

// 4. seed (warianty „Generuj plan")
const v1 = planBreaks(obiegi, reserves, { ...OPTS, seed: 1 });
const v2 = planBreaks(obiegi, reserves, { ...OPTS, seed: 2 });
console.log(`\nseed 1 vs 2 (baza): ${sig(v1) === sig(v2) ? "IDENTYCZNY (brak wariantów!)" : "RÓŻNE warianty"}`);

// 4b. MAKS. OBCIĄŻENIE przy indywidualnych limitach (skarga 2026-06-12: „12 rezerwowych, jeden na
// Kabatach może zrobić tylko jedną podmianę → reszta nie ma pełnego obciążenia")
const loadOf = (p: ReturnType<typeof planBreaks>) => {
  const eq: Record<string, number> = {};
  for (const list of Object.values(p.assignments))
    for (const a of list) if (a.reserveId) eq[a.reserveId] = (eq[a.reserveId] ?? 0) + (a.kind === "cała" ? 1 : a.kind === "połówka" ? 0.5 : a.kind === "godzinka" ? 2 / 3 : 1 / 3);
  return eq;
};
const limScenarios: Array<[string, Reserve[]]> = [
  ["A1 Żeńca maxJobs=1", reserves.map((r) => (r.id === "Żeńca" ? { ...r, maxJobs: 1 } : { ...r }))],
  ["A1 Żeńca rolling",   reserves.map((r) => (r.id === "Żeńca" ? { ...r, rolling: true } : { ...r }))],
  ["A11 Kępa maxJobs=2", reserves.map((r) => (r.id === "Kępa" ? { ...r, maxJobs: 2 } : { ...r }))],
  ["13 rez, A1-E maxJobs=1", [...reserves.map((r) => ({ ...r })), { id: "A1-E", name: "A1-E", station: "A1" as const, maxJobs: 1 }]],
];
console.log("\n=== LIMITY INDYWIDUALNE — maks. obciążenie reszty ===");
for (const [label, rv] of limScenarios) {
  const p = planBreaks(obiegi, rv, OPTS);
  const eq = loadOf(p);
  const brak = obiegi.filter((o) => !(p.assignments[o.id] ?? []).some((a) => a.reserveId)).length;
  const rows = rv.map((r) => {
    const cap = r.rolling ? 1 : Math.min(3, r.maxJobs ?? 3);
    const e = eq[r.id] ?? 0;
    return { r, e, cap, under: e < cap - 1e-6 && !r.rolling };
  });
  const under = rows.filter((x) => x.under);
  console.log(`— ${label}: BRAK ${brak} · niedociążeni: ${under.length}` +
    `${under.length ? " [" + under.map((x) => `${x.r.station}:${x.r.id}=${x.e.toFixed(2)}/${x.cap}`).join(" ") + "]" : " ✓ wszyscy do limitu"}`);
}

// 4c. SWEEP — różne liczby rezerwowych i limity: maks. obsadzenie + SPRAWIEDLIWOŚĆ
// Reguły sprawdzane: (1) gdy moc ≤ zapotrzebowanie (36), KAŻDY rezerwowy bez własnego limitu = 3,0;
// (2) nikt nie siedzi na samej połówce (0,5), gdy inny obieg dostał 1,5 (najpierw wszyscy do pełnej);
// (3) BRAK tylko przy realnym niedoborze.
const pool = (spec: Partial<Record<BreakStation, number>>, mods: Array<[string, Partial<Reserve>]> = []): Reserve[] => {
  const out: Reserve[] = [];
  for (const [st, n] of Object.entries(spec) as Array<[BreakStation, number]>)
    for (let i = 1; i <= n; i++) out.push(R(`${st}-${i}`, st));
  for (const [id, m] of mods) { const r = out.find((x) => x.id === id); if (r) Object.assign(r, m); }
  return out;
};
const sweeps: Array<[string, Reserve[]]> = [
  ["8  (2/1/3/1/1)", pool({ A1: 2, A7: 1, A11: 3, A18: 1, A23: 1 })],
  ["9  (2/1/4/1/1)", pool({ A1: 2, A7: 1, A11: 4, A18: 1, A23: 1 })],
  ["9  (1/1/5/1/1)", pool({ A1: 1, A7: 1, A11: 5, A18: 1, A23: 1 })],
  ["9  (2/1/5/1/0)", pool({ A1: 2, A7: 1, A11: 5, A18: 1 })],
  ["9  (2/2/3/1/1)", pool({ A1: 2, A7: 2, A11: 3, A18: 1, A23: 1 })],
  ["9  (3/1/3/1/1)", pool({ A1: 3, A7: 1, A11: 3, A18: 1, A23: 1 })],
  ["9  (1/1/4/2/1)", pool({ A1: 1, A7: 1, A11: 4, A18: 2, A23: 1 })],
  ["10 (3/1/4/1/1)", pool({ A1: 3, A7: 1, A11: 4, A18: 1, A23: 1 })],
  ["10 (2/1/5/1/1)", pool({ A1: 2, A7: 1, A11: 5, A18: 1, A23: 1 })],
  ["11 (3/1/4/2/1)", pool({ A1: 3, A7: 1, A11: 4, A18: 2, A23: 1 })],
  ["11 (2/1/5/2/1)", pool({ A1: 2, A7: 1, A11: 5, A18: 2, A23: 1 })],
  ["12 (3/1/5/2/1)", pool({ A1: 3, A7: 1, A11: 5, A18: 2, A23: 1 })],
  ["12 + maxJobs=1 na A1", pool({ A1: 3, A7: 1, A11: 5, A18: 2, A23: 1 }, [["A1-1", { maxJobs: 1 }]])],
  ["12 + maxJobs=2 na A11", pool({ A1: 3, A7: 1, A11: 5, A18: 2, A23: 1 }, [["A11-3", { maxJobs: 2 }]])],
  ["13 (3/2/5/2/1)", pool({ A1: 3, A7: 2, A11: 5, A18: 2, A23: 1 })],
  ["14 (4/2/5/2/1)", pool({ A1: 4, A7: 2, A11: 5, A18: 2, A23: 1 })],
  ["14 + 2×maxJobs (A1=1, A11=2)", pool({ A1: 4, A7: 2, A11: 5, A18: 2, A23: 1 }, [["A1-2", { maxJobs: 1 }], ["A11-5", { maxJobs: 2 }]])],
  ["16 (4/2/6/3/1)", pool({ A1: 4, A7: 2, A11: 6, A18: 3, A23: 1 })],
];
console.log("\n=== SWEEP liczebności rezerwy (moc vs 36 obiegów) ===");
for (const [label, rv] of sweeps) {
  const cap = rv.reduce((s, r) => s + (r.rolling ? 0 : Math.min(3, r.maxJobs ?? 3)), 0);
  const p = planBreaks(obiegi, rv, OPTS);
  const eq = loadOf(p);
  const brak = obiegi.filter((o) => !(p.assignments[o.id] ?? []).some((a) => a.reserveId)).length;
  const under = rv.filter((r) => !r.rolling && r.maxJobs == null && (eq[r.id] ?? 0) < 3 - 1e-6);
  // SPRAWIEDLIWOŚĆ wg reguł: ofiary cięcia (eq<1) muszą być NAJMNIEJ kołowe — złamanie = obieg na 0,5,
  // gdy obieg o MNIEJSZEJ liczbie kół trzyma ≥1,0; plus żaden wysokokołowy (≥4,5) na <1,0.
  // (1,5 dla najbardziej kołowych przy szczytach na 0,5 jest ZGODNE z drabiną „od najwięcej kół".)
  const oEq = (o: (typeof obiegi)[number]) =>
    (p.assignments[o.id] ?? []).filter((a) => a.reserveId).reduce((s, a) => s + (a.kind === "cała" ? 1 : a.kind === "połówka" ? 0.5 : a.kind === "godzinka" ? 2 / 3 : 1 / 3), 0);
  const lk = (o: (typeof obiegi)[number]) => (Number.isFinite(o.loops) ? o.loops : 1e9);
  const stuckHalf = obiegi.filter((o) => { const e = oEq(o); return e > 0 && e < 1 - 1e-6; });
  const brakList = obiegi.filter((o) => oEq(o) === 0);
  const orderViol = stuckHalf.filter((x) => obiegi.some((z) => oEq(z) >= 1 - 1e-6 && lk(z) < lk(x) - 0.05));
  // BRAK na wyżej-kołowym, gdy NIŻEJ-kołowy ma jakąkolwiek przerwę = najcięższe złamanie (skarga: D19 BRAK)
  const brakViol = brakList.filter((x) => obiegi.some((z) => oEq(z) > 0 && lk(z) < lk(x) - 0.05));
  const bigViol = stuckHalf.filter((x) => Number.isFinite(x.loops) && x.loops >= 4.5);
  const viol = [...new Set([...orderViol, ...bigViol])];
  const fair = brakViol.length
    ? `✗✗ BRAK NA WYSOKOKOŁOWYM [${brakViol.map((o) => `${o.id}(${Number.isFinite(o.loops) ? o.loops.toFixed(1) : "∞"})`).join(",")} bez przerwy przy obsadzonych niżej-kołowych]`
    : viol.length
    ? `✗ ZŁY PORZĄDEK CIĘCIA [${viol.map((o) => `${o.id}(${o.loops.toFixed(1)})`).join(",")} na 0,5 przy pełnych niżej-kołowych]`
    : `✓${stuckHalf.length ? ` (ofiary bilansu: ${stuckHalf.map((o) => o.id).join(",")})` : ""}`;
  const full = brak > 0
    ? "(BRAK — dodać rezerwowych; wolna moc nie pasuje do okien)"
    : cap <= 36 ? (under.length ? `✗ niedociążeni: ${under.map((r) => `${r.id}=${(eq[r.id] ?? 0).toFixed(2)}`).join(" ")}` : "✓ wszyscy 3,0") : "(nadwyżka)";
  console.log(`— ${label.padEnd(30)} moc=${cap} · BRAK ${brak} · pełne obciążenie: ${full} · sprawiedliwość: ${fair}`);
}

// 4d. SERIALIZACJA (fix 2026-06-13): jeden rezerwowy = jeden pociąg naraz. Plan NIGDY nie może dać
// rezerwowemu dwóch NAKŁADAJĄCYCH się podmian (15:49+16:03 = fizycznie niewykonalne). Sprawdzamy wszystkie
// rostery sweep × peaks on/off × locked (ręczne przypięcie A11) — zarówno czysty auto, jak i z lockedAssignments.
const overlaps = (p: ReturnType<typeof planBreaks>): string[] => {
  const byRes: Record<string, { s: number; e: number; o: string }[]> = {};
  for (const list of Object.values(p.assignments))
    for (const a of list) if (a.reserveId) (byRes[a.reserveId] ??= []).push({ s: a.startT, e: a.startT + a.durationMin * 60, o: a.obiegId });
  const v: string[] = [];
  for (const [rid, j] of Object.entries(byRes)) { j.sort((x, y) => x.s - y.s); for (let i = 0; i < j.length; i++) for (let k = i + 1; k < j.length; k++) if (j[i].s < j[k].e && j[k].s < j[i].e) v.push(`${rid} ${j[i].o}⨯${j[k].o}`); }
  return v;
};
let serialBad = 0, serialRuns = 0;
for (const [, rv] of sweeps)
  for (const peaksNotFirst of [false, true]) {
    serialRuns++;
    const ov = overlaps(planBreaks(obiegi, rv, { ...OPTS, peaksNotFirst }));
    if (ov.length) { serialBad++; if (serialBad <= 5) console.log(`  ❌ SERIAL ${rv.length}rez peaks=${peaksNotFirst}: ${ov.slice(0, 3).join(", ")}`); }
  }
// + locked: przypnij dwóch rezerwowych A11 do różnych obiegów (spójnie) i sprawdź, że auto nie nakłada się na nie
{
  const rv = pool({ A1: 2, A7: 1, A11: 4, A18: 1, A23: 1 }); // deficyt → ścieżka maxCoverMatch
  const { feasibleSlots } = await import("../src/lib/engine.ts");
  const a11 = rv.filter((r) => r.station === "A11");
  const manual: Record<string, import("../src/lib/types.ts").BreakAssignment[]> = {};
  let ri = 0;
  for (const o of obiegi) { if (ri >= 2) break;
    const sl = feasibleSlots(o, { earliest: 14 * 3600 }).find((s) => s.station === "A11" && s.kind === "połówka" && s.startT >= 15 * 3600 && s.startT <= 16 * 3600);
    if (!sl) continue; manual[o.id] = [{ obiegId: o.id, station: sl.station, dir: sl.dir, startT: sl.startT, kind: sl.kind, durationMin: sl.durationMin, reserveId: a11[ri].id, manual: true }]; ri++; }
  serialRuns++;
  const p = planBreaks(obiegi, rv, { ...OPTS, earliest: 14 * 3600, peaksNotFirst: true, lockedAssignments: manual });
  const merged = { ...p.assignments }; for (const [id, a] of Object.entries(manual)) merged[id] = a;
  const ov = overlaps({ ...p, assignments: merged } as ReturnType<typeof planBreaks>);
  if (ov.length) { serialBad++; console.log(`  ❌ SERIAL locked: ${ov.slice(0, 3).join(", ")}`); }
}
console.log(`\nSERIALIZACJA (jeden rezerwowy = jeden pociąg): ${serialBad ? `❌ ${serialBad}/${serialRuns} z NAKŁADANIAMI` : `✓ ${serialRuns}/${serialRuns} bez nakładań`}`);

// 5. godziny pracy od–do (applyWorkHours) — przeliczenie kół + cap slotów
const { applyWorkHours } = await import("../src/lib/rozklad.ts");
const { HHMMSS } = await import("../src/lib/types.ts");
const s30 = obiegi.find((o) => o.id === "S30")!;
const s30cut = applyWorkHours(s30, undefined, 18 * 3600); // pracuje do 18:00
console.log(`\nS30 koła: auto ${s30.loops.toFixed(2)} → „do 18:00" ${s30cut.loops.toFixed(2)} (entry ${HHMMSS(s30cut.entry2nd)})`);
const d19 = obiegi.find((o) => o.id === "D19")!;
const d19late = applyWorkHours(d19, 15 * 3600, undefined); // pracuje od 15:00
console.log(`D19 koła: auto ${d19.loops.toFixed(2)} → „od 15:00" ${d19late.loops.toFixed(2)} (entry ${HHMMSS(d19late.entry2nd)})`);
const d19thr = applyWorkHours(d19, undefined, 21 * 3600 + 600); // do 21:10 → zmiennik na linii
console.log(`D19 „do 21:10": throughShift=${d19thr.throughShift} loops=${d19thr.loops === Infinity ? "∞" : d19thr.loops}`);
// plan z obiegiem o skróconym oknie — przerwy S30 muszą wracać ≤ 18:00
const obiegi2 = obiegi.map((o) => (o.id === "S30" ? s30cut : o));
const pCut = planBreaks(obiegi2, reserves, OPTS);
const s30breaks = (pCut.assignments["S30"] ?? []).filter((a) => a.reserveId);
const viol = s30breaks.filter((a) => a.startT + a.durationMin * 60 > 18 * 3600);
console.log(`S30 przerwy przy „do 18:00": ${s30breaks.map((a) => `${a.kind}@${a.station} ${HHMMSS(a.startT)} (powrót ${HHMMSS(a.startT + a.durationMin * 60)})`).join(" | ") || "BRAK"} ` +
  `· powrót po 18:00: ${viol.length ? "ZŁAMANE" : "OK"} · plan vs baza: ${sig(pCut) === sig(base) ? "IDENTYCZNY (nie reaguje!)" : "ZMIENIONY"}`);

// 6. KROKI 1–4 (uzgodnione zmiany silnika): całodobowe ~4,5 koła · tryb symulacji · reguła 14:55
console.log("\n=== KROKI 1–4: całodobowe 4,5 · symulacja · reguła 14:55 ===");
// KROK 1: całozmianowy (throughShift) ma REALNE koła (liczone do 20:45, ~4,5), NIE ∞
const through = obiegi.filter((o) => o.throughShift);
const infLoops = through.filter((o) => !Number.isFinite(o.loops));
const finLoops = through.map((o) => o.loops).filter(Number.isFinite);
console.log(`— całodobowych: ${through.length} · ∞ kół: ${infLoops.length} ${infLoops.length ? "✗ (powinny być realne ~4,5)" : "✓ wszystkie skończone"}` +
  `${finLoops.length ? ` · koła min/max ${Math.min(...finLoops).toFixed(2)}/${Math.max(...finLoops).toFixed(2)} (oczek. ~4,5)` : ""}`);
// KROK 3+4: symulacja domyka deficyt godzinką/szczeniakiem (BRAK on ≤ BRAK off) BEZ złamania reguły 14:55
const CHAIN_FLOOR = 14 * 3600 + 55 * 60;
const brakOf = (p: ReturnType<typeof planBreaks>) => obiegi.filter((o) => !(p.assignments[o.id] ?? []).some((a) => a.reserveId)).length;
const simPools: Array<[string, Reserve[]]> = [
  ["9  (1/1/4/2/1)", pool({ A1: 1, A7: 1, A11: 4, A18: 2, A23: 1 })],
  ["10 (3/1/4/1/1)", pool({ A1: 3, A7: 1, A11: 4, A18: 1, A23: 1 })],
  ["11 (3/1/4/2/1)", pool({ A1: 3, A7: 1, A11: 4, A18: 2, A23: 1 })],
];
for (const [label, rv] of simPools) {
  const off = planBreaks(obiegi, rv, OPTS);
  const on = planBreaks(obiegi, rv, { ...OPTS, simulate: true });
  const starts: Record<string, number[]> = {};
  for (const list of Object.values(on.assignments))
    for (const a of list) if (a.reserveId && a.kind === "godzinka") (starts[a.reserveId] ??= []).push(a.startT);
  const chainViol = Object.entries(starts).filter(([, ss]) => ss.length >= 4 && Math.min(...ss) < CHAIN_FLOOR);
  console.log(`— ${label}: BRAK ${brakOf(off)} → ${brakOf(on)} (sim)${brakOf(on) <= brakOf(off) ? "" : " ✗ sim POGORSZYŁA"}` +
    ` · reguła 14:55: ${chainViol.length ? `✗ ZŁAMANA [${chainViol.map(([id]) => id).join(",")}]` : "✓"}`);
}
// pełna 12 + sim: bez regresji (nadal same całe/połówki, zero krótkich)
const full12sim = planBreaks(obiegi, reserves, { ...OPTS, simulate: true });
const kindsFull = new Set(Object.values(full12sim.assignments).flat().filter((a) => a.reserveId).map((a) => a.kind));
console.log(`— PEŁNA 12 + sim: BRAK ${brakOf(full12sim)} · rodzaje ${[...kindsFull].join(",")} ` +
  `${kindsFull.has("godzinka") || kindsFull.has("szczeniak") ? "✗ (niepotrzebne krótkie)" : "✓ tylko cała/połówka"}`);

// ════ CAŁA < 14:30 → 2 POŁÓWKI (decyzja użytkownika 2026-06-14) ════
// Niezmiennik: gdy pomocnik obniży próg „zacznij od" poniżej 14:30, ŻADNA cała nie startuje przed 14:30 (auto).
// Zwykły obieg ściągnięty wcześnie dostaje 2 POŁÓWKI (1. wczesna + 2. późniejsza = 1,0). Domyślnie (próg 14:30)
// reguła jest NIEAKTYWNA (0 wczesnych bloków). Całozmianowe (E4) zachowują całą — tylko przesuniętą na ≥14:30.
console.log("\n=== CAŁA < 14:30 → 2 POŁÓWKI (próg z inputu pomocnika) ===");
{
  const CE = 14 * 3600 + 30 * 60;
  for (const earliest of [CE, 14 * 3600, 13 * 3600 + 30 * 60]) {
    const p = planBreaks(obiegi, reserves, { earliest });
    const viol: string[] = [];
    let earlyBlocks = 0, splitPairs = 0;
    for (const o of obiegi) {
      const list = (p.assignments[o.id] ?? []).filter((a) => a.reserveId).sort((a, b) => a.startT - b.startT);
      for (const a of list) if (a.kind === "cała" && a.startT < CE) viol.push(o.id);
      if (!list.length || list[0].startT >= CE) continue;
      earlyBlocks++;
      if (list.length >= 2 && list.every((a) => a.kind === "połówka")) splitPairs++;
    }
    const h = `${Math.floor(earliest / 3600)}:${String(Math.floor((earliest % 3600) / 60)).padStart(2, "0")}`;
    console.log(`— próg ${h}: cała<14:30 ${viol.length ? "✗ ZŁAMANA [" + viol.join(",") + "]" : "✓ brak"}` +
      ` · wczesnych 1. bloków ${earlyBlocks} · rozbitych na 2 połówki ${splitPairs}`);
  }
}

// ════ MAX 6h15 BEZ PRZERWY (R3, decyzja użytkownika 2026-06-14, symetria 2026-06-14) ════
// Niezmiennik (SYMETRYCZNY): żaden OBSADZONY obieg nie pracuje dłużej niż 6h15 bez przerwy — ANI przed 1.
// przerwą, ANI po ostatniej do końca pracy. Trzy segmenty, WSZYSTKIE twarde pass/fail dla WSZYSTKICH obiegów:
//   (1) wjazd → start 1. przerwy ≤ 6h15
//   (2) powrót z przerwy → start następnej („między”) ≤ 6h15  [obiegi z 2 przerwami]
//   (3) powrót z OSTATNIEJ → koniec pracy („ogon”) ≤ 6h15
// Koniec pracy: ZWYKŁY = workEnd ?? lastT (realny zjazd 19:00–21:00); CAŁOZMIANOWY = THIRD_SHIFT_RELIEF
// (20:45, zmiana na linii) — bo jego lastT to KONIEC DOBY (~24:00), nie zjazd. BRAK = osobna kat. (cover_check).
console.log("\n=== MAX 6h15 BEZ PRZERWY (R3, symetryczny) ===");
{
  const L = 6 * 3600 + 15 * 60;
  const dur = (s: number) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  for (const earliest of [14 * 3600 + 30 * 60, 14 * 3600, 13 * 3600 + 30 * 60]) {
    const p = planBreaks(obiegi, reserves, { earliest });
    let maxPre = 0, maxBetween = 0, maxTail = 0;
    const viol: string[] = [];
    for (const o of obiegi) {
      const list = (p.assignments[o.id] ?? []).filter((a) => a.reserveId).sort((a, b) => a.startT - b.startT);
      if (!list.length) continue; // BRAK — osobna kategoria (cover_check)
      const pre = list[0].startT - o.entry2nd;
      maxPre = Math.max(maxPre, pre);
      if (pre > L) viol.push(`${o.id} wjazd→przerwa ${dur(pre)}`);
      for (let i = 1; i < list.length; i++) {
        const g = list[i].startT - (list[i - 1].startT + list[i - 1].durationMin * 60);
        maxBetween = Math.max(maxBetween, g);
        if (g > L) viol.push(`${o.id} między ${dur(g)}`);
      }
      const endWork = o.throughShift ? THIRD_SHIFT_RELIEF : (o.workEnd ?? o.lastT); // 24h: zmiana na linii 20:45
      const tail = endWork - (list[list.length - 1].startT + list[list.length - 1].durationMin * 60);
      maxTail = Math.max(maxTail, tail);
      if (tail > L) viol.push(`${o.id}${o.throughShift ? "·24h" : ""} ogon ${dur(tail)}`);
    }
    console.log(`— próg ${HHMMSS(earliest)}: ${viol.length ? "✗ ZŁAMANA [" + viol.join(", ") + "]" : "✓ OK"}` +
      ` · max wjazd→przerwa ${dur(maxPre)} · między ${dur(maxBetween)} · ogon ${dur(maxTail)} (koniec pracy: zwykły=zjazd, 24h=20:45)`);
  }
}
