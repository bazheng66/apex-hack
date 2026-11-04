import { progressReading, scoreOf } from "../engine/agent.ts"
import { examById, topicById } from "../engine/catalog.ts"
import type { MistakeNote } from "../engine/types.ts"
import { forecastLine } from "../features/forecast.ts"
import { formatDay, todayKey } from "../lib/day.ts"
import { cn } from "../lib/cn.ts"
import { useRecord } from "../lib/useRecord.tsx"

function formatRating(rating: number): string {
  if (!Number.isFinite(rating)) return "还没有"
  const rounded = Math.round(rating * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function newestMistakes(notes: MistakeNote[] | undefined): MistakeNote[] {
  return [...(notes ?? [])]
    .map((note, index) => ({ note, index }))
    .sort((left, right) => (left.note.date === right.note.date ? right.index - left.index : left.note.date < right.note.date ? 1 : -1))
    .map((item) => item.note)
}

const KIND = {
  "drill-done": "专项完成",
  "drill-shrink": "缩短",
  "drill-skip": "放下",
  mock: "模拟",
  upload: "自交",
} as const

export default function Progress() {
  const { state } = useRecord()
  if (!state) return null
  const exam = examById(state.examId)
  const sessions = [...state.sessions].reverse()
  const notes = newestMistakes(state.mistakes)
  const outlook = forecastLine({
    mastery: state.mastery,
    sessions: state.sessions,
    today: todayKey(),
    goal: state.goal,
    paper: state.paper,
  })

  return (
    <article>
      <p className="text-[11px] tracking-[0.22em] text-muted">实力</p>
      <h1 className="mt-4 max-w-2xl font-serif text-3xl font-semibold leading-snug text-ink">{progressReading(state)}</h1>
      {state.abilities && state.abilities.length > 0 && (
        <section data-coach="abilities" className="mt-10">
          <p className="max-w-2xl text-sm leading-7">规则分按做对做错加减。能力估计用 Elo，只随模拟和自交结果动。</p>
          <ul className="mt-4 border-b border-line">
            {exam.topics.map((topic) => {
              const ability = state.abilities?.find((item) => item.topicId === topic.id)
              const rule = scoreOf(state.mastery, topic.id)
              return (
                <li key={topic.id} className="flex items-baseline justify-between gap-4 border-t border-line py-3 text-sm">
                  <span>{topic.name}</span>
                  <span className="text-right text-muted">
                    规则分 {rule}
                    <span className="ml-3">能力估计 {ability ? formatRating(ability.rating) : "还没有"}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <p data-coach="forecast" className="mt-8 max-w-2xl text-sm leading-7">
        {outlook}
      </p>

      <ol className="mt-12 border-b border-line">
        {exam.topics.map((topic) => {
          const score = scoreOf(state.mastery, topic.id)
          const base = scoreOf(state.baseline, topic.id)
          const delta = score - base
          return (
            <li key={topic.id} className="border-t border-line py-6">
              <div className="flex items-baseline justify-between gap-4">
                <p className="min-w-0 text-sm leading-6 text-ink">{topic.name}</p>
                <p className="shrink-0 text-right font-serif text-2xl leading-none text-ink tabular-nums">
                  {score}
                  <span
                    className={cn(
                      "ml-2 align-baseline font-sans text-xs",
                      delta > 0 ? "text-moss" : delta < 0 ? "text-seal" : "text-muted",
                    )}
                  >
                    {delta === 0 ? "未动" : delta > 0 ? `+${delta}` : delta}
                  </span>
                </p>
              </div>
              <div className="relative mt-4 h-4">
                <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 bg-[color-mix(in_srgb,var(--color-muted)_32%,var(--color-line))]" />
                <div className="absolute top-1/2 h-2 -translate-y-1/2 bg-ink" style={{ width: `${score}%` }} />
                <div className="absolute top-0 h-4 w-0.5 bg-seal" style={{ left: `min(${base}%, calc(100% - 2px))` }} />
              </div>
              <p className="mt-2 text-xs text-muted">开始时 {base}</p>
            </li>
          )
        })}
      </ol>

      <section data-coach="notebook" className="mt-16">
        <h2 className="text-[11px] tracking-[0.22em] text-muted">错法</h2>
        {notes.length === 0 ? (
          <p className="mt-4 text-sm leading-7 text-muted">还没有记下的错法。交一次模拟，或写下错在哪，会出现在这里。</p>
        ) : (
          <ol className="mt-4 border-b border-line">
            {notes.map((note, index) => {
              const name = exam.topics.find((topic) => topic.id === note.topicId)?.name ?? "这一块"
              const source = note.source === "mock" ? "模拟" : note.source === "upload" ? "自交" : "专项"
              return (
                <li key={`${note.id}-${index}`} className="border-t border-line py-4">
                  <p className="text-xs text-muted">
                    {formatDay(note.date)}
                    <span className="ml-3">{name}</span>
                    <span className="ml-3">{source}</span>
                  </p>
                  <p className="mt-2 text-sm leading-6">{note.text}</p>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <h2 className="mt-16 text-[11px] tracking-[0.22em] text-muted">记录</h2>
      {sessions.length === 0 ? (
        <p className="mt-4 text-sm leading-7 text-muted">还没有。今天的专项或一份模拟，都会写在这里。</p>
      ) : (
        <ol className="mt-4 border-b border-line">
          {sessions.map((item, index) => (
            <li key={`${item.id}-${index}`} className="grid gap-2 border-t border-line py-5 sm:grid-cols-[9rem_1fr]">
              <p className="text-xs text-muted">
                {formatDay(item.date)}
                <span className="mt-1 block">{KIND[item.kind]}</span>
              </p>
              <div>
                <p className="text-sm leading-6">{item.detail}</p>
                <p className="mt-1 text-xs text-muted">
                  {topicById(state.examId, item.topicId).name} {item.scoreBefore} → {item.scoreAfter}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}
