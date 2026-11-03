-- Testpass data layer v1.1 (aligned with 算法契约)
-- Stack: Supabase/Postgres
-- Invariants:
--   1) attempts is the append-only raw event source (never rewrite for scoring)
--   2) exams/topics/sources/items are user-owned; no seeded real exam banks
--   3) mastery / abilities / forecast are DERIVED (optional materialization below)
--   4) RLS: every row scoped to auth.uid()
--   5) paper_kind on sources; attempts may mirror payload.paper_kind for filters

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users (profile; auth identity lives in auth.users)
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'Asia/Shanghai',
  active_exam_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- exams: user-defined exam outlines
-- ---------------------------------------------------------------------------
create table public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  slug text,
  name text not null,
  description text,
  exam_date date,
  target_score numeric(5,2),
  level_hint text check (level_hint is null or level_hint in ('start','basic','uneven','polish')),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index exams_user_id_idx on public.exams (user_id);

alter table public.users
  add constraint users_active_exam_id_fkey
  foreign key (active_exam_id) references public.exams (id) on delete set null;

-- ---------------------------------------------------------------------------
-- topics
-- ---------------------------------------------------------------------------
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  slug text,
  name text not null,
  drill_prompt text,
  minimum_prompt text,
  weight numeric(6,3) not null default 1.0,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, slug)
);

create index topics_exam_id_idx on public.topics (exam_id);
create index topics_user_id_idx on public.topics (user_id);

-- ---------------------------------------------------------------------------
-- sources: user-provided banks only
-- ---------------------------------------------------------------------------
create type public.source_kind as enum ('url', 'upload', 'manual');
create type public.source_status as enum ('pending', 'fetching', 'ready', 'failed');
create type public.paper_kind as enum ('practice', 'diagnostic', 'standard');

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  kind public.source_kind not null default 'url',
  paper_kind public.paper_kind not null default 'practice',
  url text,
  title text,
  status public.source_status not null default 'pending',
  etag text,
  last_fetched_at timestamptz,
  error_message text,
  raw_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sources_url_required_for_url_kind
    check (kind <> 'url' or (url is not null and length(trim(url)) > 0))
);

create index sources_user_exam_idx on public.sources (user_id, exam_id);
create index sources_paper_kind_idx on public.sources (exam_id, paper_kind);
create unique index sources_user_url_unique
  on public.sources (user_id, url)
  where url is not null;

-- ---------------------------------------------------------------------------
-- items
-- ---------------------------------------------------------------------------
create type public.item_kind as enum ('mcq', 'short', 'unknown');

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  kind public.item_kind not null default 'mcq',
  external_key text,
  prompt text not null,
  choices jsonb,
  answer_index int,
  answer_text text,
  notes jsonb not null default '[]'::jsonb,
  difficulty numeric(6,2),
  provenance jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_key)
);

create index items_exam_topic_idx on public.items (exam_id, topic_id);
create index items_user_id_idx on public.items (user_id);

-- ---------------------------------------------------------------------------
-- plans (今日专项) — algorithm writes via upsert (user, exam, local_day)
-- ---------------------------------------------------------------------------
create type public.plan_status as enum ('open', 'done', 'skipped');
create type public.plan_rule as enum ('LOWEST_TOPIC', 'SKIP_TRIM', 'SKIP_SHRINK', 'CUSTOM');
create type public.companion_hint as enum ('encourage', 'urge', 'celebrate', 'sleepy');

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  local_day date not null,
  minutes int not null check (minutes > 0 and minutes <= 180),
  instruction text not null,
  reason text,
  rule_id public.plan_rule not null default 'LOWEST_TOPIC',
  status public.plan_status not null default 'open',
  shortened boolean not null default false,
  companion_hint public.companion_hint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exam_id, local_day)
);

create index plans_user_day_idx on public.plans (user_id, local_day desc);

-- ---------------------------------------------------------------------------
-- attempts: RAW event log (append-only)
-- Session.kind mapping: drill-done→drill_done, drill-shrink→drill_shrink,
--   drill-skip→drill_skip, mock→mock, upload→upload
-- ---------------------------------------------------------------------------
create type public.attempt_kind as enum (
  'drill_item',
  'drill_done',
  'drill_shrink',
  'drill_skip',
  'mock',
  'upload',
  'import_grade'
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  plan_id uuid references public.plans (id) on delete set null,
  source_id uuid references public.sources (id) on delete set null,
  client_event_id uuid not null,
  kind public.attempt_kind not null,
  -- denormalized for calibration filters; null ⇒ treat as practice
  paper_kind public.paper_kind,
  occurred_at timestamptz not null default now(),
  local_day date not null,
  payload jsonb not null default '{}'::jsonb,
  -- payload contracts (算法):
  --   drill_item: {chosen, correct, before?, after?, note?, difficulty?, paper_kind?}
  --   drill_done: {minutes, score_delta?}
  --   drill_shrink: {minutes_before, minutes_after}
  --   drill_skip: {reason?: "rolled"|"user"}
  --   mock: single-item drill_item shape OR {items:[{item_id,chosen,correct,note?}]}
  --   upload|import_grade: {correct_count, wrong_count|total, mistake_text?, topic_id?}
  device_id text,
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);

create index attempts_user_exam_occurred_idx
  on public.attempts (user_id, exam_id, occurred_at asc, id asc);
create index attempts_user_exam_day_idx on public.attempts (user_id, exam_id, local_day);
create index attempts_topic_idx on public.attempts (topic_id, occurred_at desc);
create index attempts_paper_kind_idx
  on public.attempts (user_id, exam_id, paper_kind)
  where paper_kind in ('diagnostic', 'standard');

create or replace function public.forbid_attempt_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'attempts is append-only; mutate via compensating insert if needed';
end;
$$;

create trigger attempts_no_update
  before update on public.attempts
  for each row execute function public.forbid_attempt_mutation();

create trigger attempts_no_delete
  before delete on public.attempts
  for each row execute function public.forbid_attempt_mutation();

-- ---------------------------------------------------------------------------
-- OPTIONAL derived tables (algorithm materialization; replayable from attempts)
-- Not source of truth. Include so 算法 can upsert without inventing schema.
-- ---------------------------------------------------------------------------
create table public.algo_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  algo_version text not null,
  computed_at timestamptz not null default now()
);

create index algo_runs_user_exam_idx on public.algo_runs (user_id, exam_id, computed_at desc);

create table public.user_topic_state (
  user_id uuid not null references public.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  score numeric(6,2) not null,           -- Mastery.score 8–96
  rating numeric(10,2),                  -- Ability.rating
  uncertainty numeric(10,2),
  p_mastery numeric(6,4),
  half_life_days numeric(10,4),
  last_seen_at timestamptz,
  next_due_at timestamptz,
  n_correct int not null default 0,
  n_wrong int not null default 0,
  algo_version text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, exam_id, topic_id)
);

create table public.user_exam_forecast (
  user_id uuid not null references public.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  average numeric(6,2),
  weakest numeric(6,2),
  velocity numeric(8,4),
  projected numeric(6,2),
  pass_p_low numeric(6,4),
  pass_p_high numeric(6,4),
  calibrated boolean not null default false,
  available boolean not null default false, -- false until diagnostic/standard attempts exist
  as_of timestamptz not null default now(),
  algo_version text not null,
  primary key (user_id, exam_id)
);

-- optional SM-2 cards (else stay client-local)
create table public.review_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  prompt text not null,
  ease numeric(6,3) not null default 2.5,
  interval_days int not null default 0,
  repetitions int not null default 0,
  lapses int not null default 0,
  due date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index review_cards_due_idx on public.review_cards (user_id, due);

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger exams_set_updated_at before update on public.exams
  for each row execute function public.set_updated_at();
create trigger topics_set_updated_at before update on public.topics
  for each row execute function public.set_updated_at();
create trigger sources_set_updated_at before update on public.sources
  for each row execute function public.set_updated_at();
create trigger items_set_updated_at before update on public.items
  for each row execute function public.set_updated_at();
create trigger plans_set_updated_at before update on public.plans
  for each row execute function public.set_updated_at();
create trigger review_cards_set_updated_at before update on public.review_cards
  for each row execute function public.set_updated_at();
create trigger user_topic_state_set_updated_at before update on public.user_topic_state
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.exams enable row level security;
alter table public.topics enable row level security;
alter table public.sources enable row level security;
alter table public.items enable row level security;
alter table public.attempts enable row level security;
alter table public.plans enable row level security;
alter table public.algo_runs enable row level security;
alter table public.user_topic_state enable row level security;
alter table public.user_exam_forecast enable row level security;
alter table public.review_cards enable row level security;

create policy users_self on public.users
  for all using (id = auth.uid()) with check (id = auth.uid());
create policy exams_owner on public.exams
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy topics_owner on public.topics
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sources_owner on public.sources
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy items_owner on public.items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy attempts_owner_select on public.attempts
  for select using (user_id = auth.uid());
create policy attempts_owner_insert on public.attempts
  for insert with check (user_id = auth.uid());
create policy plans_owner on public.plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy algo_runs_owner on public.algo_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_topic_state_owner on public.user_topic_state
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_exam_forecast_owner on public.user_exam_forecast
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy review_cards_owner on public.review_cards
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
