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
  sessionId: () => Promise<string>
  sessionRoot: () => Promise<string>
  version: () => Promise<string>
  isGitRepo: () => Promise<boolean>
  surfaces: () => Promise<readonly string[]>
  /** Katalog danych Mentora: Windows %LOCALAPPDATA%, macOS ~/Library/Application Support, Linux XDG. */
  dataDir: () => Promise<string | undefined>
  pluginRoot: string
  fsRead: (path: string) => Promise<string>
  fsExists: (path: string) => Promise<boolean>
  run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  storeDelete: (key: string) => Promise<void>
  complete: (req: ModelCompleteRequest) => Promise<ModelCompleteResult>
  log: (text: string) => void
  toast: (text: string) => void
  openPane: () => Promise<UiOpenResult>
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
    version: () => Promise.resolve('?'),
    isGitRepo: () => Promise.resolve(false),
    surfaces: () => Promise.resolve([]),
    dataDir: () => Promise.resolve(undefined),
    pluginRoot: '',
    fsRead: no,
    fsExists: () => Promise.resolve(false),
    run: no,
    storeGet: () => Promise.resolve(undefined),
    storeSet: () => Promise.resolve(),
    storeDelete: () => Promise.resolve(),
    complete: no,
    log: () => undefined,
    toast: () => undefined,
    openPane: () => Promise.resolve({ isPlaced: true as const }),
    panes: () => Promise.resolve([]),
    selection: () => Promise.resolve(undefined),
  }
}
