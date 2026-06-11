# Przerwy Metro M1 — specyfikacja zasad (wersja robocza)

> Ten plik to "kontrakt" silnika planowania przerw. **Uzupełnij / popraw reguły** — z tego buduję logikę.
> Status każdej reguły: ✅ potwierdzona · ❓ do potwierdzenia · ⬜ brak / do uzupełnienia
>
> Aktualizacja 2026-06-07: naniesione decyzje D1–D9 + E3/F4/F8 z `ANALIZA-ZASAD.md`.

---

## 1. Cel aplikacji

Zaplanować **podmiany maszynistów na przerwy** dla pociągów (obiegów) będących w ruchu po południu, zmiana druga.
Wynik = lista podmian: **kto podmienia · jaki pociąg/obieg · na której stacji · w którym kierunku · jak długa przerwa**.
Tryb: aplikacja **proponuje** plan, pomocnik instruktora **zatwierdza/zmienia** (hybryda).

## 2. Dane wejściowe

- **Rozkład obiegowy** (xlsx) — godziny przejazdu obiegów przez stacje pomiarowe `A1, A4, A7, A11, A14, A18, A23`, oba kierunki, typ pociągu (M/S), nr obiegu, UWAGI. Arkusze: `powszedni`, `piątek` (docelowo też sobota/niedziela/święto/wakacje).
- **Stacje przerwowe** (konfiguracja) — patrz `data/stations.json`.
- **Pula maszynistów rezerwowych** — liczba zmienna, **rozłożeni na 5 stacjach**: Kabaty (A1), Wilanowska (A7), Politechnika (A11), Plac Wilsona (A18), Młociny (A23) — _najczęściej_. To ogranicza opcje podmian. Imienny wykaz: [`DRUZYNY-GODZINY.md`](DRUZYNY-GODZINY.md).

## 3. Rodzaje przerw

| Rodzaj    | Czas       | Gdzie                                                                    |
| --------- | ---------- | ------------------------------------------------------------------------ |
| cała      | ~90 min ✅ | Kabaty A1, Młociny A23, Wilanowska A7, Plac Wilsona A18                  |
| godzinka  | ~60 min ✅ | A7 → Młociny, A18 → Kabaty (jazda do dalszego krańca i powrót)           |
| połówka   | ~45 min ✅ | Politechnika A11, Centrum A13 (uwaga: A14 = Świętokrzyska, INNA stacja)  |
| szczeniak | ~30 min ✅ | Wilanowska A7, Plac Wilsona A18 (w stronę Kabat) — _ale patrz reguła R6_ |

> Czasy 90/60/45/30 to **wartości poglądowe** pokazywane pomocnikowi. Silnik do planowania
> podmian liczy długość **realnie z rozkładu** (czas powrotu pociągu na tę samą stację). _(D1)_

## 4. Reguły (R)

- **R1** ✅ Przerwy dotyczą **tylko 2. zmiany**.
- **R2** ✅ **Okno startu przerwy.** Najwcześniej **14:30** (wszystkie rodzaje). **Dwa okna:**
  - **1. (główna) przerwa** — start najpóźniej **18:30** („19:10 = za późno"),
  - **2. (dodatkowa) przerwa** — okno dłuższe (do ~20:00); realnie limituje ją zjazd pociągu (R7).
  - **Preferencja czasu:** najlepsze przerwy startują w okolicy **16:00–17:30** — to tylko **bonus**: przy małej liczbie rezerwowych nie każdy się załapie, więc sloty **upychamy od 14:30**, żeby zdążyć z wszystkimi obiegami. _(D2)_
  - dobra alternatywa: **dwie połówki co 2–3 h**,
  - **najlepszy wariant: cała + połówka razem lub w niewielkim odstępie** (np. na sąsiednich kołach).
  - Brak slotu w oknie → BRAK (ręczna obsada).
- **R2a** ✅ **Nie zaczynaj przerw od pociągów (obiegów), które mają tylko połówki** — najpierw obsługuj obiegi kwalifikujące się do całych. **Nie zaczynaj też od szczytów (S)**, jeśli nie trzeba — wjeżdżają na linię najpóźniej. _(H3)_
- **R3** ✅ **Max 6h ciągłej pracy** bez przerwy — liczone **od realnego startu maszynisty** (13:00 / 13:30 / 14:00 wg drużyny), nie sztywno od 14:00. Dla startu 13:00 sześć godzin mija odpowiednio wcześniej. _(D4)_
- **R4** ✅ Stacja podmiany determinuje **długość przerwy** i **kierunek podmiany** (patrz `stations.json`).
- **R5** ✅ Liczba rezerwowych jest **ograniczona i rozłożona na 5 stacjach** → opcje podmiany są ograniczone.
- **R6** ✅ Gdy **mało osób do podmian** → nie można dać wszystkim **całej** przerwy; wtedy:
  - skracamy do połówek / szczeniaków,
  - **szczeniaki = ostateczność**, i wtedy stacja przerwowa dla szczeniaków to A7 lub A18
- **R7** ✅ Pociągi **wjeżdżające do ruchu po ~14:00** są do podmiany później, ALE **zjeżdżają przed ~20:00** → trzeba je podmienić **odpowiednio wcześnie**, by zdążyć przed zjazdem.
- **R8** ✅ Stacja **Centrum (A13)** dostępna jako przerwowa **tylko gdy > 15 rezerwowych**.
- **R9** ✅ **Każdy pociąg/obieg w ruchu dostaje przerwę OBOWIĄZKOWO** (pełne pokrycie).
- **R10** ✅ **Długość wg liczby kół 2. zmiany** (`countLoops2nd`, czasowo, bez zaokrąglania — patrz [`REGULY-PRZERW.md`](REGULY-PRZERW.md)): najmniej kół → **połówka**, najwięcej → **cała**.
  - **Próg połówki (E3):** obiegi z **≤ 3 koła = połówka ZAWSZE** (twardy próg).
  - **3–4 koła = elastycznie** — przy **nadwyżce** rezerwy dostają **całą**, przy **deficycie** schodzą na **połówkę** (decyduje bilans, §4a). „Zawsze połówka" powyżej 3 kół to **sugestia, nie sztywna reguła**.
  - Obiegi jadące do/po **21:00 = zawsze cała**.
- **R11** ✅ **Pociągi szczytowe (oznaczone literą `S` w rozkładzie, np. S23, S27…)** jeżdżą krócej → mogą dostać **połówkę** (nie potrzebują całej).
- **R12** ✅ **Szczeniak = ostateczność** (mało rezerwowych); robiony na **A7 (Wilanowska) w stronę Kabat** lub **A18 (Plac Wilsona) w stronę Młocin**. Politechnika (A11) robi **połówkę**, nie szczeniaka.
- **R13** ✅ **Limit pracy rezerwowego ≈ 5 h = 3 koła** łącznie podmian (np. 3 całe lub 6 połówek). **Maksymalne wykorzystanie:** poza A1 silnik dobija każdego rezerwowego do **pełnych 3 kół** (sumując wszystkie rodzaje przerw — cała=1, godzinka=⅔, połówka=½, szczeniak=⅓), żeby nie zostawiać niewykorzystanej mocy. Wyjątek: **A1** (patrz R17). Instruktor może zdecydować inaczej (ręczny `maxJobs`). _(F3)_
- **R14** ✅ **Rezerwowy podmienia TYLKO na swojej stacji** — podmienia pociąg tam, gdzie stoi; brak „teleportacji" między stacjami. Rozmieszczenie rezerwowych na 5 stacjach decyduje, gdzie możliwe są przerwy.
- **R15** ✅ **Sterowanie per maszynista (panel):** wykluczenie z podmian (blokada), maksymalna liczba podmian, oraz wymuszone przypisanie do konkretnego obiegu (pin — działa tylko gdy obieg jest na stacji tego rezerwowego).
- **R16** ✅ **Maksymalne wykorzystanie rezerwowych — wiele przerw na obieg.** Najpierw każdy obieg dostaje 1 obowiązkową przerwę (R9). Potem, dopóki są wolni rezerwowi (w limicie ~5h / 3 koła), rozdajemy **dodatkowe przerwy**: pociąg może mieć **>1 przerwę** (np. dwie połówki, cała+połówka, dwie całe) gdy rezerwowych jest dużo. Cel: nie marnować dostępnych rezerwowych. Kolejne przerwy tego samego obiegu muszą być **po powrocie maszynisty** z poprzedniej i w oknie 14:30–18:30. **Drabina dokładania (2026-06-11):** najpierw wszystkich do **1,5 koła** (2. połówka@A11), potem obiegi **≥4,5 koła** do **2,0** (2. cała off-A11 — A1/A7/A18/A23); **„dwa nie dla tych co robią <4,5"** (krótkie kończą na 1,5). Wcześniej silnik **rebalansuje w obrębie stacji** (bez nowych przerw), by dobić rezerwowych A1/A11. Wszystko do `min(3, maxJobs)`.

## 4a. ALGORYTM POMOCNIKA INSTRUKTORA (tok rozpisywania — docelowy silnik)

Kolejność decyzji tak, jak robi to pomocnik instruktora ręcznie:

**Krok 1 — bilans mocy:**

```
standby_koła = 0/1/2/3            (rezerwa ruchowa na Kabatach, R17; 3 = tryb trudny)
moc = (rezerwowi − 1) × 3 + standby_koła     (każdy ~3 całe ≈ 5 h)
deficyt = liczba_obiegów − moc
połówek = 2 × deficyt             (gdy deficyt > 0; inaczej 0)
całych  = liczba_obiegów − połówek
```

(uwzględnić R18: maszynista z krótszym oknem dostępności liczy mniej niż 3 koła)

> **Przy obecnej obsadzie (36 obiegów, ~14 rezerwowych):** moc = (14−1)×3 + 1 ≈ **40** > 36 →
> **deficyt ≤ 0 (nadwyżka)**, więc bilans nie wymusza połówek — każdy obieg może dostać całą,
> a połówki wynikają wtedy tylko z progu kół (R10, ≤ 3) i z geografii (połówki tylko A11/A13).
> Dopiero spadek rezerwy (≈ ≤ 12 osób) uruchamia deficyt i masowe połówki.

**Krok 2 — rozdanie całych:** najpierw CAŁE na wszystkich stacjach **oprócz A11** (Kabaty A1, Wilanowska A7, Plac Wilsona A18, Młociny A23).

**Krok 3 — rozdanie połówek (A11 Politechnika):** połówki dostają **najpierw szczyty (S)**, w kolejności **wg rosnącej liczby kół** (najmniej kół → pierwszy na połówkę). Szczyty z natury mają najmniej kół, więc trafiają pierwsze — **bez sztywnej listy**, kolejność wynika z rozkładu. _(D7)_

**Krok 4 — wyjątek:** szczytowi, który ma mieć **tylko połówki**, nie dawaj jej jako **pierwszej** — zaplanuj ją **między 1. pełnym kołem a 18:15** (nie od razu na starcie). _(D8/H7)_

**R17** ✅ Rezerwa ruchowa (Kabaty A1): na A1 stoi pociąg rezerwy ruchowej z maszynistą oddelegowanym do wprowadzania składu za pociąg, który uległ awarii / wymaga sprzątania. Dlatego **tylko JEDEN** rezerwowy z obsady A1 robi **DOMYŚLNIE max 1 koło** (jedną całą) i zostaje pod ręką — **pozostali rezerwowi na A1 robią normalnie do 3 kół**. Gdyby ten jeden też wyjechał na 3 koła, w razie nagłej potrzeby zabrakłoby maszynisty rezerwowego na Kabatach. Tryb **0/1/2/3 koła** dla tego jednego ustawia instruktor ręcznie (`maxJobs`); 3 = trudna obsada, brak odłożonej rezerwy. _(F4)_
**R18** ✅ Rezerwowi mają **okno dostępności [od–do]** (do 16:00 / do 18:00 / od 18:00 do rana). Przerwa musi się zmieścić: `start ≥ od` i `start + długość ≤ do`. „Od 18:00" robi całą (start 18:00 → wraca ~19:30).
**R19** ✅ Sterowanie: **„tylko moje obiegi"** (manualOnly) — rezerwowy robi wyłącznie wpisane piny, bez auto.
**R20** ✅ **Łapanie kolejnego pociągu z drugiej strony peronu.** Liczy się **moment między podmianami** jednego rezerwowego: po oddaniu pociągu musi czasem **przejść na drugą stronę toru**, żeby zdążyć na kolejną podmianę (częste — chodzi o to, by **nie rozciągać przerw**, tylko łapać szybko). To **nie** jest cecha samej połówki ani powrotu pociągu z przerwy. Silnik oznacza `crossTrack`, gdy peron **wsiadania** do kolejnej podmiany ≠ peron **oddania** poprzedniej, a czas na przejście **≤ 5 min**; planista może też zaznaczyć ręcznie. Wtedy **alert ⚠ „szybki przeskok (~5 min) — w razie czego dogadaj się z pociągiem"** widoczny **na przerwie w planie ORAZ na pasku bocznym „Rezerwowi na stacjach"**. Zwykłe podmiany (z zapasem czasu albo bez przesiadki na drugi tor) — bez ⚠. _(D9)_

## 5. Mechanika podmiany (✅ potwierdzona)

1. Rezerwowy czeka na stacji X. Gdy nadjeżdża pociąg (obieg) w kierunku K → **wsiada i prowadzi pociąg dalej**.
2. Maszynista schodzi na przerwę o długości D (zależnej od stacji/kierunku).
3. Pociąg robi pętlę i **wraca**; maszynista **wsiada z powrotem do swojego pociągu**.
4. Rezerwowy po oddaniu pociągu **wraca do puli rezerwy**
5. **Brak łańcucha** — maszynista po przerwie nie podmienia kolejnego, wraca na swój skład.
   → Czas D ≈ czas powrotu tego samego pociągu do punktu ponownego wsiadania.

## 6. Stacje (✅): A13 Centrum i A14 Świętokrzyska to DWIE RÓŻNE stacje. A14 jest w rozkładzie jako punkt pomiarowy; A13 Centrum trzeba interpolować między A11 a A14.

## 6a. Arkusz planowania pomocnika instruktora (✅ z fotki — PONIEDZIAŁEK–CZWARTEK)

Każda kolumna = jeden **obieg**. Oznaczenia: liczby 1–13 (całodzienne), `S##` (szczytowe), `D##` (dodatkowe). **Łącznie 36 obiegów — KAŻDY musi dostać przerwę.**

- **górna komórka** „godz. + stacja" = **wjazd na linię** wg rozkładu (np. S30 → 14:07 na A7),
- **dolna czarna** = **wyjazd z linii** (zjazd składu, np. 19:34),
- **dolna czerwona** = **do której godziny pracuje maszynista** (np. 21:00),
- puste, duże pole w środku kolumny = miejsce, gdzie pomocnik instruktora wpisuje **plan przerwy** (to generuje nasza apka).

## 7. Pytania otwarte (do rozstrzygnięcia)

_Brak — wszystkie rozstrzygnięte (patrz `ANALIZA-ZASAD.md`, decyzje D1–D9)._

> Rozstrzygnięte: czas samej podmiany — **zwykła pomijana, przeciwny tor = bufor 5 min + alert** (R20);
> każdy obieg ≥ 1 przerwa (R9), więcej przy nadmiarze rezerwy (R16); priorytet przy
> deficycie = najpierw całe, potem połówki, szczeniak ostateczność (R6, §4a); rezerwowy podmienia i
> wraca tylko na swojej stacji (R14).
