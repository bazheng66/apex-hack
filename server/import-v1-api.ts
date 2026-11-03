import type { IncomingMessage, ServerResponse } from "node:http"
import type { Connect, Plugin } from "vite"
import { LIMITS } from "./imports/contract.js"
import { handleImportsApi } from "./imports/http.js"

export function importV1Api(env: Record<string, string>): Plugin {
  const attach = (middlewares: Connect.Server) => {
    middlewares.use((request, response, next) => {
      const path = request.url?.split("?")[0] ?? ""
      if (!path.startsWith("/api/v1/")) {
        next()
        return
      }
      void serve(request, response, env).catch((error: unknown) => {
        console.error("import api failed", error instanceof Error ? error.message.slice(0, 300) : "unknown")
        write(response, 500, { error_code: "INTERNAL", error_message: "The import could not be saved." })
      })
    })
  }
  return {
    name: "import-v1-api",
    configureServer(server) {
      attach(server.middlewares)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}

async function serve(request: IncomingMessage, response: ServerResponse, env: Record<string, string>) {
  const method = request.method ?? "GET"
  const host = request.headers.host ?? "127.0.0.1"
  const url = `http://${host}${request.url ?? "/"}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue
    if (typeof value === "string") headers.set(key, value)
    else if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    }
  }
  let body: Uint8Array | undefined
  if (method !== "GET" && method !== "HEAD") {
    const read = await readNodeBody(request, LIMITS.jsonCsvMarkdownBytes)
    if (!read.ok) {
      write(response, 413, { error_code: "PAYLOAD_TOO_LARGE", error_message: "The request is larger than the import size limit." })
      return
    }
    body = read.bytes
  }
  const web = new Request(url, body ? { method, headers, body } : { method, headers })
  const result = await handleImportsApi(web, { env: { ...process.env, ...env } })
  const payload = Buffer.from(await result.arrayBuffer())
  response.statusCode = result.status
  result.headers.forEach((value, key) => {
    if (key === "transfer-encoding" || key === "content-length") return
    response.setHeader(key, value)
  })
  response.setHeader("content-length", String(payload.byteLength))
  response.end(payload)
}

const HOP_BY_HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade"])

function write(response: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  response.statusCode = status
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.setHeader("cache-control", "no-store")
  response.end(payload)
}

function readNodeBody(request: IncomingMessage, maxBytes: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  const declared = Number(request.headers["content-length"] ?? "")
  if (Number.isFinite(declared) && declared > maxBytes) return Promise.resolve({ ok: false })
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    request.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buf.length
      if (total > maxBytes) {
        request.destroy()
        resolve({ ok: false })
        return
      }
      chunks.push(buf)
    })
    request.on("end", () => resolve({ ok: true, bytes: Buffer.concat(chunks) }))
    request.on("error", reject)
  })
}
