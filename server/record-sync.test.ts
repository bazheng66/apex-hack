import { PGlite } from "@electric-sql/pglite"
import { readFileSync, readdirSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createProfile, finishToday } from "../src/engine/agent.ts"
import { attemptRows } from "../src/lib/cloud-record.ts"

const owner = "11111111-1111-4111-8111-111111111111"
const other = "22222222-2222-4222-8222-222222222222"
const exam = "33333333-3333-4333-8333-333333333333"
const topic = "44444444-4444-4444-8444-444444444444"
const db = new PGlite()
const state = finishToday(createProfile("os", "basic", "2026-11-03"))
let events: Awaited<ReturnType<typeof attemptRows>>

describe("record sync in PostgreSQL with RLS", () => {
  beforeAll(async () => {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
    const dir = new URL("../supabase/migrations/", import.meta.url)
    for (const file of readdirSync(dir).sort()) {
      // gen_random_uuid is built in; the optional pgcrypto extension is unnecessary here.
      await db.exec(readFileSync(new URL(file, dir), "utf8").replace('create extension if not exists "pgcrypto";', ""))
    }
    await db.exec(`grant usage on schema public, auth to authenticated;
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into auth.users(id) values ('${owner}'), ('${other}');
      set role authenticated; set request.jwt.claim.sub = '${owner}';
      insert into public.exams(id,user_id,slug,name) values('${exam}','${owner}','os','OS');
      insert into public.topics(id,user_id,exam_id,slug,name) values('${topic}','${owner}','${exam}','${state.daily.topicId}','Topic');`)
    events = await attemptRows(state, owner, exam)
  }, 30000)
  afterAll(async () => { await db.close() })

  it("atomically saves a snapshot and appends each event only once on retry", async () => {
    const save = async (revision: number) => db.query<{ revision: number }>("select public.save_record_state($1,$2,$3::jsonb,$4::jsonb) as revision", [exam, revision, JSON.stringify(state), JSON.stringify(events)])
    expect((await save(0)).rows[0]?.revision).toBe(1)
    expect((await save(1)).rows[0]?.revision).toBe(2)
    expect((await db.query("select * from attempts")).rows).toHaveLength(1)
    await expect(save(0)).rejects.toMatchObject({ code: "PT409" })
    expect((await db.query<{ record_revision: number }>("select record_revision from exams")).rows[0]?.record_revision).toBe(2)
  })
  it("rolls back the snapshot if an event fails and prohibits attempt mutation", async () => {
    await expect(db.query("select save_record_state($1,null,$2::jsonb,'[]')", [exam, JSON.stringify(state)])).rejects.toMatchObject({ code: "PT409" })
    await expect(db.query("select save_record_state($1,2,null,'[]')", [exam])).rejects.toThrow("Invalid record")
    const bad = [{ ...events[0], topic_slug: "unknown" }]
    await expect(db.query("select save_record_state($1,2,$2::jsonb,$3::jsonb)", [exam, JSON.stringify(state), JSON.stringify(bad)])).rejects.toThrow("Unknown topic")
    expect((await db.query<{ record_revision: number }>("select record_revision from exams")).rows[0]?.record_revision).toBe(2)
    expect((await db.exec("update attempts set payload = '{}'::jsonb"))[0]?.affectedRows).toBe(0)
    expect((await db.exec("delete from attempts"))[0]?.affectedRows).toBe(0)
    await db.exec("reset role")
    await expect(db.exec("update attempts set payload = '{}'::jsonb")).rejects.toThrow("append-only")
    await expect(db.exec("delete from attempts")).rejects.toThrow("append-only")
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}'`)
  })
  it("cannot read or write another owner's record with a different anonymous identity", async () => {
    await db.exec(`set request.jwt.claim.sub = '${other}'`)
    expect((await db.query("select * from exams")).rows).toEqual([])
    expect((await db.query("select * from attempts")).rows).toEqual([])
    await expect(db.query("select save_record_state($1,2,$2::jsonb,$3::jsonb)", [exam, JSON.stringify(state), JSON.stringify(events)])).rejects.toThrow("Exam not found")
    await db.exec("reset role; set role anon")
    await expect(db.query("select save_record_state($1,2,'{}','[]')", [exam])).rejects.toThrow("permission denied")
  })
})
