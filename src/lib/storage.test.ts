import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createProfile } from "../engine/agent.ts"
import type { RecordState } from "../engine/types.ts"
import { todayKey } from "./day.ts"
import { loadRecord, saveRecord } from "./storage.ts"

function installMemory() {
  const jar = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => jar.get(key) ?? null,
    setItem: (key: string, value: string) => {
      jar.set(key, value)
    },
    removeItem: (key: string) => {
      jar.delete(key)
    },
    clear: () => {
      jar.clear()
    },
  })
}

describe("saved record", () => {
  beforeEach(() => {
    installMemory()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("drops a record when daily is not an open, done, or skipped day", () => {
    const state = createProfile("os", "uneven", todayKey())
    for (const daily of ["open", 1, null, [], { ...state.daily, status: "later" }, { ...state.daily, date: 20261103 }, { ...state.daily, topicId: 1 }]) {
      saveRecord({ ...state, daily } as unknown as RecordState)
      let loaded: RecordState | null = state
      expect(() => {
        loaded = loadRecord()
      }).not.toThrow()
      expect(loaded).toBeNull()
    }
  })

  it("drops a record when mastery or baseline is not scored topics", () => {
    const state = createProfile("os", "uneven", todayKey())
    const broken = [
      { ...state, mastery: [{ topicId: "os-paging", score: "40" }] },
      { ...state, mastery: [{ topicId: "os-paging" }] },
      { ...state, mastery: [null] },
      { ...state, baseline: [{ topicId: 1, score: 40 }] },
      { ...state, baseline: "none" },
    ]
    for (const value of broken) {
      saveRecord(value as unknown as RecordState)
      expect(loadRecord()).toBeNull()
    }
  })

  it("keeps goal, cards, abilities, and mistakes when they are present", () => {
    const today = todayKey()
    const state = createProfile("os", "uneven", today)
    const mastery = state.mastery.map((item, index) => (index === 0 ? { ...item, kept: "yes" } : item))
    const saved = {
      ...state,
      mastery,
      daily: { ...state.daily, hint: "keep-me" },
      goal: { examDate: "2026-12-20", target: 85 },
      cards: [{ id: "c1", topicId: "os-paging", prompt: "FIFO", ease: 2.5, intervalDays: 1, repetitions: 0, lapses: 0, due: today }],
      abilities: [{ topicId: "os-paging", rating: 1400, uncertainty: 0.4 }],
      mistakes: [{ id: "m1", date: today, topicId: "os-paging", text: "FIFO 和 LRU 记成同一次", source: "upload" as const }],
    }
    saveRecord(saved as unknown as RecordState)
    const loaded = loadRecord()
    expect(loaded?.goal).toEqual(saved.goal)
    expect(loaded?.cards).toEqual(saved.cards)
    expect(loaded?.abilities).toEqual(saved.abilities)
    expect(loaded?.mistakes).toEqual(saved.mistakes)
    expect(loaded?.mastery[0]).toMatchObject({ kept: "yes", topicId: mastery[0]?.topicId, score: mastery[0]?.score })
    expect(loaded?.daily).toMatchObject({ hint: "keep-me", status: "open", date: today })

    const rolled = {
      ...createProfile("os", "uneven", "2020-01-01"),
      goal: { examDate: "2026-12-20", target: 80 },
      cards: [],
      abilities: [],
      mistakes: [],
    }
    rolled.daily = { ...rolled.daily, status: "done" }
    saveRecord(rolled)
    const next = loadRecord()
    expect(next?.goal).toEqual(rolled.goal)
    expect(next?.cards).toEqual([])
    expect(next?.abilities).toEqual([])
    expect(next?.mistakes).toEqual([])
    expect(next?.daily.date).toBe(today)
  })

  it("loads when goal, cards, abilities, and mistakes are absent", () => {
    const state = createProfile("network", "basic", todayKey())
    const older = { ...state }
    delete older.abilities
    delete older.cards
    delete older.mistakes
    delete older.goal
    saveRecord(older)
    let loaded: RecordState | null = null
    expect(() => {
      loaded = loadRecord()
    }).not.toThrow()
    expect(loaded?.examId).toBe("network")
    expect(loaded?.goal).toBeUndefined()
    expect(loaded?.cards).toBeUndefined()
    expect(loaded?.mistakes).toBeUndefined()
    expect(loaded?.abilities?.map((item) => item.topicId)).toEqual(state.mastery.map((item) => item.topicId))
  })
})
