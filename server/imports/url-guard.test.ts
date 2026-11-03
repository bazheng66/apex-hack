import { describe, expect, it } from "vitest"
import { guardPublicUrl, isPublicAddress, type HostResolver } from "./url-guard.ts"

const resolveNever: HostResolver = async () => {
  throw new Error("resolver should not be called")
}

describe("public url guard", () => {
  it("blocks private, link-local, loopback, and metadata addresses without a lookup", async () => {
    const blocked = [
      "http://127.0.0.1/latest",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://127.1/",
      "http://0177.0.0.1/",
      "http://10.1.2.3/",
      "http://192.168.0.8/admin",
      "http://172.16.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://100.100.100.200/",
      "http://0.0.0.0/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fe80::1]/",
      "http://[fd00::1]/",
      "http://[64:ff9b::7f00:1]/",
      "http://[2002:7f00:1::]/",
      "http://localhost/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://foo.internal/",
      "http://printer.local/",
    ]
    for (const target of blocked) {
      const guarded = await guardPublicUrl(target, resolveNever)
      expect(guarded.ok, target).toBe(false)
    }
  })

  it("allows a public address and a name that resolves only to public addresses", async () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true)
    expect(isPublicAddress("1.1.1.1")).toBe(true)
    expect(isPublicAddress("172.15.5.5")).toBe(true)
    expect(isPublicAddress("172.16.5.5")).toBe(false)
    const literal = await guardPublicUrl("https://8.8.8.8/quiz", resolveNever)
    expect(literal).toMatchObject({ ok: true, addresses: [{ address: "8.8.8.8", family: 4 }] })
    const mapped = await guardPublicUrl("http://[64:ff9b::808:808]/quiz", resolveNever)
    expect(mapped).toMatchObject({ ok: true, addresses: [{ address: "8.8.8.8", family: 4 }] })
    let lookedUp = ""
    const named = await guardPublicUrl("https://example.com/quiz", async (hostname) => {
      lookedUp = hostname
      return [{ address: "93.184.216.34", family: 4 }]
    })
    expect(lookedUp).toBe("example.com")
    expect(named.ok).toBe(true)
  })

  it("blocks a hostname when any resolved address is private", async () => {
    const guarded = await guardPublicUrl("https://rebind.example/quiz", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.4", family: 4 },
    ])
    expect(guarded).toEqual({ ok: false, reason: "blocked" })
  })

  it("rejects credentials and non-http protocols before lookup", async () => {
    expect(await guardPublicUrl("https://user:pass@example.com/", resolveNever)).toEqual({ ok: false, reason: "credentials" })
    expect(await guardPublicUrl("file:///etc/passwd", resolveNever)).toEqual({ ok: false, reason: "protocol" })
  })
})
