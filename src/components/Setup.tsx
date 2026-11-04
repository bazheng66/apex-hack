import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { shiftDate } from "../engine/agent.ts"
import { EXAMS, LEVELS } from "../engine/catalog.ts"
import type { ExamId, Goal, LevelId, PaperDifficulty, PaperProfile } from "../engine/types.ts"
import { useRecord } from "../lib/useRecord.tsx"
import { cn } from "../lib/cn.ts"
import { todayKey } from "../lib/day.ts"
import { Button } from "./ui/button.tsx"
import { SyncNotice } from "./SyncNotice.tsx"

const DIFFICULTIES: { id: PaperDifficulty; label: string }[] = [
  { id: "easy", label: "偏易" },
  { id: "normal", label: "正常" },
  { id: "hard", label: "偏难" },
]

function equalShares(examId: ExamId): Record<string, number> {
  const topics = EXAMS.find((exam) => exam.id === examId)?.topics ?? []
  const each = topics.length > 0 ? Math.round(100 / topics.length) : 25
  return Object.fromEntries(topics.map((topic) => [topic.id, each]))
}

export default function Setup() {
  const { start, demo } = useRecord()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preset = params.get("exam") as ExamId | null

  const [step, setStep] = useState(0)
  const [examId, setExamId] = useState<ExamId>(preset && EXAMS.some((exam) => exam.id === preset) ? preset : "os")
  const [level, setLevel] = useState<LevelId>("uneven")
  const [examDate, setExamDate] = useState(() => shiftDate(todayKey(), 21))
  const [target, setTarget] = useState("80")
  const [paperOpen, setPaperOpen] = useState(false)
  const [questions, setQuestions] = useState("30")
  const [difficulty, setDifficulty] = useState<PaperDifficulty>("normal")
  const [shares, setShares] = useState<Record<string, number>>(() => equalShares(examId))

  const topics = EXAMS.find((exam) => exam.id === examId)?.topics ?? []

  useEffect(() => {
    setShares(equalShares(examId))
  }, [examId])

  function pickExam(id: ExamId) {
    setExamId(id)
    setStep(1)
  }

  function pickLevel(id: LevelId) {
    setLevel(id)
    setStep(2)
  }

  function goalFromForm(): Goal {
    const parsed = Number(target)
    const rounded = Number.isFinite(parsed) ? Math.round(parsed) : 80
    return {
      examDate: /^\d{4}-\d{2}-\d{2}$/.test(examDate) ? examDate : shiftDate(todayKey(), 21),
      target: Math.min(96, Math.max(60, rounded)),
    }
  }

  function paperFromForm(): PaperProfile | null {
    if (!paperOpen) return null
    const parsed = Number(questions)
    return {
      questions: Number.isFinite(parsed) ? Math.min(120, Math.max(5, Math.round(parsed))) : 30,
      difficulty,
      shares: topics.map((topic) => ({ topicId: topic.id, percent: Math.max(0, Number(shares[topic.id] ?? 0)) })),
    }
  }

  return (
    <main className="sheet mx-auto min-h-svh max-w-xl px-5 py-14 sm:px-6 sm:py-24">
      <div className="flex items-center justify-between">
        <p className="text-[11px] tracking-[0.28em] text-muted">第一次进入</p>
        <p className="text-[11px] tracking-[0.28em] text-muted">{`${step + 1} / 3`}</p>
      </div>

      <div className="mt-4 flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={cn("h-[3px] flex-1 rounded-[2px]", index <= step ? "bg-seal" : "bg-line")}
          />
        ))}
      </div>

      {step === 0 && (
        <section className="mt-12">
          <h1 className="font-serif text-4xl font-bold leading-tight text-ink sm:text-5xl">你在准备哪场考试？</h1>
          <p className="mt-4 text-sm leading-7 text-muted">先选一场。之后每天只安排这场里最弱的那一块。</p>
          <div className="mt-10 border-t border-line">
            {EXAMS.map((exam) => (
              <button
                key={exam.id}
                type="button"
                onClick={() => pickExam(exam.id)}
                className="flex w-full items-center gap-4 border-b border-l-2 border-b-line border-l-transparent py-5 pr-2 pl-3 text-left hover:border-l-seal hover:bg-card"
              >
                <span className="h-2 w-2 shrink-0 border border-line" />
                <span className="text-base text-ink">{exam.name}</span>
                <span className="ml-auto text-xs text-muted">{exam.topics.length} 个专项</span>
              </button>
            ))}
          </div>

          <div className="mt-10 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                demo()
                navigate("/today")
              }}
              className="inline-flex h-12 items-center justify-center rounded-[2px] border border-line text-sm text-ink hover:border-seal"
            >
              先看一份练过几天的记录
            </button>
            <button type="button" onClick={() => navigate("/account")} className="text-xs text-muted hover:text-seal">
              我有账号，去登录
            </button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="mt-12">
          <button type="button" onClick={() => setStep(0)} className="text-xs text-muted hover:text-seal">
            ← 换一场考试
          </button>
          <h1 className="mt-6 font-serif text-4xl font-bold leading-tight text-ink sm:text-5xl">现在大概什么水平？</h1>
          <p className="mt-4 text-sm leading-7 text-muted">选最接近的一个。它决定第一天给你多少任务。</p>
          <div className="mt-10 border-t border-line">
            {LEVELS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => pickLevel(item.id)}
                className="flex w-full items-start gap-4 border-b border-l-2 border-b-line border-l-transparent py-5 pr-2 pl-3 text-left hover:border-l-seal hover:bg-card"
              >
                <span className="mt-1.5 h-2 w-2 shrink-0 border border-line" />
                <span>
                  <span className="block text-base text-ink">{item.name}</span>
                  <span className="mt-1 block text-sm leading-6 text-muted">{item.detail}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="mt-12">
          <button type="button" onClick={() => setStep(1)} className="text-xs text-muted hover:text-seal">
            ← 改水平
          </button>
          <h1 className="mt-6 font-serif text-4xl font-bold leading-tight text-ink sm:text-5xl">什么时候考，想考多少？</h1>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
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
                className="mt-2 block w-full rounded-[2px] border border-line bg-card px-3 py-3 text-sm text-ink tabular-nums outline-none focus:border-seal"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => setPaperOpen((open) => !open)}
            className="mt-8 text-xs text-muted underline decoration-line underline-offset-4 hover:text-seal"
          >
            {paperOpen ? "收起这场卷子的结构" : "可选：这场卷子长什么样（填了预测更准）"}
          </button>

          {paperOpen && (
            <div className="mt-4 rounded-[2px] border border-line bg-card px-4 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-muted">总题量</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={5}
                    max={120}
                    value={questions}
                    onChange={(event) => setQuestions(event.target.value)}
                    className="mt-2 block w-full rounded-[2px] border border-line bg-paper px-3 py-2 text-sm text-ink tabular-nums outline-none focus:border-seal"
                  />
                </label>
                <div>
                  <span className="text-xs text-muted">难度</span>
                  <div className="mt-2 flex gap-1">
                    {DIFFICULTIES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={difficulty === item.id}
                        onClick={() => setDifficulty(item.id)}
                        className={cn(
                          "h-10 flex-1 rounded-[2px] border text-xs",
                          difficulty === item.id ? "border-seal bg-seal text-paper" : "border-line text-muted",
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted">各章占比（百分比，不必凑满 100）</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {topics.map((topic) => (
                  <label key={topic.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">{topic.name}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      value={shares[topic.id] ?? 0}
                      onChange={(event) => setShares((current) => ({ ...current, [topic.id]: Number(event.target.value) }))}
                      className="w-16 rounded-[2px] border border-line bg-paper px-2 py-1.5 text-right text-xs text-ink tabular-nums outline-none focus:border-seal"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mt-10 flex flex-col gap-3 sm:max-w-sm">
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                start(examId, level, goalFromForm(), paperFromForm())
                navigate("/today")
              }}
            >
              开始
            </Button>
          </div>
        </section>
      )}

      <SyncNotice />
    </main>
  )
}
