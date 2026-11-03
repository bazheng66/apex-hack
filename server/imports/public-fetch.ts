import http from "node:http"
import https from "node:https"
import type { IncomingMessage } from "node:http"
import type { LookupFunction } from "node:net"
import { responseByteLimit } from "./contract.js"
import { guardPublicUrl, type AddressPin, type HostResolver } from "./url-guard.js"

export const PUBLIC_REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
  "User-Agent": "TestpassImport/1.0",
  "Accept-Encoding": "identity",
} as const

const MAX_REDIRECTS = 3

export type PublicFetchResult =
  | {
      outcome: "ok"
      status: number
      finalUrl: string
      contentType: string
      body: string
      bytes: number
      etag: string | null
    }
  | { outcome: "blocked"; reason: "credentials" | "protocol" | "blocked" }
  | { outcome: "too_large"; limit: number; contentType: string }
  | { outcome: "error"; reason: "timeout" | "unreachable" | "redirect" }

export type UpstreamResponse = {
  status: number
  headers: Headers
  readBody: (maxBytes: number) => Promise<{ bytes: Uint8Array; overflow: boolean }>
  cancel: () => void
}

export type UpstreamRequest = (input: {
  url: URL
  address: string
  family: 4 | 6
  headers: Record<string, string>
  signal: AbortSignal
}) => Promise<UpstreamResponse>

export function publicRequestHeaders(): Record<string, string> {
  return { ...PUBLIC_REQUEST_HEADERS }
}

export async function fetchPublicPage(
  rawUrl: string,
  options: {
    resolve?: HostResolver
    request?: UpstreamRequest
    signal?: AbortSignal
    timeoutMs?: number
  } = {},
): Promise<PublicFetchResult> {
  const resolve = options.resolve
  const request = options.request ?? nodeUpstreamRequest
  const signal = options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 8000)
  let current = rawUrl
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (signal.aborted) return { outcome: "error", reason: "timeout" }
    const guarded = await guardPublicUrl(current, resolve)
    if (!guarded.ok) {
      if (guarded.reason === "dns") return { outcome: "error", reason: "unreachable" }
      return { outcome: "blocked", reason: guarded.reason }
    }
    const pin = guarded.addresses[0]
    if (!pin) return { outcome: "error", reason: "unreachable" }
    let response: UpstreamResponse
    try {
      response = await request({
        url: guarded.url,
        address: pin.address,
        family: pin.family,
        headers: publicRequestHeaders(),
        signal,
      })
    } catch (error) {
      return { outcome: "error", reason: isTimeout(error) ? "timeout" : "unreachable" }
    }
    if (isRedirect(response.status)) {
      const location = response.headers.get("location")
      response.cancel()
      if (!location || redirect === MAX_REDIRECTS) return { outcome: "error", reason: "redirect" }
      try {
        current = new URL(location, guarded.url).toString()
      } catch {
        return { outcome: "blocked", reason: "protocol" }
      }
      continue
    }
    const contentType = response.headers.get("content-type") ?? ""
    const limit = responseByteLimit(contentType)
    const declared = Number(response.headers.get("content-length") ?? "")
    if (Number.isFinite(declared) && declared > limit) {
      response.cancel()
      return { outcome: "too_large", limit, contentType }
    }
    let read: { bytes: Uint8Array; overflow: boolean }
    try {
      read = await response.readBody(limit)
    } catch (error) {
      return { outcome: "error", reason: isTimeout(error) ? "timeout" : "unreachable" }
    }
    if (read.overflow) return { outcome: "too_large", limit, contentType }
    return {
      outcome: "ok",
      status: response.status,
      finalUrl: guarded.url.toString(),
      contentType,
      body: decodeBody(read.bytes, contentType),
      bytes: read.bytes.byteLength,
      etag: cleanEtag(response.headers.get("etag")),
    }
  }
  return { outcome: "error", reason: "redirect" }
}

export function nodeUpstreamRequest(input: {
  url: URL
  address: string
  family: 4 | 6
  headers: Record<string, string>
  signal: AbortSignal
}): Promise<UpstreamResponse> {
  const pin: AddressPin = { address: input.address, family: input.family }
  return new Promise((resolve, reject) => {
    if (input.signal.aborted) {
      reject(abortError())
      return
    }
    const lib = input.url.protocol === "https:" ? https : http
    const bare = input.url.hostname.startsWith("[") ? input.url.hostname.slice(1, -1) : input.url.hostname
    const headers = { ...input.headers, Host: input.url.host }
    const requestOptions: https.RequestOptions = {
      protocol: input.url.protocol,
      hostname: bare,
      path: `${input.url.pathname}${input.url.search}`,
      method: "GET",
      headers,
      lookup: pinLookup(pin),
      signal: input.signal,
      timeout: 8000,
    }
    if (input.url.port) requestOptions.port = Number(input.url.port)
    if (isHostname(bare)) requestOptions.servername = bare.replace(/\.$/, "")
    const req = lib.request(requestOptions, (incoming) => {
      resolve({
        status: incoming.statusCode ?? 0,
        headers: headersFrom(incoming),
        readBody: (maxBytes) => readCapped(incoming, maxBytes),
        cancel: () => {
          incoming.destroy()
        },
      })
    })
    const fail = (error: unknown) => {
      req.destroy()
      reject(error instanceof Error ? error : new Error("fetch failed"))
    }
    input.signal.addEventListener("abort", () => fail(abortError()), { once: true })
    req.on("error", fail)
    req.on("timeout", () => fail(timeoutError()))
    req.end()
  })
}

function pinLookup(pin: AddressPin): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: pin.address, family: pin.family }])
      return
    }
    callback(null, pin.address, pin.family)
  }
}

function headersFrom(incoming: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue
    if (key.toLowerCase() === "set-cookie") continue
    headers.set(key, Array.isArray(value) ? value.join(", ") : value)
  }
  return headers
}

function readCapped(stream: IncomingMessage, maxBytes: number): Promise<{ bytes: Uint8Array; overflow: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    const finish = (overflow: boolean) => {
      cleanup()
      if (overflow) stream.destroy()
      resolve({ bytes: Buffer.concat(chunks), overflow })
    }
    const onData = (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (total + buf.length > maxBytes) {
        finish(true)
        return
      }
      total += buf.length
      chunks.push(buf)
    }
    const onEnd = () => finish(false)
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      stream.removeListener("data", onData)
      stream.removeListener("end", onEnd)
      stream.removeListener("error", onError)
    }
    stream.on("data", onData)
    stream.on("end", onEnd)
    stream.on("error", onError)
  })
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const headerCharset = charsetOf(contentType)
  const probe = new TextDecoder("latin1").decode(bytes.subarray(0, 2048))
  const meta = /charset=["']?([^"'>\s/]+)/i.exec(probe)?.[1]?.toLowerCase()
  const charset = headerCharset || meta || "utf-8"
  const label = charset === "gb2312" || charset === "gbk" || charset === "gb18030" ? "gbk" : "utf-8"
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  }
}

function charsetOf(contentType: string): string {
  return /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/["']/g, "").toLowerCase() ?? ""
}

function cleanEtag(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 200) return null
  return trimmed
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function isTimeout(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ""
  return name === "TimeoutError" || name === "AbortError"
}

function abortError(): Error {
  const error = new Error("aborted")
  error.name = "AbortError"
  return error
}

function timeoutError(): Error {
  const error = new Error("timeout")
  error.name = "TimeoutError"
  return error
}

function isHostname(value: string): boolean {
  return value.includes(".") && !/^\d{1,3}(\.\d{1,3}){3}$/.test(value)
}
