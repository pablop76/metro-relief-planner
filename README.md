# metro-relief-planner — Przerwy Metro M1

Aplikacja webowa (PWA) do planowania **podmian maszynistów metra na przerwy** — warszawska linia **M1** (Kabaty ↔ Młociny).
Wczytuje operacyjny rozkład jazdy (xlsx), automatycznie układa plan przerw wg reguł ruchowych i pozwala dyspozytorowi korygować go ręcznie.

> Dyspozytorskie narzędzie zastępujące ręczny arkusz Excela.

## Co potrafi

- **Wczytuje rozkład z xlsx** w przeglądarce (SheetJS) — 36 obiegów (całodobowe, szczytowe `S`, dodatkowe `D`).
- **Silnik planowania przerw** (heurystyka z ograniczeniami):
  - każdy obieg dostaje przerwę (pełne pokrycie),
  - długości: cała / połówka / szczeniak zależnie od stacji i kierunku,
  - okno **14:30–18:30**, rezerwowy podmienia **tylko na swojej stacji**,
  - limit **4,5 h** podmian na rezerwowego,
  - **R16**: maksymalne wykorzystanie rezerwowych — obieg może mieć kilka przerw (dwie połówki, cała+połówka…).
- **Lista maszynistów** z pliku (`maszynisci.json`) — edytowalna, z eksportem/importem.
- **Sterowanie per maszynista**: blokada, limit podmian, przypięcie do konkretnego obiegu.
- **Karta obiegu**: numer pociągu, godzina/stacja wjazdu, przerwy (z wizualizacją pory), zjazd na STP / sprzątanie.
- Kolejność obiegów wg rozkładu, drag&drop, opóźnienie linii, zapis w `localStorage`.

Reguły domenowe: [`ZASADY.md`](ZASADY.md).

## Uruchomienie

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # produkcja (dist/)
```

Domyślny rozkład i lista maszynistów leżą w `public/`. Inny rozkład wczytasz przyciskiem „Wczytaj rozkład…".

## Stack

React + Vite + TypeScript · SheetJS (xlsx) · PWA · bez backendu (stan w `localStorage`).
Silnik planowania: `src/lib/engine.ts`. Parser rozkładu: `src/lib/rozklad.ts`.

## Status

W budowie. Następny etap: widok maszynisty na telefon + powiadomienia push (PWA).

---
Autor: [pablop76](https://web-service.com.pl/)
