-- RLS tests for Stage 1 (families, parents, teens, invites, audit_log, feedback).
--
-- How to run: paste this whole file into the Supabase SQL editor (or run it through
-- the Supabase MCP execute_sql tool). It builds two test families, checks every rule,
-- then rolls everything back — nothing is left in the database.
-- Every row of the result should start with PASS.
--
-- (Written as a plain SQL script instead of pgTAP because `supabase test db` needs a
-- local Docker stack.)

create or replace function pg_temp.as_user(p_claims jsonb)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', coalesce(p_claims, '{}'::jsonb)::text, true);
  if p_claims is null then
    execute 'set local role anon';
  else
    execute 'set local role authenticated';
  end if;
end $$;

create or replace function pg_temp.as_admin()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.run_rls_tests()
returns table (result text)
language plpgsql as $$
declare
  r text[] := '{}';
  pa uuid := gen_random_uuid();   -- parent, family A
  pb uuid := gen_random_uuid();   -- parent, family B
  ta1 uuid := gen_random_uuid();  -- teen 1, family A
  ta2 uuid := gen_random_uuid();  -- teen 2, family A
  tb1 uuid := gen_random_uuid();  -- teen 1, family B
  fa uuid; fb uuid;
  c_pa jsonb; c_pa1 jsonb; c_pb jsonb; c_ta1 jsonb;
  n bigint;
  s text;

begin
  begin  -- everything inside this block is rolled back at the end
    -- ------------------------------------------------------------------ fixtures
    perform pg_temp.as_admin();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (pa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'rls-test-a-' || pa || '@example.com', '', '{"provider":"email"}',
       '{"family_name":"Test Family A","display_name":"Parent A","consent":"true"}', now(), now()),
      (pb, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'rls-test-b-' || pb || '@example.com', '', '{"provider":"email"}',
       '{"family_name":"Test Family B","display_name":"Parent B","consent":"true"}', now(), now());

    select (raw_app_meta_data ->> 'family_id')::uuid into fa from auth.users where id = pa;
    select (raw_app_meta_data ->> 'family_id')::uuid into fb from auth.users where id = pb;

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (ta1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       ta1 || '@teens.invalid', '', jsonb_build_object('role', 'teen', 'family_id', fa), '{}', now(), now()),
      (ta2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       ta2 || '@teens.invalid', '', jsonb_build_object('role', 'teen', 'family_id', fa), '{}', now(), now()),
      (tb1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       tb1 || '@teens.invalid', '', jsonb_build_object('role', 'teen', 'family_id', fb), '{}', now(), now());

    insert into public.teens (id, family_id, nickname, age_band, avatar, username, consent_at) values
      (ta1, fa, 'Teen A1', 14, 'koala', 'rlstest_a1', now()),
      (ta2, fa, 'Teen A2', 16, 'owl',   'rlstest_a2', now()),
      (tb1, fb, 'Teen B1', 15, 'fox',   'rlstest_b1', now());
    insert into public.invites (code, teen_id, expires_at) values
      ('TSTAA2', ta1, now() + interval '7 days'),
      ('TSTAB3', ta2, now() + interval '7 days'),
      ('TSTBA4', tb1, now() + interval '7 days');
    insert into public.audit_log (family_id, actor, action) values
      (fa, pa, 'test_a'), (fb, pb, 'test_b');

    c_pa  := jsonb_build_object('sub', pa, 'role', 'authenticated', 'aal', 'aal2',
               'app_metadata', jsonb_build_object('role', 'parent', 'family_id', fa));
    c_pa1 := jsonb_build_object('sub', pa, 'role', 'authenticated', 'aal', 'aal1',
               'app_metadata', jsonb_build_object('role', 'parent', 'family_id', fa));
    c_pb  := jsonb_build_object('sub', pb, 'role', 'authenticated', 'aal', 'aal2',
               'app_metadata', jsonb_build_object('role', 'parent', 'family_id', fb));
    c_ta1 := jsonb_build_object('sub', ta1, 'role', 'authenticated', 'aal', 'aal1',
               'app_metadata', jsonb_build_object('role', 'teen', 'family_id', fa));

    -- ------------------------------------------------------------------ sign-up trigger
    select count(*) into n from public.families where id = fa and name = 'Test Family A';
    r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' | sign-up trigger creates the family');
    select count(*) into n from public.parents where id = pa and family_id = fa and consent_at is not null;
    r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' | sign-up trigger creates the parent with consent date');
    select count(*) into n from public.audit_log where family_id = fa and action = 'parent_signed_up';
    r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' | sign-up is written to audit_log');
    select count(*) into n from public.families where id in (select family_id from public.teens where id = ta1) and id <> fa;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | teen auth users do not get a family of their own');

    -- ------------------------------------------------------------------ parent A (aal2)
    perform pg_temp.as_user(c_pa);
    select count(*) into n from public.families;
    r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' | parent A sees only their own family (' || n || ')');
    select count(*) into n from public.families where id = fb;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | parent A cannot see family B');
    select count(*) into n from public.parents where family_id = fb;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | parent A cannot see parent B');
    select count(*) into n from public.teens;
    r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' | parent A sees their 2 teens (' || n || ')');
    select count(*) into n from public.teens where family_id = fb;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | parent A cannot see family B''s teen');
    select count(*) into n from public.invites;
    r := r || (case when n = 2 then 'PASS' else 'FAIL' end || ' | parent A sees their 2 invites (' || n || ')');
    select count(*) into n from public.invites where teen_id = tb1;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | parent A cannot see family B''s invite');
    select count(*) into n from public.audit_log where family_id = fb;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | parent A cannot see family B''s audit_log');
    select count(*) into n from public.audit_log where family_id = fa;
    r := r || (case when n >= 1 then 'PASS' else 'FAIL' end || ' | parent A can read their own audit_log');

    update public.families set name = 'Hacked' where id = fb;
    get diagnostics n = row_count;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | parent A cannot rename family B');
    update public.teens set nickname = 'Hacked' where id = tb1;
    get diagnostics n = row_count;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | parent A cannot change family B''s teen');
    update public.families set name = 'Test Family A2' where id = fa;
    get diagnostics n = row_count;
    r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' | parent A can rename their own family');
    update public.teens set nickname = 'Renamed' where id = ta1;
    get diagnostics n = row_count;
    r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' | parent A can change their teen''s nickname');

    begin
      update public.teens set failed_pin_count = 0, locked_until = null where id = ta1;
      r := r || text 'FAIL | parent A must not change PIN lock fields directly';
    exception when insufficient_privilege then
      r := r || text 'PASS | parent A cannot change PIN lock fields directly';
    end;
    begin
      update public.teens set username = 'stolen' where id = ta1;
      r := r || text 'FAIL | parent A must not change a username directly';
    exception when insufficient_privilege then
      r := r || text 'PASS | parent A cannot change a username directly';
    end;
    begin
      update public.teens set family_id = fb where id = ta1;
      r := r || text 'FAIL | parent A must not move a teen to another family';
    exception when insufficient_privilege then
      r := r || text 'PASS | parent A cannot move a teen to another family';
    end;
    begin
      insert into public.teens (id, family_id, nickname, age_band, avatar, consent_at)
      values (gen_random_uuid(), fa, 'X', 14, 'fox', now());
      r := r || text 'FAIL | parent A must not insert teens directly';
    exception when insufficient_privilege then
      r := r || text 'PASS | parent A cannot insert teens directly (Edge Function only)';
    end;
    begin
      insert into public.invites (code, teen_id, expires_at) values ('ZZZZZ2', ta1, now() + interval '1 day');
      r := r || text 'FAIL | parent A must not insert invites directly';
    exception when insufficient_privilege then
      r := r || text 'PASS | parent A cannot insert invites directly (Edge Function only)';
    end;
    begin
      insert into public.audit_log (family_id, actor, action) values (fa, pa, 'fake');
      r := r || text 'FAIL | parent A must not write audit_log';
    exception when insufficient_privilege then
      r := r || text 'PASS | parent A cannot write audit_log';
    end;
    begin
      update public.audit_log set action = 'edited' where family_id = fa;
      r := r || text 'FAIL | parent A must not edit audit_log';
    exception when insufficient_privilege then
      r := r || text 'PASS | parent A cannot edit audit_log';
    end;
    begin
      delete from public.audit_log where family_id = fa;
      r := r || text 'FAIL | parent A must not delete audit_log';
    exception when insufficient_privilege then
      r := r || text 'PASS | parent A cannot delete audit_log';
    end;
    begin
      perform count(*) from public.feedback;
      r := r || text 'FAIL | parent A must not read feedback';
    exception when insufficient_privilege then
      r := r || text 'PASS | parent A cannot read feedback (owner only, via dashboard)';
    end;

    -- ------------------------------------------------------------------ parent A without 2-step (aal1)
    perform pg_temp.as_user(c_pa1);
    select (select count(*) from public.families) + (select count(*) from public.parents)
         + (select count(*) from public.teens) + (select count(*) from public.invites)
         + (select count(*) from public.audit_log) into n;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | parent without 2-step verification sees nothing (' || n || ')');
    update public.families set name = 'No MFA' where id = fa;
    get diagnostics n = row_count;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | parent without 2-step verification cannot change anything');

    -- ------------------------------------------------------------------ parent B
    perform pg_temp.as_user(c_pb);
    select count(*) into n from public.teens where family_id = fa;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | parent B cannot see family A''s teens');
    select count(*) into n from public.teens;
    r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' | parent B sees only their own teen (' || n || ')');

    -- ------------------------------------------------------------------ teen A1
    perform pg_temp.as_user(c_ta1);
    select count(*) into n from public.teens;
    r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' | teen sees only their own teens row (' || n || ')');
    select count(*) into n from public.teens where id = ta2;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | teen cannot read their sibling''s row');
    select count(*) into n from public.teens where id = tb1;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | teen cannot read another family''s teen');
    select string_agg(name, ',') into s from public.families;
    r := r || (case when s = 'Test Family A2' then 'PASS' else 'FAIL' end || ' | teen can read only their family''s name (' || coalesce(s, 'none') || ')');
    select (select count(*) from public.parents) + (select count(*) from public.invites)
         + (select count(*) from public.audit_log) into n;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | teen cannot read parents, invites or audit_log (' || n || ')');

    update public.teens set nickname = 'Me', show_real_values = true where id = ta1;
    get diagnostics n = row_count;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | teen cannot update their own row');
    update public.families set name = 'Teen rules' where id = fa;
    get diagnostics n = row_count;
    r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' | teen cannot rename the family');
    begin
      update public.teens set failed_pin_count = 0, locked_until = null where id = ta1;
      r := r || text 'FAIL | teen must not clear their own PIN lock';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot clear their own PIN lock';
    end;
    begin
      insert into public.audit_log (family_id, actor, action) values (fa, ta1, 'fake');
      r := r || text 'FAIL | teen must not write audit_log';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot write audit_log';
    end;
    begin
      insert into public.invites (code, teen_id, expires_at) values ('ZZZZZ3', ta1, now() + interval '1 day');
      r := r || text 'FAIL | teen must not create invites';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot create invites';
    end;
    begin
      insert into public.feedback (screen, text) values ('test', 'Teen feedback works');
      r := r || text 'PASS | teen can send feedback';
    exception when others then
      r := r || ('FAIL | teen can send feedback: ' || sqlerrm);
    end;
    begin
      insert into public.feedback (user_id, screen, text) values (pa, 'test', 'Pretending to be the parent');
      r := r || text 'FAIL | teen must not send feedback as someone else';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot send feedback as someone else';
    end;
    begin
      perform public.svc_pin_attempt_success(ta1);
      r := r || text 'FAIL | teen must not call server-only functions';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot call server-only functions';
    end;

    -- ------------------------------------------------------------------ anonymous
    perform pg_temp.as_user(null);
    begin
      perform count(*) from public.teens;
      r := r || text 'FAIL | anonymous must not read teens';
    exception when insufficient_privilege then
      r := r || text 'PASS | anonymous cannot read teens';
    end;
    begin
      perform count(*) from public.families;
      r := r || text 'FAIL | anonymous must not read families';
    exception when insufficient_privilege then
      r := r || text 'PASS | anonymous cannot read families';
    end;
    begin
      insert into public.feedback (screen, text) values ('test', 'anon');
      r := r || text 'FAIL | anonymous must not send feedback';
    exception when insufficient_privilege then
      r := r || text 'PASS | anonymous cannot send feedback';
    end;
    begin
      perform public.svc_join_record_failure(array['ip:test']);
      r := r || text 'FAIL | anonymous must not call server-only functions';
    exception when insufficient_privilege then
      r := r || text 'PASS | anonymous cannot call server-only functions';
    end;

    -- ------------------------------------------------------------------ audit_log is append-only, even for the database owner
    perform pg_temp.as_admin();
    begin
      update public.audit_log set action = 'edited' where family_id = fa;
      r := r || text 'FAIL | audit_log rows must not be editable by anyone';
    exception when raise_exception then
      r := r || text 'PASS | audit_log rows cannot be edited, even by the database owner';
    end;
    begin
      delete from public.audit_log where family_id = fa;
      r := r || text 'FAIL | audit_log rows must not be deletable';
    exception when raise_exception then
      r := r || text 'PASS | audit_log rows cannot be deleted, even by the database owner';
    end;

    -- ------------------------------------------------------------------ PIN lock helper (server-only)
    perform public.svc_pin_attempt_begin(ta1); perform public.svc_pin_attempt_begin(ta1);
    perform public.svc_pin_attempt_begin(ta1); perform public.svc_pin_attempt_begin(ta1);
    perform public.svc_pin_attempt_begin(ta1);
    select count(*) into n from public.teens where id = ta1 and locked_until > now() + interval '14 minutes';
    r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' | 5 PIN attempts lock the teen for 15 minutes');
    select count(*) into n from public.teens
     where id = ta1 and (public.svc_pin_attempt_begin(ta1) ->> 'reason') = 'locked';
    r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' | a 6th attempt is refused while locked');

    -- ------------------------------------------------------------------ teen-join rate-limit helper (server-only)
    for i in 1..9 loop perform public.svc_join_record_failure(array['ip:rls-test']); end loop;
    r := r || (case when public.svc_join_blocked(array['ip:rls-test']) is null then 'PASS' else 'FAIL' end
               || ' | 9 wrong invite codes do not block');
    perform public.svc_join_record_failure(array['ip:rls-test']);
    r := r || (case when public.svc_join_blocked(array['ip:rls-test']) > now() + interval '14 minutes' then 'PASS' else 'FAIL' end
               || ' | the 10th wrong invite code blocks for 15 minutes');

    raise exception 'rls_tests_rollback';
  exception when others then
    if sqlerrm <> 'rls_tests_rollback' then
      r := r || ('ERROR | ' || sqlerrm);
    end if;
  end;
  perform pg_temp.as_admin();
  return query select unnest(r);
end $$;

select * from pg_temp.run_rls_tests();
