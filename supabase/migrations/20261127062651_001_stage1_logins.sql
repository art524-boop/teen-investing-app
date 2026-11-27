-- Migration 001 — Stage 1: logins and family setup
--
-- Tables: families, parents, teens, invites, audit_log, feedback
-- Private (not exposed through the API): join_failures, join_blocks (teen-join rate limit)
--
-- Access model
--   * Roles come from the JWT: app_metadata.role ('parent' | 'teen') and app_metadata.family_id.
--     app_metadata can only be written by the server (sign-up trigger below, or Edge Functions).
--   * Parents must have passed two-step verification (JWT aal = 'aal2') to read or change anything.
--   * Teens can read their own teens row and their family's name. They cannot write anything here.
--   * Money, credit, PIN, invite and audit changes happen only in server code (service role).

-- ---------------------------------------------------------------------------
-- Private schema: helper functions and rate-limit tables
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
-- authenticated needs USAGE so RLS policies can call the helper functions.
grant usage on schema private to authenticated, service_role;

create or replace function private.jwt_role()
returns text
language sql stable
set search_path = ''
as $$ select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') $$;

create or replace function private.jwt_family_id()
returns uuid
language sql stable
set search_path = ''
as $$ select nullif(auth.jwt() -> 'app_metadata' ->> 'family_id', '')::uuid $$;

-- A parent who has completed two-step verification in this session.
create or replace function private.is_parent()
returns boolean
language sql stable
set search_path = ''
as $$
  select private.jwt_role() = 'parent'
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and private.jwt_family_id() is not null
$$;

create or replace function private.is_teen()
returns boolean
language sql stable
set search_path = ''
as $$ select private.jwt_role() = 'teen' and private.jwt_family_id() is not null $$;

revoke all on function private.jwt_role(), private.jwt_family_id(), private.is_parent(), private.is_teen() from public, anon;
grant execute on function private.jwt_role(), private.jwt_family_id(), private.is_parent(), private.is_teen() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.families (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(btrim(name)) between 1 and 60),
  created_at         timestamptz not null default now(),
  module_auto_credit boolean not null default true
);

create table public.parents (
  id           uuid primary key references auth.users (id) on delete cascade,
  family_id    uuid not null references public.families (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  consent_at   timestamptz,
  created_at   timestamptz not null default now()
);
-- One parent per family for the test (a second guardian is out of scope).
create unique index parents_one_per_family on public.parents (family_id);

create table public.teens (
  id               uuid primary key references auth.users (id) on delete cascade,
  family_id        uuid not null references public.families (id) on delete cascade,
  nickname         text not null check (char_length(btrim(nickname)) between 1 and 30),
  age_band         smallint not null check (age_band between 13 and 17),
  avatar           text not null check (avatar ~ '^[a-z]{2,20}$'),
  username         text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  show_real_values boolean not null default false,
  consent_at       timestamptz not null,
  failed_pin_count integer not null default 0,
  locked_until     timestamptz,
  created_at       timestamptz not null default now()
);
create index teens_family_id on public.teens (family_id);

create table public.invites (
  code       text primary key check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  teen_id    uuid not null references public.teens (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index invites_teen_id on public.invites (teen_id);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  family_id  uuid not null references public.families (id) on delete cascade,
  actor      uuid not null,           -- auth user id of whoever did it
  action     text not null check (char_length(action) between 1 and 60),
  amount     numeric(12, 2),          -- money/credit amount, when there is one
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_family_created on public.audit_log (family_id, created_at desc);

create table public.feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  screen     text check (char_length(screen) <= 60),
  text       text not null check (char_length(btrim(text)) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- Rate limit for teen-join (wrong invite codes per device / IP). Server only.
create table private.join_failures (
  key        text not null,
  failed_at  timestamptz not null default now()
);
create index join_failures_key_time on private.join_failures (key, failed_at);

create table private.join_blocks (
  key           text primary key,
  blocked_until timestamptz not null
);

-- ---------------------------------------------------------------------------
-- Audit log is append-only: nobody may edit rows. Deleting is refused too, except
-- when a whole family is being removed by the (Stage 6) delete-data server function,
-- which sets app.deleting_family = 'on' for its transaction.
-- ---------------------------------------------------------------------------
create or replace function private.audit_log_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'audit_log rows cannot be changed';
  end if;
  if tg_op in ('DELETE', 'TRUNCATE') and coalesce(current_setting('app.deleting_family', true), '') <> 'on' then
    raise exception 'audit_log rows cannot be deleted';
  end if;
  return null;
end $$;

create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function private.audit_log_guard();
create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function private.audit_log_guard();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_log_guard();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.families      enable row level security;
alter table public.parents       enable row level security;
alter table public.teens         enable row level security;
alter table public.invites       enable row level security;
alter table public.audit_log     enable row level security;
alter table public.feedback      enable row level security;
alter table private.join_failures enable row level security;
alter table private.join_blocks   enable row level security;

-- Start from nothing, then grant only what each role needs.
revoke all on public.families, public.parents, public.teens, public.invites,
              public.audit_log, public.feedback from anon, authenticated;
revoke all on private.join_failures, private.join_blocks from anon, authenticated;
revoke update, delete, truncate on public.audit_log from service_role;

grant select on public.families, public.parents, public.teens, public.invites, public.audit_log to authenticated;
grant update (name, module_auto_credit) on public.families to authenticated;
grant update (display_name) on public.parents to authenticated;
grant update (nickname, age_band, avatar, show_real_values) on public.teens to authenticated;
grant insert (screen, text) on public.feedback to authenticated;

-- families
create policy families_select on public.families
  for select to authenticated
  using (((select private.is_parent()) or (select private.is_teen()))
         and id = (select private.jwt_family_id()));

create policy families_update on public.families
  for update to authenticated
  using ((select private.is_parent()) and id = (select private.jwt_family_id()))
  with check ((select private.is_parent()) and id = (select private.jwt_family_id()));

-- parents
create policy parents_select on public.parents
  for select to authenticated
  using ((select private.is_parent()) and family_id = (select private.jwt_family_id()));

create policy parents_update on public.parents
  for update to authenticated
  using ((select private.is_parent()) and id = (select auth.uid()))
  with check ((select private.is_parent()) and id = (select auth.uid())
              and family_id = (select private.jwt_family_id()));

-- teens
create policy teens_select_parent on public.teens
  for select to authenticated
  using ((select private.is_parent()) and family_id = (select private.jwt_family_id()));

create policy teens_select_self on public.teens
  for select to authenticated
  using ((select private.is_teen()) and id = (select auth.uid()));

create policy teens_update_parent on public.teens
  for update to authenticated
  using ((select private.is_parent()) and family_id = (select private.jwt_family_id()))
  with check ((select private.is_parent()) and family_id = (select private.jwt_family_id()));

-- invites (parents only; teens never see codes)
create policy invites_select_parent on public.invites
  for select to authenticated
  using ((select private.is_parent())
         and exists (select 1 from public.teens t
                     where t.id = invites.teen_id
                       and t.family_id = (select private.jwt_family_id())));

-- audit_log (parent reads own family; only server code adds)
create policy audit_log_select_parent on public.audit_log
  for select to authenticated
  using ((select private.is_parent()) and family_id = (select private.jwt_family_id()));

-- feedback (anyone signed in can add their own; nobody reads it through the API —
-- the app owner reads it in the Supabase dashboard)
create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Parent sign-up: mark the new auth user as a parent with a new family,
-- then create the family and parent rows.
-- Teens (created by Edge Functions with a @teens.invalid address and their own
-- app_metadata) are left alone.
-- ---------------------------------------------------------------------------
create or replace function private.on_auth_user_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email ilike '%@teens.invalid'
     or coalesce(new.raw_app_meta_data ->> 'role', '') <> '' then
    return new;
  end if;
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'parent', 'family_id', gen_random_uuid());
  return new;
end $$;

create or replace function private.on_auth_user_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family uuid;
  v_family_name text;
  v_display_name text;
begin
  if coalesce(new.raw_app_meta_data ->> 'role', '') <> 'parent'
     or new.email ilike '%@teens.invalid' then
    return new;
  end if;

  v_family := (new.raw_app_meta_data ->> 'family_id')::uuid;
  v_family_name := left(nullif(btrim(new.raw_user_meta_data ->> 'family_name'), ''), 60);
  v_display_name := left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 60);

  insert into public.families (id, name)
  values (v_family, coalesce(v_family_name, 'My family'));

  insert into public.parents (id, family_id, display_name, consent_at)
  values (new.id, v_family, coalesce(v_display_name, 'Parent'),
          case when (new.raw_user_meta_data ->> 'consent') = 'true' then now() end);

  insert into public.audit_log (family_id, actor, action, details)
  values (v_family, new.id, 'parent_signed_up',
          jsonb_build_object('consent', (new.raw_user_meta_data ->> 'consent') = 'true'));
  return new;
end $$;

revoke all on function private.on_auth_user_before_insert(), private.on_auth_user_after_insert() from public, anon, authenticated;

create trigger on_auth_user_before_insert
  before insert on auth.users
  for each row execute function private.on_auth_user_before_insert();

create trigger on_auth_user_after_insert
  after insert on auth.users
  for each row execute function private.on_auth_user_after_insert();

-- ---------------------------------------------------------------------------
-- Server-only helpers called by Edge Functions (service role).
-- They live in public so supabase-js rpc() can reach them, but only
-- service_role may execute them.
-- ---------------------------------------------------------------------------

-- Teen PIN attempt, counted BEFORE the PIN is checked so parallel guesses
-- cannot slip past the limit. The 5th attempt sets a 15-minute lock; a
-- successful sign-in then clears it (svc_pin_attempt_success).
create or replace function public.svc_pin_attempt_begin(p_teen uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_locked timestamptz;
  v_next integer;
begin
  select failed_pin_count, locked_until into v_count, v_locked
  from public.teens where id = p_teen for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  if v_locked is not null and v_locked > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_locked);
  end if;
  -- A lock that has run out starts a fresh count.
  v_next := case when v_locked is not null then 1 else v_count + 1 end;
  update public.teens
     set failed_pin_count = v_next,
         locked_until = case when v_next >= 5 then now() + interval '15 minutes' else null end
   where id = p_teen;
  return jsonb_build_object('ok', true, 'attempt', v_next);
end $$;

create or replace function public.svc_pin_attempt_success(p_teen uuid)
returns void
language sql
security definer
set search_path = ''
as $$ update public.teens set failed_pin_count = 0, locked_until = null where id = p_teen $$;

-- teen-join rate limit: is any of these keys (device / IP) blocked right now?
create or replace function public.svc_join_blocked(p_keys text[])
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  select max(blocked_until) from private.join_blocks
  where key = any (p_keys) and blocked_until > now()
$$;

-- Record a wrong invite code for each key; block a key for 15 minutes once it
-- reaches 10 wrong codes within 15 minutes. Returns the block end, if any.
create or replace function public.svc_join_record_failure(p_keys text[])
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  v_recent integer;
  v_until timestamptz;
begin
  delete from private.join_failures where failed_at < now() - interval '1 day';
  delete from private.join_blocks where blocked_until < now() - interval '1 day';
  foreach k in array p_keys loop
    insert into private.join_failures (key) values (k);
    select count(*) into v_recent from private.join_failures
     where key = k and failed_at > now() - interval '15 minutes';
    if v_recent >= 10 then
      insert into private.join_blocks (key, blocked_until)
      values (k, now() + interval '15 minutes')
      on conflict (key) do update set blocked_until = excluded.blocked_until;
      v_until := greatest(coalesce(v_until, now()), now() + interval '15 minutes');
    end if;
  end loop;
  return v_until;
end $$;

-- Sign a user out everywhere (used after a PIN reset). Refresh tokens stop
-- working at once; an access token already issued lasts until it expires (max 1 hour).
create or replace function public.svc_revoke_sessions(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$ delete from auth.sessions where user_id = p_user $$;

revoke all on function public.svc_pin_attempt_begin(uuid), public.svc_pin_attempt_success(uuid),
  public.svc_join_blocked(text[]), public.svc_join_record_failure(text[]),
  public.svc_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.svc_pin_attempt_begin(uuid), public.svc_pin_attempt_success(uuid),
  public.svc_join_blocked(text[]), public.svc_join_record_failure(text[]),
  public.svc_revoke_sessions(uuid) to service_role;
