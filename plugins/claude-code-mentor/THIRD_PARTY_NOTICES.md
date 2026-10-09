# Third party notices

Claude Code Mentor zawiera fragmenty i techniki zaadaptowane z poniższych projektów. Zmiany: przepisane na moduły Mentora (`hooks/ui/visuals.ts`, `hooks/ui/savvy.ts`, `hooks/ui/crab.ts`, `hooks/ui/motion.tsx`, `hooks/ui/agents.tsx`, `hooks/ui/activity.tsx`), teksty po polsku, kolory dopasowane do motywu Claude Code.

Krab i kostiumy w `hooks/ui/crab.ts` są skopiowane z savvy-progress. Tam postać jest opisana jako „Pixel Clawd from DockCrab (Clawdy)”, czyli odrysowana z projektu DockCrab.

## claude-code-filetree

Panel „Pliki”: drzewo projektu z katalogami rozwijanymi na żądanie i drogą do plików, których Claude dotknął, odczytanie gałęzi i statusu z `git status --porcelain -b -z`, katalogi pomijane przy szukaniu, kolory odczytu (fiolet), edycji (pomarańcz) i commitu (zieleń), palety tonów i funkcja shimmer (pasmo światła po nazwie pliku), ostatni commit na dole. Karta „Teraz”, plakietki stanu i lista „Claude dotknął” są odtworzone ze zrzutów ekranu, w repozytorium ich nie ma.

https://github.com/data-goblin/claude-code-filetree

```
MIT License

Copyright (c) 2026 Kurt Buhler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## claude-kit / savvy-progress

Pasek zadania nad promptem (tytuł, migoczące piksele, pigułka, procent, krab, ×N, ✕), boczny panel agentów (kafelki koszt, tokeny, czas; Pracują, Skończeni, widok zwinięty), wiersze agentów z kontekstem, kosztem i czasem, cennik i okna kontekstu modeli, znaczniki stanu, pikselowy krab z 6 kostiumami i jego animacje CSS z `prefers-reduced-motion` i `prefers-color-scheme`, śledzenie subagentów przez `agent.spawn`, `turn.step` i `turn.complete`, przełączanie panelu komendą.

https://github.com/JohnnyVizz/claude-kit

```
MIT License

Copyright (c) 2026 johnnyvizz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## claude-code-playground: token-weather, replay-theater, blast-radius

Pomysły: pogoda kontekstu (pasma zajętości z ikoną), historia 12 tur z wykresem z bloków i zmianą tury (token-weather); edycje tury krok po kroku z klawiszami `p` i `n` i diff z kontekstem (replay-theater; wygląd z kółkami na linii, „Edycja k z N”, zmienionymi słowami i legendą odtworzony ze zrzutów ekranu, w repozytorium jest wersja tekstowa); lista skutków przed decyzją z oznaczeniem źródła i bezpiecznym wyborem domyślnym (blast-radius). Kod w Mentorze jest napisany od nowa.

https://github.com/anthropics/claude-code-playground

Licensed under the Apache License, Version 2.0. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

## claude-reflect

Pomysł: nauka z jawnej informacji zwrotnej, łączona w liczniki zamiast kopii. Kod w Mentorze jest napisany od nowa, bez zapisu do CLAUDE.md i bez wywołań modelu.

https://github.com/BayramAnnakov/claude-reflect (MIT, Copyright (c) 2025 Bayram Annakov)
