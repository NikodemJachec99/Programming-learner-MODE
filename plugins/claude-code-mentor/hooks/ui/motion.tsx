// Wspólny język wizualny ruchu i stanów: jedna paleta, jedne ikony, jedne animacje.
// Desktop: małe SVG z animacją CSS (ruch robi przeglądarka, bez przerysowań panelu),
// z prefers-reduced-motion i prefers-color-scheme. Terminal: tekstowe odpowiedniki,
// klatki spinnera liczy jeden harmonogram w mentorze i tylko wtedy, gdy coś trwa.

import type { Elements, RenderElement } from 'claude-code'
import type { Kit } from './kit'

/** Znaczenie koloru w całym panelu. Klucze motywu Claude Code (jasny i ciemny). */
export const TONE = {
  add: 'success',
  ok: 'success',
  remove: 'error',
  error: 'error',
  edit: 'claude',
  read: 'permission',
  info: 'suggestion',
  muted: 'subtle',
} as const
export type Tone = keyof typeof TONE

/** Te same znaczenia jako kolory SVG (desktop rysuje SVG bez motywu). */
const HEX: Record<'edit' | 'read' | 'seen' | 'ok' | 'error' | 'idle', string> = {
  edit: '#d97757',
  read: '#8b7cf6',
  seen: '#8b7cf6',
  ok: '#3b9c5f',
  error: '#d0453f',
  idle: '#8a8a8a',
}

/** Znak stanu w terminalu: zawsze jest też tekst, kolor tylko go wzmacnia. */
export const GLYPH = { edit: '●', read: '◆', seen: '◆', ok: '✓', error: '✗', idle: '·', denied: '⊘' } as const

export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
export const spin = (frame: number) => SPIN[frame % SPIN.length]!

const svgSurface = (k: Kit) => k.surface === 'desktop' || k.surface === 'vscode'

const PULSE_CSS =
  '<style>.live{animation:p 1.2s ease-in-out infinite;transform-origin:center}@keyframes p{50%{opacity:.25;transform:scale(.8)}}' +
  '@media (prefers-reduced-motion: reduce){.live{animation:none}}</style>'

/** Ikona stanu 12×12: pulsująca kropka (trwa), ✓, ✗ albo spokojna kropka. */
function markSvg(state: 'edit' | 'read' | 'seen' | 'ok' | 'error' | 'idle'): string {
  const c = HEX[state]
  const body =
    state === 'ok'
      ? `<path d="M2.5 6.5l2.3 2.3 4.7-5" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
      : state === 'error'
        ? `<path d="M3 3l6 6M9 3l-6 6" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>`
        : state === 'idle'
          ? `<circle cx="6" cy="6" r="2" fill="${c}" opacity=".6"/>`
          : state === 'seen'
            ? `<path d="M6 2.2l3.8 3.8L6 9.8 2.2 6z" fill="${c}"/>`
            : state === 'read'
              ? `<circle class="live" cx="6" cy="6" r="3.6" fill="none" stroke="${c}" stroke-width="1.8"/>`
            : `<circle class="live" cx="6" cy="6" r="3.8" fill="${c}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">${state === 'edit' || state === 'read' ? PULSE_CSS : ''}${body}</svg>`
}

const ALT: Record<string, string> = { edit: 'edytuje', read: 'czyta', seen: 'przeczytany', ok: 'gotowe', error: 'błąd', idle: 'bez zmian', denied: 'odrzucone' }

/**
 * Znacznik stanu. Na desktopie animowane SVG (bez przerysowań), w terminalu znak:
 * w trakcie spinner z klatki harmonogramu, potem ✓, ✗ albo kropka.
 */
export function statusMark(k: Kit, state: 'edit' | 'read' | 'seen' | 'ok' | 'error' | 'idle' | 'denied', frame: number, key: string): RenderElement {
  const { Text } = k.E
  if (svgSurface(k) && state !== 'denied') {
    const { Svg } = k.E as Elements['desktop']
    return <Svg key={key} source={markSvg(state)} alt={ALT[state]!} width={12} height={12} />
  }
  const active = state === 'edit' || state === 'read'
  const color = state === 'idle' || state === 'denied' ? TONE.muted : state === 'ok' ? TONE.ok : state === 'error' ? TONE.error : state === 'seen' ? TONE.read : TONE[state]
  return (
    <Text key={key} color={color} dimColor={state === 'idle'}>
      {active ? spin(frame) : GLYPH[state]}
    </Text>
  )
}

/** Spokojny stan oczekiwania (lekcja, alternatywy): trzy pulsujące kropki albo spinner. */
export function waiting(k: Kit, text: string, frame: number, key = 'wait'): RenderElement {
  const { Box, Text } = k.E
  if (svgSurface(k)) {
    const { Svg } = k.E as Elements['desktop']
    const dots = [0, 1, 2]
      .map(i => `<circle cx="${4 + i * 8}" cy="5" r="2.4" fill="${HEX.read}" style="animation:d 1.2s ${i * 0.2}s ease-in-out infinite"/>`)
      .join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="10" viewBox="0 0 24 10"><style>@keyframes d{0%,80%,100%{opacity:.2}40%{opacity:1}}@media (prefers-reduced-motion: reduce){circle{animation:none!important;opacity:.7}}</style>${dots}</svg>`
    return (
      <Box key={key} flexDirection="row" columnGap={1} alignItems="center">
        <Svg source={svg} alt="trwa" width={24} height={10} />
        <Text color={TONE.read} wrap="wrap">
          {text}
        </Text>
      </Box>
    )
  }
  return (
    <Text key={key} color={TONE.read} wrap="wrap">
      {`${spin(frame)} ${text}`}
    </Text>
  )
}
