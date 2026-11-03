import { examById, initialMastery, levelById, QUESTIONS, topicById } from "./catalog.ts"
import { abilityFromScore } from "./model.ts"
import { planAssignment, scoreOf, shrinkDaily, weakestOf } from "./plan.ts"
import { applyTopicAbility, clampScore, DRILL_DONE_DELTA, itemScoreDelta, uploadCountsAsHit, uploadScoreDelta } from "./score.ts"
import type { Ability, Daily, GradeItem, Mastery, MistakeNote, Question, RecordState, ReviewCard, Session, SessionKind } from "./types.ts"

export { clampScore, scoreOf }
let lastOccurrence = 0

export function weakest(state: Pick<RecordState, "examId" | "mastery">) {
  return weakestOf(examById(state.examId).topics, state.mastery)
}

function session(
  date: string,
  kind: SessionKind,
  topicId: string,
  detail: string,
  before: number,
  after: number,
  salt: string,
): Session {
  lastOccurrence = Math.max(Date.now(), lastOccurrence + 1)
  return {
    id: salt.startsWith("demo-") || salt === "rolled" ? `${date}-${kind}-${topicId}-${salt}` : crypto.randomUUID(),
    occurredAt: new Date(lastOccurrence).toISOString(),
    date,
    kind,
    topicId,
    detail,
    scoreBefore: before,
    scoreAfter: after,
    ...(kind.startsWith("drill-") ? { payload: { ...(salt === "rolled" ? { reason: "rolled" } : {}), ...(kind === "drill-shrink" ? { minutes_after: 12 } : {}) } } : {}),
  }
}

function replanIfWeakestMoved(state: RecordState, today: string, previousTopicId: string): RecordState {
  if (state.daily.status !== "open") return state
  const plan = planDay(state, today)
  if (plan.topicId === previousTopicId) return state
  return { ...state, daily: plan }
}

function withScore(mastery: Mastery[], topicId: string, score: number): Mastery[] {
  return mastery.map((item) => (item.topicId === topicId ? { ...item, score: clampScore(score) } : item))
}

function abilityList(state: Pick<RecordState, "abilities" | "mastery">): Ability[] {
  const source = state.abilities ?? state.mastery.map((item) => abilityFromScore(item.topicId, item.score))
  return source.map((item) => ({ ...item }))
}


function pushReview(cards: ReviewCard[], topicId: string, prompt: string, id: string, today: string): ReviewCard[] {
  if (cards.some((card) => card.topicId === topicId && card.prompt === prompt)) return cards
  return [
    ...cards,
    {
      id,
      topicId,
      prompt,
      ease: 2.5,
      intervalDays: 1,
      repetitions: 0,
      lapses: 1,
      due: shiftDate(today, 1),
    },
  ]
}

function skipCounted(state: Pick<RecordState, "sessions">, date: string): boolean {
  return state.sessions.some(
    (item) => item.date === date && (item.kind === "drill-shrink" || item.kind === "drill-skip"),
  )
}

export function planDay(state: Pick<RecordState, "examId" | "mastery" | "skipStreak">, date: string): Daily {
  return planAssignment({
    topics: examById(state.examId).topics,
    mastery: state.mastery,
    skipStreak: state.skipStreak,
    date,
  })
}

export function createProfile(examId: RecordState["examId"], level: RecordState["level"], today: string): RecordState {
  const mastery = initialMastery(examId, level)
  const draft = {
    examId,
    level,
    baseline: mastery.map((item) => ({ ...item })),
    mastery,
    sessions: [],
    skipStreak: 0,
    answeredIds: [],
    abilities: mastery.map((item) => abilityFromScore(item.topicId, item.score)),
    cards: [],
    mistakes: [],
    daily: planDay({ examId, mastery, skipStreak: 0 }, today),
  }
  return draft
}

export function shiftDate(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number)
  const value = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, date ?? 1))
  value.setUTCDate(value.getUTCDate() + delta)
  return value.toISOString().slice(0, 10)
}

export function createDemo(today: string): RecordState {
  const profile = createProfile("os", "uneven", today)
  const mastery = withScore(withScore(profile.mastery, "os-sync", 78), "os-paging", 32)
  const state: RecordState = {
    ...profile,
    mastery,
    abilities: mastery.map((item) => abilityFromScore(item.topicId, item.score)),
    skipStreak: 0,
    answeredIds: ["os-1"],
    sessions: [
      session(shiftDate(today, -3), "drill-done", "os-sync", "专项做完。只写了等待和唤醒，不确定的箭头空着。", 74, 78, "demo-sync"),
      session(shiftDate(today, -1), "mock", "os-paging", "三个页框那题选成了 FIFO 和 LRU 同一次淘汰。", 40, 32, "demo-paging"),
    ],
    mistakes: [
      {
        id: "demo-paging",
        date: shiftDate(today, -1),
        topicId: "os-paging",
        text: "三个页框那题选成了 FIFO 和 LRU 同一次淘汰。",
        source: "mock",
      },
    ],
    cards: [
      {
        id: "demo-paging-card",
        topicId: "os-paging",
        prompt: "三个页框那题把 FIFO 和 LRU 的第一次淘汰看成了同一页。",
        ease: 2.5,
        intervalDays: 1,
        repetitions: 0,
        lapses: 1,
        due: today,
      },
    ],
  }
  return { ...state, daily: planDay(state, today) }
}

export function rollTo(state: RecordState, today: string): RecordState {
  if (state.daily.date === today) return state
  if (state.daily.status !== "open") {
    return { ...state, daily: planDay(state, today) }
  }
  if (skipCounted(state, state.daily.date)) {
    return { ...state, daily: planDay(state, today) }
  }
  const before = scoreOf(state.mastery, state.daily.topicId)
  const next: RecordState = {
    ...state,
    skipStreak: state.skipStreak + 1,
    sessions: [
      ...state.sessions,
      session(state.daily.date, "drill-skip", state.daily.topicId, "这一天的专项没有做。", before, before, "rolled"),
    ],
  }
  return { ...next, daily: planDay(next, today) }
}

export function seniorLine(state: RecordState): string {
  const exam = examById(state.examId)
  const level = levelById(state.level)
  const topic = topicById(state.examId, state.daily.topicId)
  const score = scoreOf(state.mastery, topic.id)
  if (state.daily.status === "done") {
    return `${topic.name}今天的专项做完了。这块现在是 ${score}。明天再按分数排，不提前加码。`
  }
  if (state.daily.status === "skipped") {
    return `今天停在${topic.name}。明天还是它，范围更小。不换考试，也不补一段打气的话。`
  }
  if (state.daily.ruleId === "SKIP_SHRINK") {
    return `你说做不动。${topic.name}收到 ${state.daily.minutes} 分钟，只留最小的一问。`
  }
  return `${exam.name}。${level.voice}${topic.name}现在是 ${score}，是最虚的一块。今天 ${state.daily.minutes} 分钟，只碰这里。`
}

export function progressReading(state: RecordState): string {
  const topics = examById(state.examId).topics.map((topic) => ({
    topic,
    score: scoreOf(state.mastery, topic.id),
    base: scoreOf(state.baseline, topic.id),
  }))
  const weak = [...topics].sort((a, b) => a.score - b.score)[0]
  const moved = [...topics].sort((a, b) => Math.abs(b.score - b.base) - Math.abs(a.score - a.base))[0]
  if (!weak || !moved || moved.score === moved.base) {
    return `${weak?.topic.name ?? "这一场"} 现在最低，${weak?.score ?? 0}。这是按你选的水平估的，还没有新的记录。做完专项，或交一份模拟，我才改分数。`
  }
  const direction = moved.score > moved.base ? "升到" : "降到"
  return `${weak.topic.name}现在最低，${weak.score}。变化最大的是${moved.topic.name}，从 ${moved.base} ${direction} ${moved.score}。没练过的章节不算进步。`
}

export function finishToday(state: RecordState): RecordState {
  if (state.daily.status !== "open") return state
  const before = scoreOf(state.mastery, state.daily.topicId)
  const after = clampScore(before + DRILL_DONE_DELTA)
  return {
    ...state,
    skipStreak: 0,
    mastery: withScore(state.mastery, state.daily.topicId, after),
    daily: { ...state.daily, status: "done" },
    sessions: [
      ...state.sessions,
      session(state.daily.date, "drill-done", state.daily.topicId, `专项做完，${state.daily.minutes} 分钟。`, before, after, "done"),
    ],
  }
}

export function deferToday(state: RecordState): RecordState {
  if (state.daily.status !== "open") return state
  const before = scoreOf(state.mastery, state.daily.topicId)
  if (state.daily.ruleId === "SKIP_SHRINK") {
    return {
      ...state,
      skipStreak: state.skipStreak + 1,
      daily: { ...state.daily, status: "skipped" },
      sessions: [
        ...state.sessions,
        session(state.daily.date, "drill-skip", state.daily.topicId, "最小的一问也放下了。今天不再加任务。", before, before, "skip"),
      ],
    }
  }
  const topic = topicById(state.examId, state.daily.topicId)
  return {
    ...state,
    skipStreak: state.skipStreak + 1,
    daily: shrinkDaily(state.daily, topic),
    sessions: [
      ...state.sessions,
      session(state.daily.date, "drill-shrink", state.daily.topicId, "今天做不动。专项收到 12 分钟。", before, before, "shrink"),
    ],
  }
}

export function nextPaper(state: RecordState): Question[] {
  return QUESTIONS.filter((question) => question.examId === state.examId && !state.answeredIds.includes(question.id))
    .sort((a, b) => scoreOf(state.mastery, a.topicId) - scoreOf(state.mastery, b.topicId))
    .slice(0, 3)
}

export function gradePaper(state: RecordState, choices: Record<string, number>, today: string): { state: RecordState; items: GradeItem[] } {
  const paper = nextPaper(state).filter((question) => choices[question.id] !== undefined)
  if (paper.length === 0) return { state, items: [] }
  let mastery = state.mastery.map((item) => ({ ...item }))
  let abilities = abilityList(state)
  let cards = [...(state.cards ?? [])]
  let mistakes: MistakeNote[] = [...(state.mistakes ?? [])]
  const items: GradeItem[] = []
  const sessions = [...state.sessions]
  for (const question of paper) {
    const chosen = choices[question.id] ?? 0
    const correct = chosen === question.answer
    const before = scoreOf(mastery, question.topicId)
    const after = clampScore(before + itemScoreDelta(correct))
    mastery = withScore(mastery, question.topicId, after)
    abilities = applyTopicAbility(abilities, question.topicId, correct, before)
    const note = question.notes[chosen] ?? ""
    items.push({ questionId: question.id, topicId: question.topicId, chosen, correct, note, before, after })
    sessions.push({ ...session(today, "mock", question.topicId, note, before, after, question.id), payload: { correct, chosen, note, items: [{ item_id: question.id, topic_id: question.topicId, chosen, correct, note }] } })
    if (!correct) {
      mistakes = [
        ...mistakes,
        {
          id: `${today}-mock-${question.id}`,
          date: today,
          topicId: question.topicId,
          text: note,
          source: "mock",
        },
      ]
      cards = pushReview(cards, question.topicId, question.prompt, `${today}-card-${question.id}`, today)
    }
  }
  const previousTopicId = state.daily.topicId
  let next: RecordState = {
    ...state,
    mastery,
    abilities,
    cards,
    mistakes,
    sessions,
    answeredIds: [...state.answeredIds, ...paper.map((question) => question.id)],
  }
  next = replanIfWeakestMoved(next, today, previousTopicId)
  return { state: next, items }
}

export function recordUpload(
  state: RecordState,
  input: { topicId: string; correct: number; total: number; mistake: string; today: string },
): { ok: true; state: RecordState; line: string } | { ok: false; message: string } {
  if (!Number.isInteger(input.total) || input.total < 1 || input.total > 50) {
    return { ok: false, message: "总题数填 1 到 50。" }
  }
  if (!Number.isInteger(input.correct) || input.correct < 0 || input.correct > input.total) {
    return { ok: false, message: "做对的题数要在 0 和总题数之间。" }
  }
  const topic = topicById(state.examId, input.topicId)
  const before = scoreOf(state.mastery, topic.id)
  const delta = uploadScoreDelta(input.correct, input.total)
  const after = clampScore(before + delta)
  const mistake = input.mistake.trim()
  const detail = mistake
    ? `自交模拟 ${input.correct}/${input.total}。错法：${mistake}`
    : `自交模拟 ${input.correct}/${input.total}。`
  const salt = state.sessions.length
  const abilities = applyTopicAbility(abilityList(state), topic.id, uploadCountsAsHit(input.correct, input.total), before)
  let cards = [...(state.cards ?? [])]
  let mistakes = [...(state.mistakes ?? [])]
  if (mistake) {
    mistakes = [
      ...mistakes,
      {
        id: `${input.today}-upload-${salt}`,
        date: input.today,
        topicId: topic.id,
        text: mistake,
        source: "upload",
      },
    ]
    cards = pushReview(cards, topic.id, mistake, `${input.today}-upload-card-${salt}`, input.today)
  }
  let next: RecordState = {
    ...state,
    mastery: withScore(state.mastery, topic.id, after),
    abilities,
    cards,
    mistakes,
    sessions: [...state.sessions, { ...session(input.today, "upload", topic.id, detail, before, after, `${salt}-${input.correct}-${input.total}`), payload: { correct_count: input.correct, total: input.total, mistake_text: mistake } }],
  }
  next = replanIfWeakestMoved(next, input.today, state.daily.topicId)
  const switched = next.daily.topicId !== state.daily.topicId && state.daily.status === "open"
  const line = switched
    ? `${topic.name}按 ${input.correct}/${input.total} 记成 ${after}。今天的专项改到${topicById(next.examId, next.daily.topicId).name}，因为那里现在更低。`
    : `${topic.name}按 ${input.correct}/${input.total} 记成 ${after}。${mistake ? `错法记下了。` : ""}明天的专项按这个分数重排。`
  return { ok: true, state: next, line }
}

export function letterOf(index: number): string {
  return "ABCD"[index] ?? "?"
}
