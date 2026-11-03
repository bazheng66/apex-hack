import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

export type AddressPin = { address: string; family: 4 | 6 }
export type HostResolver = (hostname: string) => Promise<AddressPin[]>

export type GuardedUrl =
  | { ok: true; url: URL; addresses: AddressPin[] }
  | { ok: false; reason: "credentials" | "protocol" | "blocked" | "dns" }

const BLOCKED = buildBlockList()

const BLOCKED_NAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "kubernetes",
  "kubernetes.default",
  "kubernetes.default.svc",
  "kubernetes.default.svc.cluster.local",
])

export async function resolvePublicHost(hostname: string): Promise<AddressPin[]> {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }))
}

export async function guardPublicUrl(raw: string, resolve: HostResolver = resolvePublicHost): Promise<GuardedUrl> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: "protocol" }
  }
  if (url.username || url.password) return { ok: false, reason: "credentials" }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "protocol" }
  const bare = bareHostname(url.hostname)
  if (!bare || bare.includes("%") || bare.includes("\\")) return { ok: false, reason: "blocked" }
  if (isIP(bare) !== 0) {
    const pin = normalizeAddress(bare)
    if (!pin) return { ok: false, reason: "blocked" }
    return { ok: true, url, addresses: [pin] }
  }
  const name = bare.replace(/\.+$/, "").toLowerCase()
  if (isBlockedHostname(name)) return { ok: false, reason: "blocked" }
  let resolved: AddressPin[]
  try {
    resolved = await resolve(name)
  } catch {
    return { ok: false, reason: "dns" }
  }
  if (resolved.length === 0) return { ok: false, reason: "dns" }
  const pins: AddressPin[] = []
  for (const record of resolved) {
    const pin = normalizeAddress(record.address)
    if (!pin) return { ok: false, reason: "blocked" }
    pins.push(pin)
  }
  return { ok: true, url, addresses: pins }
}

export function isPublicAddress(address: string): boolean {
  return normalizeAddress(address) !== null
}

export function normalizeAddress(address: string): AddressPin | null {
  const family = isIP(address)
  if (family === 4) return BLOCKED.check(address, "ipv4") ? null : { address, family: 4 }
  if (family !== 6) return null
  const embedded = embeddedIpv4(address)
  if (embedded) return normalizeAddress(embedded)
  if (!ipv6Bytes(address)) return null
  return BLOCKED.check(address, "ipv6") ? null : { address, family: 6 }
}

function bareHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname.slice(1, -1)
  return hostname
}

function isBlockedHostname(hostname: string): boolean {
  if (!hostname || BLOCKED_NAMES.has(hostname)) return true
  if (
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localdomain")
  ) {
    return true
  }
  return !hostname.includes(".")
}

function embeddedIpv4(address: string): string | null {
  const bytes = ipv6Bytes(address)
  if (!bytes) return null
  const mapped = zeros(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff
  const nat64 =
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    zeros(bytes, 4, 8)
  if (mapped || nat64) return ipv4FromBytes(bytes.subarray(12, 16))
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return ipv4FromBytes(bytes.subarray(2, 6))
  return null
}

export function ipv6Bytes(address: string): Uint8Array | null {
  const input = address.toLowerCase().split("%")[0] ?? ""
  if (!input || input.includes(":::")) return null
  const halves = input.split("::")
  if (halves.length > 2) return null
  const left = parseGroups(halves[0] ?? "")
  if (!left) return null
  if (halves.length === 1) return left.length === 8 ? groupsToBytes(left) : null
  const right = parseGroups(halves[1] ?? "")
  if (!right) return null
  const missing = 8 - left.length - right.length
  if (missing < 0) return null
  return groupsToBytes([...left, ...new Array<number>(missing).fill(0), ...right])
}

function parseGroups(part: string): number[] | null {
  if (part === "") return []
  const groups = part.split(":")
  const out: number[] = []
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index] ?? ""
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(group)) {
      if (index !== groups.length - 1) return null
      const nums = group.split(".").map((item) => Number(item))
      if (nums.some((item) => item > 255)) return null
      out.push(((nums[0] ?? 0) << 8) | (nums[1] ?? 0), ((nums[2] ?? 0) << 8) | (nums[3] ?? 0))
      continue
    }
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    out.push(Number.parseInt(group, 16))
  }
  return out
}

function groupsToBytes(groups: number[]): Uint8Array {
  const bytes = new Uint8Array(16)
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff
    bytes[index * 2 + 1] = group & 0xff
  })
  return bytes
}

function zeros(bytes: Uint8Array, start: number, length: number): boolean {
  for (let index = start; index < start + length; index += 1) {
    if (bytes[index] !== 0) return false
  }
  return true
}

function ipv4FromBytes(bytes: Uint8Array): string {
  return `${bytes[0] ?? 0}.${bytes[1] ?? 0}.${bytes[2] ?? 0}.${bytes[3] ?? 0}`
}

function buildBlockList(): BlockList {
  const list = new BlockList()
  const v4: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ]
  for (const [address, prefix] of v4) list.addSubnet(address, prefix, "ipv4")
  list.addAddress("::", "ipv6")
  list.addAddress("::1", "ipv6")
  const v6: Array<[string, number]> = [
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
    ["2001:db8::", 32],
  ]
  for (const [address, prefix] of v6) list.addSubnet(address, prefix, "ipv6")
  return list
}
