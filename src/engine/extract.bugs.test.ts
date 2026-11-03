import { describe, expect, it } from "vitest"
import { questionsFromModel, safePageUrl, visionReading } from "./extract.ts"

const stem = "三个页框，访问串 1 2 3 4，FIFO 先淘汰哪一页？"

describe("stem recovery", () => {
  it("keeps stems when prose or an example object precedes the JSON", () => {
    const payload = JSON.stringify({ found: true, questions: [{ stem }] })
    const decoy = JSON.stringify({ found: false, questions: [], note: "x".repeat(500) })
    expect(questionsFromModel(`注意 { 这个 } 符号\n${payload}`)).toEqual([{ stem }])
    expect(questionsFromModel(`${decoy}\n${payload}`)).toEqual([{ stem }])
    expect(questionsFromModel(`\`\`\`\nnot json\n\`\`\`\n${payload}`)).toEqual([{ stem }])
  })

  it("keeps stems when the JSON has a trailing comma", () => {
    const raw = `{"found":true,"questions":[{"stem":${JSON.stringify(stem)}},]}`
    expect(questionsFromModel(raw)).toEqual([{ stem }])
  })

  it("keeps a stem that itself contains braces", () => {
    const tricky = "设有代码 { int x = 1; } 问第一次淘汰的页是哪一页？"
    expect(questionsFromModel(JSON.stringify({ found: true, questions: [{ stem: tricky }] }))).toEqual([{ stem: tricky }])
  })
})

describe("public source links", () => {
  it("rejects loopback names that still look like public hosts", () => {
    expect(safePageUrl("http://foo.localhost/a")).toBeNull()
    expect(safePageUrl("http://localhost./secret")).toBeNull()
    expect(safePageUrl("http://localhost../secret")).toBeNull()
    expect(safePageUrl("http://printer.local./a")).toBeNull()
    expect(safePageUrl("http://files.internal./a")).toBeNull()
    expect(safePageUrl("http://localhost.localdomain/a")).toBeNull()
    expect(safePageUrl("http://[::1]/secret")).toBeNull()
  })

  it("still accepts a public page and a public address", () => {
    expect(safePageUrl("https://example.com/os/final")).toBe("https://example.com/os/final")
    expect(safePageUrl("http://8.8.8.8/a")).toBe("http://8.8.8.8/a")
    expect(safePageUrl("http://172.15.5.5/a")).toBe("http://172.15.5.5/a")
    expect(safePageUrl("http://localhost.com/a")).toBe("http://localhost.com/a")
    expect(safePageUrl("http://evil.localhost.com/a")).toBe("http://evil.localhost.com/a")
  })
})

describe("vision payload", () => {
  it("reads the vision comment when a brace appears before the JSON", () => {
    const body = JSON.stringify({
      seen: "题目写着 FIFO 与 LRU 的第一次淘汰",
      comment: "你把两次淘汰写成了同一页。",
    })
    expect(visionReading(`卷面上有 { 页框 } 这类记号。\n${body}`)).toEqual({
      seen: "题目写着 FIFO 与 LRU 的第一次淘汰",
      comment: "你把两次淘汰写成了同一页。",
    })
  })
})
