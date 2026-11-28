-- Migration 004 — Stage 2: tasks, approvals, "Not yet", shout-outs, task ideas, credits
--
-- Tables: tasks, task_submissions, task_ideas, shoutouts, credit_ledger (+ view teen_balances)
-- Every table carries family_id (set by trigger, never by the caller) so RLS and
-- Realtime can be filtered to one family.
--
-- Who can do what
--   Parent (aal2): read everything in their family; add / edit / archive tasks.
--   Teen: read their own rows; INSERT ONLY a submission for their own open task,
--         a task idea and a shout-out. Never decisions, credits or the ledger.
--   Decisions and credits: only through decide_submission / decide_shoutout /
--         decide_idea (security definer, parent-only), each writing to audit_log.
--   credit_ledger is the only source of a teen's balance. No cap on credits.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  teen_id     uuid not null references public.teens (id) on delete cascade,
  family_id   uuid not null references public.families (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  category    text not null default 'Home' check (char_length(btrim(category)) between 1 and 30),
  credits     integer not null check (credits between 0 and 100000),
  repeats     text not null default 'none' check (repeats in ('none', 'weekly')),
  proof_type  text not null default 'none' check (proof_type in ('none', 'note', 'check-in')),
  due_date    date,
  status      text not null default 'open' check (status in ('open', 'submitted', 'done', 'archived')),
  reopen_at   timestamptz,           -- weekly tasks: when "done" turns back into "open"
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index tasks_family on public.tasks (family_id);
create index tasks_teen on public.tasks (teen_id);
create index tasks_reopen on public.tasks (reopen_at) where status = 'done' and repeats = 'weekly';

create table public.task_submissions (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks (id) on delete cascade,
  teen_id       uuid not null default auth.uid() references public.teens (id) on delete cascade,
  family_id     uuid not null references public.families (id) on delete cascade,
  note          text check (char_length(note) <= 500),
  submitted_at  timestamptz not null default now(),
  decision      text not null default 'pending' check (decision in ('pending', 'approved', 'not_yet')),
  reason        text check (char_length(reason) <= 200),
  credits_given integer,
  decided_at    timestamptz,
  decided_by    uuid
);
create index task_submissions_family on public.task_submissions (family_id, submitted_at desc);
create index task_submissions_task on public.task_submissions (task_id, submitted_at desc);
-- At most one submission waiting per task (stops double sends).
create unique index task_submissions_one_pending on public.task_submissions (task_id) where decision = 'pending';

create table public.task_ideas (
  id            uuid primary key default gen_random_uuid(),
  teen_id       uuid not null default auth.uid() references public.teens (id) on delete cascade,
  family_id     uuid not null references public.families (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 80),
  credits_asked integer not null default 5 check (credits_asked between 0 and 100000),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  final_title   text check (char_length(final_title) <= 80),
  final_credits integer check (final_credits between 0 and 100000),
  task_id       uuid references public.tasks (id) on delete set null,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid
);
create index task_ideas_family on public.task_ideas (family_id, created_at desc);

create table public.shoutouts (
  id            uuid primary key default gen_random_uuid(),
  teen_id       uuid not null default auth.uid() references public.teens (id) on delete cascade,
  family_id     uuid not null references public.families (id) on delete cascade,
  text          text not null check (char_length(btrim(text)) between 1 and 280),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'not_yet')),
  reason        text check (char_length(reason) <= 200),
  credits_given integer,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid
);
create index shoutouts_family on public.shoutouts (family_id, created_at desc);

create table public.credit_ledger (
  id          bigint generated always as identity primary key,
  teen_id     uuid not null references public.teens (id) on delete cascade,
  family_id   uuid not null references public.families (id) on delete cascade,
  change      integer not null,
  reason      text not null check (char_length(reason) between 1 and 200),
  source_type text not null check (source_type in ('task', 'shoutout', 'module', 'adjustment')),
  source_id   uuid,
  created_at  timestamptz not null default now()
);
create index credit_ledger_teen on public.credit_ledger (teen_id, created_at desc);
create index credit_ledger_family on public.credit_ledger (family_id);
-- One credit entry per approved item: a double-tap can never pay twice.
create unique index credit_ledger_once on public.credit_ledger (source_type, source_id) where source_id is not null;

-- Balance = sum of the ledger. security_invoker: the caller's RLS applies.
create view public.teen_balances with (security_invoker = true) as
  select teen_id, family_id, coalesce(sum(change), 0)::integer as balance
  from public.credit_ledger
  group by teen_id, family_id;

-- ---------------------------------------------------------------------------
-- Triggers: family_id always comes from the teen, never from the caller
-- ---------------------------------------------------------------------------
create or replace function private.set_family_from_teen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select family_id into new.family_id from public.teens where id = new.teen_id;
  if new.family_id is null then
    raise exception 'Teen not found';
  end if;
  return new;
end $$;

create trigger tasks_family before insert or update of teen_id on public.tasks
  for each row execute function private.set_family_from_teen();
create trigger task_ideas_family before insert on public.task_ideas
  for each row execute function private.set_family_from_teen();
create trigger shoutouts_family before insert on public.shoutouts
  for each row execute function private.set_family_from_teen();
create trigger credit_ledger_family before insert on public.credit_ledger
  for each row execute function private.set_family_from_teen();

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger tasks_touch before update on public.tasks
  for each row execute function private.touch_updated_at();

-- New ideas and shout-outs always start undecided, whatever the caller sent.
create or replace function private.new_request_defaults()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.status := 'pending';
  new.decided_at := null;
  new.decided_by := null;
  if tg_table_name = 'shoutouts' then new.credits_given := null; new.reason := null; end if;
  if tg_table_name = 'task_ideas' then new.final_title := null; new.final_credits := null; new.task_id := null; end if;
  new.created_at := now();
  return new;
end $$;
create trigger task_ideas_defaults before insert on public.task_ideas
  for each row execute function private.new_request_defaults();
create trigger shoutouts_defaults before insert on public.shoutouts
  for each row execute function private.new_request_defaults();

-- A teen marks a task done: check the task, then flip it to "submitted".
create or replace function private.before_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  select id, teen_id, family_id, status, proof_type into t from public.tasks where id = new.task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if t.status <> 'open' then raise exception 'This task is not open right now.'; end if;
  new.teen_id := t.teen_id;
  new.family_id := t.family_id;
  new.decision := 'pending';
  new.reason := null;
  new.credits_given := null;
  new.decided_at := null;
  new.decided_by := null;
  new.submitted_at := now();
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  if t.proof_type = 'note' and new.note is null then
    raise exception 'Add a short note about what you did.';
  end if;
  return new;
end $$;

create or replace function private.after_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks set status = 'submitted' where id = new.task_id;
  return null;
end $$;

create trigger task_submissions_before before insert on public.task_submissions
  for each row execute function private.before_submission();
create trigger task_submissions_after after insert on public.task_submissions
  for each row execute function private.after_submission();

-- Parent task changes go to the audit log.
create or replace function private.audit_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if auth.uid() is null or not private.is_parent()
     or coalesce(current_setting('app.in_decision', true), '') = 'on' then
    return null; -- seeded tasks, decisions and the weekly reopen job are logged elsewhere
  end if;
  if tg_op = 'INSERT' then
    v_action := 'task_added';
  elsif new.status = 'archived' and old.status <> 'archived' then
    v_action := 'task_archived';
  elsif old.status = 'archived' and new.status <> 'archived' then
    v_action := 'task_restored';
  else
    v_action := 'task_edited';
  end if;
  insert into public.audit_log (family_id, actor, action, amount, details)
  values (new.family_id, auth.uid(), v_action, new.credits,
          jsonb_build_object('task_id', new.id, 'teen_id', new.teen_id, 'title', new.title,
                             'repeats', new.repeats, 'proof_type', new.proof_type));
  return null;
end $$;

create trigger tasks_audit after insert or update on public.tasks
  for each row execute function private.audit_task_change();

-- Parents may only open or archive a task by hand; "submitted" and "done" come from the flow.
create or replace function private.guard_task_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and private.is_parent()
     and coalesce(current_setting('app.in_decision', true), '') <> 'on' then
    if tg_op = 'INSERT' and new.status <> 'open' then
      new.status := 'open';
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status
          and not (new.status = 'archived' or (old.status = 'archived' and new.status = 'open')) then
      raise exception 'A task can only be archived or restored here.';
    end if;
    if tg_op = 'UPDATE' and old.status = 'archived' and new.status = 'open' then
      new.reopen_at := null;
    end if;
  end if;
  return new;
end $$;

create trigger tasks_guard_status before insert or update on public.tasks
  for each row execute function private.guard_task_status();

-- Seed v6's example tasks for every new teen (photo proof becomes a parent check-in).
create or replace function private.seed_tasks_for_teen(p_teen uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.tasks (teen_id, family_id, title, category, credits, repeats, proof_type)
  select t.id, t.family_id, s.title, s.category, s.credits, s.repeats, s.proof
  from public.teens t,
  (values
    ('Wash the car', 'Home', 10, 'weekly', 'check-in'),
    ('Cook a family dinner', 'Home', 8, 'weekly', 'check-in'),
    ('Read for 30 minutes, four times', 'Study', 5, 'weekly', 'note'),
    ('Track a week of spending', 'Money skills', 6, 'none', 'note'),
    ('Mow the lawn', 'Home', 10, 'weekly', 'check-in'),
    ('Compare prices for new headphones', 'Money skills', 6, 'none', 'note')
  ) as s(title, category, credits, repeats, proof)
  where t.id = p_teen
$$;

create or replace function private.after_teen_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_tasks_for_teen(new.id);
  return null;
end $$;

create trigger teens_seed_tasks after insert on public.teens
  for each row execute function private.after_teen_insert();

-- Teens added before Stage 2 get the example tasks too.
select private.seed_tasks_for_teen(t.id)
from public.teens t
where not exists (select 1 from public.tasks x where x.teen_id = t.id);

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.task_submissions enable row level security;
alter table public.task_ideas enable row level security;
alter table public.shoutouts enable row level security;
alter table public.credit_ledger enable row level security;

revoke all on public.tasks, public.task_submissions, public.task_ideas, public.shoutouts,
              public.credit_ledger, public.teen_balances from anon, authenticated;

grant select on public.tasks, public.task_submissions, public.task_ideas, public.shoutouts,
                public.credit_ledger, public.teen_balances to authenticated;
grant insert (teen_id, title, category, credits, repeats, proof_type, due_date) on public.tasks to authenticated;
grant update (title, category, credits, repeats, proof_type, due_date, status) on public.tasks to authenticated;
grant insert (task_id, note) on public.task_submissions to authenticated;
grant insert (title, credits_asked) on public.task_ideas to authenticated;
grant insert (text) on public.shoutouts to authenticated;

grant select, insert, update on public.tasks, public.task_submissions, public.task_ideas, public.shoutouts to service_role;
grant select, insert on public.credit_ledger to service_role;
grant select on public.teen_balances to service_role;

-- tasks
create policy tasks_select_parent on public.tasks for select to authenticated
  using ((select private.is_parent()) and family_id = (select private.jwt_family_id()));
create policy tasks_select_teen on public.tasks for select to authenticated
  using ((select private.is_teen()) and teen_id = (select auth.uid()));
create policy tasks_insert_parent on public.tasks for insert to authenticated
  with check ((select private.is_parent()) and family_id = (select private.jwt_family_id()));
create policy tasks_update_parent on public.tasks for update to authenticated
  using ((select private.is_parent()) and family_id = (select private.jwt_family_id()))
  with check ((select private.is_parent()) and family_id = (select private.jwt_family_id()));

-- task_submissions
create policy submissions_select_parent on public.task_submissions for select to authenticated
  using ((select private.is_parent()) and family_id = (select private.jwt_family_id()));
create policy submissions_select_teen on public.task_submissions for select to authenticated
  using ((select private.is_teen()) and teen_id = (select auth.uid()));
create policy submissions_insert_teen on public.task_submissions for insert to authenticated
  with check ((select private.is_teen()) and teen_id = (select auth.uid()));

-- task_ideas
create policy ideas_select_parent on public.task_ideas for select to authenticated
  using ((select private.is_parent()) and family_id = (select private.jwt_family_id()));
create policy ideas_select_teen on public.task_ideas for select to authenticated
  using ((select private.is_teen()) and teen_id = (select auth.uid()));
create policy ideas_insert_teen on public.task_ideas for insert to authenticated
  with check ((select private.is_teen()) and teen_id = (select auth.uid()));

-- shoutouts
create policy shoutouts_select_parent on public.shoutouts for select to authenticated
  using ((select private.is_parent()) and family_id = (select private.jwt_family_id()));
create policy shoutouts_select_teen on public.shoutouts for select to authenticated
  using ((select private.is_teen()) and teen_id = (select auth.uid()));
create policy shoutouts_insert_teen on public.shoutouts for insert to authenticated
  with check ((select private.is_teen()) and teen_id = (select auth.uid()));

-- credit_ledger (read only for everyone; written only by the decide_* functions)
create policy ledger_select_parent on public.credit_ledger for select to authenticated
  using ((select private.is_parent()) and family_id = (select private.jwt_family_id()));
create policy ledger_select_teen on public.credit_ledger for select to authenticated
  using ((select private.is_teen()) and teen_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Decisions (parent only). Each one locks the item, so a double-tap is a no-op.
-- ---------------------------------------------------------------------------
create or replace function private.require_parent()
returns uuid language plpgsql stable set search_path = '' as $$
begin
  if not private.is_parent() then
    raise exception 'Only a parent who has entered their authenticator code can do this.'
      using errcode = '42501';
  end if;
  return private.jwt_family_id();
end $$;

-- Start of next week (Monday 00:00) in Sydney.
create or replace function private.next_sydney_week()
returns timestamptz language sql stable set search_path = '' as $$
  select (date_trunc('week', now() at time zone 'Australia/Sydney') + interval '7 days') at time zone 'Australia/Sydney'
$$;

create or replace function public.decide_submission(p_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  s record;
  t record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_decision not in ('approve', 'not_yet') then raise exception 'Unknown decision.'; end if;
  perform set_config('app.in_decision', 'on', true);
  select * into s from public.task_submissions where id = p_id and family_id = v_family for update;
  if not found then raise exception 'That item was not found.'; end if;
  if s.decision <> 'pending' then
    return jsonb_build_object('ok', true, 'already_decided', true, 'decision', s.decision);
  end if;
  select * into t from public.tasks where id = s.task_id for update;

  if p_decision = 'approve' then
    update public.task_submissions
       set decision = 'approved', credits_given = t.credits, decided_at = now(), decided_by = auth.uid()
     where id = p_id;
    if t.credits > 0 then
      insert into public.credit_ledger (teen_id, change, reason, source_type, source_id)
      values (s.teen_id, t.credits, 'Task: ' || t.title, 'task', s.id);
    end if;
    update public.tasks
       set status = case when status = 'archived' then 'archived' else 'done' end,
           reopen_at = case when repeats = 'weekly' then private.next_sydney_week() else null end
     where id = t.id;
    insert into public.audit_log (family_id, actor, action, amount, details)
    values (v_family, auth.uid(), 'task_approved', t.credits,
            jsonb_build_object('task_id', t.id, 'submission_id', s.id, 'teen_id', s.teen_id, 'title', t.title));
  else
    if v_reason is null then raise exception 'Choose or write a short reason.'; end if;
    update public.task_submissions
       set decision = 'not_yet', reason = left(v_reason, 200), credits_given = 0, decided_at = now(), decided_by = auth.uid()
     where id = p_id;
    update public.tasks set status = case when status = 'archived' then 'archived' else 'open' end where id = t.id;
    insert into public.audit_log (family_id, actor, action, amount, details)
    values (v_family, auth.uid(), 'task_not_yet', 0,
            jsonb_build_object('task_id', t.id, 'submission_id', s.id, 'teen_id', s.teen_id, 'title', t.title, 'reason', v_reason));
  end if;
  return jsonb_build_object('ok', true, 'already_decided', false);
end $$;

create or replace function public.decide_shoutout(p_id uuid, p_decision text, p_credits integer default 0, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  s record;
  v_credits integer := coalesce(p_credits, 0);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_decision not in ('approve', 'not_yet') then raise exception 'Unknown decision.'; end if;
  if v_credits < 0 or v_credits > 100000 then raise exception 'Credits must be 0 or more.'; end if;
  select * into s from public.shoutouts where id = p_id and family_id = v_family for update;
  if not found then raise exception 'That item was not found.'; end if;
  if s.status <> 'pending' then
    return jsonb_build_object('ok', true, 'already_decided', true, 'status', s.status);
  end if;

  if p_decision = 'approve' then
    update public.shoutouts
       set status = 'approved', credits_given = v_credits, decided_at = now(), decided_by = auth.uid()
     where id = p_id;
    if v_credits > 0 then
      insert into public.credit_ledger (teen_id, change, reason, source_type, source_id)
      values (s.teen_id, v_credits, 'Shout-out', 'shoutout', s.id);
    end if;
    insert into public.audit_log (family_id, actor, action, amount, details)
    values (v_family, auth.uid(), 'shoutout_approved', v_credits,
            jsonb_build_object('shoutout_id', s.id, 'teen_id', s.teen_id));
  else
    v_reason := coalesce(v_reason, 'Thanks for telling me. Not this time, but keep it up.');
    update public.shoutouts
       set status = 'not_yet', reason = left(v_reason, 200), credits_given = 0, decided_at = now(), decided_by = auth.uid()
     where id = p_id;
    insert into public.audit_log (family_id, actor, action, amount, details)
    values (v_family, auth.uid(), 'shoutout_not_yet', 0,
            jsonb_build_object('shoutout_id', s.id, 'teen_id', s.teen_id, 'reason', v_reason));
  end if;
  return jsonb_build_object('ok', true, 'already_decided', false);
end $$;

create or replace function public.decide_idea(p_id uuid, p_decision text, p_final_title text default null, p_final_credits integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family uuid := private.require_parent();
  i record;
  v_title text;
  v_credits integer;
  v_nick text;
  v_task uuid;
begin
  if p_decision not in ('approve', 'decline') then raise exception 'Unknown decision.'; end if;
  perform set_config('app.in_decision', 'on', true);
  select * into i from public.task_ideas where id = p_id and family_id = v_family for update;
  if not found then raise exception 'That item was not found.'; end if;
  if i.status <> 'pending' then
    return jsonb_build_object('ok', true, 'already_decided', true, 'status', i.status);
  end if;

  if p_decision = 'approve' then
    v_title := coalesce(nullif(btrim(coalesce(p_final_title, '')), ''), i.title);
    v_credits := coalesce(p_final_credits, i.credits_asked);
    if char_length(v_title) > 80 then raise exception 'Keep the task name under 80 characters.'; end if;
    if v_credits < 0 or v_credits > 100000 then raise exception 'Credits must be 0 or more.'; end if;
    select nickname into v_nick from public.teens where id = i.teen_id;
    insert into public.tasks (teen_id, title, category, credits, repeats, proof_type)
    values (i.teen_id, v_title, left(v_nick || '''s idea', 30), v_credits, 'none', 'note')
    returning id into v_task;
    update public.task_ideas
       set status = 'approved', final_title = v_title, final_credits = v_credits, task_id = v_task,
           decided_at = now(), decided_by = auth.uid()
     where id = p_id;
    insert into public.audit_log (family_id, actor, action, amount, details)
    values (v_family, auth.uid(), 'idea_approved', v_credits,
            jsonb_build_object('idea_id', i.id, 'task_id', v_task, 'teen_id', i.teen_id, 'title', v_title,
                               'edited', v_title <> i.title or v_credits <> i.credits_asked));
  else
    update public.task_ideas set status = 'declined', decided_at = now(), decided_by = auth.uid() where id = p_id;
    insert into public.audit_log (family_id, actor, action, amount, details)
    values (v_family, auth.uid(), 'idea_declined', 0,
            jsonb_build_object('idea_id', i.id, 'teen_id', i.teen_id, 'title', i.title));
  end if;
  return jsonb_build_object('ok', true, 'already_decided', false);
end $$;

-- Names for headings: family name and the parent's display name (teens can't read parents).
create or replace function public.my_family()
returns table (family_name text, parent_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.name, (select p.display_name from public.parents p where p.family_id = f.id limit 1)
  from public.families f
  where f.id = private.jwt_family_id()
    and (private.is_parent() or private.is_teen())
$$;

revoke all on function public.decide_submission(uuid, text, text), public.decide_shoutout(uuid, text, integer, text),
  public.decide_idea(uuid, text, text, integer), public.my_family() from public, anon;
grant execute on function public.decide_submission(uuid, text, text), public.decide_shoutout(uuid, text, integer, text),
  public.decide_idea(uuid, text, text, integer), public.my_family() to authenticated;
revoke all on function private.require_parent(), private.next_sydney_week(), private.seed_tasks_for_teen(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Weekly tasks reopen at the start of the next Sydney week (checked every 5 minutes).
-- ---------------------------------------------------------------------------
create or replace function private.reopen_weekly_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.tasks
     set status = 'open', reopen_at = null
   where status = 'done' and repeats = 'weekly' and reopen_at is not null and reopen_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.reopen_weekly_tasks() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('reopen-weekly-tasks', '*/5 * * * *', 'select private.reopen_weekly_tasks()');

-- ---------------------------------------------------------------------------
-- Realtime: changes stream to signed-in family members (RLS applies).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.tasks, public.task_submissions, public.task_ideas, public.shoutouts, public.credit_ledger;
