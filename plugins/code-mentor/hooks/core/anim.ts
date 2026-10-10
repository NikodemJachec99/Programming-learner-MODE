// Jeden harmonogram animacji Mentora: odtwarzanie w Symulatorze, odsłanianie wyników laboratorium,
// błyski plików, liczniki czasu agentów i zadań w tle, wyjście zadań, oczekiwanie na lekcję
// i krótkie potwierdzenia. Śpi do najbliższej zmiany; gdy nic się nie rusza, nie zostawia timera.

import type { Host } from '../host'
import { nextChange } from '../engine/activity'
import { nextRead, withOutput } from '../engine/tasks'
import { S } from '../ui/state'
import { simTotal } from '../ui/simcache'

/** Pauza między krokami odtwarzania w Symulatorze. */
export const SPEED_MS = { slow: 8000, normal: 4000, fast: 1800 } as const
/** Klatka spinnerów w terminalu i odstęp kroków animacji laboratorium. */
export const FRAME_MS = 150
export const BENCH_FRAME_MS = 800
export const BENCH_FRAMES = 5

export class Animator {
  /** `isWorking`: czy Claude pracuje nad bieżącym poleceniem (licznik czasu paska zadania). */
  constructor(private readonly isWorking: () => boolean) {}

  // Jedna pętla dla wszystkiego, co się rusza: odtwarzanie w Symulatorze, odsłanianie wyników
  // laboratorium, błyski plików, oczekiwanie na lekcję i krótkie potwierdzenia. Śpi dokładnie do
  // najbliższej zmiany; gdy nic się nie rusza, kończy się i nie zostawia żadnego timera.

  /** Licznik klatek (spinnery w terminalu). */
  frame = 0
  /** Powierzchnia, na której panel był ostatnio rysowany (na desktopie ruch robi CSS w SVG). */
  lastSurface: string | null = null
  private animIo: Host | null = null
  private animRunning = false
  private simNextAt = 0
  private benchNextAt = 0
  /** Ile razy pętla obudziła się, żeby przerysować (do pomiarów i testów). */
  animTicks = 0

  /** Budzi harmonogram, jeśli śpi. */
  wake(io: Host): void {
    this.animIo = io
    if (!this.animRunning) void this.loop().catch(() => undefined)
  }

  private async loop(): Promise<void> {
    this.animRunning = true
    try {
      // bezpiecznik: żadna animacja nie trwa dłużej niż kilka tysięcy kroków
      for (let guard = 0; guard < 20_000; guard++) {
        const io = this.animIo
        if (!io) break
        const now = await io.now()
        const due = await this.due(io, now)
        if (due === null) break
        if (!(await io.sleep(Math.max(40, due - now)))) break
        // krok liczy się co najmniej do zaplanowanej chwili (zegar bez sesji stoi w miejscu)
        await this.step(io, Math.max(due, await io.now()))
      }
    } finally {
      this.animRunning = false
    }
  }

  private async due(io: Host, now: number): Promise<number | null> {
    const due: number[] = []
    // w terminalu błysk pliku to shimmer z klatek; na desktopie robi go CSS
    const a = nextChange(await io.get(S.activity), now, FRAME_MS, this.lastSurface === 'terminal')
    if (a !== null) due.push(a)
    // pracujący subagenci i zadania w tle: licznik czasu raz na sekundę, wyjście zadań co kilka sekund
    const tasks = await io.get(S.tasks)
    const working = this.isWorking()
    if (working || (await io.get(S.agents)).some(x => x.status === 'running') || tasks.some(t => t.status === 'running')) due.push(now + 1000)
    const read = nextRead(tasks)
    if (read !== null) due.push(read)
    if ((await io.get(S.sim)).playing) due.push(this.simNextAt)
    if ((await io.get(S.lab)).bench?.reveal !== undefined) due.push(this.benchNextAt)
    const job = await io.get(S.job)
    // terminal nie ma CSS: spinner oczekiwania na lekcję to klatki tekstu
    if ((job.state === 'working' || job.state === 'queued') && this.lastSurface === 'terminal') due.push(now + 400)
    const flash = await io.get(S.flash)
    if (flash && flash.until > now) due.push(flash.until)
    return due.length ? Math.min(...due) : null
  }

  private async step(io: Host, now: number): Promise<void> {
    this.frame++
    this.animTicks++
    const sim = await io.get(S.sim)
    if (sim.playing && now >= this.simNextAt - 5) {
      const total = simTotal(sim)
      // odtwarzanie żyje tylko na widocznej zakładce Symulatora
      if ((await io.get(S.tab)) !== 'sim' || sim.cursor >= total - 1) await io.set(S.sim, s => ({ ...s, playing: false }))
      else {
        await io.set(S.sim, s => ({ ...s, cursor: Math.min(total - 1, s.cursor + 1), playing: s.cursor + 1 < total - 1 }))
        this.simNextAt = now + SPEED_MS[sim.speed ?? 'slow']
      }
    }
    // ostatnie linie wyjścia zadań w tle (tylko te, którym minął odstęp)
    for (const t of await io.get(S.tasks)) {
      if (t.status === 'running' && t.outputFile && now >= t.nextReadAt - 5) await this.readTask(io, t.id)
    }
    const b = (await io.get(S.lab)).bench
    if (b?.reveal !== undefined && now >= this.benchNextAt - 5) {
      const cells = b.cases.length * b.variants.length
      const f = (b.frame ?? 0) + 1
      const reveal = f >= BENCH_FRAMES ? b.reveal + 1 : b.reveal
      await io.set(S.lab, l => (l.bench ? { ...l, bench: { ...l.bench, reveal: reveal >= cells ? undefined : reveal, frame: f >= BENCH_FRAMES ? 0 : f } } : l))
      this.benchNextAt = now + BENCH_FRAME_MS
    }
    io.invalidate()
  }

  /** Odczyt wyjścia zadania w tle (ostatnie linie, po redakcji). Błąd odczytu tylko odsuwa następną próbę. */
  async readTask(io: Host, id: string, file?: string): Promise<void> {
    const t = (await io.get(S.tasks)).find(x => x.id === id)
    const path = file ?? t?.outputFile
    if (!t || !path) return
    const now = await io.now()
    try {
      const text = await io.fsRead(path)
      await io.set(S.tasks, list => withOutput(list, id, text, now).map(x => (x.id === id && !x.outputFile ? { ...x, outputFile: path } : x)))
    } catch {
      await io.set(S.tasks, list => list.map(x => (x.id === id ? { ...x, nextReadAt: now + 10_000 } : x)))
    }
  }

  /** Zmiana tempa działa od następnego kroku, także w trakcie odtwarzania. */
  async cycleSpeed(io: Host): Promise<void> {
    await io.set(S.sim, s => ({ ...s, speed: s.speed === 'fast' ? ('slow' as const) : s.speed === 'normal' ? ('fast' as const) : ('normal' as const) }))
  }

  /**
   * Animacja uruchomienia laboratorium: komórki wyniku odsłaniają się po kolei, a liczona
   * pokazuje, którą linię właśnie wykonuje. Wyniki są policzone od razu; animacja tylko je odsłania.
   */
  async animateBench(io: Host): Promise<void> {
    const b = (await io.get(S.lab)).bench
    if (!b || !b.cases.length) return
    await io.set(S.lab, l => (l.bench ? { ...l, bench: { ...l.bench, reveal: 0, frame: 0 } } : l))
    this.benchNextAt = (await io.now()) + BENCH_FRAME_MS
    this.wake(io)
  }

  /** „Pokaż od razu”: koniec animacji, wszystkie wyniki widoczne. */
  async skipBench(io: Host): Promise<void> {
    await io.set(S.lab, l => (l.bench ? { ...l, bench: { ...l.bench, reveal: undefined, frame: undefined } } : l))
  }

  /**
   * Odtwarzanie w Symulatorze: kursor idzie sam, krok po kroku. Tempo stałe na krok, żeby dało się
   * śledzić linię, zmienne i wyjście: wolno 8 s, średnio 4 s, szybko 1,8 s. Drugie wywołanie to pauza.
   */
  async playSim(io: Host): Promise<void> {
    const sim = await io.get(S.sim)
    if (sim.playing) return void (await io.set(S.sim, s => ({ ...s, playing: false })))
    const total = simTotal(sim)
    if (total <= 1) return
    await io.set(S.sim, s => ({ ...s, playing: true, cursor: s.cursor >= total - 1 ? 0 : s.cursor }))
    this.simNextAt = (await io.now()) + SPEED_MS[sim.speed ?? 'slow']
    this.wake(io)
  }

  /** Krótkie potwierdzenie (sukces albo błąd) na górze panelu; znika samo. */
  async flash(io: Host, text: string, tone: 'ok' | 'error' = 'ok', ms = 2600): Promise<void> {
    const now = await io.now()
    await io.set(S.flash, () => ({ text, tone, until: now + ms }))
    this.wake(io)
  }
}
