import type { IncomingMessage, ServerResponse } from "node:http"
import type { Connect, Plugin } from "vite"
import { loadPublicDocument, resultFromDocument, type ImportFetchResult } from "../src/engine/import-bank.ts"

export function importApi(): Plugin {
  const attach = (middlewares: Connect.Server) => {
    middlewares.use("/api/import-page", (request, response, next) => {
      if (request.method !== "POST") {
        next()
        return
      }
      void handleImport(request, response)
    })
  }

  return {
    name: "import-api",
    configureServer(server) {
      attach(server.middlewares)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}

async function handleImport(request: IncomingMessage, response: ServerResponse) {
  try {
    const body = await readJson(request)
    const url = typeof body.url === "string" ? body.url : ""
    const loaded = await loadPublicDocument(url, (target, init) => fetch(target, init))
    send(response, 200, resultFromDocument(loaded))
  } catch {
    const miss: ImportFetchResult = { outcome: "miss", reason: "unreachable", questions: [] }
    send(response, 200, miss)
  }
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.end(JSON.stringify(body))
}

function readJson(request: IncomingMessage): Promise<{ url?: unknown }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > 20_000) {
        reject(new Error("too large"))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString() || "{}")
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("invalid"))
          return
        }
        resolve(parsed as { url?: unknown })
      } catch (error) {
        reject(error)
      }
    })
    request.on("error", reject)
  })
}
