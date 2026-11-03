import { describe, expect, it } from "vitest"
import {
  COMPANION_HINTS,
  COMPANION_LINE,
  COPY,
  COPY_FALLBACK,
  copyLine,
  copyLines,
  hintFromSearch,
  presentHint,
  type CopyKey,
} from "./companion.ts"

const CONTRACT_KEYS: CopyKey[] = [
  "plan_lowest",
  "plan_trim",
  "plan_shrink",
  "plan_switched",
  "good_progress",
  "tough_miss",
  "review_due_tomorrow",
  "streak_up",
  "streak_broke",
  "shortened_ok",
  "shortened_stop",
  "uncalibrated_band",
  "calibrated_on_track",
  "calibrated_behind",
  "day_done",
  "day_skipped",
  "all_open_questions_done",
]

describe("companion lines", () => {
  it("uses the confirmed four sentences verbatim", () => {
    expect(COMPANION_LINE.encourage).toBe("今天这几道，先轻松拿下～")
    expect(COMPANION_LINE.urge).toBe("这块有点紧，再刷几道就稳了")
    expect(COMPANION_LINE.celebrate).toBe("漂亮！连胜续上了")
    expect(COMPANION_LINE.sleepy).toBe("今天先歇会儿，计划已帮你收短")
    expect(new Set(COMPANION_HINTS.map((hint) => COMPANION_LINE[hint])).size).toBe(4)
  })
})

describe("copy keys", () => {
  it("has a short Chinese line for every contract key", () => {
    expect(Object.keys(COPY).sort()).toEqual([...CONTRACT_KEYS].sort())
    for (const key of CONTRACT_KEYS) {
      expect(COPY[key].length).toBeGreaterThan(0)
      expect(COPY[key]).not.toBe(COPY_FALLBACK)
    }
  })

  it("falls back for an unknown key and does not throw", () => {
    expect(copyLine("not_a_key")).toBe(COPY_FALLBACK)
    expect(copyLine("")).toBe(COPY_FALLBACK)
    expect(copyLines(["nope", "plan_lowest", "also_unknown"])).toEqual([COPY.plan_lowest, COPY_FALLBACK])
  })

  it("keeps known keys in contract order and drops duplicate lines", () => {
    expect(copyLines(["day_done", "plan_lowest", "plan_lowest"])).toEqual([COPY.plan_lowest, COPY.day_done])
  })
})

describe("hint override", () => {
  it("reads a hint query and ignores anything else", () => {
    expect(hintFromSearch("?hint=sleepy")).toBe("sleepy")
    expect(hintFromSearch("hint=urge&from=review")).toBe("urge")
    expect(hintFromSearch("?hint=SLEEPY")).toBeNull()
    expect(hintFromSearch("")).toBeNull()
    expect(presentHint("encourage", "?hint=celebrate")).toEqual({ hint: "celebrate", forced: true })
    expect(presentHint("urge", "")).toEqual({ hint: "urge", forced: false })
  })
})
