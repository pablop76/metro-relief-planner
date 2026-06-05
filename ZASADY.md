# Przerwy Metro M1 — specyfikacja zasad (wersja robocza)

> Ten plik to "kontrakt" silnika planowania przerw. **Uzupełnij / popraw reguły** — z tego buduję logikę.
> Status każdej reguły: ✅ potwierdzona · ❓ do potwierdzenia · ⬜ brak / do uzupełnienia

---

## 1. Cel aplikacji

Zaplanować **podmiany maszynistów na przerwy** dla pociągów (obiegów) będących w ruchu po południu, zmiana druga.
Wynik = lista podmian: **kto podmienia · jaki pociąg/obieg · na której stacji · w którym kierunku · jak długa przerwa**.
Tryb: aplikacja **proponuje** plan, dyspozytor **zatwierdza/zmienia** (hybryda).

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
- **R2** ✅ **Okno startu przerwy: 14:30–18:30.** Nie wcześniej niż 14:30 (14:05 = za wcześnie), nie później niż 18:30 (19:10 = za późno). Preferencja: jak najbliżej 14:30. Brak slotu w oknie → BRAK (ręczna obsada).
- **R3** ❓ **Max 6h ciągłej pracy** bez przerwy. _Liczone od czego?_ ( od stałej godziny 14:00)
- **R4** ✅ Stacja podmiany determinuje **długość przerwy** i **kierunek podmiany** (patrz `stations.json`).
- **R5** ✅ Liczba rezerwowych jest **ograniczona i rozłożona na 5 stacjach** → opcje podmiany są ograniczone.
- **R6** ❓ Gdy **mało osób do podmian** → nie można dać wszystkim **całej** przerwy; wtedy:
  - skracamy do połówek / szczeniaków,
  - **szczeniaki = ostateczność**, i wtedy stacja przerwowa dla szczeniaków to A7 lub A18
- **R7** ✅ Pociągi **wjeżdżające do ruchu po ~14:00** są do podmiany później, ALE **zjeżdżają przed ~20:00** → trzeba je podmienić **odpowiednio wcześnie**, by zdążyć przed zjazdem.
- **R8** ❓ Stacja **Centrum (A13)** dostępna jako przerwowa **tylko gdy > 15 rezerwowych**.
- **R9** ✅ **Każdy pociąg/obieg w ruchu dostaje przerwę OBOWIĄZKOWO** (pełne pokrycie).
- **R10** ✅ **Długość wg czasu w ruchu**: kto jeździ najdłużej → **cała**; pozostali → **co najmniej połówka**.
- **R11** ✅ **Pociągi szczytowe (oznaczone literą `S` w rozkładzie, np. S23, S27…)** jeżdżą krócej → mogą dostać **połówkę** (nie potrzebują całej).
- **R12** ✅ **Szczeniak = ostateczność** (mało rezerwowych); robiony na **A7 (Wilanowska) w stronę Kabat** lub **A18 (Plac Wilsona) w stronę Młocin**. Politechnika (A11) robi **połówkę**, nie szczeniaka.
- **R13** ✅ **Limit pracy rezerwowego ≈ 4,5 h** łącznie podmian (np. 3 całe lub 6 połówek = 270 min).
- **R14** ✅ **Rezerwowy podmienia TYLKO na swojej stacji** — podmienia pociąg tam, gdzie stoi; brak „teleportacji" między stacjami. Rozmieszczenie rezerwowych na 5 stacjach decyduje, gdzie możliwe są przerwy.
- **R15** ✅ **Sterowanie per maszynista (panel):** wykluczenie z podmian (blokada), maksymalna liczba podmian, oraz wymuszone przypisanie do konkretnego obiegu (pin — działa tylko gdy obieg jest na stacji tego rezerwowego).
- **R16** ⬜ **Maksymalne wykorzystanie rezerwowych — wiele przerw na obieg.** Najpierw każdy obieg dostaje 1 obowiązkową przerwę (R9). Potem, dopóki są wolni rezerwowi (w limicie 4,5h), rozdajemy **dodatkowe przerwy**: pociąg może mieć **>1 przerwę** (np. dwie połówki, cała+połówka, dwie całe) gdy rezerwowych jest dużo. Cel: nie marnować dostępnych rezerwowych. Kolejne przerwy tego samego obiegu muszą być **po powrocie maszynisty** z poprzedniej i w oknie 14:30–18:30.

## 5. Mechanika podmiany (✅ potwierdzona)

1. Rezerwowy czeka na stacji X. Gdy nadjeżdża pociąg (obieg) w kierunku K → **wsiada i prowadzi pociąg dalej**.
2. Maszynista schodzi na przerwę o długości D (zależnej od stacji/kierunku).
3. Pociąg robi pętlę i **wraca**; maszynista **wsiada z powrotem do swojego pociągu**.
4. Rezerwowy po oddaniu pociągu **wraca do puli rezerwy**
5. **Brak łańcucha** — maszynista po przerwie nie podmienia kolejnego, wraca na swój skład.
   → Czas D ≈ czas powrotu tego samego pociągu do punktu ponownego wsiadania.

## 6. Stacje (✅): A13 Centrum i A14 Świętokrzyska to DWIE RÓŻNE stacje. A14 jest w rozkładzie jako punkt pomiarowy; A13 Centrum trzeba interpolować między A11 a A14.

## 6a. Arkusz planowania dyspozytora (✅ z fotki — PONIEDZIAŁEK–CZWARTEK)

Każda kolumna = jeden **obieg**. Oznaczenia: liczby 1–13 (całodzienne), `S##` (szczytowe), `D##` (dodatkowe). **Łącznie 36 obiegów — KAŻDY musi dostać przerwę.**

- **górna komórka** „godz. + stacja" = **wjazd na linię** wg rozkładu (np. S30 → 14:07 na A7),
- **dolna czarna** = **wyjazd z linii** (zjazd składu, np. 19:34),
- **dolna czerwona** = **do której godziny pracuje maszynista** (np. 21:00),
- puste, duże pole w środku kolumny = miejsce, gdzie dyspozytor wpisuje **plan przerwy** (to generuje nasza apka).

## 7. Pytania otwarte (do rozstrzygnięcia)

1. Czy **każdy pociąg/obieg** w ruchu po południu musi dostać **dokładnie jedną** przerwę, czy część obiegów nie wymaga przerwy (np. te kończące służbę wcześnie)?
2. **Priorytet planu** gdy brakuje rezerwowych: (a) maksymalnie dużo CAŁYCH przerw, (b) „każdy dostaje cokolwiek" choćby szczeniaka, (c) inne?
3. Ile trwa sama **podmiana** (czas wejścia/zejścia maszynisty na stacji) — pomijalne czy doliczać?
4. Czy rezerwowy musi wrócić **na tę samą stację**, z której ruszył, czy może zwolnić się gdziekolwiek?
