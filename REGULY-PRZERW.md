# Reguły planowania przerw — Metro M1 (do weryfikacji)

> Stan na 2026-06-07. Dokument roboczy — reguły do sprawdzenia i poprawy.
> Po weryfikacji zaczynamy logikę planowania od nowa.

---

## 1. Liczenie kół (2. zmiana)

- Liczymy **odjazdy ze stacji na której pociąg jest w okilcy 13:45** w oknie **14:00–20:00** (`LAST_LAP_DEP = 20:00`)
- **+0.5 koła** jeśli obieg wjeżdża z innej stacji niż A1 (np. S31 z A18 → "midline")
- **+0.5 koła** jeśli obieg startuje 2. zmianę o 13:00/13:30 (lista `EARLY_START_2ND`):
  D17, D18, D19, D20, D22, S26, S27, S28, S29, S32, S33, S34, S35

**⚠️ ZGŁOSZONE BŁĘDY:**

- S31: wjeżdża z A18 o 14:32, zjeżdża 19:17 → **nie robi nawet 4 kół** (system liczy źle)
- S34: kończy na A23 → też **nie robi 4 kół**
- D20: start 13:00, koniec 20:17 → **robi 4,5 koła** (system pokazuje co innego)
- "takich kwiatków jest więcej" — liczenie kół jest generalnie błędne
- **Podejrzenie: parser xlsx czyta tylko 1 wiersz dla S31/S34 zamiast ~7** (scalone komórki w kolumnie "obieg"?) → przez to liczba kół zaniżona

---

## 2. Rodzaj przerwy (kto dostaje połówkę)

- Obiegi z **≤ 2.5 koła** → zawsze **połówka** (niezależnie od liczby rezerwowych)
- Gdy rezerwowych za mało (deficyt) → kolejne obiegi (wg rosnącej liczby kół) dostają **połówkę**
- Reszta → **cała**
- Zasada nadrzędna: **najmniej kół = połówka**, najwięcej kół = cała

**⚠️ ZGŁOSZONE BŁĘDY:**

- Przy 12 rezerwowych powinno wyjść **6 połówek, reszta całe** — wychodziło 28/17 połówek
- S34 robi najmniej kół, a dostawał najwięcej przerwy (cała) — "karygodny błąd"

---

## 3. Okna czasowe (start przerwy)

- **najwcześniej 14:30** (wszystkie rodzaje)
- **preferencja: 16:00–17:30** — najlepsze przerwy startują w tym oknie (NIE „jak najbliżej 14:30")
- **DWA OKNA — pierwsze krótsze:**
  - **1. przerwa** (główna) — start najpóźniej **18:30** ("19:10 = za późno")
  - **2. przerwa** (dodatkowa) — **dłuższe okno**, start może być później (do ~20:00); realnie ogranicza ją zjazd pociągu (R7 — musi wrócić przed zjazdem)
- **nie zaczynać przerw od obiegów, które mają tylko połówki** (najpierw całe)

## 3a. Druga (dodatkowa) przerwa — kombinacje

Obieg może mieć max 2 przerwy. Dozwolone kombinacje:

- **cała + połówka** — dowolna kolejność (może być połówka, potem cała); to **NAJLEPSZA** kombinacja
- **połówka + połówka**
- **cała + cała** — dozwolone przy **dużej liczbie maszynistów manewrowych** (nadmiar rezerwy)
- **szczeniak jako dokładka** — gdy jest taka potrzeba (ostateczność)

Rozmieszczenie (R2):

- **dwie połówki** — rozsunięte ~2,5 h od siebie (co 2–3 h)
- **cała + połówka** (i pozostałe) — blisko siebie / mały odstęp po powrocie maszynisty (np. sąsiednie koła)

---

## 4. Stacje podmian

| Stacja         | Rodzaj przerwy   | Kierunek  |
| -------------- | ---------------- | --------- |
| A1 (Kabaty)    | cała             | oba       |
| A7             | cała + szczeniak | ↓ Kabaty  |
| A11 (Centrum?) | połówka          | oba       |
| A18            | cała + szczeniak | ↑ Młociny |
| A23 (Młociny)  | cała             | oba       |

**⚠️ ZGŁOSZONE BŁĘDY:**

- Szczeniak pojawiał się na A18 tam, gdzie nie powinien

---

## 5. Rezerwowi (obciążenie)

- Rezerwowy podmienia **tylko na swojej stacji** (brak "pożyczania" z innej stacji)
- Maks. obciążenie: **270 min (4,5h)** na rezerwowego
- Maks. podmian: **3** na rezerwowego (domyślnie; edytowalne w UI)
- Packing: najpierw dobijamy najczęściej używanego rezerwowego (żeby świeżych zostawić na trudne obiegi)

**⚠️ ZGŁOSZONE BŁĘDY / WYMAGANIA:**

- **Na Kabatach (A1): jeden rezerwowy robi MAX jedno koło, reszta po trzy** — system dawał "po dwa koła"
- **A11: dawał po jednej połówce** na rezerwowego = pracuje tylko 45 min na 8h → marnotrawstwo, ma robić więcej

---

## 6. Kolejność przetwarzania

- Obieg z **najmniejszą liczbą dostępnych slotów** → przetwarzany pierwszy
- Remis → najwcześniejszy zjazd → S przed full przed D
- Cel: każdy obieg dostaje ≥1 przerwę (D19/D20 nie mogą zostać bez podmiany)

---

## 7. Pozostałe wymagania / pomysły

- Każdy z 36 obiegów MUSI dostać ≥1 przerwę gdy mocy wystarcza (rezerwowi×3 ≥ liczba obiegów)
- Szczeniak = ostateczność (tylko gdy nie ma cała ani połówka)
- Nie dawać połówki szczytowi, jeśli na 1. kole ma tylko połówki (wspomniane, niewdrożone)

---

## Dane wejściowe (kontekst)

- 36 obiegów: 1–13 całodobowe (full), D14–D22 dodatkowe, S23–S36 szczyty
- Drużyna = obieg (numer drużyny = numer obiegu)
- 2. zmiana nominalnie 14:00–22:00; część drużyn od 13:00/13:30
- Maszyniści zmieniają się ~30 min przed końcem zmiany (dojeżdżają na swoją stację)
- 189 maszynistów w `maszynisci.json`
