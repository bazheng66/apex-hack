import { describe, expect, it } from "vitest"
import { questionsFromModel, safePageUrl, visionReading } from "./extract.ts"

describe("past-paper extraction", () => {
  it("reads at most two stems from a fenced payload", () => {
    const raw = [
      "```json",
      JSON.stringify({
        found: true,
        questions: [
          { stem: "三个页框，访问串 1 2 3 4，FIFO 先淘汰哪一页？" },
          { stem: "银行家算法为什么不能只看 Need？" },
          { stem: "第三道不该被带出来，因为它超过两道。" },
        ],
      }),
      "```",
    ].join("\n")
    expect(questionsFromModel(raw)).toEqual([
      { stem: "三个页框，访问串 1 2 3 4，FIFO 先淘汰哪一页？" },
      { stem: "银行家算法为什么不能只看 Need？" },
    ])
  })

  it("returns nothing when the page had no question", () => {
    expect(questionsFromModel('{"found":false,"questions":[]}')).toEqual([])
  })

  it("accepts public http links and rejects credentials or scripts", () => {
    expect(safePageUrl("https://example.com/os/final")).toBe("https://example.com/os/final")
    expect(safePageUrl("javascript:alert(1)")).toBeNull()
    expect(safePageUrl("https://user:pass@example.com/a")).toBeNull()
    expect(safePageUrl("http://localhost/secret")).toBeNull()
    expect(safePageUrl("http://127.0.0.1/secret")).toBeNull()
  })
})

describe("vision reading", () => {
  it("separates the transcribed stem from the comment", () => {
    const raw = JSON.stringify({
      seen: "题目写着 FIFO 与 LRU 的第一次淘汰",
      comment: "你把两次淘汰写成了同一页。",
    })
    expect(visionReading(raw)).toEqual({
      seen: "题目写着 FIFO 与 LRU 的第一次淘汰",
      comment: "你把两次淘汰写成了同一页。",
    })
  })
})
