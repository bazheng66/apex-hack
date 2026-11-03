import type { SupabaseClient } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createProfile, finishToday, deferToday } from "../engine/agent.ts"
import { todayKey } from "./day.ts"
import { RecordStore } from "./record-store.ts"
import { saveRecord } from "./storage.ts"
import { RecordConflict } from "./cloud-record.ts"

const mocks = vi.hoisted(() => ({ find: vi.fn(), ensure: vi.fn(), save: vi.fn(), derived: vi.fn() }))
vi.mock("./cloud-record.ts", async (load) => ({ ...await load<typeof import("./cloud-record.ts")>(), findCloudRecord: mocks.find, ensureCloudExam: mocks.ensure, saveCloudRecord: mocks.save }))
vi.mock("../algo/sync.ts", () => ({ persistDerivedFromRecord: mocks.derived }))
vi.mock("./legacy-banks.ts", () => ({ migrateLegacyBanks: vi.fn(async () => {}) }))
const client = {} as SupabaseClient
const state = () => createProfile("os", "basic", todayKey())
const cloud = (record = state(), revision = 1) => ({ id: "cloud-exam", state: record, revision })
let cache: Map<string, string>

beforeEach(() => {
  vi.clearAllMocks()
  cache = new Map()
  vi.stubGlobal("localStorage", { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value), removeItem: (key: string) => cache.delete(key) })
  mocks.find.mockResolvedValue(null)
  mocks.ensure.mockResolvedValue({ id: "cloud-exam", state: null, revision: 0 })
  mocks.save.mockResolvedValue(1)
  mocks.derived.mockResolvedValue({ reason: "upserted" })
})

describe("record sync queue", () => {
  it("migrates legacy state once, then keeps different anonymous users isolated", async () => {
    saveRecord(state())
    const store = new RecordStore(client)
    await store.connect("owner")
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(store.view.status).toBe("synced")
    expect(cache.has("testpass-record-owner")).toBe(true)
    await store.connect("other")
    expect(store.view.state).toBeNull()
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(cache.has("testpass-record-other")).toBe(false)
  })
  it("keeps offline pending actions across reload and resumes with the same IDs", async () => {
    await new RecordStore(client).connect("owner")
    const store = new RecordStore(client)
    await store.connect("owner")
    mocks.save.mockRejectedValue(new Error("offline"))
    const done = finishToday(state())
    store.update(done)
    await store.flush()
    expect(store.view.status).toBe("error")
    expect(JSON.parse(cache.get("testpass-record-owner")!).dirty).toBe(true)
    mocks.save.mockResolvedValue(2)
    const resumed = new RecordStore(client)
    await resumed.connect("owner")
    expect(resumed.view.status).toBe("synced")
    expect(resumed.view.state?.sessions[0]?.id).toBe(done.sessions[0]?.id)
    expect(JSON.parse(cache.get("testpass-record-owner")!).dirty).toBe(false)
  })
  it("awaits the active write, saves newer edits, and never overwrites them with its old snapshot", async () => {
    const store = new RecordStore(client)
    await store.connect("owner")
    let release!: (value: number) => void
    mocks.save.mockImplementationOnce(() => new Promise<number>((resolve) => { release = resolve }))
    store.update(state())
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    const later = deferToday(store.view.state!)
    store.update(later)
    const idle = store.flush()
    release(1)
    await idle
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(store.view.state).toEqual(later)
    expect(store.view.status).toBe("synced")
  })
  it("rebases a lost-response retry against the latest revision without duplicate sessions", async () => {
    const done = finishToday(state())
    mocks.find.mockResolvedValue(cloud(done))
    const store = new RecordStore(client)
    await store.connect("owner")
    mocks.save.mockRejectedValueOnce(new RecordConflict("conflict")).mockResolvedValue(3)
    mocks.find.mockResolvedValue(cloud(done, 2))
    store.update(done)
    await store.flush()
    expect(store.view.state?.sessions).toHaveLength(1)
    expect(store.view.status).toBe("synced")
  })
  it("drops an old in-flight result when the anonymous identity changes", async () => {
    const store = new RecordStore(client)
    await store.connect("owner")
    let release!: (value: number) => void
    mocks.save.mockImplementationOnce(() => new Promise<number>((resolve) => { release = resolve }))
    store.update(state())
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    await store.connect("other")
    release(1)
    await store.flush()
    expect(store.view.state).toBeNull()
    expect(cache.has("testpass-record-other")).toBe(false)
  })
})
