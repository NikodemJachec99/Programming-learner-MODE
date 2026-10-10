// Subagenci tej sesji (pomysł z savvy-progress): kto pracuje, nad czym i co robi teraz.
// Dane wyłącznie z obserwowanych zdarzeń: agent.spawn, tool.call z agentId, turn.complete.
// Czyste funkcje; stan trzyma ui/state, zdarzenia podaje register.tsx.

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  /** Ostatnia czynność: „edytuje src/a.ts”, „czyta …”, „uruchamia: npm test”. */
  now: string | null
  tools: number
  tokens: number
  /** Zajętość kontekstu agenta po ostatnim kroku i rozmiar jego okna. */
  contextTokens: number
  contextMax: number
  /** Szacunek kosztu z cennika (silnik podaje tokeny, nie pieniądze). */
  costUsd: number
  steps: number
  effort?: string
  /** Tura głównej rozmowy, w której agent wystartował (do paska nad promptem). */
  turn: number
}

// Cennik i okna kontekstu: claude-kit/savvy-progress, MIT, (c) 2026 johnnyvizz.
// USD za milion tokenów: wejście, wyjście, odczyt cache, zapis cache. To szacunek.
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5|opus 5\.5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]
export type StepUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
const priceOf = (model: string) => PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 5]
export function costOf(model: string, u: StepUsage): number {
  const [i, o, r, w] = priceOf(model)
  return ((u.input_tokens ?? 0) * i + (u.output_tokens ?? 0) * o + (u.cache_read_input_tokens ?? 0) * r + (u.cache_creation_input_tokens ?? 0) * w) / 1e6
}
export const windowOf = (model: string): number => (/haiku/i.test(model) ? 200_000 : 1_000_000)
const sum = (u: StepUsage) => (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)

/** Jeden krok modelu agenta: kontekst, tokeny, koszt, liczba kroków. */
export function stepAgent(list: readonly AgentRun[], agentId: string, u: StepUsage, model: string, effort?: string): AgentRun[] {
  return list.map(a =>
    a.agentId !== agentId
      ? a
      : { ...a, model: modelName(model) || a.model, effort: effort ?? a.effort, contextTokens: sum(u), contextMax: windowOf(model), tokens: a.tokens + sum(u), costUsd: a.costUsd + costOf(model, u), steps: a.steps + 1 },
  )
}

export const MAX_AGENTS = 40

export function spawnAgent(list: readonly AgentRun[], a: { id: string; agentId?: string; type: string; description: string; model: string; at: number; turn?: number }): AgentRun[] {
  const run: AgentRun = { id: a.id, agentId: a.agentId, type: a.type, description: a.description, model: a.model, status: 'running', startedAt: a.at, now: null, tools: 0, tokens: 0, contextTokens: 0, contextMax: 1_000_000, costUsd: 0, steps: 0, turn: a.turn ?? 0 }
  return [...list.filter(x => x.id !== run.id), run].slice(-MAX_AGENTS)
}

const base = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')

/** Czynność narzędzia po polsku, krótko. Polecenia Bash obcięte i bez treści po pierwszym słowie kluczowym. */
export function describeTool(tool: string, input: Record<string, unknown>): string {
  const file = String(input.file_path ?? input.notebook_path ?? input.path ?? '')
  switch (tool) {
    case 'Read':
      return `czyta ${base(file)}`
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return `${tool === 'Write' ? 'zapisuje' : 'edytuje'} ${base(file)}`
    case 'Grep':
      return `szuka „${String(input.pattern ?? '').slice(0, 24)}”`
    case 'Glob':
      return `przegląda ${String(input.pattern ?? '').slice(0, 24)}`
    case 'Bash':
      return `uruchamia: ${String(input.command ?? '').trim().split(/\s+/).slice(0, 3).join(' ').slice(0, 32)}`
    case 'WebFetch':
    case 'WebSearch':
      return 'szuka w sieci'
    default:
      return `używa ${tool}`
  }
}

export function agentTool(list: readonly AgentRun[], agentId: string, what: string): AgentRun[] {
  return list.map(a => (a.agentId === agentId ? { ...a, now: what, tools: a.tools + 1 } : a))
}

export function endAgent(list: readonly AgentRun[], agentId: string, ok: boolean, tokens: number, at: number, cost = 0): AgentRun[] {
  // kroki niewidziane (np. po przeładowaniu): suma z tury, inaczej to, co zebrały kroki
  return list.map(a =>
    a.agentId === agentId && a.status === 'running'
      ? { ...a, status: ok ? 'done' : 'failed', endedAt: at, tokens: a.steps ? a.tokens : tokens || a.tokens, costUsd: a.steps ? a.costUsd : cost || a.costUsd, now: null }
      : a,
  )
}

/** Procent okna kontekstu agenta. */
export const ctxPercent = (a: AgentRun): number => (a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0)

export const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

/** Nazwa modelu do pokazania: „Opus 5.5”, „Haiku 5.5”. */
export function modelName(id: string): string {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  if (!m) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '')
  const [, family = '', major = '', minor] = m
  return `${family[0]!.toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

export const elapsedOf = (a: AgentRun, now: number) => (a.endedAt ?? Math.max(now, a.startedAt)) - a.startedAt
