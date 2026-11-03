import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { ImportMode, ImportStatus, PaperKind } from "./contract.js"

export type TableName = "users" | "exams" | "sources" | "items" | "import_jobs"

export interface ImportJobRecord {
  id: string
  exam_id: string
  source_id: string | null
  mode: string
  status: ImportStatus
  request_url: string | null
  declared_source_url: string | null
  paper_kind: string
  parser: string | null
  stats: Record<string, unknown>
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}

export interface SourceRecord {
  id: string
  exam_id: string
  kind: string
  paper_kind: string
  url: string | null
  title: string | null
  status: string
  etag: string | null
  last_fetched_at: string | null
  error_message: string | null
  raw_meta: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ItemRecord {
  id: string
  exam_id: string
  source_id: string
  topic_id: string | null
  kind: string
  external_key: string | null
  prompt: string
  choices: unknown
  answer_index: number | null
  answer_text: string | null
  is_active: boolean
  provenance: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface NewJob {
  examId: string
  requestUrl: string | null
  paperKind: PaperKind
  mode?: ImportMode
  inputHash?: string
  declaredSourceUrl?: string | null
}

export interface JobPatch {
  status?: ImportStatus
  sourceId?: string | null
  stats?: Record<string, unknown>
  errorCode?: string | null
  errorMessage?: string | null
  finishedAt?: string | null
}

export interface SourceUpsert {
  examId: string
  url: string | null
  title: string
  paperKind: PaperKind
  etag: string | null
  fetchedAt: string
  rawMeta: Record<string, unknown>
  id?: string
  kind?: "url" | "upload" | "manual"
}

export interface ItemUpsert {
  examId: string
  sourceId: string
  kind: "mcq" | "short" | "unknown"
  externalKey: string
  prompt: string
  choices: string[] | null
  answerIndex: number | null
  answerText: string | null
  provenance: Record<string, unknown>
}

export interface ImportRepository {
  readonly userId: string
  getExam(examId: string): Promise<{ id: string } | null>
  insertJob(input: NewJob): Promise<ImportJobRecord>
  updateJob(id: string, patch: JobPatch): Promise<ImportJobRecord>
  getJob(id: string): Promise<ImportJobRecord | null>
  listSources(examId: string, limit: number): Promise<SourceRecord[]>
  listItems(filter: { sourceId?: string; examId?: string; topicId?: string }, limit: number): Promise<ItemRecord[]>
  upsertSource(input: SourceUpsert): Promise<{ id: string }>
  upsertItems(items: ItemUpsert[]): Promise<number>
}

export class RepositoryError extends Error {
  readonly code: string | undefined
  constructor(message: string, code?: string) {
    super(message)
    this.name = "RepositoryError"
    this.code = code
  }
}

export class SourceExamConflict extends Error {
  constructor() {
    super("SOURCE_EXAM_CONFLICT")
    this.name = "SourceExamConflict"
  }
}

const JOB_COLUMNS =
  "id, exam_id, source_id, mode, status, request_url, declared_source_url, paper_kind, parser, stats, error_code, error_message, created_at, updated_at, finished_at"
const SOURCE_COLUMNS =
  "id, exam_id, kind, paper_kind, url, title, status, etag, last_fetched_at, error_message, raw_meta, created_at, updated_at"
const ITEM_COLUMNS =
  "id, exam_id, source_id, topic_id, kind, external_key, prompt, choices, answer_index, answer_text, is_active, provenance, created_at, updated_at"

type DbError = { message: string; code?: string } | null
type DbResult = { data: unknown; error: DbError }
type Row = Record<string, unknown>

interface Query extends PromiseLike<DbResult> {
  select(columns: string): Query
  insert(values: unknown): Query
  update(values: unknown): Query
  upsert(values: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }): Query
  eq(column: string, value: string): Query
  order(column: string, options?: { ascending?: boolean }): Query
  limit(count: number): Query
  maybeSingle(): Promise<DbResult>
  single(): Promise<DbResult>
}

export class SupabaseImportRepository implements ImportRepository {
  private readonly client: SupabaseClient
  readonly userId: string

  constructor(client: SupabaseClient, userId: string) {
    this.client = client
    this.userId = userId
  }

  async getExam(examId: string): Promise<{ id: string } | null> {
    const row = await maybe(
      table(this.client, "exams").select("id").eq("id", examId).eq("user_id", this.userId).maybeSingle(),
    )
    return row ? { id: text(row, "id") } : null
  }

  async insertJob(input: NewJob): Promise<ImportJobRecord> {
    const row = await one(
      table(this.client, "import_jobs")
        .insert({
          user_id: this.userId,
          exam_id: input.examId,
          mode: input.mode ?? "public_url",
          status: "queued",
          request_url: input.requestUrl,
          input_sha256: input.inputHash ?? null,
          declared_source_url: input.declaredSourceUrl ?? null,
          paper_kind: input.paperKind,
          parser: "scrapling",
        })
        .select(JOB_COLUMNS)
        .single(),
    )
    return jobFrom(row)
  }

  async updateJob(id: string, patch: JobPatch): Promise<ImportJobRecord> {
    const payload: Record<string, unknown> = {}
    if (patch.status) payload.status = patch.status
    if ("sourceId" in patch) payload.source_id = patch.sourceId
    if (patch.stats) payload.stats = patch.stats
    if ("errorCode" in patch) payload.error_code = patch.errorCode
    if ("errorMessage" in patch) payload.error_message = patch.errorMessage
    if ("finishedAt" in patch) payload.finished_at = patch.finishedAt
    const row = await one(
      table(this.client, "import_jobs").update(payload).eq("id", id).eq("user_id", this.userId).select(JOB_COLUMNS).single(),
    )
    return jobFrom(row)
  }

  async getJob(id: string): Promise<ImportJobRecord | null> {
    const row = await maybe(
      table(this.client, "import_jobs").select(JOB_COLUMNS).eq("id", id).eq("user_id", this.userId).maybeSingle(),
    )
    return row ? jobFrom(row) : null
  }

  async listSources(examId: string, limit: number): Promise<SourceRecord[]> {
    const rows = await many(
      table(this.client, "sources")
        .select(SOURCE_COLUMNS)
        .eq("user_id", this.userId)
        .eq("exam_id", examId)
        .order("created_at", { ascending: false })
        .limit(limit),
    )
    return rows.map(sourceFrom)
  }

  async listItems(filter: { sourceId?: string; examId?: string; topicId?: string }, limit: number): Promise<ItemRecord[]> {
    let query = table(this.client, "items").select(ITEM_COLUMNS).eq("user_id", this.userId)
    if (filter.sourceId) query = query.eq("source_id", filter.sourceId)
    if (filter.examId) query = query.eq("exam_id", filter.examId)
    if (filter.topicId) query = query.eq("topic_id", filter.topicId)
    const rows = await many(query.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit))
    return rows.map(itemFrom)
  }

  async upsertSource(input: SourceUpsert): Promise<{ id: string }> {
    if (input.id && input.kind && input.kind !== "url") {
      const row = await one(table(this.client, "sources").upsert({
        id: input.id, user_id: this.userId, exam_id: input.examId, kind: input.kind,
        url: null, title: input.title, paper_kind: input.paperKind, status: "ready",
        last_fetched_at: input.fetchedAt, raw_meta: input.rawMeta, error_message: null,
      }, { onConflict: "id" }).select("id").single())
      return { id: text(row, "id") }
    }
    if (!input.url) throw new RepositoryError("Source URL required")
    const existing = await this.findSource(input.url)
    if (existing) {
      if (existing.exam_id !== input.examId) throw new SourceExamConflict()
      await this.writeSource(existing.id, input)
      return { id: existing.id }
    }
    try {
      const row = await one(
        table(this.client, "sources")
          .insert({
            user_id: this.userId,
            exam_id: input.examId,
            kind: "url",
            paper_kind: input.paperKind,
            url: input.url,
            title: input.title,
            status: "ready",
            etag: input.etag,
            last_fetched_at: input.fetchedAt,
            raw_meta: input.rawMeta,
            error_message: null,
          })
          .select("id")
          .single(),
      )
      return { id: text(row, "id") }
    } catch (error) {
      if (!(error instanceof RepositoryError) || error.code !== "23505") throw error
      const again = await this.findSource(input.url)
      if (!again) throw error
      if (again.exam_id !== input.examId) throw new SourceExamConflict()
      await this.writeSource(again.id, input)
      return { id: again.id }
    }
  }

  async upsertItems(items: ItemUpsert[]): Promise<number> {
    if (items.length === 0) return 0
    const rows = await many(
      table(this.client, "items")
        .upsert(
          items.map((item) => ({
            user_id: this.userId,
            exam_id: item.examId,
            source_id: item.sourceId,
            kind: item.kind,
            external_key: item.externalKey,
            prompt: item.prompt,
            choices: item.choices,
            answer_index: item.answerIndex,
            answer_text: item.answerText,
            provenance: item.provenance,
            is_active: true,
          })),
          { onConflict: "source_id,external_key" },
        )
        .select("id"),
    )
    return rows.length
  }

  private async findSource(url: string): Promise<{ id: string; exam_id: string } | null> {
    const row = await maybe(
      table(this.client, "sources").select("id, exam_id").eq("user_id", this.userId).eq("url", url).maybeSingle(),
    )
    return row ? { id: text(row, "id"), exam_id: text(row, "exam_id") } : null
  }

  private async writeSource(id: string, input: SourceUpsert): Promise<void> {
    await one(
      table(this.client, "sources")
        .update({
          paper_kind: input.paperKind,
          title: input.title,
          status: "ready",
          etag: input.etag,
          last_fetched_at: input.fetchedAt,
          raw_meta: input.rawMeta,
          error_message: null,
        })
        .eq("id", id)
        .eq("user_id", this.userId)
        .select("id")
        .single(),
    )
  }
}

export interface SupabasePublicEnv {
  url: string
  publishableKey: string
}

export function readSupabasePublicEnv(source: Record<string, string | undefined>): SupabasePublicEnv | null {
  const url = first(source.SUPABASE_URL, source.VITE_SUPABASE_URL)
  const publishableKey = first(source.SUPABASE_PUBLISHABLE_KEY, source.VITE_SUPABASE_PUBLISHABLE_KEY, source.SUPABASE_ANON_KEY)
  if (!url || !publishableKey || !isPublishableKey(publishableKey)) return null
  return { url, publishableKey }
}

export function isPublishableKey(key: string): boolean {
  if (key.startsWith("sb_secret_") || key.startsWith("sb_secret")) return false
  if (key.startsWith("sb_publishable_")) return true
  return jwtRole(key) !== "service_role"
}

export async function openUserRepository(jwt: string, env: SupabasePublicEnv): Promise<{ userId: string; repo: ImportRepository } | null> {
  const authClient = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await authClient.auth.getUser(jwt)
  if (error || !data.user) return null
  const userId = data.user.id
  const client = createClient(env.url, env.publishableKey, {
    accessToken: async () => jwt,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const profile = await table(client, "users").upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true })
  if (profile.error) throw new RepositoryError(profile.error.message, profile.error.code)
  return { userId, repo: new SupabaseImportRepository(client, userId) }
}

function table(client: SupabaseClient, name: TableName): Query {
  return client.from(name) as unknown as Query
}

async function one(query: Promise<DbResult>): Promise<Row> {
  const row = await maybe(query)
  if (!row) throw new RepositoryError("missing row")
  return row
}

async function maybe(query: Promise<DbResult>): Promise<Row | null> {
  const { data, error } = await query
  if (error) throw new RepositoryError(error.message, error.code)
  if (!data) return null
  if (typeof data !== "object" || Array.isArray(data)) throw new RepositoryError("unexpected row")
  return data as Row
}

async function many(query: PromiseLike<DbResult>): Promise<Row[]> {
  const { data, error } = await query
  if (error) throw new RepositoryError(error.message, error.code)
  if (!Array.isArray(data)) return []
  return data.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item))
}

function jobFrom(row: Row): ImportJobRecord {
  return {
    id: text(row, "id"),
    exam_id: text(row, "exam_id"),
    source_id: nullableText(row, "source_id"),
    mode: text(row, "mode"),
    status: text(row, "status") as ImportStatus,
    request_url: nullableText(row, "request_url"),
    declared_source_url: nullableText(row, "declared_source_url"),
    paper_kind: text(row, "paper_kind"),
    parser: nullableText(row, "parser"),
    stats: objectField(row, "stats"),
    error_code: nullableText(row, "error_code"),
    error_message: nullableText(row, "error_message"),
    created_at: text(row, "created_at"),
    updated_at: text(row, "updated_at"),
    finished_at: nullableText(row, "finished_at"),
  }
}

function sourceFrom(row: Row): SourceRecord {
  return {
    id: text(row, "id"),
    exam_id: text(row, "exam_id"),
    kind: text(row, "kind"),
    paper_kind: text(row, "paper_kind"),
    url: nullableText(row, "url"),
    title: nullableText(row, "title"),
    status: text(row, "status"),
    etag: nullableText(row, "etag"),
    last_fetched_at: nullableText(row, "last_fetched_at"),
    error_message: nullableText(row, "error_message"),
    raw_meta: objectField(row, "raw_meta"),
    created_at: text(row, "created_at"),
    updated_at: text(row, "updated_at"),
  }
}

function itemFrom(row: Row): ItemRecord {
  const answer = row.answer_index
  return {
    id: text(row, "id"),
    exam_id: text(row, "exam_id"),
    source_id: text(row, "source_id"),
    topic_id: nullableText(row, "topic_id"),
    kind: text(row, "kind"),
    external_key: nullableText(row, "external_key"),
    prompt: text(row, "prompt"),
    choices: row.choices ?? null,
    answer_index: typeof answer === "number" ? answer : null,
    answer_text: nullableText(row, "answer_text"),
    is_active: row.is_active !== false,
    provenance: objectField(row, "provenance"),
    created_at: text(row, "created_at"),
    updated_at: text(row, "updated_at"),
  }
}

function text(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== "string" || !value) throw new RepositoryError(`missing ${key}`)
  return value
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === "string" ? value : null
}

function objectField(row: Row, key: string): Record<string, unknown> {
  const value = row[key]
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function first(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function jwtRole(token: string): string | null {
  const parts = token.split(".")
  if (parts.length < 2 || !parts[1]) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown }
    return typeof payload.role === "string" ? payload.role : null
  } catch {
    return null
  }
}
