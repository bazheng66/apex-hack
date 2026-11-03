import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { LIMITS, assertSize, canonicalPublicUrl, rejectCredentialFields, responseByteLimit } from "./contract.ts"
import { isPublishableKey, readSupabasePublicEnv } from "./repository.ts"

describe("import contract", () => {
  it("rejects credential fields anywhere in the body", () => {
    expect(rejectCredentialFields({ exam_id: "1", mode: "public_url", url: "https://example.com" })).toBeNull()
    expect(rejectCredentialFields({ cookie: "a=b" })).toBe("IMPORT_CREDENTIALS_FORBIDDEN")
    expect(rejectCredentialFields({ pack: { storage_state: { cookies: [] } } })).toBe("IMPORT_CREDENTIALS_FORBIDDEN")
    expect(rejectCredentialFields({ Headers: { Authorization: "Bearer x" } })).toBe("IMPORT_CREDENTIALS_FORBIDDEN")
    expect(rejectCredentialFields({ items: [{ "set-cookie": "a=b" }] })).toBe("IMPORT_CREDENTIALS_FORBIDDEN")
    expect(rejectCredentialFields({ storageState: {} })).toBe("IMPORT_CREDENTIALS_FORBIDDEN")
  })

  it("rejects a body that is too nested to scan", () => {
    let value: unknown = { ok: true }
    for (let depth = 0; depth < 12; depth += 1) value = { nest: value }
    expect(rejectCredentialFields(value)).toBe("INVALID_INPUT")
  })

  it("applies the draft size limits and caps public responses", () => {
    expect(assertSize("public_url", LIMITS.jsonCsvMarkdownBytes + 10)).toBeNull()
    expect(assertSize("paste_html", LIMITS.htmlBytes)).toBeNull()
    expect(assertSize("paste_html", LIMITS.htmlBytes + 1)).toBe("PAYLOAD_TOO_LARGE")
    expect(assertSize("extension_pack", LIMITS.htmlBytes + 1)).toBe("PAYLOAD_TOO_LARGE")
    expect(assertSize("upload_json", LIMITS.jsonCsvMarkdownBytes)).toBeNull()
    expect(assertSize("upload_csv", LIMITS.jsonCsvMarkdownBytes + 1)).toBe("PAYLOAD_TOO_LARGE")
    expect(assertSize("upload_markdown", 3 * 1024 * 1024)).toBeNull()
    expect(responseByteLimit("text/html; charset=utf-8")).toBe(LIMITS.htmlBytes)
    expect(responseByteLimit("application/json")).toBe(LIMITS.jsonCsvMarkdownBytes)
    expect(responseByteLimit("text/csv")).toBe(LIMITS.jsonCsvMarkdownBytes)
    expect(responseByteLimit("text/markdown")).toBe(LIMITS.jsonCsvMarkdownBytes)
  })

  it("canonicalizes public urls and drops fragments", () => {
    expect(canonicalPublicUrl(" https://Example.com/a#secret ")).toBe("https://example.com/a")
    expect(canonicalPublicUrl("http://user:pass@example.com/")).toBeNull()
    expect(canonicalPublicUrl("file:///etc/passwd")).toBeNull()
    expect(canonicalPublicUrl("not a url")).toBeNull()
  })

  it("refuses a secret or service-role key and ignores it when reading env", () => {
    expect(isPublishableKey("sb_publishable_example")).toBe(true)
    expect(isPublishableKey("sb_secret_example")).toBe(false)
    const service = jwt({ role: "service_role" })
    expect(isPublishableKey(service)).toBe(false)
    expect(isPublishableKey(jwt({ role: "anon" }))).toBe(true)
    expect(
      readSupabasePublicEnv({
        SUPABASE_URL: "https://bhylflnzkwmhhaskduqp.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: service,
        SUPABASE_SERVICE_ROLE_KEY: service,
      }),
    ).toBeNull()
    expect(
      readSupabasePublicEnv({
        VITE_SUPABASE_URL: "https://bhylflnzkwmhhaskduqp.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
        SUPABASE_SERVICE_ROLE_KEY: service,
      }),
    ).toEqual({
      url: "https://bhylflnzkwmhhaskduqp.supabase.co",
      publishableKey: "sb_publishable_example",
    })
  })

  it("keeps the service role and attempts table out of the client and the import writer", () => {
    const client = walk(fileURLToPath(new URL("../../src", import.meta.url))).join("\n")
    expect(client).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE|sb_secret_/)
    const writer = readFileSync(new URL("./repository.ts", import.meta.url), "utf8")
    expect(writer).not.toMatch(/from\(["']attempts["']\)/)
    expect(writer).not.toMatch(/"attempts"/)
  })
})

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`
}

function walk(dir: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files.push(...walk(path))
    else if (/\.(ts|tsx)$/.test(name)) files.push(readFileSync(path, "utf8"))
  }
  return files
}
