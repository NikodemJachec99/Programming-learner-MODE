// Dane Mentora: kopie zapasowe, eksport i import, czyszczenie, diagnostyka, test modelu, piaskownica SQL.

import type { Host } from '../host'
import { COST_PROFILES } from '../engine/budget'
import { one, pendingCount, runSql } from '../store/db'
import { DEFAULT_SETTINGS, S } from '../ui/state'
import type { Mentor } from '../mentor'
import { errText } from './shared'
import { tr } from '../i18n'

/** Kopie, eksport, import, czyszczenie danych, diagnostyka (część Mentora). */
export class DataController {
  constructor(private readonly m: Mentor) {}

  async exportData(io: Host): Promise<void> {
    if (!this.m.ctx) return this.m.notice(io, tr('Eksport niemożliwy: baza niedostępna.', 'Export impossible: database unavailable.'))
    try {
      const v = await one<{ path: string; counts: Record<string, number> }>(io, this.m.ctx, 'export', {})
      await this.m.notice(io, `${tr('Wyeksportowano do', 'Exported to')}:\n${v.path}\n(${Object.entries(v.counts).map(([k, n]) => `${k}: ${n}`).join(', ')})`)
    } catch (e) {
      await this.m.notice(io, `${tr('Eksport nieudany', 'Export failed')}: ${errText(e)}`)
    }
  }

  async importData(io: Host, path: string, mode: 'merge' | 'replace'): Promise<void> {
    if (!this.m.ctx) return this.m.notice(io, tr('Import niemożliwy: baza niedostępna.', 'Import impossible: database unavailable.'))
    try {
      const v = await one<{ counts: Record<string, number>; backup?: string }>(io, this.m.ctx, 'import', { path: path.trim().replace(/^"|"$/g, ''), mode })
      await this.m.notice(io, tr(`Zaimportowano (${mode === 'merge' ? 'scalenie' : 'zastąpienie'}). Kopia sprzed importu: ${v.backup ?? '—'}`, `Imported (${mode === 'merge' ? 'merge' : 'replace'}). Backup from before the import: ${v.backup ?? '—'}`))
      await this.m.refreshKnowledge(io)
    } catch (e) {
      await this.m.notice(io, `${tr('Import nieudany', 'Import failed')}: ${errText(e)}`)
    }
  }

  async backup(io: Host): Promise<void> {
    if (!this.m.ctx) return this.m.notice(io, tr('Kopia niemożliwa: baza niedostępna.', 'Backup impossible: database unavailable.'))
    try {
      const v = await one<{ path: string }>(io, this.m.ctx, 'backup', { keep: 10 })
      await this.m.notice(io, `${tr('Kopia zapasowa', 'Backup')}: ${v.path}`)
    } catch (e) {
      await this.m.notice(io, `${tr('Kopia nieudana', 'Backup failed')}: ${errText(e)}`)
    }
  }

  async wipe(io: Host): Promise<void> {
    if (!this.m.ctx) return this.m.notice(io, tr('Usuwanie niemożliwe: baza niedostępna.', 'Delete impossible: database unavailable.'))
    try {
      const v = await one<{ backup?: string }>(io, this.m.ctx, 'wipe', { confirm: 'USUN-WSZYSTKO', keepBackup: true })
      await io.storeDelete('pendingOps')
      this.m.taught.clear()
      this.m.settings = DEFAULT_SETTINGS
      await io.set(S.settings, () => DEFAULT_SETTINGS)
      await io.set(S.lessons, () => [])
      await io.set(S.lesson, () => null)
      await io.set(S.quiz, () => null)
      await io.set(S.quizKey, () => null)
      await this.m.refreshKnowledge(io)
      await this.m.notice(io, tr(`Usunięto wszystkie dane nauki. Ostatnia kopia bezpieczeństwa: ${v.backup ?? 'brak'} (możesz ją skasować ręcznie).`, `All learning data deleted. Last safety backup: ${v.backup ?? 'none'} (you can delete it by hand).`))
    } catch (e) {
      await this.m.notice(io, `${tr('Usuwanie nieudane', 'Delete failed')}: ${errText(e)}`)
    }
  }

  /**
   * Częściowe czyszczenie z kopią: „history” usuwa zmiany, obserwacje i lekcje (z pracy Claude),
   * wiedza i odpowiedzi zostają; „progress” zeruje wiedzę, dowody i odpowiedzi, historia zostaje.
   */
  async clearPart(io: Host, part: 'history' | 'progress'): Promise<void> {
    if (!this.m.ctx) return this.m.notice(io, tr('Czyszczenie niemożliwe: baza niedostępna.', 'Cleanup impossible: database unavailable.'))
    try {
      const confirm = part === 'history' ? 'WYCZYSC-HISTORIE' : 'RESETUJ-POSTEP'
      const v = await one<{ counts: Record<string, number>; backup?: string }>(io, this.m.ctx, 'clearData', { part, confirm, keepBackup: true })
      if (part === 'history') {
        this.m.forgetChanges()
        await io.set(S.changes, () => [])
        await io.set(S.feed, () => [])
        await io.set(S.lessons, () => [])
        await io.set(S.lesson, () => null)
        await io.set(S.focus, () => null)
        await io.set(S.lab, l => ({ ...l, selected: null, bench: null, guess: null, lessonFor: null, lessonId: null }))
      } else {
        this.m.taught.clear()
        await io.set(S.quiz, () => null)
        await io.set(S.quizKey, () => null)
        await this.m.refreshKnowledge(io)
      }
      const what = part === 'history' ? tr(`zmiany ${v.counts.changes ?? 0}, obserwacje ${v.counts.observations ?? 0}, lekcje ${v.counts.lessons ?? 0}`, `changes ${v.counts.changes ?? 0}, observations ${v.counts.observations ?? 0}, lessons ${v.counts.lessons ?? 0}`) : tr(`wiedza ${v.counts.knowledge ?? 0} pojęć, odpowiedzi ${v.counts.exercises ?? 0}, dowody ${v.counts.evidence ?? 0}`, `knowledge of ${v.counts.knowledge ?? 0} concepts, answers ${v.counts.exercises ?? 0}, evidence ${v.counts.evidence ?? 0}`)
      await this.m.notice(io, `${part === 'history' ? tr('Wyczyszczona historia', 'History cleared') : tr('Zresetowany postęp', 'Progress reset')}: ${what}. ${tr('Kopia sprzed czyszczenia', 'Backup from before cleanup')}: ${v.backup ?? tr('brak', 'none')}.`)
    } catch (e) {
      await this.m.notice(io, `${tr('Czyszczenie nieudane', 'Cleanup failed')}: ${errText(e)}`)
    }
  }

  async diagnose(io: Host): Promise<void> {
    const lines: string[] = []
    const boot = await io.get(S.boot)
    lines.push(`Silnik Claude Code: ${boot.engine}, powierzchnia: ${(await io.surfaces().catch(() => [])).join(', ') || 'brak'}`)
    lines.push(`Projekt: ${boot.project?.root ?? '—'} (git: ${boot.project?.isGit ? 'tak' : 'nie'})`)
    lines.push(`Katalog danych: ${boot.dataDir || 'BRAK'}`)
    try {
      const r = await io.run([boot.node || 'node', '--version'], { timeoutMs: 10000 })
      lines.push(`Node: ${boot.node} → ${r.stdout.trim() || r.stderr.trim()}`)
    } catch (e) {
      lines.push(`Node: NIE DZIAŁA (${errText(e)})`)
    }
    if (this.m.ctx) {
      try {
        const d = await one<Record<string, unknown>>(io, this.m.ctx, 'diag')
        lines.push(`SQLite ${String(d.sqliteVersion)}, schemat v${String(d.schemaVersion)}, tryb ${String(d.journalMode)}, integralność: ${String(d.integrity)}`)
        lines.push(`Rozmiar bazy: ${Math.round(Number(d.dbBytes ?? 0) / 1024)} KB, WAL: ${Math.round(Number(d.walBytes ?? 0) / 1024)} KB`)
        const counts = d.counts as Record<string, number> | undefined
        if (counts) lines.push(`Wiersze: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}`)
      } catch (e) {
        lines.push(`Baza: BŁĄD (${errText(e)})`)
      }
    } else lines.push('Baza: niepodłączona (tryb awaryjny).')
    lines.push(`Bufor zapisów: ${await pendingCount(io)} operacji`)
    const panes = await io.panes().catch(() => [])
    lines.push(`Panel: ${panes.map(p => `${p.id} (${p.isPlaced ? 'widoczny' : 'czeka na miejsce'})`).join(', ') || 'zamknięty'}`)
    lines.push(`Model lekcji: ${this.m.settings.model}, koszty: ${COST_PROFILES[this.m.settings.cost].label}, bezpiecznik: ${this.m.breaker.open(Date.now()) ? 'WSTRZYMANY' : 'ok'}`)
    lines.push(`Kolejka lekcji: ${this.m.jobs.length}, praca: ${this.m.working ? 'tak' : 'nie'}`)
    await this.m.notice(io, lines.join('\n'))
  }

  async testModel(io: Host): Promise<void> {
    const now = await io.now()
    const r = await this.m.callModel(io, 'manual', 'Odpowiedz jednym słowem.', 'Napisz: działa', 20, now)
    await this.m.notice(io, r ? `Model ${this.m.settings.model} odpowiada: ${r.trim().slice(0, 40)}` : `Model ${this.m.settings.model} niedostępny (limit, błąd API albo brak bazy do pilnowania limitów).`)
  }

  async runSql(io: Host, setup: string, query: string): Promise<string> {
    if (!this.m.ctx) return JSON.stringify({ ok: false, error: 'Piaskownica SQL wymaga helpera Node (baza niedostępna).' })
    try {
      return JSON.stringify(await runSql(io, this.m.ctx, setup, query))
    } catch (e) {
      return JSON.stringify({ ok: false, error: errText(e) })
    }
  }
}
