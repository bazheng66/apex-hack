import type { SupabaseClient } from "@supabase/supabase-js"
import type { RecordState } from "../engine/types.ts"
import { rollTo } from "../engine/agent.ts"
import { ensureCloudExam, findCloudRecord, mergeCloudRecord, RecordConflict, saveCloudRecord, type CloudRecord } from "./cloud-record.ts"
import { todayKey } from "./day.ts"
import { loadRecord, readable, saveRecord } from "./storage.ts"
import { persistDerivedFromRecord } from "../algo/sync.ts"
import { migrateLegacyBanks } from "./legacy-banks.ts"

export type SyncStatus = "loading" | "local" | "syncing" | "synced" | "error"
export interface RecordView { state: RecordState | null; status: SyncStatus; error: string | null; ready: boolean; cloudExamId: string | null }
interface Cache { state: RecordState; revision: number; dirty: boolean }

/** One queue per browser. Cache keys include the authenticated owner. */
export class RecordStore {
  view: RecordView
  private listeners = new Set<() => void>()
  private userId: string | null = null
  private cloud: CloudRecord | null = null
  private dirty = false
  private running = false
  private generation = 0
  private initialized = false
  private waiters: (() => void)[] = []
  private client: SupabaseClient | null
  constructor(client: SupabaseClient | null) {
    this.client = client
    this.view = { state: client ? null : loadRecord(), status: client ? "loading" : "local", error: null, ready: !client, cloudExamId: null }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.view
  private emit(patch: Partial<RecordView>) {
    this.view = { ...this.view, ...patch }
    for (const listener of this.listeners) listener()
  }
  private key() { return `testpass-record-${this.userId}` }
  private cache() {
    if (!this.userId || !this.view.state) return
    localStorage.setItem(this.key(), JSON.stringify({ state: this.view.state, revision: this.cloud?.revision ?? 0, dirty: this.dirty }))
  }
  async connect(userId: string | null): Promise<void> {
    if (this.initialized && this.userId === userId) return
    this.initialized = true
    this.userId = userId
    this.cloud = null
    this.dirty = false
    const generation = ++this.generation
    if (!this.client) return
    this.emit({ state: null, ready: false, status: "loading", error: null, cloudExamId: null })
    if (!userId) { this.emit({ ready: true, status: "error", error: "匿名会话未建立，请重试连接。" }); return }
    let cached: Cache | null = null
    try {
      const raw = localStorage.getItem(this.key())
      const parsed = raw ? JSON.parse(raw) : null
      if (parsed && readable(parsed.state)) cached = parsed
      if (!cached && (!localStorage.getItem("testpass-legacy-owner") || localStorage.getItem("testpass-legacy-owner") === userId)) {
        const legacy = loadRecord()
        if (legacy) { cached = { state: legacy, revision: 0, dirty: true }; localStorage.setItem("testpass-legacy-owner", userId) }
      }
      const remote = await findCloudRecord(this.client, userId, cached?.state.examId)
      if (generation !== this.generation) return
      this.cloud = remote
      let state = remote?.state ?? cached?.state ?? null
      if (cached?.dirty) { state = remote?.state ? mergeCloudRecord(remote.state, cached.state) : cached.state; this.dirty = true }
      // Claim pre-cloud data once. The original remains as a backup.
      if (!state && !localStorage.getItem("testpass-legacy-owner")) {
        state = loadRecord()
        if (state) { localStorage.setItem("testpass-legacy-owner", userId); this.dirty = true }
      }
      if (state) state = rollTo(state, todayKey())
      this.emit({ state, ready: true, status: this.dirty ? "syncing" : "synced", cloudExamId: remote?.id ?? null })
      this.cache()
      if (state) { this.dirty = true; await this.flush() }
    } catch (error) {
      if (generation !== this.generation) return
      this.dirty = cached?.dirty ?? false
      this.emit({ state: cached?.state ?? null, ready: true, status: "error", error: message(error) })
    }
  }
  update = (state: RecordState | null) => {
    if (!this.client) {
      try { saveRecord(state); this.emit({ state, status: "local", error: null }) }
      catch { this.emit({ state, status: "error", error: "浏览器无法保存记录，请保持页面打开。" }) }
      return
    }
    if (!state) { this.emit({ state: null }); return }
    if (!this.userId) { this.emit({ status: "error", error: "匿名会话未建立，请先重试连接。" }); return }
    if (state.examId !== this.view.state?.examId) { this.cloud = null; ++this.generation }
    this.dirty = true
    this.emit({ state, status: "syncing", error: null })
    try { this.cache() } catch { this.emit({ status: "error", error: "浏览器缓存不可用，请保持页面打开并重试。" }) }
    void this.flush()
  }
  retry = async () => {
    if (!this.userId) return
    if (!this.view.state) { this.initialized = false; await this.connect(this.userId) }
    else { this.dirty = true; await this.flush() }
  }
  async flush(): Promise<void> {
    if (this.running) return new Promise<void>((resolve) => this.waiters.push(resolve))
    if (!this.client || !this.userId || !this.view.state) return
    this.running = true
    const generation = this.generation
    const userId = this.userId
    try {
      let conflicts = 0
      while (this.dirty && this.view.state && generation === this.generation) {
        const pending = this.view.state
        this.emit({ status: "syncing", error: null })
        if (!this.cloud) {
          const cloud = await ensureCloudExam(this.client, userId, pending)
          if (generation !== this.generation) return
          this.cloud = cloud
          if (cloud.state) { this.emit({ state: mergeCloudRecord(cloud.state, this.view.state ?? pending) }); continue }
        }
        const cloud = this.cloud
        try {
          const revision = await saveCloudRecord(this.client, userId, cloud, pending)
          if (generation !== this.generation) return
          this.cloud = { id: cloud.id, revision, state: pending }
          const derived = await persistDerivedFromRecord(pending, { client: this.client })
          if (generation !== this.generation) return
          if (derived.reason === "error") throw new Error("Derived state sync failed")
          await migrateLegacyBanks(this.client, userId, cloud.id, pending.examId)
          if (generation !== this.generation) return
          this.dirty = this.view.state !== pending
          this.cache()
          this.emit({ cloudExamId: cloud.id, status: this.dirty ? "syncing" : "synced" })
        } catch (error) {
          if (!(error instanceof RecordConflict) || ++conflicts > 3) throw error
          const latest = await findCloudRecord(this.client, userId, pending.examId)
          if (generation !== this.generation) return
          if (!latest?.state) throw error
          this.cloud = latest
          this.emit({ state: mergeCloudRecord(latest.state, this.view.state ?? pending) })
          this.cache()
        }
      }
    } catch (error) {
      if (generation === this.generation) this.emit({ status: "error", error: message(error) })
    } finally {
      this.running = false
      for (const resolve of this.waiters.splice(0)) resolve()
      if (generation !== this.generation && this.dirty) void this.flush()
    }
  }
}
function message(error: unknown) {
  return error instanceof RecordConflict ? error.message : "云同步未完成，记录仍保留在本机。请检查连接或数据库迁移后重试。"
}
