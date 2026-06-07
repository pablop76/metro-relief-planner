# Liczenie kół i przydział przerw — Metro M1

> Specyfikacja **silnika** (stan zaimplementowany): `src/lib/rozklad.ts` (`countLoops2nd`,
> `lapDuration`) i `src/lib/engine.ts` (`planBreaks`). Pełny kontrakt domenowy: [`ZASADY.md`](ZASADY.md).

---

## 1. Liczenie kół (2. zmiana)

Koła liczone **czasowo, bez zaokrąglania** (`countLoops2nd`):

```
koła = (zjazd − wjazd) / czas_koła
```

- **czas_koła** = mediana odstępu między kolejnymi odjazdami A1→Młociny tego obiegu, z pominięciem
  postojów > 3 h (`lapDuration`; fallback 84 min, gdy za mało danych).
- **wjazd** = realny wjazd z rozkładu — pierwsze zdarzenie po przerwie > 60 min po 12:00
  (`afternoonEntry`); dla obiegów jadących ciągiem (bez postoju w dzień) start maszynisty z grafiku
  (`SHIFT2_DRIVER_START`: D17–D20 = 13:00, D22 = 13:30). Domyślnie 14:00.
- **zjazd** = ostatnie zdarzenie obiegu (cap na 22:00 = koniec 2. zmiany).
- Częściowe pierwsze/ostatnie koło wychodzi jako **realny ułamek** — np. S23 (wjazd A11 14:41 →
  zjazd 19:54) = **3,73**, a nie zaokrąglone 4. Zakończenie na A23 (zjazd/sprzątanie) to pół koła,
  nie całe — liczenie czasowe robi to poprawnie samo, bez korekt.

### 1a. Kogo liczymy

O rodzaju przerwy decyduje długość pracy maszynisty 2. zmiany: czy sam dowozi pociąg na zjazd, czy
zmienia go ktoś na linii.

| Kryterium (ostatnie zdarzenie obiegu)        | Koła           | Kto |
| --- | --- | --- |
| **zjazd ≥ 21:00** — zmiennik na linii / 3. zmiana / całodobowy | `Infinity`, zawsze cała (`throughShift`) | 1–13, D14, D15, D21 |
| **zjazd < 21:00** — maszynista sam zjeżdża na STP | liczone | wszystkie S, D16, D17–D20, D22 |

- Detekcja: `lastT >= RELIEF_ON_LINE` (21:00) → cała (nieliczone). Próg = deklarowana zmiana na
  linii „nie później niż 21:00".
- D17–D20 są liczone, ale mają najwięcej kół (~5,0–5,15) → ranking i tak daje im całą.
  D22 zjeżdża sam wcześnie (≈19:19) → realny kandydat na połówkę.

**Przykłady zweryfikowane (2026-06-07):**

| Obieg | Wjazd | Zjazd | Koła |
| --- | --- | --- | --- |
| S23 | A11 14:41 | 19:54 | 3,73 |
| S31 | A18 14:32 | 19:17 | ~3,5 |
| S34 | — | A23 (zjazd/sprzątanie) | ~3,45 |
| D20 | 13:00 | 20:17 | ~4,5 |

---

## 2. Rodzaj przerwy (połówka vs cała)

Decyduje liczba kół (`planBreaks`):

- Obiegi z **≤ 3 koła** (`POL_MAX_LOOPS`) → **połówka zawsze**, niezależnie od liczby rezerwowych (twardy próg).
- Obiegi **3–4 koła** → **elastycznie**: przy nadwyżce rezerwy dostają **całą**, przy deficycie schodzą na **połówkę**. „Zawsze połówka" powyżej 3 kół to sugestia — decyduje bilans.
- **Deficyt mocy** (`liczba_obiegów − rezerwowi×3`) zwiększa liczbę połówek o `2 × deficyt`.
- Połówki trafiają do obiegów z **najmniejszą liczbą kół** (szczyty); reszta → **cała**.
- Zasada nadrzędna: **najmniej kół = połówka**, najwięcej kół = cała.
- Ręczny override rodzaju (`forcedKinds`) ma pierwszeństwo nad auto-bilansem.

---

## 3. Okna startu przerwy

- **Najwcześniej 14:30** (`EARLIEST_DEFAULT`); override per obieg dozwolony (`earliestByObieg`).
- **Preferencja 16:00–17:30** (`PREF_WINDOW`) — najlepsze przerwy startują w tym oknie; slot w oknie
  ma score 0, poza oknem — odległość do najbliższej krawędzi.
- **Dwa okna:**
  - **1. (główna) przerwa** — start najpóźniej **18:30** (`LATEST_FIRST`; „19:10 = za późno").
  - **2. (dodatkowa) przerwa** — okno dłuższe, do **20:00** (`LATEST_SECOND`); realnie limituje ją
    zjazd pociągu (musi wrócić, zanim zjedzie — patrz §1).
- Nie zaczynać przerw od obiegów mających tylko połówki — najpierw całe (kolejność w §5).

### 3a. Druga (dodatkowa) przerwa — kombinacje

Obieg może mieć max 2 przerwy (`MAX_BREAKS_PER_OBIEG`). Dozwolone kombinacje:

- **cała + połówka** — dowolna kolejność; **najlepsza** kombinacja.
- **połówka + połówka** — rozsunięte ~2,5 h (`SPACING_POLOWKI`).
- **cała + cała** — dozwolona, gdy trzeba dobić rezerwowego do pełnych 3 kół (pokrycie już zapewnione).
- **szczeniak** jako dokładka — ostateczność.

Pozostałe kombinacje kładzione blisko powrotu maszynisty (mały odstęp).

---

## 4. Stacje podmian

Konfiguracja w [`src/lib/stations.ts`](src/lib/stations.ts) / `data/stations.json`:

| Stacja          | Rodzaje przerw          | Kierunek          |
| --------------- | ----------------------- | ----------------- |
| A1 (Kabaty)     | cała                    | oba (krańcówka)   |
| A7 (Wilanowska) | cała, godzinka, szczeniak | godzinka ↑ Młociny, szczeniak ↓ Kabaty |
| A11 (Politechnika) | cała, połówka        | oba               |
| A18 (Plac Wilsona) | cała, godzinka, szczeniak | godzinka ↓ Kabaty, szczeniak ↑ Młociny |
| A23 (Młociny)   | cała                    | oba (krańcówka)   |

Rodzaje wg długości: **cała** (~90 min, pełna pętla) > **godzinka** (~1h, jazda do dalszego krańca
i powrót) > **połówka** (~45 min) > **szczeniak** (~30 min, krótki nawrót do bliższego krańca).
„godzinka" liczona jak połówka/szczeniak (powrót w przeciwnym kierunku), ale do dalszego krańca:
A7→Młociny ≈ 58 min, A18→Kabaty ≈ 62–66 min (realnie z rozkładu).

Długość przerwy liczona z **realnego rozkładu** (czas od wejścia w obieg do powrotu pociągu na tę
stację), nie ze sztywnych 90/45/30 min.

---

## 5. Rezerwowi i kolejność przetwarzania

- Rezerwowy podmienia **tylko na swojej stacji** (brak „pożyczania" z innej).
- Limit obciążenia: **3 całe** liczone w równowartości (cała=1, godzinka=⅔, połówka=0,5, szczeniak=⅓),
  nie w minutach (`MAX_RESERVE_LOAD_EQ`). 3 całe = 6 połówek = 2 całe+2 połówki = 1 cała+4 połówki.
  „Pełny" gdy równowartość ≥ 3.
- **Limit liczby podmian wg stacji** (`jobCapOf`): na **A1 (Kabaty) tylko JEDEN** rezerwowy z obsady ma
  **domyślnie 1** podmianę — rezerwa ruchowa musi zostać pod ręką (R17); **pozostali rezerwowi A1
  pracują normalnie do 3 kół**. Inne stacje: bez limitu liczby (ogranicza je tylko 3 koła).
  Instruktor może nadpisać ręcznie (`Reserve.maxJobs`).
- **Maksymalne wykorzystanie:** dodatkowe przerwy (R16) rozdawane są tak, by dobić każdego rezerwowego
  (poza A1) do **pełnych 3 kół**. Dlatego druga **cała** jest dozwolona zawsze (nie tylko przy nadmiarze)
  — pokrycie (R9) jest już zapewnione wcześniej, a BRAK = brak rezerwowego na danej stacji (R14), więc
  dokładanie 2. przerwy gdzie indziej nie odbiera nikomu pokrycia.
- Pakowanie: najpierw dobijamy najczęściej używanego rezerwowego, świeżych zostawiamy na trudniejsze,
  późniejsze obiegi.
- Okno dostępności rezerwowego (`availFrom`/`availTo`, R18) i autoryzacje taboru są respektowane.
- **Kolejność:** najpierw obiegi z całą, potem z połówką; w grupie — najmniej slotów najpierw, dalej
  najwcześniejszy zjazd, S przed full przed D.
- **Pokrycie (R9) jest nadrzędne:** każdy obieg dostaje ≥ 1 przerwę. Najpierw próba w preferowanym
  rodzaju i oknie (do 18:30). Gdy nie złapie wolnego rezerwowego — **pokrycie awaryjne** (`tryCover`):
  zejście na krótszy rodzaj (połówka/szczeniak) i/lub szersze okno (do 20:00). Dopiero gdy NIGDZIE
  nie ma wolnego rezerwowego → **BRAK** (ręczna obsada).
- Dodatkowe (drugie) przerwy z R16 rozdawane są **dopiero po** zapewnieniu pokrycia wszystkim obiegom.
