import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseObiegi } from "../src/lib/rozklad.ts";
import { planBreaks } from "../src/lib/engine.ts";
import { CALA_EQ, HHMMSS } from "../src/lib/types.ts";
import type { Reserve, BreakStation } from "../src/lib/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const buf = readFileSync(resolve(__dirname, "../data/RJ_M1_A1_od_13_05_2026.xlsx"));
const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
const obiegi = parseObiegi(wb, "powszedni");
const R = (id: string, station: BreakStation, extra: Partial<Reserve> = {}): Reserve => ({ id, name: id, station, ...extra });

// SURPLUS pool ~14: dorzucam po jednym na A7/A18/A23 i jeden A11
const reserves: Reserve[] = [
  R("Kopyt", "A1", { rolling: true }), R("Łada", "A1"), R("Kornaszewski", "A1"),
  R("Miros", "A7"), R("Miros2", "A7"),
  R("Szczepanik", "A11"), R("Żeńca", "A11"), R("Kępa", "A11"), R("Mańkowski", "A11"), R("Bogucki", "A11"),
  R("H.Galicki", "A18"), R("Galicki2", "A18"),
  R("Gnas", "A23"), R("Gnas2", "A23"),
];
const plan = planBreaks(obiegi, reserves, { earliest: 14*3600+30*60 });

let poltora = 0, lonePol = 0, cala2 = 0, pol2 = 0;
const details: string[] = [];
for (const o of obiegi) {
  const list = (plan.assignments[o.id] ?? []).filter(a => a.reserveId);
  const kinds = list.map(a => a.kind);
  if (kinds.length === 2 && kinds.includes("cała") && kinds.includes("połówka")) { poltora++; details.push(`PÓŁTORA ${o.id} loops=${o.loops===Infinity?"∞":o.loops.toFixed(1)} ${list.map(a=>a.kind[0]+"@"+a.station+HHMMSS(a.startT)).join(" + ")}`); }
  if (kinds.length === 2 && kinds.every(k=>k==="cała")) cala2++;
  if (kinds.length === 2 && kinds.every(k=>k==="połówka")) pol2++;
  if (kinds.length === 1 && kinds[0] === "połówka") { lonePol++; details.push(`LONE-POŁ ${o.id} loops=${o.loops===Infinity?"∞":o.loops.toFixed(1)} ${HHMMSS(list[0].startT)}@${list[0].station}`); }
}
const brak = obiegi.filter(o => !(plan.assignments[o.id]??[]).some(a=>a.reserveId)).map(o=>o.id);
console.log(`SURPLUS ${reserves.length} rez · BRAK ${brak.length} [${brak.join(",")}]`);
console.log(`półtora(c+p)=${poltora}  lone-połówka=${lonePol}  2×cała=${cala2}  2×połówka=${pol2}`);
// rozkład startów
const bin: Record<string, number> = {};
for (const list of Object.values(plan.assignments)) for (const a of list) if (a.reserveId) { const b=HHMMSS(Math.floor(a.startT/1800)*1800); bin[b]=(bin[b]??0)+1; }
console.log("starty:", Object.entries(bin).sort().map(([b,n])=>`${b}:${n}`).join("  "));
console.log(details.slice(0,30).join("\n"));
