import { describe, expect, it } from "vitest"
import {
  NO_STEM,
  OPENING_TEXT,
  UNFETCHED,
  UNREAD,
  UNWRITTEN,
  imageFileError,
  lineWhenNoStem,
  pastTurn,
  priorHistory,
  readStoredTurns,
  sendFailure,
  stemRecorded,
  turnsForStorage,
  visionTurn,
  waitingCopy,
  withStemRecorded,
} from "./talk.ts"

const stemA = "三个页框，访问串 1 2 3 4，FIFO 先淘汰哪一页？"
const stemB = "银行家算法为什么不能只看 Need？"

describe("dialogue states", () => {
  it("starts from the opening line when nothing is stored", () => {
    expect(readStoredTurns(null)).toEqual([{ id: "open", role: "senior", text: OPENING_TEXT }])
    expect(readStoredTurns("[]")).toEqual([{ id: "open", role: "senior", text: OPENING_TEXT }])
    expect(readStoredTurns("{")).toEqual([{ id: "open", role: "senior", text: OPENING_TEXT }])
  })

  it("keeps the reading apart from the comment", () => {
    expect(visionTurn("v", { seen: " 卷面写着 FIFO 与 LRU ", comment: " 你把两次淘汰写成了同一页。 " })).toEqual({
      id: "v",
      role: "senior",
      text: "你把两次淘汰写成了同一页。",
      seen: "卷面写着 FIFO 与 LRU",
    })
    expect(visionTurn("v", { seen: "  ", comment: "看不清题干，只能看见页框。" }).seen).toBeUndefined()
    expect(visionTurn("v", null).text).toBe(UNREAD)
  })

  it("says plainly when a past page has no stem", () => {
    expect(pastTurn("p", "os-paging", null)).toEqual({ id: "p", role: "senior", text: UNFETCHED })
    expect(pastTurn("p", "os-paging", { line: "", source: { title: "某处", url: "https://example.com/a" }, questions: [] })).toEqual({
      id: "p",
      role: "senior",
      text: NO_STEM,
    })
    expect(lineWhenNoStem("这次搜到的页面里没有能核对的题干。可以换一个说法，或把自己找到的卷子拍给我。")).toContain("没有")
    expect(pastTurn("p", "os-paging", { line: "这是从公开页面上抽到的题干。", source: null, questions: [{ stem: "  " }] }).text).toBe(NO_STEM)
  })

  it("keeps each stem and a real source link", () => {
    const turn = pastTurn("p", "os-paging", {
      line: "这是从公开页面上抽到的题干，不是我编的。",
      source: { title: "操作系统期末", url: "https://example.com/os/final" },
      questions: [{ stem: stemA }, { stem: stemB }],
    })
    expect(turn.questions).toEqual([{ stem: stemA }, { stem: stemB }])
    expect(turn.source).toEqual({ title: "操作系统期末", url: "https://example.com/os/final" })
    expect(pastTurn("p", "os-paging", { line: "题干在页面上。", source: { title: "坏", url: "javascript:alert(1)" }, questions: [{ stem: stemA }] }).source).toBeUndefined()
  })

  it("records the wrong-answer action once per stem", () => {
    const turn = pastTurn("p", "os-paging", {
      line: "核对出处。",
      source: null,
      questions: [{ stem: stemA }, { stem: stemB }],
    })
    const once = withStemRecorded(turn, stemA)
    expect(stemRecorded(once, stemA)).toBe(true)
    expect(stemRecorded(once, stemB)).toBe(false)
    expect(withStemRecorded(once, stemA).recordedStems).toEqual([stemA])
    expect(stemRecorded({ ...turn, recorded: true }, stemB)).toBe(true)
  })

  it("names the waiting lines and drops stored images", () => {
    expect(waitingCopy("text")).toBe("在看你这句话。")
    expect(waitingCopy("image")).toBe("在看这张卷面。")
    expect(waitingCopy("past")).toBe("在公开页面上找题干。")
    expect(UNWRITTEN).toContain("没有写成")
    expect(imageFileError({ type: "image/gif", size: 10 })).toBeNull()
    expect(imageFileError({ type: "image/svg+xml", size: 10 })).toContain("JPEG")
    expect(imageFileError({ type: "image/png", size: 5 * 1024 * 1024 })).toContain("4MB")
    const stored = turnsForStorage([
      { id: "u", role: "user", text: "看这张卷面。", image: "data:image/png;base64,aaaa", seen: "不应出现在用户句" },
    ])
    expect(stored[0]?.image).toBeUndefined()
    expect(readStoredTurns(JSON.stringify([{ ...stored[0], image: "data:image/png;base64,aaaa" }]))[0]?.image).toBeUndefined()
  })

  it("names the alert when a send throws", () => {
    expect(sendFailure("text")).toBe("这句话没有送出去。分数没有动。")
    expect(sendFailure("image")).toBe("这张图没有看成。分数没有动。")
    expect(sendFailure("past")).toBe("真题没有取回来。分数没有动。")
  })

  it("rejects loopback pages that only look public", () => {
    const paper = {
      line: "核对出处。",
      source: { title: "本机", url: "http://foo.localhost/a" },
      questions: [{ stem: stemA }],
    }
    expect(pastTurn("p", "os-paging", paper).source).toBeUndefined()
    expect(pastTurn("p", "os-paging", { ...paper, source: { title: "本机", url: "http://localhost./secret" } }).source).toBeUndefined()
    expect(pastTurn("p", "os-paging", { ...paper, source: { title: "内网", url: "http://printer.local./a" } }).source).toBeUndefined()
    expect(pastTurn("p", "os-paging", paper).questions).toEqual([{ stem: stemA }])
  })

  it("does not throw when a past paper has no question list", () => {
    expect(pastTurn("p", "os-paging", { line: "", source: null, questions: undefined as unknown as { stem: string }[] }).text).toBe(NO_STEM)
    expect(() => pastTurn("p", "os-paging", { line: "核对出处。", source: null, questions: [null as unknown as { stem: string }] })).not.toThrow()
  })

  it("does not keep an image payload in a vision reply or a stem", () => {
    const blob = `data:image/png;base64,${"A".repeat(8000)}`
    const turn = visionTurn("v", { seen: blob, comment: `你把两次淘汰写成了同一页。${blob}` })
    expect(turn.text.length).toBeLessThanOrEqual(400)
    expect(turn.seen).toBeUndefined()
    expect(JSON.stringify(turn)).not.toContain("A".repeat(500))
    const paper = pastTurn("p", "os-paging", {
      line: "核对出处。",
      source: null,
      questions: [{ stem: stemA }, { stem: blob }],
    })
    expect(paper.questions).toEqual([{ stem: stemA }])
    expect(JSON.stringify(turnsForStorage([turn, paper]))).not.toContain("A".repeat(500))
  })

  it("does not store a pasted image data URL in the transcript", () => {
    const blob = `data:image/png;base64,${"B".repeat(8000)}`
    const stored = turnsForStorage([{ id: "u", role: "user", text: blob, image: blob }])
    expect(stored[0]?.image).toBeUndefined()
    expect(stored[0]?.text).toBe("")
    expect(JSON.stringify(stored)).not.toContain("base64")
    const reloaded = readStoredTurns(JSON.stringify([{ id: "s", role: "senior", text: "核对出处。", seen: blob, questions: [{ stem: blob }] }]))
    expect(reloaded[0]?.seen).toBeUndefined()
    expect(reloaded[0]?.questions).toBeUndefined()
    expect(JSON.stringify(reloaded)).not.toContain("base64")
  })

  it("leaves the image out of the lines sent as earlier history", () => {
    const blob = `data:image/png;base64,${"C".repeat(4000)}`
    const history = priorHistory([
      { id: "1", role: "senior", text: "先看页框。" },
      { id: "2", role: "user", text: blob, image: blob },
    ])
    expect(history).toEqual([
      { role: "senior", text: "先看页框。" },
      { role: "user", text: "" },
    ])
    expect(JSON.stringify(history)).not.toContain("base64")
    expect(history).toHaveLength(2)
  })
})
