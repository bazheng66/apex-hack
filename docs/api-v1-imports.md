# `/api/v1/imports`

Supports public URL, pasted HTML/plain text, and JSON/CSV/Markdown uploads. Only extension packs return `501 NOT_IMPLEMENTED`.

The worker runs inside the request. There is no separate queue in this environment. A successful import still responds `202` with the terminal job status.

## Auth

Send the caller's Supabase access token:

```http
Authorization: Bearer <access_token>
```

Anonymous users are allowed. Rows are written with that JWT, so RLS (`user_id = auth.uid()`) applies. The server uses the publishable key only as the Supabase `apikey`. It refuses a `sb_secret_` key or a JWT whose `role` is `service_role`.

## Create

```http
POST /api/v1/imports
Content-Type: application/json

{ "exam_id": "<uuid>", "mode": "public_url", "url": "https://example.com/quiz", "paper_kind": "practice" }
```

`paper_kind` is `practice` (default), `diagnostic`, or `standard`.

For local content, send JSON with `mode`, `exam_id`, and `content` (a string). Modes are `paste_html`, `upload_json`, `upload_csv`, and `upload_markdown`. `html` is also accepted as an alias for `content`. Optional `filename` labels the source, and `declared_source_url` records attribution without fetching the URL.

```json
{ "exam_id": "<uuid>", "mode": "upload_json", "content": "[{\"prompt\":\"分页与分段的地址映射有什么差别？\",\"choices\":[\"页表\",\"段表\"],\"answer_index\":0}]", "filename": "os.json" }
```

Multipart requests use the same fields with a single `file` part. HTML is capped at 2MB and other local formats at 5MB before parsing; the hosting platform can impose a lower request limit. JSON preserves supplied choices and answers. CSV/Markdown currently import stems only. Missing choices or answers stay null. The raw supplied document is not stored. A content hash scopes stable source IDs to the caller and exam, so retrying the same mode and content does not duplicate sources/items. A retry creates a new job for audit.

Success:

```json
{ "job_id": "<uuid>", "source_id": "<uuid>", "status": "succeeded" }
```

| Status | When |
| --- | --- |
| 202 | Job finished `succeeded`, or failed with `FETCH_FAILED` / `PARSE_EMPTY` |
| 400 | `IMPORT_CREDENTIALS_FORBIDDEN` or `URL_REJECTED` |
| 401 | Missing or rejected bearer token |
| 404 | `EXAM_NOT_FOUND` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `LOGIN_WALL` |
| 501 | `extension_pack` |

Bodies that contain `cookie`, `cookies`, `authorization`, `storage_state`, `set-cookie`, or `headers` (any nesting, any of those casings) are `400 IMPORT_CREDENTIALS_FORBIDDEN` and are not stored. A URL with a username or password is the same rejection. The fetcher does not forward the caller's `Cookie` or `Authorization`, and it does not replay `Set-Cookie`.

Private, loopback, link-local, and metadata targets are rejected before the request is sent. That includes decimal and hex IPv4 forms, IPv4-mapped IPv6, NAT64 `64:ff9b::/96`, and 6to4 when the embedded address is not public. Hostnames are resolved and pinned; if any address is non-public, the URL is rejected.

HTML responses are capped at 2MB. JSON, CSV, Markdown, and `text/plain` are capped at 5MB.

## Reads

```http
GET /api/v1/imports/{job_id}
GET /api/v1/sources?exam_id=<uuid>
GET /api/v1/items?source_id=<uuid>
GET /api/v1/items?exam_id=<uuid>&topic_id=<uuid>
```

Optional `limit` is 1–100, default 50. Items are idempotent on `(source_id, external_key)`.

## Parser

`ScraplingParser` is the adapter. CPython Scrapling cannot run in this Vite/Vercel Node function, so `createNodeScraplingParser()` (`impl: node-html-adapter`) extracts prompts and choices that are actually in the HTML or embedded JSON. `import_jobs.parser` is `scrapling`. Nothing is written to `attempts`.

## Local Supabase

1. Copy `.env.example` to `.env`. Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Do not add a secret key.
2. In the Supabase dashboard, enable Anonymous sign-ins.
3. `npm test` runs the API without a network fetch. `npm run dev` serves `/api/v1/*` on port 4731.
4. Mint a user JWT and an exam id:

```bash
node --input-type=module <<'EOF'
import { createClient } from "@supabase/supabase-js"
import { loadEnv } from "vite"
const env = loadEnv("", process.cwd(), "")
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data, error } = await supabase.auth.signInAnonymously()
if (error || !data.session) throw error ?? new Error("no session")
const token = data.session.access_token
const { data: exam, error: examError } = await supabase.from("exams").insert({ user_id: data.session.user.id, name: "import smoke" }).select("id").single()
if (examError) throw examError
console.log(JSON.stringify({ token, exam_id: exam.id }))
EOF
```

5. Import a public page, then read the job:

```bash
curl -sS -X POST http://127.0.0.1:4731/api/v1/imports \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"exam_id\":\"$EXAM_ID\",\"mode\":\"public_url\",\"url\":\"https://example.com/\"}"
curl -sS "http://127.0.0.1:4731/api/v1/imports/$JOB_ID" -H "Authorization: Bearer $TOKEN"
curl -sS "http://127.0.0.1:4731/api/v1/sources?exam_id=$EXAM_ID" -H "Authorization: Bearer $TOKEN"
curl -sS "http://127.0.0.1:4731/api/v1/items?source_id=$SOURCE_ID" -H "Authorization: Bearer $TOKEN"
```

On Vercel, `api/v1/imports.ts`, `api/v1/sources.ts`, and `api/v1/items.ts` call the same handler. `GET /api/v1/imports/:jobId` is rewritten to `GET /api/v1/imports?job_id=:jobId`. Set the same public URL and publishable key in the project env. Do not set a service-role key.
