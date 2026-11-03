import { describe, expect, it } from "vitest"
import { createDemo, createProfile, gradePaper, nextPaper, recordUpload } from "../engine/agent.ts"
import { attemptRows, eventUuid, mergeCloudRecord, RecordConflict } from "./cloud-record.ts"
import { todayKey } from "./day.ts"

const today = todayKey()
describe("cloud record events", () => {
  it("keeps retry IDs stable and distinguishes users and exams", async () => {
    const id = await eventUuid("owner", "exam", "session")
    expect(await eventUuid("owner", "exam", "session")).toBe(id)
    expect(await eventUuid("other", "exam", "session")).not.toBe(id)
    expect(await eventUuid("owner", "other", "session")).not.toBe(id)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
  it("retains raw answers and marks legacy sessions without inventing answers", async () => {
    const state = createProfile("os", "basic", today)
    const graded = gradePaper(state, { [nextPaper(state)[0]!.id]: 1 }, today).state
    const rows = await attemptRows(graded, "owner", "exam")
    expect(rows[0]?.payload.chosen).toBe(1)
    expect(typeof rows[0]?.payload.correct).toBe("boolean")
    expect(rows[0]?.payload.items?.[0]?.topic_id).toBeUndefined()
    const legacy = await attemptRows(createDemo(today), "owner", "exam")
    expect(legacy.find((event) => event.kind === "mock")?.payload.legacy_snapshot).toBe(true)
    expect(legacy.find((event) => event.kind === "mock")?.payload.correct).toBeUndefined()
  })
  it("merges concurrent uploads and treats a repeated merge as a no-op", () => {
    const state = createProfile("os", "basic", today)
    const upload = (correct: number) => {
      const result = recordUpload(state, { topicId: "os-paging", correct, total: 5, mistake: "检查页表映射", today })
      if (!result.ok) throw new Error(result.message)
      return result.state
    }
    const remote = upload(5), local = upload(1)
    const merged = mergeCloudRecord(remote, local)
    expect(merged.sessions).toHaveLength(2)
    expect(new Set(merged.sessions.map((s) => s.id)).size).toBe(2)
    expect(merged.mastery.find((m) => m.topicId === "os-paging")?.score).toBe(state.mastery.find((m) => m.topicId === "os-paging")?.score)
    expect(mergeCloudRecord(merged, local)).toEqual(merged)
    expect(() => mergeCloudRecord(state, createDemo(today))).toThrow(RecordConflict)
  })
})
