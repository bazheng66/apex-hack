import type { SupabaseClient } from "@supabase/supabase-js"
import { bankStorageKey, parseStoredImports } from "../engine/import-bank.ts"
import { eventUuid } from "./cloud-record.ts"

/** Migrate the old stem-only banks once, retaining the original local backup. */
export async function migrateLegacyBanks(client: SupabaseClient, userId: string, examId: string, examSlug: string) {
  const ownerKey = "testpass-legacy-banks-owner"
  const owner = localStorage.getItem(ownerKey)
  if (owner && owner !== userId) return
  const banks = parseStoredImports(localStorage.getItem(bankStorageKey(examSlug)))
  if (!banks.length) return
  localStorage.setItem(ownerKey, userId)
  for (const bank of banks) {
    const marker = `testpass-migrated-bank-${userId}-${examId}-${bank.id}`
    if (localStorage.getItem(marker)) continue
    let sourceId = await eventUuid(userId, examId, `bank/${bank.id}`)
    if (bank.kind === "url") {
      const found = await client.from("sources").select("id,exam_id").eq("user_id", userId).eq("url", bank.source).maybeSingle()
      if (found.error) throw new Error(found.error.message)
      if (found.data && found.data.exam_id !== examId) throw new Error("Source already belongs to another exam")
      if (found.data) sourceId = found.data.id
    }
    const source = await client.from("sources").upsert({ id: sourceId, user_id: userId, exam_id: examId,
      kind: bank.kind === "url" ? "url" : bank.kind === "file" ? "upload" : "manual", paper_kind: "practice",
      url: bank.kind === "url" ? bank.source : null, title: bank.source || "粘贴的题目", status: "ready",
      raw_meta: { legacy_import_id: bank.id },
    }, { onConflict: "id", ignoreDuplicates: true })
    if (source.error) throw new Error(source.error.message)
    const items = await client.from("items").upsert(await Promise.all(bank.questions.map(async ({ stem }) => ({
      user_id: userId, exam_id: examId, source_id: sourceId, kind: "unknown", prompt: stem,
      external_key: await eventUuid(userId, sourceId, stem), provenance: { legacy_import_id: bank.id },
    }))), { onConflict: "source_id,external_key", ignoreDuplicates: true })
    if (items.error) throw new Error(items.error.message)
    localStorage.setItem(marker, "1")
  }
}
