import { describe, expect, it } from "vitest"
import {
  IMPORT_COPY,
  fileHint,
  gateReason,
  loadPublicDocument,
  localSuccess,
  mergeStoredImport,
  missLine,
  parseImportedBank,
  parsePublicPage,
  parseStoredImports,
  publicSuccess,
  resultFromDocument,
  type PageFetch,
} from "./import-bank.ts"

const stemA = "三个页框，访问串 1 2 3 4，FIFO 先淘汰哪一页？"
const stemB = "银行家算法为什么不能只看 Need？"
const stemC = "分页与分段的地址映射有什么差别？"

describe("import copy", () => {
  it("keeps the draft wording in one place", () => {
    expect(IMPORT_COPY.title).toBe("导入题库")
    expect(IMPORT_COPY.note).toBe("只收录你提供的公开页面里实际出现的题，不补写选项和答案。")
    expect(IMPORT_COPY.reading).toBe("正在读取页面…")
    expect(missLine()).toBe("这个链接里没读到题。换一个公开页，或用「需登录站点」方式。")
    expect(IMPORT_COPY.gatedTitle).toBe("这个站点要登录才能看题")
    expect(IMPORT_COPY.gatedLead).toBe("浏览器这边登不进你的账号。你可以：")
    expect(IMPORT_COPY.step1).toContain("粘贴 HTML")
    expect(IMPORT_COPY.step2).toBe("（预留）用书签脚本或扩展一键打包——稍后提供。")
    expect(IMPORT_COPY.placeholder).toBe("把题目 HTML 或纯文本贴这里")
    expect(IMPORT_COPY.uploadNote).toBe("只存你上传的来源")
    expect(IMPORT_COPY.acknowledge).toBe("我知道了")
    expect(IMPORT_COPY.back).toBe("换公开链接再试")
    expect(IMPORT_COPY.badFormat).toBe("格式没认出来。可改成 JSON（题干+选项）或 Markdown 列表再试。")
    expect(publicSuccess(3)).toBe("读到 3 题 · 来源已记下")
    expect(localSuccess(2)).toBe("已从粘贴/文件收录 2 题")
  })
})

describe("parse imported banks", () => {
  it("reads every stem from JSON and drops options and answers", () => {
    const raw = JSON.stringify({
      questions: [
        { stem: stemA, options: ["页1", "页2"], answer: "A" },
        { stem: stemB, choices: ["会死锁", "不一定"] },
        { question: stemC },
      ],
    })
    expect(parseImportedBank(raw, "json").map((item) => item.stem)).toEqual([stemA, stemB, stemC])
    expect(JSON.stringify(parseImportedBank(raw))).not.toContain("会死锁")
  })

  it("reads a CSV stem column and a markdown list", () => {
    const csv = ["题干,选项A,答案", `"${stemA}",页1,A`, `${stemB},不一定,B`].join("\n")
    expect(parseImportedBank(csv, "csv").map((item) => item.stem)).toEqual([stemA, stemB])
    const markdown = ["# 期末", `1. ${stemA}`, `2. ${stemB}`, `- ${stemC}`].join("\n")
    expect(parseImportedBank(markdown, "md").map((item) => item.stem)).toEqual([stemA, stemB, stemC])
  })

  it("reads an HTML list and a fenced JSON block", () => {
    const html = `<html><body><nav><li>登录</li></nav><ol><li>${stemA}</li><li>${stemB}</li></ol></body></html>`
    expect(parseImportedBank(html, "html").map((item) => item.stem)).toEqual([stemA, stemB])
    const fenced = ["先看这段。", "```json", JSON.stringify([stemA, stemB]), "```"].join("\n")
    expect(parseImportedBank(fenced).map((item) => item.stem)).toEqual([stemA, stemB])
  })

  it("returns nothing for prose that is not a question list", () => {
    expect(parseImportedBank("今天天气不错，适合复习操作系统。")).toEqual([])
    expect(parseImportedBank("[]", "json")).toEqual([])
    expect(fileHint("bank.JSON")).toBe("json")
    expect(fileHint("notes.md")).toBe("md")
    expect(fileHint("page.html")).toBe("html")
    expect(fileHint("photo.png")).toBeNull()
  })
})

describe("public page outcomes", () => {
  it("sends login walls, 403, and empty bodies to the guided panel", () => {
    expect(gateReason(403, `<ol><li>${stemA}</li><li>${stemB}</li></ol>`)).toBe("forbidden")
    expect(gateReason(200, "   ")).toBe("empty")
    expect(
      gateReason(
        200,
        "<html><body><form><h1>请登录</h1><p>登录后才能查看这套题。</p><input type='password' name='password'></form></body></html>",
      ),
    ).toBe("login")
    const withNav = `<html><body><header><a>请登录</a></header><ol><li>${stemA}</li><li>${stemB}</li></ol></body></html>`
    expect(resultFromDocument({ kind: "http", status: 200, body: withNav }).outcome).toBe("ok")
    const wall = [
      "<html><body><form><h1>Sign in to continue</h1><input type='password' name='password'></form>",
      "<ul><li>Contact us</li><li>Manage cookies</li><li>Forgot password?</li></ul></body></html>",
    ].join("")
    expect(parsePublicPage(wall)).toEqual([])
    expect(resultFromDocument({ kind: "http", status: 200, body: wall })).toEqual({
      outcome: "gated",
      reason: "login",
      questions: [],
    })
    const passwordAndQuestions = `<html><body><form><input type="password"></form><ol><li>${stemA}</li><li>${stemB}</li></ol></body></html>`
    expect(resultFromDocument({ kind: "http", status: 200, body: passwordAndQuestions }).outcome).toBe("ok")
    const signup = `<html><body><form><h1>Sign in to the bank</h1><input type="password" name="password"></form><p>New to GitHub?</p></body></html>`
    expect(resultFromDocument({ kind: "http", status: 200, body: signup }).outcome).toBe("gated")
    expect(resultFromDocument({ kind: "http", status: 403, body: stemA }).outcome).toBe("gated")
    expect(resultFromDocument({ kind: "http", status: 200, body: "<html><body></body></html>" })).toEqual({
      outcome: "gated",
      reason: "empty",
      questions: [],
    })
  })

  it("keeps a real question page, and treats timeout or a non-question page as a miss", () => {
    const html = `<html><body><ol><li>${stemA}</li><li>${stemB}</li></ol></body></html>`
    expect(resultFromDocument({ kind: "http", status: 200, body: html })).toEqual({
      outcome: "ok",
      reason: "ok",
      questions: [{ stem: stemA }, { stem: stemB }],
    })
    const article = `<html><body><p>${"操作系统复习。".repeat(40)}</p></body></html>`
    expect(resultFromDocument({ kind: "http", status: 200, body: article }).outcome).toBe("miss")
    expect(resultFromDocument({ kind: "timeout" })).toEqual({ outcome: "miss", reason: "timeout", questions: [] })
  })

  it("does not follow a redirect into a blocked host", async () => {
    const calls: string[] = []
    const fetchPage: PageFetch = async (url) => {
      calls.push(url)
      if (url === "https://example.com/start") {
        return new Response("", { status: 302, headers: { location: "http://127.0.0.1/secret" } })
      }
      return new Response("nope", { status: 200 })
    }
    const loaded = await loadPublicDocument("https://example.com/start", fetchPage)
    expect(loaded).toEqual({ kind: "unreachable" })
    expect(calls).toEqual(["https://example.com/start"])
  })

  it("classifies a fetched question page and a timeout", async () => {
    const html = `<html><body><ol><li>${stemA}</li><li>${stemB}</li></ol></body></html>`
    const ok = await loadPublicDocument("https://example.com/os", async () => new Response(html, { status: 200 }))
    expect(resultFromDocument(ok).questions).toEqual([{ stem: stemA }, { stem: stemB }])
    const timed = await loadPublicDocument("https://example.com/slow", async () => {
      const error = new Error("timed out")
      error.name = "TimeoutError"
      throw error
    })
    expect(resultFromDocument(timed).reason).toBe("timeout")
  })
})

describe("stored imports", () => {
  it("keeps only the url or file name the user gave", () => {
    const saved = mergeStoredImport([], {
      id: "1",
      kind: "url",
      source: "https://example.com/os/final",
      questions: [{ stem: stemA }, { stem: "  " }],
      savedAt: "2026-11-03T00:00:00.000Z",
    })
    expect(saved).toEqual([
      {
        id: "1",
        kind: "url",
        source: "https://example.com/os/final",
        questions: [{ stem: stemA }],
        savedAt: "2026-11-03T00:00:00.000Z",
      },
    ])
    expect(parseStoredImports(JSON.stringify(saved))[0]?.source).toBe("https://example.com/os/final")
    expect(parseStoredImports("{")).toEqual([])
  })
})
