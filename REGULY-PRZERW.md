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

| Kryterium (ostatnie zdarzenie obiegu)                          | Koła                                     | Kto                            |
| -------------------------------------------------------------- | ---------------------------------------- | ------------------------------ |
| **zjazd ≥ 21:00** — zmiennik na linii / 3. zmiana / całodobowy | `Infinity`, zawsze cała (`throughShift`) | 1–13, D14, D15, D21            |
| **zjazd < 21:00** — maszynista sam zjeżdża na STP              | liczone                                  | wszystkie S, D16, D17–D20, D22 |

- Detekcja: `lastT >= RELIEF_ON_LINE` (21:00) → cała (nieliczone). Próg = deklarowana zmiana na
  linii „nie później niż 21:00".
- D17–D20 są liczone, ale mają najwięcej kół (~5,0–5,15) → ranking i tak daje im całą.
  D22 zjeżdża sam wcześnie (≈19:19) → realny kandydat na połówkę.

**Przykłady zweryfikowane (2026-06-07):**

| Obieg | Wjazd     | Zjazd                  | Koła |
| ----- | --------- | ---------------------- | ---- |
| S22   |           | 19:19                  | 4    |
| S23   | A11 14:41 | 19:54                  | 3,73 |
| S31   | A18 14:32 | 19:17                  | ~3,3 |
| S34   | —         | A23 (zjazd/sprzątanie) | 3,5  |
| D17   |           | 20:17                  | 5    |
| D18   |           | 20:17                  | 5    |
| D19   |           | 20:17                  | 5    |
| D20   |           | 20:17                  | 5    |

---

## 2. Rodzaj przerwy (połówka vs cała)

Decyduje liczba kół (`planBreaks`) — **BILANS = MAKSYMALIZUJ OBCIĄŻENIE** (2026-06-08/09, **kluczowa korekta
2026-06-11** potwierdzona ręcznym planem użytkownika: 12 rez × 3 = 36 obiegów → WSZYSCY po 3 całe, 0 połówek):

- **DOMYŚLNIE każdy obieg = PEŁNA PRZERWA (cała) — TAKŻE <4 koła.** „Daj jak najwięcej całych" = „maksymalnie
  obciążeni rezerwowi" (cała = 1 koło, połówka = ½). **Zniesiono dawny twardy próg „<4 koła = połówka zawsze"**
  (`HARD_POL_LOOPS`) — niepotrzebnie kradł całe ze stacji A1/A7/A23 i wrzucał fragmenty na A11, zostawiając
  rezerwowych na 2,0–2,5/3 zamiast pełnych 3,0. Połówki pojawiają się **WYŁĄCZNIE przy DEFICYCIE** (patrz niżej).
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
- **CAŁA@A11 = NORMALNA** (korekta 2026-06-11): A11 jest pełnoprawną stacją całych — w stanie pełnego
  obciążenia 5 rezerwowych A11 robi po 3 całe (15 całych w 3 falach ~85 min). Kara `A11_CALA_PENALTY`
  (odpychanie całych z A11) działa **TYLKO gdy są połówki** (deficyt) — wtedy rezerwuje A11 dla nich
  (`reserveA11ForPolowki`). Połówka jest możliwa **tylko na A11**.
- **TYLKO całe i połówki w automacie** — godzinka i szczeniak tylko ręcznie (godzinka = ryzyko przy awarii;
  szczeniak za słaby).
- Ręczny override (`forcedKinds`) > auto i jest **TWARDY** (fix 2026-06-12): obieg z wymuszonym rodzajem
  dostaje TYLKO ten rodzaj — bez downgrade'u w tryAssign/tryCover/B&B (wymuszona cała → cała albo BRAK;
  wcześniej przy deficycie bywała ścinana na połówkę i wymuszenie „nie działało"). (Nawrót racjonowania
  używa `forcedKinds` wewnętrznie.)

---

### 1b. Ręczne godziny pracy per obieg (od–do, 2026-06-12)

Pomocnik może obiegowi ustawić **„pracuje od" / „pracuje do"** (edytor przerwy; `entry2ndByObieg` /
`workEndByObieg` w App, `applyWorkHours` w `rozklad.ts`). Ustawienie **przelicza koła z rozkładu** w oknie
[od, do] (te same półpętle kraniec↔kraniec), nadpisuje `entry2nd` (dolna granica przerw, R3) i ustawia
`workEnd` — silnik **nie planuje przerwy, z której pociąg wraca po końcu pracy**. „Do" ≥ 21:00 = zmiennik
na linii → **całozmianowy** (∞, zawsze cała). Zmiana godzin od razu przelicza plan. Znacznik ✋ w stopce karty.

## 3. Okna startu przerwy

- **„ZACZNIJ OD" (domyślnie 14:30, `EARLIEST_DEFAULT`)** — ZALECENIE „nie wcześniej niż" (nie sztywna
  godzina; decyzja użytkownika 2026-06-12, **usunięto tolerancję +15′**), nadpisywalne na dwóch poziomach:
  **globalnie** (`earliest`) i **per obieg** (`earliestByObieg`). Precedencja: **per-obieg > globalny**.
  Pole w UI: „⏰ zacznij od" (poziom per stacja usunięty — decyzja użytkownika 2026-06-12).
  To **twarda dolna granica** (slotów wcześniej nie ma); w `score` po prostu „wcześniej = lepiej" od progu
  w górę. Pomocnik steruje wczesnym startem wyłącznie tym inputem — np. próg 14:00 pozwala obiegowi z wjazdem
  13:00 dostać przerwę tuż po 14:00. Naturalna serializacja rozkłada przerwy po popołudniu.
- **Dwa okna:**
  - **1. (= JEDYNA gwarantowana) przerwa** — start najpóźniej **18:20** (`LATEST_FIRST`). Reguła: **jedyna
    przerwa NIE może startować po 18:20** (pokrycie = 1 przerwa). Dodatkowo **R3**: `latestFirstOf =
min(18:20, entry2nd + 6 h)`. To samo okno obowiązuje w pokryciu awaryjnym (`tryCover`).
  - **2. (dodatkowa) przerwa** — okno dłuższe, do **20:00** (`LATEST_SECOND`); realnie limituje ją
    zjazd pociągu (musi wrócić, zanim zjedzie — patrz §1).
- **§4a krok 4** (`coverWindow`, próg `POL_LATE_LOOPS = 3,5`): **samotna połówka obiegu ≥ 3,5 koła NIE może
  być pierwszą podmianą** — dół okna = **entry2nd + 1 koło**, góra = **18:15** (`ONLY_POL_LATEST`). Obieg
  **< 3,5 koła** (drobny szczyt) MOŻE mieć połówkę wcześnie (od progu z ustawień). **WYJĄTEK: gdy rezerwowych
  jest < 10** (`enoughReserves`) reguła znika — przy ciasnej obsadzie pakujemy wszystko najwcześniej, by się
  zmieściło. Decyzja użytkownika 2026-06-09.

### 3a. Druga (dodatkowa) przerwa — kombinacje

Obieg może mieć max 2 przerwy (`MAX_BREAKS_PER_OBIEG`). R16 = pokrycie + **MAKSYMALNE WYKORZYSTANIE MOCY**:
**każdy rezerwowy do `min(3 koła, maxJobs)`** — chyba że planista ręcznie ustawi niższy limit (`maxJobs`).
(decyzja użytkownika 2026-06-11, SUPERSEDUJE 2026-06-10). Bramka: **brak realnego BRAK**. Etapy:

- **BILANS NADWYŻKI Z GÓRY** (decyzja użytkownika 2026-06-12): gdy `moc > zapotrzebowanie`, silnik **od
  początku** zna liczbę nadmiarowych połówek (`extraHalves = (moc − eq) × 2`) i już przy rozkładaniu całych
  rezerwuje pod nie A11 (`reserveA11ForPolowki = true` → całe odpychane z A11 wypełniają moc off-A11).
  Bez tego całe zjadały A11 i nadwyżka nie miała gdzie wejść (rezerwowi off-A11 zostawali np. na 2,0/3).
- **KROK 0 — REBALANS w obrębie stacji (bez nowych przerw):** pakuje pojedyncze przydziały, dobijając
  rezerwowych najbliższych pełna kosztem najmniej obciążonych **tej samej stacji** (rezerwowy podmienia tylko
  u siebie). Maksymalizuje liczbę rezerwowych na 3,0; nadmiarowi zostają widocznie wolni (do zwolnienia ręcznie).
  Naprawia nierówny rozkład A1/A11 w planach z połówkami. Nie zmienia rodzajów/slotów → nie łamie reguł.
- **KROK 0b — PROMOTE połówek → CAŁA (fix 2026-06-12):** przy ciasnym upakowaniu (np. indywidualne
  `maxJobs`) nawrót tnie WIĘCEJ obiegów niż bilans i rezerwowi stacji „od całych" (A1/A7/A18/A23) zostają
  niedociążeni, bo połówka możliwa tylko na A11. AUTOMATYCZNE połówki obiegu (najbardziej kołowi pierwsi —
  odwracamy cięcie od góry) zamieniane na **CAŁĄ** u wolnego rezerwowego; zwolniona moc A11 wraca do puli
  (drabina dołoży z niej 2. połówki). Wymuszonych (`forced`) i ręcznych (✎) nie rusza; netto obciążenie
  tylko rośnie. Całe R16 ma **gwarantowany świeży budżet ~150 ms** (`r16Deadline`) — głęboki nawrót zjadał
  `planDeadline` i zwycięski plan wychodził bez dociążenia.
- **KROK 0c — SPRAWIEDLIWA ZAMIANA OFIAR CIĘCIA (`swapCutVictims`, 2026-06-12, skarga „D16 pół, D19 pół"):**
  pokrycie awaryjne/eviction potrafi pociąć obieg WYSOKOKOŁOWY, choć niżej-kołowy trzyma całą. Naprawa:
  obieg na samotnej połówce (eq<1, auto) dostaje CAŁĄ, a **najmniej-kołowy** posiadacz auto-całej schodzi
  na połówkę@A11 (staje się ofiarą zgodną z bilansem „tnij najmniej kół"). Pełny rollback przy porażce.
  Odpalany dwa razy: po PROMOTE i po drabinie. **REBALANS, PROMOTE i ZAMIANA działają także przy BRAK**
  (nie dokładają 2. przerw — tylko pakują/przestawiają rodzaje wg porządku kół); same dokładki (PASS A/B/C
  niżej) wciąż TYLKO przy 0 BRAK.
- **DOKŁADKI — TRZY PASSY (przebudowa 2026-06-12, sprawiedliwość):**
  **PASS A** — najpierw WSZYSCY DO PEŁNEJ: obieg z samą połówką (0,5) dostaje 2. połówkę (2×½ = pełna),
  zanim ktokolwiek dostanie 1,5 (skarga „D16 pół, a całodobowe półtora"); wysokokołowi pierwsi.
  **PASS B** — dopiero potem 1,5: obiegi z całą dobijane 2. połówką OD NAJWIĘCEJ KÓŁ (drabina jak dotąd).
  **PASS C** — REDYSTRYBUCJA: jeśli mimo PASS A ktoś tkwi na 0,5, a inny ma 1,5 — zabierz 2. połówkę
  (auto) najmniej-kołowemu z 1,5 (próbując KAŻDĄ jego połówkę — wczesna z pary zwalnia inną moc niż późna)
  i dobij nią obieg na 0,5; nie wyszło → przywróć (0,5 zostaje tylko, gdy fizyka okien nie pozwala inaczej).
- **DRABINA DOCIĄŻANIA (nadmiarowe połówki) — SPRAWIEDLIWIE** (2026-06-11, przebudowa 2026-06-12): każdy
  obieg dobijamy do **1,5 koła** **POŁÓWKĄ** (możliwa tylko na A11 → dociąża rezerwowych A11), w kolejności
  **OD NAJWIĘCEJ KÓŁ** (`loopKey` malejąco; całozmianowi = ∞ pierwsi). Dopóki `roomLeft` (rezerwowy <
  `min(3, maxJobs)`). **Połówka NIE musi być druga chronologicznie — może być PIERWSZA** (wczesna, od progu
  „zacznij od"), a cała później; **zero wymuszonego rozsuwu** (usunięto `SPACING_POLOWKI` ~2,5 h — „może być
  od razu, jeden maszynista robi od razu półtorej, albo po czasie, ta sama lub inna stacja — pełna dowolność").
  Jedyny warunek: przerwy obiegu się **nie nakładają**; pierwsza-z-pary mieści się w oknie 1. przerwy
  (≤ min(18:20, wjazd+6h)). Gdy wczesna połówka koliduje z już ustawioną całą — silnik **przesuwa całą** na
  inny slot (para planowana łącznie, `addExtraHalf`). **NIKT nie dostaje 2,0** (2. zawsze połówka) — to
  wyrównuje (równo-kołowi traktowani identycznie). Nadwyżkowa moc off-A11 (połówki tam nie wejdą) zostaje
  **WOLNA**. Limit `MAX_BREAKS_PER_OBIEG = 2`; bez RNG (determinizm), bezpiecznik `planDeadline`.
- Dokładki tylko **cała / połówka**. **Godzinka i szczeniak NIE są dokładane automatycznie** (patrz niżej).

---

## 4. Stacje podmian

Konfiguracja w [`src/lib/stations.ts`](src/lib/stations.ts) / `data/stations.json`:

| Stacja             | Rodzaje przerw            | Kierunek                               |
| ------------------ | ------------------------- | -------------------------------------- |
| A1 (Kabaty)        | cała                      | oba (krańcówka)                        |
| A7 (Wilanowska)    | cała, godzinka, szczeniak | godzinka ↑ Młociny, szczeniak ↓ Kabaty |
| A11 (Politechnika) | cała, połówka             | oba                                    |
| A18 (Plac Wilsona) | cała, godzinka, szczeniak | godzinka ↓ Kabaty, szczeniak ↑ Młociny |
| A23 (Młociny)      | cała                      | oba (krańcówka)                        |

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
> „godzinka" liczona jak połówka/szczeniak (powrót w przeciwnym kierunku), ale do dalszego krańca:
> A7→Młociny ≈ 58 min, A18→Kabaty ≈ 62–66 min (realnie z rozkładu).

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
- **Wykorzystanie nadmiaru (R16, przebudowa 2026-06-12):** nadwyżka policzona **Z GÓRY w bilansie**
  (`extraHalves`), A11 zarezerwowane pod nią od startu. KROK 0 = REBALANS w obrębie stacji (pakuje istniejące
  przydziały, bez nowych przerw), potem DRABINA nadmiarowych połówek (najwięcej-kołowi pierwsi, do 1,5;
  połówka może być PIERWSZA, bez rozsuwu, z relokacją kolidującej całej). Cel: **każdy rezerwowy do
  `min(3, maxJobs)`**. Patrz §3a.
- Pakowanie: najpierw dobijamy najczęściej używanego rezerwowego, świeżych zostawiamy na trudniejsze,
  późniejsze obiegi.
- Okno dostępności rezerwowego (`availFrom`/`availTo`, R18) i autoryzacje taboru są respektowane.
- **PRZYDZIAŁ — DOPASOWANIE (ścieżki powiększające / Kuhn) → potem B&B → greedy** (`optimizeExact`):
  - **FAST PATH — `tryFullMatch` (kluczowe, 2026-06-11; wzmocnienia 2026-06-12):** dopasowanie z nawrotami
    szuka każdemu obiegowi jego DOCELOWEGO rodzaju (dg=0) bez ani jednego downgrade'u; w razie kolizji
    czasowej RELOKUJE już przypisane (rekurencyjnie). Sukces ⇒ **0 połówek = maksymalne obciążenie** (12 rez
    → wszyscy po 3 całe, ~15–30 ms). Dlaczego nie sam B&B: przy ZEROWYM luzie (36 całych = 36 mocy) naiwny
    branch-and-bound nie znajduje pełnego upakowania (2,6 mln węzłów bez liścia — brak inkumbenta = brak
    przycinania). Poprawność+pełność dopasowania: `oid` wstawiamy NAJPIERW (zajmuje miejsce), relokowane
    (nachodzące) nie wracają na tego rezerwowego; `moving` blokuje cykle; restart z inną kolejnością (seeded
    → **różne warianty „Generuj plan"**, wszystkie po 3 koła). **Limity rezerwowego = DWA OSOBNE (2026-06-12):
    RÓWNOWARTOŚĆ ≤ 3,0 eq + LICZBA podmian (maxJobs/rolling)** — dawny wspólny cap `min(3, maxJobs)` liczył
    sztuki, nie eq (2 całe + 2 połówki = 4 sztuki = legalne 3,0). **Relokacja także z powodu POJEMNOŚCI**
    (nie tylko kolizji czasowej): gdy eq/liczba blokuje, wypierane są największe-eq podmiany. Dwie kolejności
    bazowe (MRV + najtrudniejsi-najpierw, na przemian). Pomijany przy pinach i w nawrocie (deficyt). Budżet
    ~250 ms → spada do B&B.
  - **B&B (`dfs`, branch-and-bound):** gdy pełne dopasowanie się nie składa (DEFICYT), przeszukiwanie z nawrotami
    MINIMALIZUJĄCE liczbę downgrade'ów. Placements = docelowy rodzaj (dg=0) + dla całej połówka (dg=1, tylko
    <4,5 koła); **cała@A11 dozwolona**. Przycinanie: inkumbent + suma `minDg` + dedup pustych + MRV. Gdy po
    `NO_INCUMBENT_BAIL` węzłach brak ŻADNEGO rozwiązania (to samo zero-luzu) → szybki fallback do greedy (UI bez laga).
- **Kolejność greedy (FALLBACK, gdy optymalizator nie znajdzie planu — np. obsada przeciążona co do koła):**
  - **FAZA 1:** CAŁE **poza A11** (A1/A7/A18/A23). W obrębie całych: **CAŁOZMIANOWE/całodobowe pierwsze**
    (`criticalRank`, `isThrough`), potem **MALEJĄCO PO KOŁACH** (`loopKey`). Nadmiar czeka na fazę 3.
  - **FAZA 2:** dedykowane **POŁÓWKI szczytów na A11** — zajmują A11, zanim wejdzie tam nadmiar całych.
  - **FAZA 3:** nadmiar całych → cała off-A11; gdy brak → **CAŁA@A11** (a11 też może być cała); ostatecznie
    połówka@A11 → BRAK.
  - **NAWRÓT — ITERACYJNY Z LOOKAHEAD (przebudowa 2026-06-12):** przy BRAK tniemy kolejnych NAJMNIEJ-KOŁOWYCH
    z całych na połówki (kumulatywnie, GŁĘBIEJ o 1 na iterację) i bierzemy NAJLEPSZY plan (najmniej BRAK). Każda
    próba to szybki SKAN (`scanOnly` — tylko pokrycie, bez dokładek). Przechodzi przez PLATEAU (cięcie chwilowo
    nie zmniejsza BRAK), bo bilans eq nie widzi OKIEN czasowych (A11 mieści w oknie ≤18:20 ~5 połówek). Stop:
    0 BRAK / `STALL_CUTS=12` bez poprawy / deadline. Zwycięskie cięcia przeliczone w pełni.
  - **MAKSYMALNE POKRYCIE Z PRIORYTETEM KÓŁ (`maxCoverMatch`, 2026-06-12):** gdy po greedy/nawrocie został BRAK,
    budujemy DOPASOWANIE ścieżkami powiększającymi (Kuhn) na świeżym modelu, przetwarzając obiegi **OD NAJWIĘCEJ
    KÓŁ** — wysokokołowy zajmuje miejsce pierwszy i augmentacja go NIE wypycha, więc nieobsadzeni to NAJMNIEJ
    kołowi (`D19/5,0 NIGDY nie BRAK, gdy niżej-kołowy ma przerwę`). Placements wszystkich rodzajów sort po SCORE
    (pokrycie nadrzędne — preferowanie całych zmniejszałoby liczbę pokrytych). Limity eq≤3 i liczby podmian
    respektowane. **Adoptujemy TYLKO gdy pokrywa WIĘCEJ** obiegów (nie regresuje). Kind-fairness (wysokokołowy=
    cała) poprawia potem `swapCutVictims`; w głębokim deficycie część cała@A11↔połówka@A11 bywa nieprzestawialna
    (geometria czasów A11) — oba i tak POKRYTE.
- **Pokrycie (R9) jest nadrzędne:** każdy obieg dostaje ≥ 1 przerwę. Najpierw `tryAssign` (preferowany rodzaj,
  okno ≤ 18:20). Gdy nie złapie wolnego rezerwowego — **pokrycie awaryjne** (`tryCover`): zejście na krótszy
  rodzaj (**połówka** — bez godzinki i szczeniaka), **to samo okno ≤ 18:20** (jedyna przerwa nie później).
- **Pass naprawczy (eviction)** — po pokryciu, przed R16: dla każdego BRAK obiegu silnik próbuje **zwolnić
  rezerwowego**, przenosząc jego dotychczasową (jedyną) podmianę na innego wolnego (`placeElsewhere`), po czym
  obsadza BRAK. **Relokacja ZACHOWUJE wielkość przerwy** (długodystansowiec → cała, szczyt → połówka — eviction
  nie krzywdzi nikogo połówką). Dopiero gdy i to nie pomoże → **BRAK** (dodać rezerwowego na stacji z deficytem).
- **R16 DOPIERO przy 0 BRAK** (bramka `hasBrak`). Wewnątrz: KROK 0 rebalans w obrębie stacji (bez nowych
  przerw) → RUNDA A (krótkie <4,5 do 1,5) → RUNDA B (długodystansowce ≥4,5 do 2,0, off-A11). Dokładamy tylko
  dopóki rezerwowi < `min(3, maxJobs)` (`roomLeft`); ręczny `maxJobs` jest respektowany. Patrz §3a.
