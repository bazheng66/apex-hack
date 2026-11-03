import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { shiftDate } from "../engine/agent.ts"
import { EXAMS, LEVELS } from "../engine/catalog.ts"
import type { ExamId, Goal, LevelId } from "../engine/types.ts"
import { useRecord } from "../lib/useRecord.tsx"
import { cn } from "../lib/cn.ts"
import { todayKey } from "../lib/day.ts"
import { Button } from "./ui/button.tsx"
import { SyncNotice } from "./SyncNotice.tsx"

export default function Setup() {
  const { start, demo } = useRecord()
  const navigate = useNavigate()
  const [examId, setExamId] = useState<ExamId>("os")
  const [level, setLevel] = useState<LevelId>("uneven")
  const [examDate, setExamDate] = useState(() => shiftDate(todayKey(), 21))
  const [target, setTarget] = useState("80")

  function goalFromForm(): Goal {
    const parsed = Number(target)
    const rounded = Number.isFinite(parsed) ? Math.round(parsed) : 80
    return {
      examDate: /^\d{4}-\d{2}-\d{2}$/.test(examDate) ? examDate : shiftDate(todayKey(), 21),
      target: Math.min(96, Math.max(60, rounded)),
    }
  }

  return (
    <main className="sheet mx-auto min-h-svh max-w-xl px-5 py-14 sm:px-6 sm:py-24">
      <p className="text-[11px] tracking-[0.28em] text-muted">第一次进入</p>
      <div className="mt-5 flex items-start gap-4">
        <span
          aria-hidden="true"
          className="mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-[2px] bg-seal font-serif text-xl font-semibold leading-none text-paper shadow-[inset_0_0_0_1px_rgba(243,236,223,0.55)]"
        >
          T
        </span>
        <h1 className="min-w-0 font-serif text-4xl font-bold leading-none tracking-tight text-ink sm:text-6xl">
          Testpass
          <span className="mt-3 block text-xl font-semibold tracking-wide text-ink sm:text-2xl">AI考试通过助手</span>
        </h1>
      </div>
      <p className="mt-6 text-sm leading-7 text-ink/80">
        告诉我你要应对的考试，以及你现在的水平。我按这个督促每天的专项，并记下你后来交来的模拟。
      </p>

      <fieldset className="mt-12">
        <legend className="text-[11px] tracking-[0.18em] text-muted">准备哪一场</legend>
        <div className="mt-3 border-t border-line">
          {EXAMS.map((exam) => {
            const on = examId === exam.id
            return (
              <button
                key={exam.id}
                type="button"
                aria-pressed={on}
                onClick={() => setExamId(exam.id)}
                className={cn(
                  "flex w-full items-center gap-4 border-b border-l-2 border-b-line py-4 pr-2 pl-3 text-left",
                  on ? "border-l-seal bg-card" : "border-l-transparent",
                )}
              >
                <Dot on={on} />
                <span className={cn("text-sm", on ? "text-ink" : "text-muted")}>{exam.name}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="mt-10">
        <legend className="text-[11px] tracking-[0.18em] text-muted">现在的水平</legend>
        <div className="mt-3 border-t border-line">
          {LEVELS.map((item) => {
            const on = level === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={on}
                onClick={() => setLevel(item.id)}
                className={cn(
                  "flex w-full items-start gap-4 border-b border-l-2 border-b-line py-4 pr-2 pl-3 text-left",
                  on ? "border-l-seal bg-card" : "border-l-transparent",
                )}
              >
                <Dot on={on} />
                <span>
                  <span className={cn("block text-sm", on ? "text-ink" : "text-muted")}>{item.name}</span>
                  <span className="mt-1 block text-sm leading-6 text-muted">{item.detail}</span>
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="mt-10">
        <legend className="text-[11px] tracking-[0.18em] text-muted">想考到哪</legend>
        <div className="mt-3 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-muted">考试日期</span>
            <input
              type="date"
              value={examDate}
              onChange={(event) => setExamDate(event.target.value)}
              className="mt-2 block w-full rounded-[2px] border border-line bg-card px-3 py-3 text-sm text-ink outline-none focus:border-seal"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">目标分</span>
            <input
              type="number"
              inputMode="numeric"
              min={60}
              max={96}
              step={1}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="mt-2 block w-full rounded-[2px] border border-line bg-card px-3 py-3 text-sm text-ink outline-none focus:border-seal"
            />
          </label>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted">默认 21 天后，目标 80。范围 60 到 96。</p>
      </fieldset>

      <div className="mt-10 flex w-full flex-col items-stretch gap-3 sm:max-w-sm">
        <Button
          size="lg"
          className="w-full"
          onClick={() => {
            start(examId, level, goalFromForm())
            navigate("/today")
          }}
        >
          让 Testpass 安排今天
        </Button>
        <button
          type="button"
          className="inline-flex h-12 w-full items-center justify-center rounded-[2px] border border-line bg-transparent px-6 text-sm text-ink hover:border-seal"
          onClick={() => {
            demo()
            navigate("/today")
          }}
        >
          先看一份练过几天的记录
        </button>
      </div>
      <SyncNotice />
      <p className="mt-8 text-xs leading-6 text-muted">访客记录随当前浏览器的匿名身份保存。请保留浏览器数据；换设备需要重新开始。</p>
    </main>
  )
}

function Dot({ on }: { on: boolean }) {
  return <span className={cn("mt-1.5 h-2 w-2 shrink-0 border", on ? "border-seal bg-seal" : "border-line bg-transparent")} />
}
