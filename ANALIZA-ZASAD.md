# Analiza zasad podmian — dokument roboczy do edycji

> ✅ **ZASTOSOWANE 2026-06-07** — decyzje D1–D9 + E3/F4/F8 naniesione do `ZASADY.md`, `stations.json`,
> `REGULY-PRZERW.md` i `DRUZYNY-GODZINY.md`. Pozostałe do zrobienia = zmiany w **kodzie silnika** (patrz rozmowa).

> **Jak korzystać:** każdy punkt ma stały identyfikator (A1, B2, …). Poprawiaj na 2 sposoby:
>
> 1. edytuj treść punktu wprost, **albo**
> 2. dopisz pod punktem linię `→ ZMIANA: ...` / `→ USUŃ` / `→ OK`.
>    W sekcji **DECYZJE** zaznacz `[x]` przy wybranej opcji. Na dole jest miejsce na **nowe zasady**.
>    Po Twoich poprawkach naniosę je do `ZASADY.md` (i w razie potrzeby do `stations.json` / silnika).

Legenda statusu: ✅ potwierdzona · ❓ do potwierdzenia · ⬜ brak/niedokończona · ⚠️ sprzeczność

Źródła: `ZASADY.md` (R1–R19), `REGULY-PRZERW.md` (silnik), `DRUZYNY-GODZINY.md` (drużyny/godziny), `data/stations.json` (stacje).

---

## A. Cel i zakres

- **A1** ✅ Plan dotyczy podmian na przerwy **tylko dla 2. zmiany** (popołudnie); obiegi w ruchu po południu. _(R1)_
- **A2** ✅ Wynik = lista: **kto podmienia · jaki obieg · na której stacji · w którym kierunku · jak długa przerwa**.
- **A3** ✅ Tryb **hybrydowy**: aplikacja proponuje, pomocnik instruktora zatwierdza/zmienia.
- **A4** ✅ **Każdy obieg w ruchu dostaje przerwę OBOWIĄZKOWO** — pełne pokrycie; łącznie **36 obiegów**. _(R9, §6a)_

## B. Rodzaje przerw i długości

- **B1** ✅ **godzinka** ~1h — jazda do dalszego krańca i powrót (A7→Młociny ≈58 min, A18→Kabaty ≈62–66 min).
- **B2** ❓ **cała** ~90 min — długość do potwierdzenia. Potwierdzam
- **B3** ❓ **połówka** ~45 min — do potwierdzenia. Potwierdzam
- **B4** ❓ **szczeniak** ~30 min, ostateczność (mało rezerwowych) — do potwierdzenia. _(R6, R12)_ Potwierdzam
- **B5** ⚠️ Długość liczona z **realnego rozkładu** (czas powrotu pociągu na stację), **nie** ze sztywnych 90/45/30 — ale `stations.json` ma sztywne minuty (90/60/45/30). **Patrz DECYZJA D1.**

licz relanie z rozkładu do podmian ale jako informacja dla pomocnika wpisuj ogólmne, przyblizone wartosći

## C. Stacje podmian (gdzie + kierunek) — R4, §4, stations.json

- **C1** ✅ **A1 Kabaty** (krańcówka): tylko **cała**, kierunek dowolny.
- **C2** ✅ **A7 Wilanowska**: **cała** (oba), **godzinka** ↑Młociny, **szczeniak** ↓Kabaty.
- **C3** ✅ **A11 Politechnika**: **cała** + **połówka** (oba kierunki). A11 robi połówkę, **nie** szczeniaka. _(R12)_
- **C4** ❓ **A13 Centrum**: **cała** + **połówka**, dostępna **tylko gdy > 15 rezerwowych** (min. 16). _(R8)_ Potwierdzam
- **C5** ✅ **A18 Plac Wilsona**: **cała** (oba), **godzinka** ↓Kabaty, **szczeniak** ↑Młociny.
- **C6** ✅ **A23 Młociny** (krańcówka): tylko **cała**, kierunek dowolny.
- **C7** ✅ **A13 Centrum ≠ A14 Świętokrzyska** — dwie różne stacje; A13 interpolować między A11 a A14. _(§6)_
- **C8** ✅ Stacja podmiany **determinuje długość i kierunek** przerwy. _(R4)_

## D. Kiedy — okna czasowe

- **D1** ✅ **Najwcześniej 14:30** (wszystkie rodzaje). _(R2)_
- **D2** ✅ **1. (główna) przerwa** — start najpóźniej **18:30** ("19:10 = za późno").
- **D3** ✅ **2. (dodatkowa) przerwa** — okno do ~**20:00**, realnie limitowane zjazdem pociągu. _(R7)_
- **D4** ✅ **Preferencja: 16:00–17:30** to najlepszy czas startu _(R2)_ — ⚠️ `stations.json` mówi "jak najbliżej 14:30". **Patrz DECYZJA D2.
  bo musimy zacząć 14:30 zeby wyrobic sie z podmianami, wszysscy niemoga miec w najlepszym momencie
  **
- **D5** ✅ Najlepszy wariant: **cała + połówka** razem/blisko; dobra alternatywa: **dwie połówki co 2–3 h**.
- **D6** ❓ **Max 6h ciągłej pracy** bez przerwy, liczone od stałej **14:00** _(R3)_ — ⚠️ część obiegów startuje 13:00/13:30. **Patrz DECYZJA D3.** dla 13:00 szesc godzin będzie wcześniej
- **D7** ✅ Brak slotu w oknie → **BRAK** (ręczna obsada).

## E. Dobór długości wg "kół" 2. zmiany — R10, R11

- **E1** ✅ Koła liczone **czasowo, bez zaokrąglania**: `koła = (zjazd − wjazd) / czas_koła`; `czas_koła` = mediana odstępu A1→Młociny (fallback 84 min).
- **E2** ✅ **Najmniej kół → połówka; najwięcej → cała.**
- **E3** ✅ Obiegi **≤ 3,5 koła** → **zawsze połówka**.
- **E4** ✅ Obiegi jadące do/po **21:00** → **zawsze cała** (zmiennik na linii / 3. zmiana; `throughShift`).
- **E5** ✅ Pociągi szczytowe (**S**) jeżdżą krócej → kandydaci na **połówkę**. _(R11)_
- **E6** ✅ **Deficyt mocy** zwiększa liczbę połówek o `2 × deficyt`; połówki idą do obiegów z najmniejszą liczbą kół.

## F. Kto podmienia — rezerwowi (rozmieszczenie + limity) — R5, R13, R14, R17, R18

- **F1** ✅ Pula rezerwowych **rozłożona na 5 stacjach**: A1, A7, A11, A18, A23. _(R5)_
- **F2** ✅ Rezerwowy podmienia **TYLKO na swojej stacji** — brak "teleportacji"; wraca do puli tej samej stacji. _(R14)_
- **F3** ✅ **Limit obciążenia ≈ 5h = 3 koła** (równowartość: cała=1, godzinka=⅔, połówka=½, szczeniak=⅓). _(R13)_
- **F4** ✅ **A1 Kabaty = domyślnie max 1 koło dla jednego z całej obsady A1 reszta 3 koła** — rezerwa ruchowa musi zostać pod ręką (wprowadzanie składu za awarię/sprzątanie). _(R17)_
- **F5** ✅ Tryb rezerwy ruchowej A1: **0/1/2/3 koła**, ustawiany ręcznie; 3 = trudna obsada. _(R17)_
- **F6** ✅ Rezerwowi mają **okno dostępności [od–do]** (np. do 16:00 / do 18:00 / od 18:00); przerwa musi się zmieścić: `start ≥ od`, `start + długość ≤ do`. _(R18)_
- **F7** ✅ Poza A1 silnik **dobija każdego rezerwowego do pełnych 3 kół**, żeby nie marnować mocy. _(R13, R16)_
- **F8** (dane) Rezerwowi: **A1** Kopyt, Kornaszewski, Łada · **A7** Kępa, Mańkowski · **A11** Bogucki, Galicki H., Gnas, Jówko, Piotrowski M.,**A18** Moszumański, Jóźwiak ,**A23** Półtoraczyk, Tryńdak.

## G. Ile przerw na obieg — pokrycie + dodatkowe — R9, R16, §3a

- **G1** ✅ Najpierw **1 obowiązkowa przerwa** dla każdego obiegu (pokrycie nadrzędne). _(R9)_
- **G2** ✅ Potem, dopóki są wolni rezerwowi w limicie → **dodatkowe przerwy**; obieg może mieć **max 2 przerwy**. _(R16)_
- **G3** ✅ Kombinacje 2 przerw: **cała+połówka** (najlepsza) · **połówka+połówka** (~2,5h odstępu) · **cała+cała** (do dobicia 3 kół) · **szczeniak** jako dokładka (ostateczność).
- **G4** ✅ Kolejna przerwa obiegu **dopiero po powrocie maszynisty** z poprzedniej i w oknie czasowym.
- **G5** ✅ Pokrycie awaryjne (`tryCover`): brak wolnego rezerwowego → zejście na krótszy rodzaj i/lub szersze okno (do 20:00); dopiero potem **BRAK**.

## H. Mechanika podmiany + kolejność przetwarzania — R2a, §4a, §5

- **H1** ✅ Rezerwowy czeka na stacji, **wsiada i prowadzi pociąg dalej**; maszynista schodzi na przerwę; pociąg wraca → maszynista wsiada **z powrotem do swojego składu**.
- **H2** ✅ **Brak łańcucha** — maszynista po przerwie nie podmienia kolejnego.
- **H3** ✅ **Nie zaczynaj** od obiegów mających tylko połówki — najpierw obiegi kwalifikujące się do całych. _(R2a)_, nie zaczynaj od szczytów jak nie musisz, bo one wjeżdzają najpózniej na linie
- **H4** ✅ Kolejność: całe → połówki; w grupie: najmniej slotów → najwcześniejszy zjazd → **S przed full przed D**.
- **H5** ❓ Bilans (§4a): `moc = (rezerwowi−1)×3 + standby_koła`; `deficyt = obiegi − moc`; `połówek = 2×deficyt`.
- **H6** ❓ Priorytet połówek dla szczytów (§4a krok 3): `S34, S32, S22?, S26, S27, S28, S29, S23, S35, S36` — kolejność do potwierdzenia (S22 z pytajnikiem). Jak wynika z obiegów ze robi bajwyżej czetry koła to tak, połowka
- **H7** ⬜ Wyjątek (§4a krok 4): szczytowemu, który ma mieć **tylko połówki**, nie dawać połówki jako pierwszej — przesunąć później (po kole, ale przed 18:15) — do doprecyzowania.

## I. Sterowanie ręczne (panel instruktora) — R15, R19

- **I1** ✅ Per maszynista: **wykluczenie** (blokada), **maks. liczba podmian** (`maxJobs`), **pin** do obiegu (działa tylko gdy obieg jest na jego stacji). _(R15)_
- **I2** ✅ **"tylko moje obiegi"** (`manualOnly`) — rezerwowy robi wyłącznie wpisane piny, bez auto. _(R19)_
- **I3** ✅ Ręczny override rodzaju przerwy (`forcedKinds`) ma pierwszeństwo nad auto-bilansem.

---

## DECYZJE — sprzeczności i luki (zaznacz `[x]`, dopisz uzasadnienie)

**D1. Długości przerw — źródło prawdy** (dot. B5)

- [ ] realny rozkład (minuty w `stations.json` to tylko wartości poglądowe)
- [ ] sztywne minuty z `stations.json`
- [ ] inne → \***\*\_\_\_\*\***

**D2. Preferencja okna startu** (dot. D4)

- [ ] 16:00–17:30 (usuń "14:30" z `stations.json`)
- [ ] jak najbliżej 14:30
- [ ] inne → \***\*\_\_\_\*\***

**D3. Okno 1. przerwy / okno 2. przerwy** (dot. D2, D3)

- [ ] 1. do 18:30, 2. do 20:00 (popraw `stations.json`, które ma 18:30)
- [ ] inne → \***\*\_\_\_\*\***

**D4. R3 „max 6h" — od czego liczyć?** (dot. D6)

- [ ] od realnego startu maszynisty (13:00 / 13:30 / 14:00)
- [ ] sztywno od 14:00
- [ ] inne → \***\*\_\_\_\*\***

**D5. Próg dostępności A13 Centrum** (dot. C4)

- [ ] > 15 rezerwowych (min. 16) — OK
- [ ] inny próg → \***\*\_\_\_\*\***

**D6. Czasy: cała / połówka / szczeniak** (dot. B2–B4) → cała = **_ min · połówka = _** min · szczeniak = \_\_\_ min

**D7. Priorytet połówek dla szczytów** (dot. H6) → kolejność: \***\*\_\_\_\*\***

**D8. Wyjątek §4a krok 4** (dot. H7) → doprecyzowanie: \***\*\_\_\_\*\***

**D9. Czas samej podmiany (wejście/zejście)** — obecnie pomijany

- [ ] pomijać (zostaje)
- [ ] doliczać \_\_\_ min

---

## NOWE ZASADY (do dopisania)

> Dopisuj tu nowe reguły. Nadam im numery R20+ przy nanoszeniu do `ZASADY.md`.

- **N1.**
- **N2.**
- **N3.**
