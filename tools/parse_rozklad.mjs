// Dev-parser rozkładu xlsx (SheetJS) — eksploracja struktury.
// Uruchom: node tools/parse_rozklad.mjs
import * as XLSX from "xlsx";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const xlsxPath = resolve(__dirname, "../data/RJ_M1_A1_od_13_05_2026.xlsx");

const buf = readFileSync(xlsxPath);
const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
console.log("Arkusze:", wb.SheetNames);

const ws = wb.Sheets["powszedni"];
// raw:false => wartości sformatowane jako tekst (czasy jako "14:07" itd.)
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

console.log("Liczba wierszy:", rows.length);

// Mapowanie kolumn wg wcześniejszej analizy (0-indeks)
const COL = {
  nrKolejny: 0, typ: 2, obieg: 4,
  n_A1: 5, odstepN: 6, n_A4: 7, n_A7: 8, n_A11: 9, n_A14: 10, n_A18: 11, n_A23: 12,
  zawrotN: 13,
  s_odj: 14, odstepS: 15, s_A18: 16, s_A14: 17, s_A11: 18, s_A7: 19, s_A1: 20,
  zawrotS: 21, srK: 22, uwagi: 23,
};

// Pokaż nagłówki (wiersze 3-6 w Excelu => indeksy 2-5)
console.log("\n=== NAGŁÓWKI (wiersze 1-6) ===");
for (let i = 0; i < 6; i++) {
  console.log(i + 1, JSON.stringify(rows[i]));
}

// Zrzuć wszystkie wiersze danych z numerem obiegu do pliku debug
const out = [];
for (let i = 5; i < rows.length; i++) {
  const r = rows[i];
  const obieg = (r[COL.obieg] ?? "").toString().trim();
  if (!obieg) continue;
  out.push({
    excelRow: i + 1,
    obieg,
    typ: r[COL.typ],
    // kierunek północ (A1->A23)
    n: { A1: r[COL.n_A1], A4: r[COL.n_A4], A7: r[COL.n_A7], A11: r[COL.n_A11], A14: r[COL.n_A14], A18: r[COL.n_A18], A23: r[COL.n_A23] },
    // kierunek południe (A23->A1)
    s: { odj: r[COL.s_odj], A18: r[COL.s_A18], A14: r[COL.s_A14], A11: r[COL.s_A11], A7: r[COL.s_A7], A1: r[COL.s_A1] },
    uwagi: r[COL.uwagi],
  });
}
writeFileSync(resolve(__dirname, "../data/_debug_rows.json"), JSON.stringify(out, null, 2), "utf8");
console.log("\nZapisano data/_debug_rows.json — wierszy danych:", out.length);

// Lista unikalnych obiegów
const obiegi = [...new Set(out.map((o) => o.obieg))];
console.log("\nUnikalne obiegi (" + obiegi.length + "):", obiegi.join(", "));
