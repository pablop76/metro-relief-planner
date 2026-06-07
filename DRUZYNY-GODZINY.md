# Drużyny → obiegi → godziny zmian (grafik czerwiec 2026)

Źródło: grafik miesięczny imienny MWS, Linia 1, czerwiec 2026 (odczyt ze zdjęć — **godziny zweryfikuj przy wgraniu rozkładu xlsx**).

## Kluczowe odkrycie: Drużyna = obieg
Numeracja drużyn pokrywa się z obiegami:

| Drużyna | Obieg w aplikacji | Typ |
|---|---|---|
| 1–13 | 1–13 | całodobowe (full) |
| 14–22 | D14–D22 | dodatkowe (D) |
| 23–36 | S23–S36 | szczyty (S) |
| MI | — | obsługa MI / manewrowi |

## Zmiany (legendy z grafiku)
- **Zmiana 1** (rano): zwykle `6:00–14:00`; część drużyn `5:00–13:00` lub `5:30–13:30`.
- **Zmiana 2** (popołudnie): co do zasady `14:00–22:00`; **część zaczyna wcześniej** — `13:00–21:00` lub `13:30–21:30`.
- **Zmiana 3** (noc): `22:00–6:00` (tylko drużyny całodobowe 1–13 + MI).

## Druga zmiana wg drużyn (istotne dla przerw)
Przerwy dotyczą **2. zmiany**. Start przed 14:00 NIE daje sztywnego „+0,5 koła" — koła liczone są
**czasowo od realnego wjazdu** (`countLoops2nd`, patrz [`REGULY-PRZERW.md`](REGULY-PRZERW.md) §1).
Tabela startów jest źródłem dla `SHIFT2_DRIVER_START` (tylko obiegi jadące ciągiem: D17–D20, D22).

| Drużyna / obieg | Start 2. zmiany | Uwaga |
|---|---|---|
| 1–13 (1–13) | 14:00–22:00 | całodobowe |
| 14 (D14) | 14:00–22:00 | |
| 15 (D15) | 14:00–22:00 | |
| 16 (D16) | 14:00–22:00 | |
| **17 (D17)** | **13:00–21:00** | start z grafiku |
| **18 (D18)** | **13:00–21:00** | start z grafiku |
| **19 (D19)** | **13:00–21:00** | start z grafiku |
| **20 (D20)** | **13:00–21:00** | start z grafiku |
| 21 (D21) | 14:00–22:00 | |
| **22 (D22)** | **13:30–21:30** | start z grafiku; zjeżdża sam wcześnie |
| 23 (S23) | 14:00–22:00 | wjazd z postoju w dzień |
| 24 (S24) | 14:00–22:00 | |
| 25 (S25) | 14:00–22:00 | |
| **26 (S26)** | **13:00–21:00** | |
| **27 (S27)** | **13:00–21:00** | |
| **28 (S28)** | **13:30–21:30** | |
| **29 (S29)** | **13:00–21:00** | |
| 30 (S30) | 14:00–22:00 | rusza A7 |
| 31 (S31) | 14:00–22:00 | rusza A18, zjazd STP A1 |
| **32 (S32)** | **13:30–21:30** | |
| **33 (S33)** | **13:30–21:30** | |
| **34 (S34)** | **13:00–21:00** | sprzątanie A23 (oprócz piątku) |
| **35 (S35)** | **13:30–21:30** | |
| 36 (S36) | 14:00–22:00 | |

> Godziny 2. zmiany odczytane z legend pod każdą drużyną. Dla szczytów (S) realny wjazd bierze się z
> rozkładu (wznowienie po postoju w dzień), nie z tej tabeli. Pojedyncze dni z innym kodem (np.
> `2/M1 14:00–22:00`, `2/S## 13:00–21:00`) to wyjątki dzienne — nie zmieniają reguły bazowej drużyny.

## Rezerwowi (do podmian na przerwy)
| Rezerwa | Stacja | Maszyniści |
|---|---|---|
| A01 | A1 Kabaty | Kopyt, Kornaszewski, Łada, Miros, Szczepanik, Żeńca |
| A07 | A7 Wilanowska | Kępa, Mańkowski |
| A11/A23 | A11 Politechnika / A23 Młociny | Bogucki, Galicki H., Gnas, Jówko, Piotrowski M., Półtoraczyk, Tryńdak |

Norma 2. zmiany na rezerwie wg legend A01: `1/A1* 5:00–13:00`, `2/A1* 13:00–21:00`, `2/A1# 13:30–21:30`, `1/XXII 5:30–13:30`.
