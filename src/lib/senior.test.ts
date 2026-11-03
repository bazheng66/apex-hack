import { afterEach, describe, expect, it, vi } from "vitest"
import { askPast, askVision } from "./senior.ts"

const stem = "三个页框，访问串 1 2 3 4，FIFO 先淘汰哪一页？"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("senior client", () => {
  it("does not accept a past-paper source on a loopback host", async () => {
    const blob = `data:image/png;base64,${"B".repeat(4000)}`
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          line: "题干在页面上。",
          source: { title: "本机", url: "http://foo.localhost/a" },
          questions: [{ stem }, { stem: blob }],
        }),
      })),
    )
    const paper = await askPast("操作系统", "页面置换")
    expect(paper?.source).toBeNull()
    expect(paper?.questions).toEqual([{ stem }])
    expect(JSON.stringify(paper)).not.toContain("base64")
  })

  it("keeps a public past-paper source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          line: "题干在页面上。",
          source: { title: "操作系统期末", url: "https://example.com/os/final" },
          questions: [{ stem }],
        }),
      })),
    )
    const paper = await askPast("操作系统", "页面置换")
    expect(paper?.source).toEqual({ title: "操作系统期末", url: "https://example.com/os/final" })
    expect(paper?.questions).toEqual([{ stem }])
  })

  it("does not return a vision note the size of the image", async () => {
    const blob = `data:image/png;base64,${"A".repeat(8000)}`
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          seen: blob,
          comment: `你把两次淘汰写成了同一页。${blob}`,
        }),
      })),
    )
    const note = await askVision(blob, "操作系统", "页面置换", "")
    expect(note?.comment.length ?? 0).toBeLessThanOrEqual(400)
    expect(note?.seen.length ?? 0).toBeLessThanOrEqual(240)
    expect(JSON.stringify(note)).not.toContain("A".repeat(500))
  })
})
