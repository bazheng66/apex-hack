-- Already applied on the remote project (schema_migrations version 20261103042330).
-- This file is repo history only. FORCE ROW LEVEL SECURITY makes the table owner obey policies.

alter table public.users force row level security;
alter table public.exams force row level security;
alter table public.topics force row level security;
alter table public.sources force row level security;
alter table public.items force row level security;
alter table public.plans force row level security;
alter table public.attempts force row level security;
alter table public.import_jobs force row level security;
alter table public.algo_runs force row level security;
alter table public.user_topic_state force row level security;
alter table public.user_exam_forecast force row level security;
alter table public.review_cards force row level security;
