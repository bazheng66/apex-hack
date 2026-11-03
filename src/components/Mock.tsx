import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { syncAfterLocalChange } from "../algo/index.ts"
import { gradePaper, letterOf, nextPaper, recordUpload } from "../engine/agent.ts"
import { QUESTIONS, examById, topicById } from "../engine/catalog.ts"
import type { GradeItem } from "../engine/types.ts"
import { forecastRange, mockSessionSubmit, submitSummary, type SessionSubmitView } from "../features/algo-display.ts"
import { presentHint } from "../features/companion.ts"
import { todayKey } from "../lib/day.ts"
import { askSenior } from "../lib/senior.ts"
import { useRecord } from "../lib/useRecord.tsx"
import { cn } from "../lib/cn.ts"
import { Companion } from "./Companion.tsx"

export default function Mock() {
  const { state } = useRecord()
  const [mode, setMode] = useState<"site" | "upload">("site")
  if (!state) return null

  return (
    <article>
      <p className="text-[11px] tracking-[0.22em] text-muted">模拟</p>
      <h1 className="mt-4 max-w-2xl font-serif text-3xl font-semibold leading-snug text-ink">交卷，我才改分数</h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">
        在这里做开放的几道，或把你自己找来、做完的结果交上来。完整题库以后会收费，这一版不放出来。
      </p>

      <div className="mt-8 flex gap-1 border-b border-line">
        {(
          [
            ["site", "在这里做"],
            ["upload", "交我做过的"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={cn(
              "-mb-px inline-flex h-12 items-center border-b-2 px-3 text-sm",
              mode === id ? "border-seal text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-10">{mode === "site" ? <SitePaper /> : <UploadForm />}</div>

      <p className="mt-16 text-sm text-muted">
        记完可以去
        <Link to="/progress" className="ml-1 text-ink underline decoration-line underline-offset-4 hover:decoration-seal">
          实力
        </Link>
        看哪一块动了。
      </p>
    </article>
  )
}

function SitePaper() {
  const { state, setState } = useRecord()
  const [params] = useSearchParams()
  const [choices, setChoices] = useState<Record<string, number>>({})
  const [review, setReview] = useState<GradeItem[] | null>(null)
  const [feedback, setFeedback] = useState<SessionSubmitView | null>(null)
  const [comment, setComment] = useState<string | null>(null)
  const [commenting, setCommenting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const examId = state?.examId

  useEffect(() => {
    if (!review || !examId) return
    let cancel = false
    setComment(null)
    setCommenting(true)
    void askSenior({
      kind: "review",
      exam: examById(examId).name,
      items: review.map((item) => {
        const question = QUESTIONS.find((entry) => entry.id === item.questionId)
        return {
          topic: topicById(examId, item.topicId).name,
          prompt: question?.prompt ?? "",
          chosen: question ? `${letterOf(item.chosen)}. ${question.choices[item.chosen] ?? ""}` : "",
          correct: item.correct,
          note: item.note,
        }
      }),
    }).then((line) => {
      if (cancel) return
      setComment(line)
      setCommenting(false)
    })
    return () => {
      cancel = true
    }
  }, [review, examId])

  if (!state || !examId) return null
  const paper = nextPaper(state)

  if (review) {
    return (
      <div>
        {feedback && <SubmitCompanion view={feedback} search={params.toString()} />}
        <p className="mt-6 mb-6 max-w-2xl rounded-[2px] border-y border-r border-l-2 border-y-line border-r-line border-l-seal bg-card px-5 py-4 text-sm leading-7">
          {comment ?? (commenting ? "分数已经记下。Testpass 在看这套题。" : "Testpass 暂时没写成。每题下面仍是规则给出的说明。")}
        </p>
        <ol className="space-y-4">
          {review.map((item, index) => {
            const question = QUESTIONS.find((entry) => entry.id === item.questionId)
            return (
              <li
                key={item.questionId}
                className={cn(
                  "rounded-[2px] border-y border-r border-l-2 border-y-line border-r-line bg-card px-5 py-5",
                  item.correct ? "border-l-moss" : "border-l-seal",
                )}
              >
                <p className="text-xs text-muted">
                  第 {index + 1} 题 · <span className={item.correct ? "text-moss" : "text-seal"}>{item.correct ? "对" : "错"}</span> · {item.before} → {item.after}
                </p>
                <p className="mt-2 text-sm leading-7">{item.note}</p>
                {!item.correct && question && (
                  <p className="mt-2 text-sm leading-7 text-muted">
                    提交之后可以看定论：{letterOf(question.answer)}. {question.choices[question.answer]}
                  </p>
                )}
              </li>
            )
          })}
        </ol>
        <button
          type="button"
          className="mt-8 inline-flex h-12 items-center text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-seal"
          onClick={() => {
            setReview(null)
            setComment(null)
            setFeedback(null)
            setChoices({})
          }}
        >
          继续
        </button>
      </div>
    )
  }

  if (paper.length === 0) {
    return (
      <p className="max-w-2xl text-sm leading-7 text-muted">
        这一场的开放题做完了。更多套题以后收费，现在不假装还有下一套。你自己找的题，仍然可以交结果。
      </p>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (paper.some((question) => choices[question.id] === undefined)) {
          setError("每一题都要选。选完再交，交了才会计分。")
          return
        }
        const today = todayKey()
        const graded = gradePaper(state, choices, today)
        setState(graded.state)
        syncAfterLocalChange(graded.state)
        setReview(graded.items)
        setFeedback(
          mockSessionSubmit({
            before: state,
            after: graded.state,
            today,
            sessionId: graded.state.sessions.at(-1)?.id ?? "local",
            correctN: graded.items.filter((item) => item.correct).length,
            totalN: graded.items.length,
            deltas: graded.items,
          }),
        )
        setError(null)
      }}
    >
      <ol className="space-y-10">
        {paper.map((question, index) => (
          <li key={question.id} className="rounded-[2px] border border-line bg-card px-4 py-5 sm:px-5">
            <p className="text-[11px] tracking-[0.16em] text-muted">第 {index + 1} 题</p>
            <p className="mt-3 font-serif text-lg leading-8">{question.prompt}</p>
            <div className="mt-5 border-t border-line">
              {question.choices.map((choice, choiceIndex) => {
                const selected = choices[question.id] === choiceIndex
                return (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setChoices((current) => ({ ...current, [question.id]: choiceIndex }))}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-l-2 border-b-line py-3.5 pr-2 pl-3 text-left",
                      selected ? "border-l-seal bg-paper" : "border-l-transparent",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[2px] border text-xs leading-none",
                        selected ? "border-seal bg-seal text-paper" : "border-line text-muted",
                      )}
                    >
                      {letterOf(choiceIndex)}
                    </span>
                    <span className={cn("text-sm leading-6", selected ? "text-ink" : "text-muted")}>{choice}</span>
                  </button>
                )
              })}
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="mt-6 text-sm text-seal">
          {error}
        </p>
      )}
      <button type="submit" className="mt-10 h-12 rounded-[2px] bg-seal px-6 text-sm text-paper hover:bg-[#742418]">
        交卷
      </button>
    </form>
  )
}

function UploadForm() {
  const { state, setState } = useRecord()
  const [params] = useSearchParams()
  const [topicId, setTopicId] = useState(state?.daily.topicId ?? "")
  const [correct, setCorrect] = useState("3")
  const [total, setTotal] = useState("5")
  const [mistake, setMistake] = useState("")
  const [line, setLine] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<SessionSubmitView | null>(null)
  const [spoken, setSpoken] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!state) return null
  const topics = examById(state.examId).topics

  return (
    <form
      className="max-w-xl"
      onSubmit={(event) => {
        event.preventDefault()
        const result = recordUpload(state, {
          topicId,
          correct: Number(correct),
          total: Number(total),
          mistake,
          today: todayKey(),
        })
        if (!result.ok) {
          setError(result.message)
          setLine(null)
          setFeedback(null)
          return
        }
        const today = todayKey()
        const beforeScore = state.mastery.find((item) => item.topicId === topicId)?.score ?? 0
        const afterScore = result.state.mastery.find((item) => item.topicId === topicId)?.score ?? beforeScore
        setState(result.state)
        syncAfterLocalChange(result.state)
        setLine(result.line)
        setFeedback(
          mockSessionSubmit({
            before: state,
            after: result.state,
            today,
            sessionId: result.state.sessions.at(-1)?.id ?? "local",
            correctN: Number(correct),
            totalN: Number(total),
            deltas: [{ topicId, before: beforeScore, after: afterScore }],
          }),
        )
        setSpoken(null)
        setSpeaking(true)
        setError(null)
        const topicName = topicById(state.examId, topicId).name
        const nextScore = result.state.mastery.find((item) => item.topicId === topicId)?.score ?? 0
        void askSenior({
          kind: "upload",
          exam: examById(state.examId).name,
          topic: topicName,
          correct: Number(correct),
          total: Number(total),
          score: nextScore,
          mistake,
          ruleLine: result.line,
        }).then((text) => {
          setSpoken(text)
          setSpeaking(false)
        })
        setMistake("")
      }}
    >
      <p className="text-sm leading-7 text-muted">题可以在别处做。交来的是题量、对错和你认为的错法。照片我先不判，避免把看不清的卷子当成分析。</p>
      <label className="mt-8 block text-xs tracking-[0.16em] text-muted">
        知识点
        <select
          value={topicId}
          onChange={(event) => setTopicId(event.target.value)}
          className="mt-3 w-full rounded-[2px] border border-line bg-card px-3 py-3 text-sm text-ink focus:border-seal"
        >
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-6 grid grid-cols-2 gap-4">
        <label className="text-xs tracking-[0.16em] text-muted">
          做对
          <input
            inputMode="numeric"
            value={correct}
            onChange={(event) => setCorrect(event.target.value)}
            className="mt-3 w-full rounded-[2px] border border-line bg-card px-3 py-3 text-sm text-ink tabular-nums focus:border-seal"
          />
        </label>
        <label className="text-xs tracking-[0.16em] text-muted">
          共
          <input
            inputMode="numeric"
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            className="mt-3 w-full rounded-[2px] border border-line bg-card px-3 py-3 text-sm text-ink tabular-nums focus:border-seal"
          />
        </label>
      </div>
      <label className="mt-6 block text-xs tracking-[0.16em] text-muted">
        错在哪
        <textarea
          value={mistake}
          onChange={(event) => setMistake(event.target.value)}
          placeholder="例如：把 FIFO 和 LRU 的第一次淘汰写成了同一页"
          className="mt-3 min-h-28 w-full rounded-[2px] border border-line bg-card px-4 py-3 text-sm leading-6 text-ink placeholder:text-muted/70 focus:border-seal"
        />
      </label>
      {error && (
        <p role="alert" className="mt-4 text-sm text-seal">
          {error}
        </p>
      )}
      {feedback && <SubmitCompanion view={feedback} search={params.toString()} />}
      {line && <p className="mt-4 text-sm leading-7 text-muted">{line}</p>}
      {speaking && <p className="mt-3 text-xs text-muted">分数已经记下。Testpass 在看你写的错法。</p>}
      {spoken && <p className="mt-3 text-sm leading-7">{spoken}</p>}
      <button type="submit" className="mt-8 h-12 rounded-[2px] bg-seal px-6 text-sm text-paper hover:bg-[#742418]">
        记入实力
      </button>
    </form>
  )
}

function SubmitCompanion({ view, search }: { view: SessionSubmitView; search: string }) {
  const shown = presentHint(view.companion_hint, search)
  const range = forecastRange(view.pass_forecast)
  return (
    <>
      <Companion hint={shown.hint} copyKeys={view.copy_keys} detail={submitSummary(view)} forced={shown.forced} />
      {range && <p className="mt-3 text-sm leading-7 text-muted">{range}</p>}
    </>
  )
}
