import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in for HTMLAudioElement: records what the battle music does with it.
class FakeAudio {
  static all: FakeAudio[] = []
  volume = 1
  paused = true
  currentTime = 0
  duration = 90
  ended = false
  private listeners: Record<string, (() => void)[]> = {}
  constructor(public src: string) {
    FakeAudio.all.push(this)
  }
  addEventListener(type: string, fn: () => void): void {
    ;(this.listeners[type] ??= []).push(fn)
  }
  fire(type: string): void {
    for (const fn of this.listeners[type] ?? []) fn()
  }
  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
}

describe('battle music', () => {
  beforeEach(() => {
    FakeAudio.all = []
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] })
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('crossfades into the next theme before the current one ends, so there is no gap', async () => {
    const { battleMusic } = await import('../../src/client/audio/sound')
    battleMusic(true)
    expect(FakeAudio.all).toHaveLength(1)
    const first = FakeAudio.all[0]!
    expect(first.src).toMatch(/battle_1\.mp3$/)
    expect(first.paused).toBe(false)

    // well before the end nothing changes
    first.currentTime = 60
    first.fire('timeupdate')
    expect(FakeAudio.all).toHaveLength(1)

    // four seconds from the end the next theme starts silent and rises while the first falls
    first.currentTime = 86.5
    first.fire('timeupdate')
    expect(FakeAudio.all).toHaveLength(2)
    const second = FakeAudio.all[1]!
    expect(second.src).toMatch(/battle_2\.mp3$/)
    expect(second.paused).toBe(false)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(2000)
    expect(first.volume).toBeGreaterThan(0)
    expect(second.volume).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(2500)
    expect(first.paused).toBe(true)
    expect(first.volume).toBe(0)
    expect(second.volume).toBeCloseTo(0.32, 2)

    // a second hand-over goes on to the third theme, and stopping silences everything
    second.currentTime = 87
    second.fire('timeupdate')
    expect(FakeAudio.all[2]!.src).toMatch(/battle_3\.mp3$/)
    battleMusic(false)
    expect(FakeAudio.all.every((a) => a.paused)).toBe(true)
  })
})
