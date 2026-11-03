-- Additive: import_jobs (apply only after user confirms + Supabase connected)
-- Does not alter attempts append-only contract.

create type public.import_mode as enum (
  'public_url',
  'paste_html',
  'upload_json',
  'upload_csv',
  'upload_markdown',
  'extension_pack'
);

create type public.import_job_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'rejected'
);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  source_id uuid references public.sources (id) on delete set null,
  mode public.import_mode not null,
  status public.import_job_status not null default 'queued',
  request_url text,
  input_ref text,
  input_sha256 text,
  declared_source_url text,
  paper_kind public.paper_kind not null default 'practice',
  parser text,
  stats jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint import_jobs_public_url_needs_url
    check (mode <> 'public_url' or (request_url is not null and length(trim(request_url)) > 0))
);

create index import_jobs_user_created_idx on public.import_jobs (user_id, created_at desc);
create index import_jobs_status_idx on public.import_jobs (status) where status in ('queued', 'running');

alter table public.import_jobs enable row level security;

create policy import_jobs_owner on public.import_jobs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger import_jobs_set_updated_at before update on public.import_jobs
  for each row execute function public.set_updated_at();
