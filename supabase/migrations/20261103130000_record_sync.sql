-- The snapshot preserves pre-cloud records, review schedules and UI metadata.
-- Raw attempts remain append-only; a revision guards concurrent snapshot writes.
alter table public.exams add column record_state jsonb;
alter table public.exams add column record_revision integer not null default 0;

create or replace function public.save_record_state(p_exam_id uuid, p_revision integer, p_state jsonb, p_attempts jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_revision integer;
  exam_slug text;
  event jsonb;
  topic_uuid uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select record_revision, slug into current_revision, exam_slug from public.exams
    where id = p_exam_id and user_id = auth.uid() for update;
  if not found then raise exception 'Exam not found'; end if;
  if current_revision is distinct from p_revision then
    raise sqlstate 'PT409' using message = 'Record changed in another tab. Retry with the latest revision.';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object' or jsonb_typeof(p_attempts) is distinct from 'array'
    or p_state->>'examId' is distinct from exam_slug then
    raise exception 'Invalid record';
  end if;
  for event in select value from jsonb_array_elements(p_attempts) loop
    select id into topic_uuid from public.topics
      where exam_id = p_exam_id and user_id = auth.uid() and slug = event->>'topic_slug';
    if topic_uuid is null then raise exception 'Unknown topic'; end if;
    insert into public.attempts(user_id, exam_id, topic_id, client_event_id, kind, paper_kind, occurred_at, local_day, payload)
      values(auth.uid(), p_exam_id, topic_uuid, (event->>'client_event_id')::uuid,
        (event->>'kind')::public.attempt_kind, 'practice',
        (event->>'occurred_at')::timestamptz, (event->>'local_day')::date, event->'payload')
      on conflict(user_id, client_event_id) do nothing;
  end loop;
  update public.exams set record_state = p_state, record_revision = current_revision + 1,
    level_hint = p_state->>'level', exam_date = nullif(p_state->'goal'->>'examDate', '')::date,
    target_score = (p_state->'goal'->>'target')::numeric
    where id = p_exam_id and user_id = auth.uid();
  update public.users set active_exam_id = p_exam_id where id = auth.uid();
  return current_revision + 1;
end;
$$;
revoke all on function public.save_record_state(uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.save_record_state(uuid, integer, jsonb, jsonb) to authenticated;
