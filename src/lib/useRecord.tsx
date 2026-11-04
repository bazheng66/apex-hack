import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react"
import { createDemo, createProfile, shiftDate } from "../engine/agent.ts"
import type { ExamId, Goal, LevelId, PaperProfile, RecordState } from "../engine/types.ts"
import { todayKey } from "./day.ts"
import { RecordStore, type RecordView } from "./record-store.ts"
import { bootstrapSupabaseAuth, supabase } from "./supabase.ts"

interface RecordApi extends RecordView {
  setState: (state: RecordState | null) => void
  reset: () => void
  retrySync: () => Promise<void>
  flushSync: () => Promise<void>
  start: (examId: ExamId, level: LevelId, goal?: Goal | null, paper?: PaperProfile | null) => void
  demo: () => void
}
const store = new RecordStore(supabase)
const RecordContext = createContext<RecordApi | null>(null)

export function RecordProvider({ children }: { children: ReactNode }) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => {
    let live = true
    void bootstrapSupabaseAuth().then(async () => {
      const result = await supabase?.auth.getSession()
      if (live && supabase) await store.connect(result?.data.session?.user.id ?? null)
    })
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => { if (live) void store.connect(session?.user.id ?? null) }, 0)
    }).data.subscription
    const online = () => { void store.retry() }
    window.addEventListener("online", online)
    return () => { live = false; subscription?.unsubscribe(); window.removeEventListener("online", online) }
  }, [])
  const retrySync = async () => {
    await bootstrapSupabaseAuth()
    const result = await supabase?.auth.getSession()
    await store.connect(result?.data.session?.user.id ?? null)
    await store.retry()
  }
  const api: RecordApi = {
    ...view, setState: store.update, reset: () => store.update(null), retrySync, flushSync: () => store.flush(),
    start: (examId, level, goal, paper) => {
      const profile = createProfile(examId, level, todayKey())
      store.update({ ...profile, ...(goal ? { goal } : {}), ...(paper ? { paper } : {}) })
    },
    demo: () => { const today = todayKey(); store.update({ ...createDemo(today), goal: { examDate: shiftDate(today, 21), target: 80 } }) },
  }
  if (!view.ready) {
    return (
      <main className="sheet mx-auto min-h-svh max-w-xl px-5 py-24 sm:px-6" role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[2px] bg-seal font-serif text-lg font-semibold leading-none text-paper">T</span>
          <div>
            <p className="font-serif text-2xl font-bold leading-none tracking-wide text-ink">Testpass</p>
            <p className="mt-1.5 text-xs tracking-[0.14em] text-muted">正在连接练习记录</p>
          </div>
        </div>
        <div className="mt-12 space-y-4">
          <div className="h-6 w-4/5 animate-pulse rounded-[2px] bg-line" />
          <div className="h-6 w-3/5 animate-pulse rounded-[2px] bg-line" />
          <div className="mt-10 h-20 w-full animate-pulse rounded-[2px] bg-card" />
          <div className="h-20 w-full animate-pulse rounded-[2px] bg-card" />
        </div>
        <p className="mt-10 text-xs leading-6 text-muted">第一次打开要先建立一个匿名身份，通常两三秒。</p>
      </main>
    )
  }
  return <RecordContext.Provider value={api}>{children}</RecordContext.Provider>
}
export function useRecord(): RecordApi {
  const value = useContext(RecordContext)
  if (!value) throw new Error("useRecord 需要放在 RecordProvider 里")
  return value
}
