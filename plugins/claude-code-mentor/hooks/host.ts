// Adapter na możliwości silnika. API modów wymaga, by `$` był używany tylko
// jako `$.rzeczownik.metoda(...)` w miejscu wywołania, więc hook buduje ten
// obiekt z domknięć, a reszta kodu (kontroler, UI) dostaje adapter zamiast `$`.

import { getState, setState } from './ui/state'
import type { StateKey, StateShape } from './ui/state'
import type { ModelCompleteRequest, ModelCompleteResult, ProcessRunInit, ProcessRunResult, UiOpenResult, UiPane, UiSelection } from 'claude-code'

export type Host = {
  /** Stan UI sesji (pamięć modułu); set prosi o przerysowanie panelu. */
  get: <K extends StateKey>(k: K) => Promise<StateShape[K]>
  set: <K extends StateKey>(k: K, change: (v: StateShape[K]) => NoInfer<StateShape[K]>) => Promise<StateShape[K]>
  invalidate: () => void
  now: () => Promise<number>
  /** Pauza do animacji (odtwarzanie kroków). False, gdy przerwana (np. przeładowanie moda). Bez sesji wraca od razu. */
  sleep: (ms: number) => Promise<boolean>
  sessionId: () => Promise<string>
  sessionRoot: () => Promise<string>
  version: () => Promise<string>
  isGitRepo: () => Promise<boolean>
  surfaces: () => Promise<readonly string[]>
  /** Katalog danych Mentora: Windows %LOCALAPPDATA%, macOS ~/Library/Application Support, Linux XDG. */
  dataDir: () => Promise<string | undefined>
  /** Wstawia tekst do pola wiadomości (wysyła użytkownik Enterem). False, gdy nie ma pola. */
  fillPrompt: (text: string) => Promise<boolean>
  /** Wersja Mentora zapisana w instalacji Claude Code; null, gdy nie da się odczytać. */
  installedVersion: () => Promise<string | null>
  pluginRoot: string
  fsRead: (path: string) => Promise<string>
  fsExists: (path: string) => Promise<boolean>
  /** Wpisy katalogu (nazwa, rodzaj, rozmiar, czas zmiany). */
  fsList: (path: string) => Promise<{ name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number }[]>
  /** Boczny panel „Pliki”. */
  openFiles: () => Promise<UiOpenResult>
  /** Boczny panel „Zadania w tle”. */
  openTasks: () => Promise<UiOpenResult>
  /** Zatrzymuje zadanie w tle (TaskStop), tylko po kliknięciu. */
  stopTask: (id: string) => Promise<void>
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  storeDelete: (key: string) => Promise<void>
  complete: (req: ModelCompleteRequest) => Promise<ModelCompleteResult>
  log: (text: string) => void
  toast: (text: string) => void
  openPane: () => Promise<UiOpenResult>
  /** Boczny panel „Agenci”. */
  openAgents: () => Promise<UiOpenResult>
  /** Otwiera panel agentów albo zamyka, gdy jest otwarty (jak ×N w savvy-progress). True, gdy otwarty. */
  toggleAgents: () => Promise<boolean>
  panes: () => Promise<readonly UiPane[]>
  selection: () => Promise<UiSelection | undefined>
}

/** Operacje stanu: zapis + prośba o przerysowanie. */
export function stateOps(invalidate: () => void): Pick<Host, 'get' | 'set' | 'invalidate'> {
  return {
    get: k => Promise.resolve(getState(k)),
    set: (k, change) => {
      const v = setState(k, change)
      invalidate()
      return Promise.resolve(v)
    },
    invalidate,
  }
}

/** Adapter zastępczy (testy UI bez session.start): bez I/O, tylko stan. */
export function offlineHost(base: Pick<Host, 'get' | 'set' | 'now' | 'invalidate'>): Host {
  const no = () => Promise.reject(new Error('niedostępne bez sesji'))
  return {
    ...base,
    sessionId: () => Promise.resolve('test'),
    sessionRoot: () => Promise.resolve(''),
    sleep: () => Promise.resolve(true),
    version: () => Promise.resolve('?'),
    isGitRepo: () => Promise.resolve(false),
    surfaces: () => Promise.resolve([]),
    dataDir: () => Promise.resolve(undefined),
    fillPrompt: () => Promise.resolve(false),
    installedVersion: () => Promise.resolve(null),
    pluginRoot: '',
    fsRead: no,
    fsExists: () => Promise.resolve(false),
    fsList: () => Promise.resolve([]),
    openFiles: () => Promise.resolve({ isPlaced: true as const }),
    openTasks: () => Promise.resolve({ isPlaced: true as const }),
    stopTask: () => Promise.resolve(),
    run: no,
    storeGet: () => Promise.resolve(undefined),
    storeSet: () => Promise.resolve(),
    storeDelete: () => Promise.resolve(),
    complete: no,
    log: () => undefined,
    toast: () => undefined,
    openPane: () => Promise.resolve({ isPlaced: true as const }),
    openAgents: () => Promise.resolve({ isPlaced: true as const }),
    toggleAgents: () => Promise.resolve(true),
    panes: () => Promise.resolve([]),
    selection: () => Promise.resolve(undefined),
  }
}
