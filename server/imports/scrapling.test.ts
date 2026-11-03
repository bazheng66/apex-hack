import { describe, expect, it } from "vitest"
import { createNodeScraplingParser, externalKeyFor } from "./scrapling.ts"

const stemA = "三个页框，访问串 1 2 3 4，FIFO 先淘汰哪一页？"
const stemB = "银行家算法为什么不能只看 Need？"
const stemC = "分页与分段的地址映射有什么差别？"

describe("node scrapling adapter", () => {
  it("keeps the scrapling id and extracts stems plus choices that are actually present", () => {
    const parser = createNodeScraplingParser()
    expect(parser.id).toBe("scrapling")
    expect(parser.impl).toBe("node-html-adapter")
    const html = [
      "<html><head><title>OS quiz</title></head><body>",
      `<ol><li>${stemA}</li><li>${stemB}</li></ol>`,
      `<script type="application/json">${JSON.stringify({
        questions: [{ stem: stemC, options: ["页表", "段表"], answer: "A" }],
      })}</script>`,
      "</body></html>",
    ].join("")
    const parsed = parser.parse({ url: "https://example.com/os", contentType: "text/html", body: html })
    expect(parsed.truncated).toBe(false)
    expect(parsed.items.map((item) => item.prompt)).toEqual([stemC, stemA, stemB])
    const mcq = parsed.items[0]
    expect(mcq?.kind).toBe("mcq")
    expect(mcq?.choices).toEqual(["页表", "段表"])
    expect(mcq?.answer_index).toBe(0)
    expect(mcq?.external_key).toBe(externalKeyFor(stemC))
    expect(parsed.items[1]?.external_key).toBe(externalKeyFor(stemA))
  })

  it("does not turn a login wall's chrome into items", () => {
    const wall = [
      "<html><body><form><h1>Sign in to continue</h1><input type='password' name='password'></form>",
      "<ul><li>Contact us</li><li>Manage cookies</li><li>Forgot password?</li></ul></body></html>",
    ].join("")
    const parsed = createNodeScraplingParser().parse({ url: "https://example.com/login", contentType: "text/html", body: wall })
    expect(parsed.items).toEqual([])
  })

  it("uses a stable external key for the same prompt", () => {
    expect(externalKeyFor(`  ${stemA}  `)).toBe(externalKeyFor(stemA))
    expect(externalKeyFor(stemA)).not.toBe(externalKeyFor(stemB))
  })
})
