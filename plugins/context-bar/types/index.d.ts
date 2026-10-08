/** One /context category as the bar draws it. */
export type BarRow = { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' }

/** The last breakdown the bar read. */
export type Snapshot = { rows: BarRow[]; totalTokens: number; maxTokens: number; percentage: number }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { isOn: boolean; snapshot: Snapshot | null; lastRequestAt: number; ttlMinutes: number }
  }
}
