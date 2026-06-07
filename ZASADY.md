# Przerwy Metro M1 — specyfikacja zasad (wersja robocza)

> Ten plik to "kontrakt" silnika planowania przerw. **Uzupełnij / popraw reguły** — z tego buduję logikę.
> Status każdej reguły: ✅ potwierdzona · ❓ do potwierdzenia · ⬜ brak / do uzupełnienia

---

## 1. Cel aplikacji

Zaplanować **podmiany maszynistów na przerwy** dla pociągów (obiegów) będących w ruchu po południu, zmiana druga.
Wynik = lista podmian: **kto podmienia · jaki pociąg/obieg · na której stacji · w którym kierunku · jak długa przerwa**.
Tryb: aplikacja **proponuje** plan, pomocnik instruktora **zatwierdza/zmienia** (hybryda).

## 2. Dane wejściowe

- **Rozkład obiegowy** (xlsx) — godziny przejazdu obiegów przez stacje pomiarowe `A1, A4, A7, A11, A14, A18, A23`, oba kierunki, typ pociągu (M/S), nr obiegu, UWAGI. Arkusze: `powszedni`, `piątek` (docelowo też sobota/niedziela/święto/wakacje).
- **Stacje przerwowe** (konfiguracja) — patrz `data/stations.json`.
- **Pula maszynistów rezerwowych** — liczba zmienna, **rozłożeni na 5 stacjach**: Kabaty (A1), Wilanowska (A7), Politechnika (A11), Plac Wilsona (A18), Młociny (A23) — _najczęściej_. To ogranicza opcje podmian.

## 3. Rodzaje przerw

| Rodzaj    | Czas       | Gdzie                                                                    |
| --------- | ---------- | ------------------------------------------------------------------------ |
| cała      | ~90 min ❓ | Kabaty A1, Młociny A23, Wilanowska A7, Plac Wilsona A18                  |
| połówka   | ~45 min ❓ | Politechnika A11, Centrum A13 (uwaga: A14 = Świętokrzyska, INNA stacja)  |
| szczeniak | ~30 min ❓ | Wilanowska A7, Plac Wilsona A18 (w stronę Kabat) — _ale patrz reguła R6_ |

## 4. Reguły (R)

- **R1** ✅ Przerwy dotyczą **tylko 2. zmiany**.
- **R2** ✅ **Okno startu przerwy.** Najwcześniej **14:30** (wszystkie rodzaje). **Dwa okna:**
  - **1. (główna) przerwa** — start najpóźniej **18:30** („19:10 = za późno"),
  - **2. (dodatkowa) przerwa** — okno dłuższe (do ~20:00); realnie limituje ją zjazd pociągu (R7).
  - **Preferencja czasu:** najlepsze przerwy startują w okolicy **16:00–17:30**,
  - dobra alternatywa: **dwie połówki co 2–3 h**,
  - **najlepszy wariant: cała + połówka razem lub w niewielkim odstępie** (np. na sąsiednich kołach).
  - Brak slotu w oknie → BRAK (ręczna obsada).
- **R2a** ✅ **Nie zaczynaj przerw od pociągów (obiegów), które mają tylko połówki** — najpierw obsługuj obiegi kwalifikujące się do całych.
- **R3** ❓ **Max 6h ciągłej pracy** bez przerwy. _Liczone od czego?_ ( od stałej godziny 14:00)
- **R4** ✅ Stacja podmiany determinuje **długość przerwy** i **kierunek podmiany** (patrz `stations.json`).
- **R5** ✅ Liczba rezerwowych jest **ograniczona i rozłożona na 5 stacjach** → opcje podmiany są ograniczone.
- **R6** ❓ Gdy **mało osób do podmian** → nie można dać wszystkim **całej** przerwy; wtedy:
  - skracamy do połówek / szczeniaków,
  - **szczeniaki = ostateczność**, i wtedy stacja przerwowa dla szczeniaków to A7 lub A18
- **R7** ✅ Pociągi **wjeżdżające do ruchu po ~14:00** są do podmiany później, ALE **zjeżdżają przed ~20:00** → trzeba je podmienić **odpowiednio wcześnie**, by zdążyć przed zjazdem.
- **R8** ❓ Stacja **Centrum (A13)** dostępna jako przerwowa **tylko gdy > 15 rezerwowych**.
- **R9** ✅ **Każdy pociąg/obieg w ruchu dostaje przerwę OBOWIĄZKOWO** (pełne pokrycie).
- **R10** ✅ **Długość wg liczby kół 2. zmiany** (`countLoops2nd`, czasowo, bez zaokrąglania — patrz [`REGULY-PRZERW.md`](REGULY-PRZERW.md)): najmniej kół → **połówka**, najwięcej → **cała**. Obiegi z ≤ 2,5 koła zawsze połówka; obiegi jadące do/po 21:00 zawsze cała.
- **R11** ✅ **Pociągi szczytowe (oznaczone literą `S` w rozkładzie, np. S23, S27…)** jeżdżą krócej → mogą dostać **połówkę** (nie potrzebują całej).
- **R12** ✅ **Szczeniak = ostateczność** (mało rezerwowych); robiony na **A7 (Wilanowska) w stronę Kabat** lub **A18 (Plac Wilsona) w stronę Młocin**. Politechnika (A11) robi **połówkę**, nie szczeniaka.
- **R13** ✅ **Limit pracy rezerwowego ≈ 4,5 h** łącznie podmian (np. 3 całe lub 6 połówek = 270 min).
- **R14** ✅ **Rezerwowy podmienia TYLKO na swojej stacji** — podmienia pociąg tam, gdzie stoi; brak „teleportacji" między stacjami. Rozmieszczenie rezerwowych na 5 stacjach decyduje, gdzie możliwe są przerwy.
- **R15** ✅ **Sterowanie per maszynista (panel):** wykluczenie z podmian (blokada), maksymalna liczba podmian, oraz wymuszone przypisanie do konkretnego obiegu (pin — działa tylko gdy obieg jest na stacji tego rezerwowego).
- **R16** ⬜ **Maksymalne wykorzystanie rezerwowych — wiele przerw na obieg.** Najpierw każdy obieg dostaje 1 obowiązkową przerwę (R9). Potem, dopóki są wolni rezerwowi (w limicie 4,5h), rozdajemy **dodatkowe przerwy**: pociąg może mieć **>1 przerwę** (np. dwie połówki, cała+połówka, dwie całe) gdy rezerwowych jest dużo. Cel: nie marnować dostępnych rezerwowych. Kolejne przerwy tego samego obiegu muszą być **po powrocie maszynisty** z poprzedniej i w oknie 14:30–18:30.

## 4a. ALGORYTM POMOCNIKA INSTRUKTORA (tok rozpisywania — docelowy silnik)

Kolejność decyzji tak, jak robi to pomocnik instruktora ręcznie:

**Krok 1 — bilans mocy:**

```
standby_koła = 0/1/2/3            (rezerwa ruchowa na Kabatach, R17; 3 = tryb trudny)
moc = (rezerwowi − 1) × 3 + standby_koła     (każdy ~3 całe = 4,5 h)
deficyt = liczba_obiegów − moc
połówek = 2 × deficyt             (gdy deficyt > 0; inaczej 0)
całych  = liczba_obiegów − połówek
```

(uwzględnić R18: maszynista z krótszym oknem dostępności liczy mniej niż 3 koła)

**Krok 2 — rozdanie całych:** najpierw CAŁE na wszystkich stacjach **oprócz A11** (Kabaty A1, Wilanowska A7, Plac Wilsona A18, Młociny A23).

**Krok 3 — rozdanie połówek (A11 Politechnika):** połówki dostają **najpierw szczyty (S)** wg priorytetu (do potwierdzenia): `S34, S32, S22?, S26, S27, S28, S29, S23, S35, S36`.

**Krok 4 — wyjątek (do doprecyzowania):** nie dawaj szczytowi pierwszym połówki, jeśli mają mieć tylko połówki. Przesun je na pózniejszy czas, najlepiej po kole ale przed 18:15

**R17** ✅ Rezerwa ruchowa (Kabaty): 1 maszynista standby, tryb **0/1/2/3 koła** (3 = trudna obsada, brak odłożonej rezerwy; awarię obsługuje ten, kto ma przerwę).
**R18** ✅ Rezerwowi mają **okno dostępności [od–do]** (do 16:00 / do 18:00 / od 18:00 do rana). Przerwa musi się zmieścić: `start ≥ od` i `start + długość ≤ do`. „Od 18:00" robi całą (start 18:00 → wraca ~19:30).
**R19** ✅ Sterowanie: **„tylko moje obiegi"** (manualOnly) — rezerwowy robi wyłącznie wpisane piny, bez auto.

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

1. Ile trwa sama **podmiana** (czas wejścia/zejścia maszynisty na stacji) — pomijalne czy doliczać? (Obecnie pomijane.)

> Rozstrzygnięte: każdy obieg ≥ 1 przerwa (R9), więcej przy nadmiarze rezerwy (R16); priorytet przy
> deficycie = najpierw całe, potem połówki, szczeniak ostateczność (R6, §4a); rezerwowy podmienia i
> wraca tylko na swojej stacji (R14).
