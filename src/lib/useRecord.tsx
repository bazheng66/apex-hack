import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react"
import { createDemo, createProfile, shiftDate } from "../engine/agent.ts"
import type { ExamId, Goal, LevelId, RecordState } from "../engine/types.ts"
import { todayKey } from "./day.ts"
import { RecordStore, type RecordView } from "./record-store.ts"
import { bootstrapSupabaseAuth, supabase } from "./supabase.ts"

interface RecordApi extends RecordView {
  setState: (state: RecordState | null) => void
  reset: () => void
  retrySync: () => Promise<void>
  flushSync: () => Promise<void>
  start: (examId: ExamId, level: LevelId, goal?: Goal | null) => void
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
    start: (examId, level, goal) => {
      const profile = createProfile(examId, level, todayKey())
      store.update(goal ? { ...profile, goal } : profile)
    },
    demo: () => { const today = todayKey(); store.update({ ...createDemo(today), goal: { examDate: shiftDate(today, 21), target: 80 } }) },
  }
  if (!view.ready) return <main className="sheet mx-auto max-w-xl px-5 py-16" role="status">正在连接你的练习记录…</main>
  return <RecordContext.Provider value={api}>{children}</RecordContext.Provider>
}
export function useRecord(): RecordApi {
  const value = useContext(RecordContext)
  if (!value) throw new Error("useRecord 需要放在 RecordProvider 里")
  return value
}
