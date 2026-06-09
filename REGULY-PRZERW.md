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

Decyduje liczba kół (`planBreaks`) — **BILANS NADRZĘDNY + sprawiedliwość** (2026-06-08/09):

- **DOMYŚLNIE każdy obieg = PEŁNA PRZERWA (cała).** „Daj jak najwięcej całych." Przy nadwyżce mocy nawet
  szczyt 3–4 koła dostaje całą (niekoniecznie na A11 — patrz uwaga niżej).
- **TWARDY próg: ≤ 3 koła = POŁÓWKA ZAWSZE** (`HARD_POL_LOOPS`, R10 E3). To JEDYNE wymuszone połówki przy
  nadwyżce (w realnych danych zbiór bywa pusty — najniższy szczyt ≈ 3,4 koła → przy nadwyżce wszyscy = cała).
- **CAŁOZMIANOWY = jak całodobowy** (`isThrough`): auto (`throughShift`, zjazd ≥ 21:00, `Infinity`) **lub
  ręczne wskazanie pomocnika** (`throughShiftOverride`, znaczek 🔁 w `ObiegCard`). ZAWSZE cała (wykluczony
  z racjonowania), priorytet pokrycia, kosztem szczytów (uwaga użytkownika: „nie może mieć pół, gdy jest
  możliwość na całą kosztem szczytów").
- **BILANS MOCY:** `moc = Σ min(3, capOf)` po rezerwowych **BEZ rezerwy ruchowej A1** (Kopyt — jego 1 koło to
  bufor pod ręką, R17, nie planowana moc; tak liczy pomocnik: „10 do pełnej dyspozycji = 30"). Zapotrzebowanie
  `eq = Σ (połówka 0,5 / pełna 1,0)`. Gdy `eq > moc` → **RACJONOWANIE**.
- **RACJONOWANIE (cięcie wg kół):** gdy mocy brak, tniemy całe→połówki **NAJMNIEJ KÓŁ NAJPIERW** (rozszerzamy
  zbiór połówek w górę po kołach od >3), aż `eq ≤ moc`. Najbliższy progu cięty przed prawdziwym
  długodystansowcem. Bilans jest nadrzędny: jeśli matematycznie się mieści — silnik to upakowuje; jeśli nie —
  cięcie wg kół, a w ostateczności BRAK (sygnał „dodać rezerwowego"), **nie** krzywdząca połówka dla wysokokołowego.
- **„ROZBICIE" całej na A11:** na A11 **automat nie nadaje całych** — pełną przerwę długodystansowca daje jako
  **2 połówki** (drobniejsze ~45-min bloki = ciaśniejsze pakowanie i więcej opcji podmian). Cała@A11 dopuszczona
  tylko jako overflow/ostateczność (faza 3) i ręcznie. Połówka jest możliwa **tylko na A11**.
- **TYLKO całe i połówki w automacie** — godzinka i szczeniak tylko ręcznie (godzinka = ryzyko przy awarii;
  szczeniak za słaby).
- Ręczny override (`forcedKinds`) > auto. (Nawrót racjonowania używa `forcedKinds` wewnętrznie.)

---

## 3. Okna startu przerwy

- **„ZACZNIJ OD" (domyślnie 14:30, `EARLIEST_DEFAULT`)** — CEL startu przerw, nadpisywalny na trzech poziomach:
  **globalnie** (`earliest`), **per stacja** (`earliestByStation`) i **per obieg** (`earliestByObieg`).
  Precedencja: **per-obieg > per-stacja > globalny**. Pola w UI: „⏰ zacznij od (+15′)" + rząd „per stacja".
  To zarazem **twarda granica** (slotów wcześniej nie ma) i **kotwica rozkładania**.
- **Rozkładanie od „zacznij od" + TOLERANCJA 15 min** (`START_TOLERANCE`, decyzja użytkownika 2026-06-09):
  `score` po `scarcity` (patrz §4/§5) traktuje sloty w oknie **[próg, próg + 15 min] jako równie dobre**
  (score 0 → luz na lepsze upakowanie rezerwowych), a powyżej tolerancji score rośnie liniowo. Moc rezerwowych
  wypełnia się blisko docelowego startu, a naturalna serializacja rozkłada przerwy po popołudniu.
- **Dwa okna:**
  - **1. (= JEDYNA gwarantowana) przerwa** — start najpóźniej **18:20** (`LATEST_FIRST`). Reguła: **jedyna
    przerwa NIE może startować po 18:20** (pokrycie = 1 przerwa). Dodatkowo **R3**: `latestFirstOf =
    min(18:20, entry2nd + 6 h)`. To samo okno obowiązuje w pokryciu awaryjnym (`tryCover`).
  - **2. (dodatkowa) przerwa** — okno dłuższe, do **20:00** (`LATEST_SECOND`); realnie limituje ją
    zjazd pociągu (musi wrócić, zanim zjedzie — patrz §1).
- **§4a krok 4** (`coverWindow`, próg `POL_LATE_LOOPS = 3,5`): **samotna połówka obiegu ≥ 3,5 koła NIE może
  być pierwszą podmianą** — dół okna = **entry2nd + 1 koło**, góra = **18:15** (`ONLY_POL_LATEST`). Obieg
  **< 3,5 koła** (drobny szczyt) MOŻE mieć połówkę wcześnie (od progu z ustawień). Decyzja użytkownika 2026-06-09.

### 3a. Druga (dodatkowa) przerwa — kombinacje

Obieg może mieć max 2 przerwy (`MAX_BREAKS_PER_OBIEG`). R16 = pokrycie + **MAKSYMALNE WYKORZYSTANIE MOCY**
(~4,5 h = 3 koła/rezerwowego, R13; decyzja użytkownika 2026-06-09: „rezerwowi wykorzystani na maxa"). Bramka:
**brak realnego BRAK**. Dwie fazy:

- **PASS A — „dobij WSZYSTKICH do pełnej":** obieg `dk = cała` z dopiero JEDNĄ połówką@A11 (overflow z fazy 3)
  → dostaje **2. połówkę → 2×½ = pełna** (rozsunięte ~2,5 h, `SPACING_POLOWKI`). Najpierw wszyscy mają pełną.
- **PASS B — „wypełnij rezerwowych do 3 kół":** obiegowi `dk = cała` z 1 przerwą dokładamy 2., w kolejności
  **malejąco po kołach** (całozmianowe/najdłuższe pierwsze — pracują najdłużej, R3). **Preferujemy POŁÓWKĘ →
  1,5** („najlepiej rozbijaj na półtorej", uwaga 4); gdy połówki się nie da — **CAŁĄ → 2×cała** (dobicie
  rezerwowych OFF-A11 A1/A7/A18/A23, których połówką nie zapełnimy — połówka tylko na A11). Szczyt
  (`dk = połówka`) 2. przerwy NIE dostaje (#4). Pass B rusza po Pass A → nikt nie dostaje 2. przerwy, póki
  inni (których da się dopełnić) nie mają pełnej; kolejność longest-first chroni sprawiedliwość.
- Dokładki tylko **cała / połówka**. **Godzinka i szczeniak NIE są dokładane automatycznie** (patrz niżej).

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

**Preferowany KIERUNEK (tor) podmiany — MIĘKKO** (`DIR_PREF`, decyzja użytkownika 2026-06-09; tor 1 = Młociny,
tor 2 = Kabaty): **A1, A7 → Kabaty** (tor 2); **A18, A23 → Młociny** (tor 1); **A11 → oba** (bez preferencji).
To preferencja w `score` (`DIR_PENALTY` ~6 min), nie twarda reguła — silnik miesza kierunki, gdy wymaga tego
pokrycie lub znacząco lepszy czas startu.

> **Automat nadaje TYLKO całe i połówki** (`AUTO_KINDS` = cała/połówka). Godzinka i szczeniak — **tylko
> ręcznie** w edytorze. Godzinka: większy wysiłek planistyczny i ryzyko przy awarii; szczeniak: za słaby.
> Gdy całą/połówką się nie da → BRAK (sygnał do ręcznej obsady), nie godzinka/szczeniak. A11 uciągnie nawet
> ~30 połówek na 5 maszynistów, więc całe trzymamy poza A11, a połówki na A11.
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
- **Wykorzystanie nadmiaru (R16, ~4,5 h):** najpierw Pass A dobija WSZYSTKICH do pełnej przerwy (samotne
  połówki → 2×½), potem Pass B **wypełnia rezerwowych do 3 kół** — najdłuższe pierwsze, **preferując półtorej**
  (cała+połówka), a gdy połówki się nie da — **2×cała** (dobicie off-A11). Patrz §3a.
- Pakowanie: najpierw dobijamy najczęściej używanego rezerwowego, świeżych zostawiamy na trudniejsze,
  późniejsze obiegi.
- Okno dostępności rezerwowego (`availFrom`/`availTo`, R18) i autoryzacje taboru są respektowane.
- **Kolejność — CAŁE PIERWSZE (FAZY, jak liczy pomocnik instruktora §4a krok2→3):**
  - **FAZA 1:** CAŁE **poza A11** (A1/A7/A18/A23). W obrębie całych: **CAŁOZMIANOWE/całodobowe pierwsze**
    (`criticalRank`, `isThrough`), potem **MALEJĄCO PO KOŁACH** (`loopKey`) — długodystansowce zajmują całe
    off-A11 przed szczytami (uwaga 5). Nadmiar, który nie wszedł poza A11, czeka na fazę 3.
  - **FAZA 2:** dedykowane **POŁÓWKI szczytów na A11** — zajmują A11, zanim wejdzie tam nadmiar całych.
  - **FAZA 3:** nadmiar całych → cała na **dowolnej wolnej stacji off-A11**; gdy brak → **połówka@A11**
    (1. połowa; R16/Pass A dopełnia do 2×½ = pełna). **Automat NIE stawia cała@A11** (A11 = rozbicie na 2×½,
    uwaga 3). Gdy nic nie wchodzi → BRAK.
  - **NAWRÓT (cięcie wg kół):** jeśli mimo to został BRAK, tnij następnego najmniej-kołowego z całych na połówkę
    (`forcedKinds`) i przelicz od nowa; bierz wynik tylko, gdy zmniejsza BRAK. (Dawniej: bottleneck-first =
    połówki/szczyty PIERWSZE — przez to całodobowe szły na BRAK, a szczyty dostawały po 2 przerwy.)
- **Pokrycie (R9) jest nadrzędne:** każdy obieg dostaje ≥ 1 przerwę. Najpierw `tryAssign` (preferowany rodzaj,
  okno ≤ 18:20). Gdy nie złapie wolnego rezerwowego — **pokrycie awaryjne** (`tryCover`): zejście na krótszy
  rodzaj (**połówka** — bez godzinki i szczeniaka), **to samo okno ≤ 18:20** (jedyna przerwa nie później).
- **Pass naprawczy (eviction)** — po pokryciu, przed R16: dla każdego BRAK obiegu silnik próbuje **zwolnić
  rezerwowego**, przenosząc jego dotychczasową (jedyną) podmianę na innego wolnego (`placeElsewhere`), po czym
  obsadza BRAK. **Relokacja ZACHOWUJE wielkość przerwy** (długodystansowiec → cała, szczyt → połówka — eviction
  nie krzywdzi nikogo połówką). Dopiero gdy i to nie pomoże → **BRAK** (dodać rezerwowego na stacji z deficytem).
- **R16 DOPIERO przy 0 BRAK** (bramka `hasBrak`). Wewnątrz: Pass A (wszyscy do pełnej) → Pass B (wypełnianie
  rezerwowych, najdłuższe pierwsze). Kolejność longest-first + „Pass A najpierw" chronią sprawiedliwość —
  2. przerwa idzie do najdłuższych dopiero, gdy dopełnialnych do pełnej już nie ma.
