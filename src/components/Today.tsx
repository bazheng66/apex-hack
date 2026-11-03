import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Companion } from "./Companion.tsx"
import { PagingLab } from "./coach/PagingLab.tsx"
import { planDraft } from "../algo/index.ts"
import { deferToday, finishToday, scoreOf, seniorLine, shiftDate } from "../engine/agent.ts"
import { examById, levelById, topicById } from "../engine/catalog.ts"
import type { ReviewCard } from "../engine/types.ts"
import { mockDailyPlan, mockStreak } from "../features/algo-display.ts"
import { copyLine, presentHint } from "../features/companion.ts"
import { forecastLine } from "../features/forecast.ts"
import { reviewCard } from "../features/review.ts"
import { streakDays } from "../features/streak.ts"
import { cn } from "../lib/cn.ts"
import { formatDay, todayKey } from "../lib/day.ts"
import { askSenior } from "../lib/senior.ts"
import { useRecord } from "../lib/useRecord.tsx"

function dueCard(cards: ReviewCard[] | undefined, topicId: string, today: string): ReviewCard | null {
  if (!cards?.length) return null
  return (
    cards
      .filter((card) => card.topicId === topicId && card.due <= today)
      .sort((left, right) => (left.due < right.due ? -1 : left.due > right.due ? 1 : 0))[0] ?? null
  )
}

export default function Today() {
  const { state, setState } = useRecord()
  const [params] = useSearchParams()
  const [spoken, setSpoken] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [goalDate, setGoalDate] = useState(() => shiftDate(todayKey(), 21))
  const [goalTarget, setGoalTarget] = useState("80")
  const topicId = state?.daily.topicId
  const status = state?.daily.status
  const minutes = state?.daily.minutes
  const date = state?.daily.date
  const score = state && topicId ? scoreOf(state.mastery, topicId) : 0

  useEffect(() => {
    if (!state || !topicId) return
    const topic = topicById(state.examId, topicId)
    let cancel = false
    setPending(true)
    setSpoken(null)
    void askSenior({
      kind: "today",
      exam: examById(state.examId).name,
      levelVoice: levelById(state.level).voice,
      topic: topic.name,
      score: scoreOf(state.mastery, topicId),
      minutes: state.daily.minutes,
      status: state.daily.status,
      instruction: state.daily.instruction,
      reason: state.daily.reason,
    }).then((line) => {
      if (cancel) return
      setSpoken(line)
      setPending(false)
    })
    return () => {
      cancel = true
    }
  }, [state, topicId, status, minutes, date])

  if (!state || !topicId) return null
  const record = state
  const today = todayKey()
  const topic = topicById(state.examId, topicId)
  const fallback = seniorLine(state)
  const line = spoken ?? fallback
  const plan = mockDailyPlan(record, today, planDraft(record.daily))
  const streakView = mockStreak(record, today)
  const shown = presentHint(plan.companion_hint, params.toString())
  const streak = streakView.current
  const week = streakDays(state.sessions, today)
  const streakNote = plan.copy_keys.find((key) => key === "streak_up" || key === "streak_broke")
  const streakDetail =
    streakView.current > 0
      ? streakView.best > streakView.current
        ? `连续 ${streakView.current} 天 · 最好 ${streakView.best} 天`
        : `连续 ${streakView.current} 天`
      : undefined
  const card = dueCard(state.cards, topicId, today)
  const outlook = forecastLine({
    mastery: state.mastery,
    sessions: state.sessions,
    today,
    goal: state.goal,
  })

  function grade(value: number) {
    if (!card || !record.cards) return
    setState({
      ...record,
      cards: record.cards.map((item) => (item.id === card.id ? reviewCard(item, value, today) : item)),
    })
  }

  return (
    <article>
      <p className="text-[11px] tracking-[0.22em] text-muted">{formatDay(state.daily.date)}</p>
      <h1 className="mt-5 max-w-2xl text-balance font-serif text-3xl font-semibold leading-snug text-ink sm:text-4xl sm:leading-tight">
        {line}
      </h1>
      <p className="mt-4 max-w-2xl text-xs leading-5 text-muted">
        {spoken ? "这句话由 Testpass 写成。分数和专项仍按规则。" : pending ? "分数已定。Testpass 在写这句话。" : "Testpass 暂时没写成，上面是按规则留下的话。"}
      </p>
      <Companion hint={shown.hint} copyKeys={plan.copy_keys} detail={streakDetail} forced={shown.forced} />

      <dl className="mt-10 grid grid-cols-3 border border-line bg-card">
        <div className="min-w-0 px-3 py-5 sm:px-5">
          <dt className="text-[11px] tracking-[0.14em] text-muted">专项</dt>
          <dd className="mt-2 font-serif text-base leading-snug break-words text-ink sm:text-lg">{topic.name}</dd>
        </div>
        <div className="min-w-0 border-l border-line px-3 py-5 sm:px-5">
          <dt className="text-[11px] tracking-[0.14em] text-muted">时长</dt>
          <dd className="mt-2 font-serif text-2xl leading-none text-ink tabular-nums">
            {state.daily.minutes} <span className="font-sans text-xs font-normal tracking-normal text-muted">分钟</span>
          </dd>
        </div>
        <div className="min-w-0 border-l border-line px-3 py-5 sm:px-5">
          <dt className="text-[11px] tracking-[0.14em] text-muted">当前</dt>
          <dd className="mt-2 font-serif text-2xl leading-none text-ink tabular-nums">{score}</dd>
        </div>
      </dl>
      <section data-coach="streak" data-companion-hint={shown.hint} className="mt-8">
        <p className="text-sm leading-7">{streak > 0 ? `已经连续 ${streak} 天` : "今天还没有记上"}</p>
        {streakNote && <p className="mt-2 text-sm leading-7 text-muted">{copyLine(streakNote)}</p>}
        <ol className="mt-4 grid grid-cols-7 gap-2">
          {week.map((day) => (
            <li
              key={day.date}
              data-mark={day.mark}
              title={formatDay(day.date)}
              className={cn(
                "rounded-[2px] border px-1 py-2 text-center text-xs",
                day.counted ? "border-seal bg-seal text-paper" : day.mark === "today" ? "border-seal text-ink" : "border-line text-muted",
              )}
            >
              <span className="block tabular-nums">{Number(day.date.slice(8))}</span>
              <span className="mt-1 block">{day.mark === "today" ? "今天" : day.mark === "done" ? "做了" : "未做"}</span>
            </li>
          ))}
        </ol>
      </section>

      <section data-coach="forecast" className="mt-6">
        <p className="max-w-2xl text-sm leading-7">{outlook}</p>
        {!record.goal && (
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              const parsed = Number(goalTarget)
              const rounded = Number.isFinite(parsed) ? Math.round(parsed) : 80
              setState({
                ...record,
                goal: {
                  examDate: /^\d{4}-\d{2}-\d{2}$/.test(goalDate) ? goalDate : shiftDate(today, 21),
                  target: Math.min(96, Math.max(60, rounded)),
                },
              })
            }}
          >
            <label className="block">
              <span className="text-xs text-muted">考试日期</span>
              <input
                type="date"
                value={goalDate}
                onChange={(event) => setGoalDate(event.target.value)}
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
                value={goalTarget}
                onChange={(event) => setGoalTarget(event.target.value)}
                className="mt-2 block w-full rounded-[2px] border border-line bg-card px-3 py-3 text-sm text-ink outline-none focus:border-seal"
              />
            </label>
            <button type="submit" className="h-12 rounded-[2px] bg-seal px-5 text-sm text-paper">
              记下目标
            </button>
          </form>
        )}
      </section>

      {card && (
        <section data-coach="review" className="mt-8 rounded-[2px] border border-line bg-card px-5 py-5">
          <p className="text-sm leading-7">{card.prompt}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="h-12 rounded-[2px] border border-line px-5 text-sm hover:border-seal" onClick={() => grade(0)}>
              不会
            </button>
            <button type="button" className="h-12 rounded-[2px] border border-line px-5 text-sm hover:border-seal" onClick={() => grade(3)}>
              模糊
            </button>
            <button type="button" className="h-12 rounded-[2px] bg-seal px-5 text-sm text-paper" onClick={() => grade(5)}>
              记住
            </button>
          </div>
          <p className="mt-4 text-sm leading-7 text-muted">这只改下次再看见它的日子，不改规则分。</p>
        </section>
      )}

      {topicId === "os-paging" && <PagingLab />}

      {state.daily.status === "open" && (
        <>
          <div className="mt-8 rounded-[2px] border-y border-r border-l-2 border-y-line border-r-line border-l-seal bg-card px-5 py-5">
            {score < 45 && <p className="mb-4 max-w-2xl text-sm leading-7">分数不到 45。今天只做最小的一问。</p>}
            {score >= 75 && <p className="mb-4 max-w-2xl text-sm leading-7">这一场里它仍是最低的一块。今天还是只碰这里。</p>}
            <p className="max-w-2xl text-sm leading-7 text-ink">{state.daily.instruction}</p>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">{state.daily.reason}</p>
            <p className="mt-3 font-mono text-[11px] tracking-[0.14em] text-muted">{state.daily.ruleId}</p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              className="h-12 rounded-[2px] bg-seal px-6 text-sm text-paper hover:bg-[#742418]"
              onClick={() => {
                const next = finishToday(state)
                setState(next)
              }}
            >
              做完了
            </button>
            <button
              type="button"
              className="h-12 rounded-[2px] border border-line bg-transparent px-6 text-sm text-ink hover:border-seal"
              onClick={() => {
                const next = deferToday(state)
                setState(next)
              }}
            >
              今天做不动
            </button>
          </div>
        </>
      )}

      {state.daily.status !== "open" && (
        <p className="mt-8 max-w-2xl rounded-[2px] border border-line bg-card px-5 py-5 text-sm leading-7 text-muted">
          今天的专项已经有了结果。分数在「实力」里。明天再排，不在今天加新的章节。
        </p>
      )}

      <p className="mt-16 text-sm leading-7 text-muted">
        想把卷面拍给 Testpass，或让它去公开页面找一道真题，去
        <Link to="/talk" className="mx-1 text-ink underline decoration-line underline-offset-4 hover:decoration-seal">
          对话
        </Link>
        。站内做题仍在
        <Link to="/mock" className="mx-1 text-ink underline decoration-line underline-offset-4 hover:decoration-seal">
          模拟
        </Link>
        。
      </p>
    </article>
  )
}
