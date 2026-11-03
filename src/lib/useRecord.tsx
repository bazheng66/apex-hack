import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createDemo, createProfile, shiftDate } from "../engine/agent.ts"
import type { ExamId, Goal, LevelId, RecordState } from "../engine/types.ts"
import { todayKey } from "./day.ts"
import { loadRecord, saveRecord } from "./storage.ts"

interface RecordApi {
  state: RecordState | null
  setState: (state: RecordState | null) => void
  reset: () => void
  start: (examId: ExamId, level: LevelId, goal?: Goal | null) => void
  demo: () => void
}

const RecordContext = createContext<RecordApi | null>(null)

export function RecordProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RecordState | null>(() => loadRecord())

  useEffect(() => {
    saveRecord(state)
  }, [state])

  const api: RecordApi = {
    state,
    setState,
    reset: () => setState(null),
    start: (examId, level, goal) => {
      const profile = createProfile(examId, level, todayKey())
      setState(goal ? { ...profile, goal } : profile)
    },
    demo: () => {
      const today = todayKey()
      setState({
        ...createDemo(today),
        goal: { examDate: shiftDate(today, 21), target: 80 },
      })
    },
  }

  return <RecordContext.Provider value={api}>{children}</RecordContext.Provider>
}

export function useRecord(): RecordApi {
  const value = useContext(RecordContext)
  if (!value) throw new Error("useRecord 需要放在 RecordProvider 里")
  return value
}
