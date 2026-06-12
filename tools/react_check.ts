// Szybki test: czy plan REAGUJE na forcedKinds (S31=cała) i xferBufferMin. npx tsx tools/react_check.ts
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseObiegi } from "../src/lib/rozklad.ts";
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
