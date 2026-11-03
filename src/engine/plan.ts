import type { Daily, Mastery } from "./types.ts"

export interface PlanTopic {
  id: string
  name: string
  drill: string
  minimum: string
}

export function scoreOf(mastery: readonly Mastery[], topicId: string): number {
  return mastery.find((item) => item.topicId === topicId)?.score ?? 0
}

export function weakestOf<T extends { id: string }>(topics: readonly T[], mastery: readonly Mastery[]): { topic: T; score: number } {
  const first = topics[0]
  if (!first) throw new Error("exam has no topics")
  return topics.reduce<{ topic: T; score: number }>((best, topic) => {
    const score = scoreOf(mastery, topic.id)
    return score < best.score ? { topic, score } : best
  }, { topic: first, score: scoreOf(mastery, first.id) })
}

export function planAssignment(input: {
  topics: readonly PlanTopic[]
  mastery: readonly Mastery[]
  skipStreak: number
  date: string
}): Daily {
  const { topic, score } = weakestOf(input.topics, input.mastery)
  let minutes = 25
  let ruleId: Daily["ruleId"] = "LOWEST_TOPIC"
  let instruction = topic.drill
  let reason = `${topic.name} 现在是 ${score}，是这场里最低的一块。今天不新开章节。`

  if (input.skipStreak >= 2) {
    minutes = 12
    ruleId = "SKIP_SHRINK"
    instruction = topic.minimum
    reason = `专项已经连续放下 ${input.skipStreak} 次。今天只留 ${topic.name} 的最小一问，收到 12 分钟。`
  } else if (input.skipStreak === 1) {
    minutes = 18
    ruleId = "SKIP_TRIM"
    instruction = topic.minimum
    reason = `昨天这件没有做完。今天仍是 ${topic.name}，收到 18 分钟，先做最小的一问。`
  }

  return { date: input.date, topicId: topic.id, minutes, instruction, reason, ruleId, status: "open" }
}

/** Same-day "做不动": keep the topic, cut to 12 minutes. Status stays open. */
export function shrinkDaily(daily: Daily, topic: { name: string; minimum: string }): Daily {
  return {
    ...daily,
    minutes: 12,
    ruleId: "SKIP_SHRINK",
    instruction: topic.minimum,
    reason: `你说今天做不动。任务收到 12 分钟，还是${topic.name}，不换章节。`,
  }
}
