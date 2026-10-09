// Krab i kostiumy skopiowane z claude-kit/savvy-progress (MIT, (c) 2026 johnnyvizz), gdzie postać
// jest opisana jako „Pixel Clawd from DockCrab (Clawdy)”. Krab 24×18 na siatce 30×28, jeden kostium
// na rolę. Ruch robi przeglądarka przez CSS (bez przerysowań panelu); prefers-reduced-motion go wyłącza.
// Zmiany: nazwy ról Mentora w costumeOf, kolejność argumentów crab() (walking przed dim), crabSvg.

export type Costume = 'fable' | 'heavy' | 'careful' | 'medium' | 'light' | 'explore' | 'other'

const CLAY = '#D97757'
const INK = '#1F1E1D'

/** Kolor roli (akcent kostiumu): TIER_COLOR z Savvy, explore jak w Savvy idzie na szary „other”. */
export const COSTUME_COLOR: Record<Costume, string> = {
  fable: '#7F77DD',
  heavy: '#D85A30',
  careful: '#BA7517',
  medium: '#378ADD',
  light: '#1D9E75',
  explore: '#888780',
  other: '#888780',
}

/**
 * Kostium po typie subagenta. Tiery savvy-* jak w Savvy; wbudowane typy Claude Code:
 * Explore pirat, Plan detektyw, general-purpose inżynier, guide astronauta, szybkie (statusline) wyścigowiec.
 */
export function costumeOf(type: string): Costume {
  const bare = type.replace(/^[^:]*:/, '')
  const t = bare.toLowerCase()
  if (bare.startsWith('savvy-')) {
    const tier = t.replace(/^savvy-/, '')
    return tier in COSTUME_COLOR && tier !== 'explore' ? (tier as Costume) : 'other'
  }
  if (t === 'explore' || /search|explor|research/.test(t)) return 'explore'
  if (t === 'plan' || /plan|architect|review/.test(t)) return 'heavy'
  if (/guide|docs|help/.test(t)) return 'fable'
  if (/statusline|setup|quick|light/.test(t)) return 'light'
  if (/mentor|teach|design/.test(t)) return 'medium'
  if (/general|build|code|dev|impl/.test(t)) return 'careful'
  return 'other'
}

// `cls` wkłada piksel do grupy: `bd` (domyślnie) to ciało z kostiumem, `la`/`lb` pary nóg,
// każda inna nazwa to rekwizyt z własnym ruchem.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

// `armCls` pozwala podniesionej szczypcy jechać razem z rekwizytem.
const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

/** CSS animacji (raz na SVG). Okresy dzielą sekundę, więc przerysowanie co sekundę ich nie rozjeżdża. */
export const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-fable.run{animation:float 1s ease-in-out infinite}
.c-fable.run .la,.c-fable.run .lb,.c-fable.run .bd{animation:none}
.c-fable.run .ant{animation:blink 1s steps(1) infinite}
.c-fable.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-heavy.run .it{animation:scan 1s steps(1) infinite}
.c-heavy.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-careful.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-medium.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-medium.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-light.run .la{animation-duration:.25s}.c-light.run .lb{animation-duration:.25s;animation-delay:-.125s}
.c-light.run .flag{transform-origin:0 50%;animation:wave .25s steps(1) infinite}
@keyframes wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.c-explore.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const COSTUMES: Record<Costume, (f: Fill, t: string) => void> = {
  // astronauta w szklanej kopule: unosi się zamiast iść, antena i gwiazdka mrugają
  fable: (f, t) => {
    crabBody(f)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // detektyw w czapce z daszkami: lupa przesuwa się i błyska
  heavy: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // inżynier w kasku: klucz kręci śrubą
  careful: (f, t) => {
    crabBody(f)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // kucharz: podrzuca omlet na patelni
  medium: (f, t) => {
    crabBody(f, -4, 'pan')
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // wyścigowiec w kasku: biegnie dwa razy szybciej, flaga w szachownicę łopocze
  light: (f, t) => {
    crabBody(f, -4)
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK })
    f(25, 1, 1, 9, '#8E929A')
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag')
  },
  // pirat przeszukujący kod: szabla fechtuje
  explore: f => {
    crabBody(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  other: f => crabBody(f),
}

/** Domyślna skala z Savvy (krab ~33×31 px). */
export const CRAB_SCALE = 1.1

/**
 * Krab jako fragment SVG (bez <svg>) w punkcie (x, y). `walking`: idzie (agent pracuje);
 * `dim`: przygaszony (zaplanowany albo w tle). Ciało i rekwizyty w `bd`, nogi osobno.
 */
export function crab(x: number, y: number, costume: Costume, walking: boolean, dim = false, scale = CRAB_SCALE): string {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  COSTUMES[costume](f, COSTUME_COLOR[costume])
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${walking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

/** Samodzielny krab (podgląd, testy): siatka 30×28 w skali `scale`. */
export function crabSvg(costume: Costume, walking: boolean, scale = CRAB_SCALE): string {
  const w = Math.round(30 * scale)
  const h = Math.round(28 * scale)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${CRAB_CSS}${crab(0, 0, costume, walking, false, scale)}</svg>`
}
