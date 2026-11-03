import http from "node:http"
import { describe, expect, it } from "vitest"
import { LIMITS } from "./contract.ts"
import { fetchPublicPage, nodeUpstreamRequest, publicRequestHeaders, type UpstreamResponse } from "./public-fetch.ts"

const html = "<html><title>ok</title><body>hello</body></html>"

describe("public fetch", () => {
  it("sends only the public headers and does not replay set-cookie", async () => {
    const seen: Record<string, string>[] = []
    const result = await fetchPublicPage("https://example.com/start", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (input) => {
        seen.push(input.headers)
        if (seen.length === 1) {
          return upstream(302, { location: "/next", "set-cookie": "session=secret" }, "")
        }
        return upstream(200, { "content-type": "text/html" }, html)
      },
    })
    expect(result.outcome).toBe("ok")
    expect(seen).toEqual([publicRequestHeaders(), publicRequestHeaders()])
    expect(JSON.stringify(seen)).not.toMatch(/cookie|authorization/i)
    if (result.outcome === "ok") expect(result.finalUrl).toBe("https://example.com/next")
  })

  it("does not follow a redirect into the metadata address", async () => {
    let calls = 0
    const result = await fetchPublicPage("https://example.com/start", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => {
        calls += 1
        return upstream(302, { location: "http://169.254.169.254/latest/meta-data" }, "")
      },
    })
    expect(result).toEqual({ outcome: "blocked", reason: "blocked" })
    expect(calls).toBe(1)
  })

  it("caps html and allows a larger json body", async () => {
    let reads = 0
    const htmlResult = await fetchPublicPage("https://example.com/page", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => {
        reads += 1
        return upstream(200, { "content-type": "text/html", "content-length": String(LIMITS.htmlBytes + 1) }, "")
      },
    })
    expect(htmlResult).toMatchObject({ outcome: "too_large", limit: LIMITS.htmlBytes })
    const jsonResult = await fetchPublicPage("https://example.com/items.json", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => {
        reads += 1
        return {
          ...upstream(200, { "content-type": "application/json", "content-length": String(3 * 1024 * 1024) }, "[]"),
          readBody: async (max: number) => {
            expect(max).toBe(LIMITS.jsonCsvMarkdownBytes)
            return { bytes: new TextEncoder().encode("[]"), overflow: false }
          },
        }
      },
    })
    expect(jsonResult.outcome).toBe("ok")
    expect(reads).toBe(2)
  })

  it("does not put cookie or authorization on the wire", async () => {
    const seen: http.IncomingHttpHeaders[] = []
    const server = http.createServer((request, response) => {
      seen.push(request.headers)
      response.setHeader("content-type", "text/html; charset=utf-8")
      response.setHeader("set-cookie", "dropped=1")
      response.end(html)
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    try {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("no port")
      const url = new URL(`http://127.0.0.1:${address.port}/quiz`)
      const response = await nodeUpstreamRequest({
        url,
        address: "127.0.0.1",
        family: 4,
        headers: publicRequestHeaders(),
        signal: AbortSignal.timeout(2000),
      })
      const body = await response.readBody(1000)
      expect(body.overflow).toBe(false)
      expect(new TextDecoder().decode(body.bytes)).toContain("hello")
      const names = Object.keys(seen[0] ?? {}).map((key) => key.toLowerCase())
      expect(names).not.toContain("cookie")
      expect(names).not.toContain("authorization")
      expect(seen[0]?.["user-agent"]).toBe("TestpassImport/1.0")
      expect(seen[0]?.["accept-encoding"]).toBe("identity")
      expect(response.headers.get("set-cookie")).toBeNull()
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

function upstream(status: number, headers: Record<string, string>, body: string): UpstreamResponse {
  return {
    status,
    headers: new Headers(headers),
    readBody: async () => ({ bytes: new TextEncoder().encode(body), overflow: false }),
    cancel: () => undefined,
  }
}
