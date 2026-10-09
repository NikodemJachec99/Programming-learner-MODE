// Zadania w tle (komendy Bash uruchomione w tle): co robią, ostatnie linie wyjścia, jak się skończyły.
// Dane wyłącznie z obserwacji: wynik Bash z backgroundTaskId (start i plik wyjścia),
// powiadomienie task-notification (koniec), TaskStop (zatrzymanie). Czyste funkcje.

import { redact } from './redact'

export type BgTask = {
  id: string
  command: string
  description: string
  outputFile: string | null
  status: 'running' | 'completed' | 'failed' | 'killed'
  startedAt: number
  endedAt?: number
  summary?: string
  /** Ostatnie linie wyjścia (po redakcji sekretów). */
  tail: string[]
  /** Dłuższy ogon do rozwiniętego wyjścia w panelu. */
  lines?: string[]
  /** Rozmiar wyjścia przy ostatnim odczycie (znaki). */
  size: number
  /** Kiedy następny odczyt wyjścia (rośnie z rozmiarem). */
  nextReadAt: number
}

export const MAX_TASKS = 20
export const TAIL_LINES = 4
/** Ile linii pokazuje rozwinięte wyjście. */
export const LONG_LINES = 30
/** Powyżej tego rozmiaru wyjście nie jest już czytane na żywo (tylko na koniec). */
export const LIVE_LIMIT = 4_000_000

/** Ścieżka pliku wyjścia z tekstu wyniku Bash („Output is being written to: …”). */
export function outputPathFrom(text: string | undefined): string | null {
  if (!text) return null
  const m = /([A-Za-z]:[\\/][^\s"'<>]+?\.output|\/[^\s"'<>]+?\.output)\b/.exec(text)
  return m ? m[1]! : null
}

export function startTask(list: readonly BgTask[], t: { id: string; command: string; description?: string; outputFile: string | null; at: number }): BgTask[] {
  const task: BgTask = {
    id: t.id,
    command: redact(t.command.trim()).text.slice(0, 200),
    description: redact((t.description ?? '').trim()).text.slice(0, 120),
    outputFile: t.outputFile,
    status: 'running',
    startedAt: t.at,
    tail: [],
    size: 0,
    nextReadAt: t.at + 1500,
  }
  return [...list.filter(x => x.id !== task.id), task].slice(-MAX_TASKS)
}

/** Ostatnie niepuste linie wyjścia, bez kodów ANSI, przycięte i po redakcji. */
export function tailOf(text: string, n = TAIL_LINES): string[] {
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n')
  const lines = clean.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim())
  return lines.slice(-n).map(l => redact(l.length > 160 ? l.slice(0, 159) + '…' : l).text)
}

/** Odstęp następnego odczytu: im większe wyjście, tym rzadziej. */
export function readDelay(size: number): number {
  return size < 100_000 ? 2000 : size < 1_000_000 ? 5000 : 15000
}

export function withOutput(list: readonly BgTask[], id: string, text: string, now: number): BgTask[] {
  return list.map(t => (t.id === id ? { ...t, tail: tailOf(text), lines: tailOf(text, LONG_LINES), size: text.length, nextReadAt: now + readDelay(text.length) } : t))
}

export function endTask(list: readonly BgTask[], id: string, status: string, now: number, summary?: string): BgTask[] {
  const st: BgTask['status'] = status === 'completed' ? 'completed' : status === 'killed' ? 'killed' : status === 'failed' ? 'failed' : 'completed'
  return list.map(t => (t.id === id && t.status === 'running' ? { ...t, status: st, endedAt: now, summary: summary ? redact(summary).text.slice(0, 200) : t.summary } : t))
}

/** Powiadomienie o końcu zadania z tekstu wiadomości (<task-notification>). */
export function parseNotification(text: string): { id: string; status: string; summary?: string; outputFile?: string } | null {
  if (!/<task-notification>/.test(text)) return null
  const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim()
  const id = tag('task-id')
  if (!id) return null
  return { id, status: tag('status') ?? 'completed', summary: tag('summary'), outputFile: tag('output-file') }
}

/** Czy jakieś zadanie czeka na odczyt wyjścia (do harmonogramu). */
export function nextRead(list: readonly BgTask[]): number | null {
  const due = list.filter(t => t.status === 'running' && t.outputFile && t.size < LIVE_LIMIT).map(t => t.nextReadAt)
  return due.length ? Math.min(...due) : null
}
