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
- **wjazd** = realny start 2. zmiany (`shift2Start`, zapisany na obiegu jako `entry2nd`): pierwsze
  zdarzenie po przerwie > 60 min po 12:00 (`afternoonEntry`); dla obiegów jadących ciągiem (bez postoju
  w dzień) start maszynisty z grafiku (`SHIFT2_DRIVER_START`: D17–D20 = 13:00, D22 = 13:30). Domyślnie 14:00.
  `entry2nd` jest też podstawą R3 (patrz §3).
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

- **REGUŁA BILANSU — liczba połówek = `2 × deficyt`** (`deficyt = liczba_obiegów − Σ min(3, capOf)`).
  Na jednego rezerwowego mieści się **6 połówek zamiast 3 całych**, więc każda para połówek (zamiast całej)
  obsługuje **o jeden obieg więcej** → `2 × deficyt` połówek wystarcza, by **przy STAŁEJ liczbie rezerwowych**
  (stan na dany dzień — nie dodajemy ludzi) wszyscy dostali przerwę. Formuła:
  `polCount = min(liczba_kwalifikujących_się, max(hardPol, 2 × deficyt))`.
- **Godzinki** to alternatywa: mieści się ich **4 zamiast 3** całych (też zysk podmiany, krótszy ubytek niż
  połówka). Silnik sięga po nie w pokryciu awaryjnym (kolejność `cała → godzinka → połówka`).
- Twardy próg: obiegi **≤ 3 koła** (`POL_HARD_LOOPS`, `hardPol`) → **połówka ZAWSZE** (szczyty), nawet bez deficytu.
- `Infinity` (jazda po 21:00 / całodobowe) → **cała** (nie kwalifikują się do połówki).
- Połówki trafiają do obiegów z **najmniejszą liczbą kół** (szczyty); reszta → **cała**.
- Zasada nadrzędna: **najmniej kół = połówka**, najwięcej kół = cała. Ręczny override (`forcedKinds`) > auto-bilans.

---

## 3. Okna startu przerwy

- **Najwcześniej 14:30** (`EARLIEST_DEFAULT`), nadpisywalne na trzech poziomach: **globalnie** (`earliest`),
  **per stacja** (`earliestByStation` — np. wszystkie 14:30, ale A11 14:50) i **per obieg** (`earliestByObieg`).
  Precedencja progu slotu: **per-obieg > per-stacja > globalny**. Pola w UI: „⏰ nie wcześniej niż" + rząd
  „per stacja" (puste = jak globalny). Próg stacji jest zarazem **kotwicą rozkładania**.
- **Rozkładanie od progu w górę** — `score` po `scarcity` (patrz §4/§5) preferuje **najwcześniejszy** slot od
  progu startu stacji. Moc rezerwowych wypełnia się od dołu, a naturalna serializacja (jeden maszynista = jeden
  pociąg naraz) i tak rozkłada przerwy po popołudniu. (Wcześniej był „magnes" na 16:00, potem pełznący kursor —
  kursor przy wąskim gardle A11 „uciekał" przed wolną wczesną mocą i robił BRAK mimo zapasu, więc usunięty.)
- **Dwa okna:**
  - **1. (= JEDYNA gwarantowana) przerwa** — start najpóźniej **18:20** (`LATEST_FIRST`). Reguła: **jedyna
    przerwa NIE może startować po 18:20** (pokrycie = 1 przerwa). Dodatkowo **R3**: `latestFirstOf =
    min(18:20, entry2nd + 6 h)`. To samo okno obowiązuje w pokryciu awaryjnym (`tryCover`).
  - **2. (dodatkowa) przerwa** — okno dłuższe, do **20:00** (`LATEST_SECOND`); realnie limituje ją
    zjazd pociągu (musi wrócić, zanim zjedzie — patrz §1).
- **§4a krok 4** (`coverWindow`): szczyt z samą połówką (`kind = połówka`) nie dostaje jej na 1. kole —
  dół okna = **entry2nd + 1 koło**, góra = **18:15** (`ONLY_POL_LATEST`). Dotyczy też połówki nadanej awaryjnie.

### 3a. Druga (dodatkowa) przerwa — kombinacje

Obieg może mieć max 2 przerwy (`MAX_BREAKS_PER_OBIEG`). Dozwolone kombinacje:

- **cała + połówka** — dowolna kolejność; **najlepsza** kombinacja.
- **połówka + połówka** — rozsunięte ~2,5 h (`SPACING_POLOWKI`).
- **cała + cała** — dozwolona, gdy trzeba dobić rezerwowego do pełnych 3 kół (pokrycie już zapewnione).
- **godzinka** dopuszczalna jako dokładka. **Szczeniak NIE jest dokładany automatycznie** (patrz niżej).

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

> **Szczeniak NIE jest nadawany automatycznie** (`AUTO_KINDS` = cała/godzinka/połówka). Jest za słabą
> podmianą — silnik woli połówkę, ewentualnie godzinkę; gdy nic nie pasuje → BRAK (dodać rezerwowego),
> nie szczeniak. Szczeniaka można wybrać **tylko ręcznie** w edytorze przerwy. Cel: przy ~11 rezerwowych
> ~12 połówek i zero szczeniaków; pełne pokrycie daje np. **6 manewrowych na A11** (lub 5 na A11 + 2 indziej).
„godzinka" liczona jak połówka/szczeniak (powrót w przeciwnym kierunku), ale do dalszego krańca:
A7→Młociny ≈ 58 min, A18→Kabaty ≈ 62–66 min (realnie z rozkładu).

Długość przerwy liczona z **realnego rozkładu** (czas od wejścia w obieg do powrotu pociągu na tę
stację), nie ze sztywnych 90/45/30 min. Wartości 90/60/45/30 (`DURATION`) pokazujemy pomocnikowi jako
**poglądowe** (D1) — w UI „~45′ (realnie 47′)".

**R20 — przeciwny tor** (`BreakAssignment.crossTrack`): **NIE** dotyczy każdej połówki. Liczy się **moment
między podmianami** jednego rezerwowego: po oddaniu pociągu musi czasem **przejść na drugą stronę toru**, by
zdążyć na kolejną podmianę (częste „łapanie pociągu z drugiej strony peronu na kolejną podmianę", żeby nie
rozciągać przerw). Sam powrót pociągu z przerwy **nie** jest alarmem.
- **Krańcówki bez przeskoku:** na **A1 (Kabaty)** i **A23 (Młociny)** oba kierunki odjeżdżają z krańca
  (pociąg tam zawraca) — nie ma „drugiego toru". `crossTrack` **nie zapala się**, gdy kolejna podmiana wsiada
  na krańcówce.
- **Auto** (post-pass w `planBreaks`): `crossTrack = true`, gdy peron **wsiadania** do kolejnej ≠ peron
  **oddania** poprzedniej, a czas na przejście **≤ 5 min** (`XFER_BUFFER_MIN`). `returnsOppositeTrack` ustala
  tylko, gdzie rezerwowy **stoi po oddaniu** (cała wraca tym samym torem; połówka/godzinka/szczeniak —
  przeciwnym). Pierwsza podmiana rezerwowego nigdy nie jest „ciasna".
- **Ręcznie**: przełącznik ⚠ w edytorze przerwy ([`BreakEditor`](src/components/BreakEditor.tsx)).
- UI pokazuje **⚠** w planie ([`ObiegCard`](src/components/ObiegCard.tsx)) i na pasku bocznym
  ([`ReservePanel`](src/components/ReservePanel.tsx)) tylko gdy `crossTrack=true`.

---

## 5. Rezerwowi i kolejność przetwarzania

- Rezerwowy podmienia **tylko na swojej stacji** (brak „pożyczania" z innej).
- **Zajętość liczona po INTERWAŁACH** (nie po pojedynczym „busyUntil"): rezerwowy może brać podmiany w
  **dowolnej kolejności czasowej** (np. wczesną całą po wcześniej zaplanowanej późnej połówce), o ile się
  nie nakładają (`freeAt`). To odblokowuje wolną wczesną moc przy planowaniu „bottleneck-first".
- **SCARCITY A11** (`A11_CALA_PENALTY`): **połówka jest możliwa tylko na A11**, więc moc A11 to wąskie gardło.
  **Całe są odpychane z A11** dużą karą w `score` (mają alternatywne stacje) — wchodzą na A11 tylko, gdy poza
  nią nie ma już wolnego rezerwowego (nadmiar). Zostawia to A11 dla połówek.
- Limit obciążenia: **3 całe** liczone w równowartości (cała=1, godzinka=⅔, połówka=0,5, szczeniak=⅓),
  nie w minutach (`MAX_RESERVE_LOAD_EQ`). 3 całe = 6 połówek = 2 całe+2 połówki = 1 cała+4 połówki.
  „Pełny" gdy równowartość ≥ 3.
- **Limit liczby podmian wg stacji** (`capOf`): na **A1 (Kabaty) tylko JEDEN** rezerwowy (rezerwa ruchowa) ma
  **domyślnie 1** podmianę i zostaje pod ręką (R17). Wskazanie: jawny flag `Reserve.rolling` (checkbox w panelu) >
  pierwszy niezablokowany rezerwowy A1. **Pozostali rezerwowi A1 pracują normalnie do 3 kół**. Inne stacje:
  bez limitu liczby (ogranicza je tylko 3 koła). Ręczny `Reserve.maxJobs` zawsze nadpisuje.
- **Maksymalne wykorzystanie:** dodatkowe przerwy (R16) rozdawane są tak, by dobić każdego rezerwowego
  (poza A1) do **pełnych 3 kół**. Dlatego druga **cała** jest dozwolona zawsze (nie tylko przy nadmiarze)
  — pokrycie (R9) jest już zapewnione wcześniej, a BRAK = brak rezerwowego na danej stacji (R14), więc
  dokładanie 2. przerwy gdzie indziej nie odbiera nikomu pokrycia.
- Pakowanie: najpierw dobijamy najczęściej używanego rezerwowego, świeżych zostawiamy na trudniejsze,
  późniejsze obiegi.
- Okno dostępności rezerwowego (`availFrom`/`availTo`, R18) i autoryzacje taboru są respektowane.
- **Kolejność — BOTTLENECK FIRST:** najpierw obiegi z **połówką/godzinką/szczeniakiem** (możliwe tylko na
  A11/A7/A18 — najbardziej ograniczone), potem z **całą** (elastyczne, mają wiele stacji). Dzięki temu
  połówki zajmują moc A11, zanim całe-nadmiar ją wezmą. W grupie — najmniej slotów najpierw, dalej
  najwcześniejszy zjazd, S przed full przed D. (Dawniej: całe pierwsze — przy ciasnej mocy A11 robiło BRAK.)
- **Pokrycie (R9) jest nadrzędne:** każdy obieg dostaje ≥ 1 przerwę. Najpierw `tryAssign` (preferowany rodzaj,
  okno ≤ 18:20). Gdy nie złapie wolnego rezerwowego — **pokrycie awaryjne** (`tryCover`): zejście na krótszy
  rodzaj (godzinka/połówka — **bez szczeniaka**), **to samo okno ≤ 18:20** (jedyna przerwa nie później).
- **Pass naprawczy (eviction)** — po pokryciu, przed R16: dla każdego BRAK obiegu silnik próbuje **zwolnić
  rezerwowego**, przenosząc jego dotychczasową (jedyną) podmianę na innego wolnego (`placeElsewhere`), po czym
  obsadza BRAK. Domyka pokrycie tam, gdzie greedy zostawił BRAK mimo wolnej mocy (elastyczny obieg na końcu).
  Dopiero gdy i to nie pomoże → **BRAK** (ręczna obsada / dodać rezerwowego na stacji z deficytem).
- Dodatkowe (drugie) przerwy z R16 rozdawane są **dopiero po** zapewnieniu pokrycia wszystkim obiegom.
