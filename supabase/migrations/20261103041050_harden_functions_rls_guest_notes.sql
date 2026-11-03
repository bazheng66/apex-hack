-- Harden functions flagged by advisors; guest demo uses anonymous JWT (auth.uid()), not open anon RLS.

alter function public.forbid_attempt_mutation() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.handle_new_user() set search_path = public;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

comment on table public.users is 'Profile for auth.users. Guest demo: enable Anonymous sign-ins; client signInAnonymously() then RLS scopes by auth.uid(). Do not grant table access to anon without JWT.';
