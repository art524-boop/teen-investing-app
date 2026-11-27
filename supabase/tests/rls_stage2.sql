-- Stage 2 RLS and decision tests (tasks, submissions, ideas, shout-outs, credit ledger).
--
-- Run: paste into the Supabase SQL editor (or the MCP execute_sql tool). Builds two test
-- families, checks every rule, then rolls everything back. Every row should start with PASS.

create or replace function pg_temp.as_user(p_claims jsonb)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', coalesce(p_claims, '{}'::jsonb)::text, true);
  perform set_config('app.in_decision', '', true);
  if p_claims is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
end $$;

create or replace function pg_temp.as_admin()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.in_decision', '', true);
end $$;

create or replace function pg_temp.res(ok boolean, name text)
returns text language sql as $$ select (case when ok then 'PASS' else 'FAIL' end) || ' | ' || name $$;

create or replace function pg_temp.run_stage2_tests()
returns table (result text)
language plpgsql as $$
declare
  r text[] := '{}';
  pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid();
  ta1 uuid := gen_random_uuid(); ta2 uuid := gen_random_uuid(); tb1 uuid := gen_random_uuid();
  fa uuid; fb uuid;
  c_pa jsonb; c_pa1 jsonb; c_pb jsonb; c_ta1 jsonb;
  n bigint; s text; j jsonb;
  task_note uuid; task_check uuid; task_sib uuid; task_b uuid; task_big uuid;
  sub1 uuid; sub2 uuid; idea1 uuid; idea2 uuid; shout1 uuid; shout2 uuid;
begin
  begin
    -- ------------------------------------------------------------ fixtures
    perform pg_temp.as_admin();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (pa, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's2-a-' || pa || '@example.com', '',
       '{"provider":"email"}', '{"family_name":"S2 Family A","display_name":"Sam","consent":"true"}', now(), now()),
      (pb, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's2-b-' || pb || '@example.com', '',
       '{"provider":"email"}', '{"family_name":"S2 Family B","display_name":"Bea","consent":"true"}', now(), now());
    select (raw_app_meta_data ->> 'family_id')::uuid into fa from auth.users where id = pa;
    select (raw_app_meta_data ->> 'family_id')::uuid into fb from auth.users where id = pb;
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      (ta1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ta1 || '@teens.invalid', '', jsonb_build_object('role', 'teen', 'family_id', fa), '{}', now(), now()),
      (ta2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ta2 || '@teens.invalid', '', jsonb_build_object('role', 'teen', 'family_id', fa), '{}', now(), now()),
      (tb1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', tb1 || '@teens.invalid', '', jsonb_build_object('role', 'teen', 'family_id', fb), '{}', now(), now());
    insert into public.teens (id, family_id, nickname, age_band, avatar, username, consent_at) values
      (ta1, fa, 'Mia', 14, 'koala', 's2test_a1', now()),
      (ta2, fa, 'Leo', 16, 'owl', 's2test_a2', now()),
      (tb1, fb, 'Bo', 15, 'fox', 's2test_b1', now());

    c_pa  := jsonb_build_object('sub', pa, 'role', 'authenticated', 'aal', 'aal2', 'app_metadata', jsonb_build_object('role', 'parent', 'family_id', fa));
    c_pa1 := jsonb_build_object('sub', pa, 'role', 'authenticated', 'aal', 'aal1', 'app_metadata', jsonb_build_object('role', 'parent', 'family_id', fa));
    c_pb  := jsonb_build_object('sub', pb, 'role', 'authenticated', 'aal', 'aal2', 'app_metadata', jsonb_build_object('role', 'parent', 'family_id', fb));
    c_ta1 := jsonb_build_object('sub', ta1, 'role', 'authenticated', 'aal', 'aal1', 'app_metadata', jsonb_build_object('role', 'teen', 'family_id', fa));

    select count(*) into n from public.tasks where teen_id = ta1;
    r := r || pg_temp.res(n = 6, 'a new teen gets the 6 example tasks from v6 (' || n || ')');
    select count(*) into n from public.tasks where teen_id = ta1 and proof_type not in ('none', 'note', 'check-in');
    r := r || pg_temp.res(n = 0, 'no photo proof anywhere');
    select id into task_note from public.tasks where teen_id = ta1 and title = 'Read for 30 minutes, four times';
    select id into task_check from public.tasks where teen_id = ta1 and title = 'Wash the car';
    select id into task_sib from public.tasks where teen_id = ta2 limit 1;
    select id into task_b from public.tasks where teen_id = tb1 limit 1;

    -- ------------------------------------------------------------ parent A: tasks
    perform pg_temp.as_user(c_pa);
    select count(*) into n from public.tasks;
    r := r || pg_temp.res(n = 12, 'parent A sees both of their teens'' tasks (' || n || ')');
    select count(*) into n from public.tasks where family_id = fb;
    r := r || pg_temp.res(n = 0, 'parent A cannot see family B''s tasks');
    insert into public.tasks (teen_id, title, category, credits, repeats, proof_type)
    values (ta1, 'Big job', 'Home', 50000, 'none', 'none') returning id into task_big;
    r := r || pg_temp.res(task_big is not null, 'parent A adds a task (any number of credits: no cap)');
    select count(*) into n from public.audit_log where action = 'task_added' and family_id = fa;
    r := r || pg_temp.res(n = 1, 'adding a task is written to audit_log');
    begin
      insert into public.tasks (teen_id, title, credits) values (tb1, 'Sneaky', 5);
      r := r || text 'FAIL | parent A must not add tasks for family B''s teen';
    exception when insufficient_privilege then
      r := r || text 'PASS | parent A cannot add tasks for family B''s teen';
    end;
    update public.tasks set credits = 12 where id = task_check;
    get diagnostics n = row_count;
    r := r || pg_temp.res(n = 1, 'parent A edits a task''s credits');
    update public.tasks set credits = 99 where id = task_b;
    get diagnostics n = row_count;
    r := r || pg_temp.res(n = 0, 'parent A cannot edit family B''s task');
    begin
      update public.tasks set status = 'done' where id = task_check;
      r := r || text 'FAIL | parent must not mark a task done by hand';
    exception when raise_exception then
      r := r || text 'PASS | parent cannot mark a task done by hand (only through approval)';
    end;
    begin
      insert into public.credit_ledger (teen_id, change, reason, source_type) values (ta1, 100, 'gift', 'adjustment');
      r := r || text 'FAIL | parent must not write the ledger directly';
    exception when insufficient_privilege then
      r := r || text 'PASS | parent cannot write the credit ledger directly';
    end;

    -- ------------------------------------------------------------ teen A1
    perform pg_temp.as_user(c_ta1);
    select count(*) into n from public.tasks;
    r := r || pg_temp.res(n = 7, 'teen sees only their own tasks (' || n || ')');
    select count(*) into n from public.tasks where id in (task_sib, task_b);
    r := r || pg_temp.res(n = 0, 'teen cannot see a sibling''s or another family''s tasks');
    begin
      insert into public.task_submissions (task_id, note) values (task_note, '');
      r := r || text 'FAIL | a note task needs a note';
    exception when raise_exception then
      r := r || text 'PASS | a "note" task needs a note';
    end;
    insert into public.task_submissions (task_id, note) values (task_note, 'Read 4 chapters') returning id into sub1;
    r := r || pg_temp.res(sub1 is not null, 'teen marks their own open task done (with a note)');
    perform pg_temp.as_admin();
    select status into s from public.tasks where id = task_note;
    r := r || pg_temp.res(s = 'submitted', 'the task is now "submitted"');
    perform pg_temp.as_user(c_ta1);
    begin
      insert into public.task_submissions (task_id, note) values (task_note, 'again');
      r := r || text 'FAIL | a task waiting for the parent cannot be sent twice';
    exception when raise_exception then
      r := r || text 'PASS | a task waiting for the parent cannot be sent twice';
    end;
    begin
      insert into public.task_submissions (task_id, note) values (task_sib, 'not mine');
      r := r || text 'FAIL | teen must not submit a sibling''s task';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot submit a sibling''s task';
    end;
    begin
      insert into public.task_submissions (task_id, note, decision) values (task_check, 'x', 'approved');
      r := r || text 'FAIL | teen must not set a decision';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot set "decision" on a submission';
    end;
    begin
      insert into public.task_submissions (task_id, note, credits_given) values (task_check, 'x', 1000);
      r := r || text 'FAIL | teen must not set credits_given';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot set "credits_given" on a submission';
    end;
    begin
      update public.task_submissions set decision = 'approved', credits_given = 1000 where id = sub1;
      r := r || text 'FAIL | teen must not approve their own work by editing it';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot approve their own work by editing the submission';
    end;
    begin
      perform public.decide_submission(sub1, 'approve');
      r := r || text 'FAIL | teen must not call decide_submission';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot approve their own work (decide_submission refuses)';
    end;
    begin
      insert into public.credit_ledger (teen_id, change, reason, source_type) values (ta1, 1000, 'free', 'adjustment');
      r := r || text 'FAIL | teen must not write to the ledger';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot write to the credit ledger';
    end;
    update public.tasks set credits = 999 where id = task_check;
    get diagnostics n = row_count;
    r := r || pg_temp.res(n = 0, 'teen cannot change a task''s credits');
    insert into public.task_ideas (title, credits_asked) values ('Wash the dog', 12) returning id into idea1;
    insert into public.task_ideas (title, credits_asked) values ('Sort the garage', 30) returning id into idea2;
    insert into public.shoutouts (text) values ('Helped Mrs Lee carry her shopping') returning id into shout1;
    insert into public.shoutouts (text) values ('Walked the neighbour''s dog') returning id into shout2;
    r := r || pg_temp.res(idea1 is not null and shout1 is not null, 'teen sends task ideas and shout-outs');
    begin
      insert into public.shoutouts (text, status) values ('x', 'approved');
      r := r || text 'FAIL | teen must not set a shout-out''s status';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot set a shout-out''s status';
    end;
    begin
      update public.task_ideas set status = 'approved' where id = idea1;
      r := r || text 'FAIL | teen must not approve their own idea';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot approve their own idea';
    end;
    begin
      perform public.decide_shoutout(shout1, 'approve', 100);
      r := r || text 'FAIL | teen must not call decide_shoutout';
    exception when insufficient_privilege then
      r := r || text 'PASS | teen cannot approve their own shout-out';
    end;

    -- ------------------------------------------------------------ other parents
    perform pg_temp.as_user(c_pa1);
    begin
      perform public.decide_submission(sub1, 'approve');
      r := r || text 'FAIL | a parent without two-step must not decide';
    exception when insufficient_privilege then
      r := r || text 'PASS | a parent without two-step verification cannot decide';
    end;
    perform pg_temp.as_user(c_pb);
    select (select count(*) from public.task_submissions) + (select count(*) from public.task_ideas)
         + (select count(*) from public.shoutouts) + (select count(*) from public.credit_ledger)
         + (select count(*) from public.tasks where family_id = fa) into n;
    r := r || pg_temp.res(n = 0, 'family B cannot see family A''s tasks, submissions, ideas, shout-outs or credits (' || n || ')');
    begin
      perform public.decide_submission(sub1, 'approve');
      r := r || text 'FAIL | family B must not decide family A''s work';
    exception when raise_exception then
      r := r || text 'PASS | family B cannot decide family A''s work';
    end;

    -- ------------------------------------------------------------ parent A decides
    perform pg_temp.as_user(c_pa);
    select count(*) into n from public.task_submissions where decision = 'pending';
    r := r || pg_temp.res(n = 1, 'parent A sees the pending submission');
    j := public.decide_submission(sub1, 'approve');
    j := public.decide_submission(sub1, 'approve');
    r := r || pg_temp.res((j ->> 'already_decided')::boolean, 'a second approve (double-tap) is a no-op');
    select count(*) into n from public.credit_ledger where source_id = sub1;
    r := r || pg_temp.res(n = 1, 'approve adds credits exactly once');
    select balance into n from public.teen_balances where teen_id = ta1;
    r := r || pg_temp.res(n = 5, 'balance = sum of the ledger (' || n || ')');
    perform pg_temp.as_admin();
    select status || '/' || coalesce(to_char(reopen_at at time zone 'Australia/Sydney', 'Dy HH24:MI'), 'none') into s from public.tasks where id = task_note;
    r := r || pg_temp.res(s = 'done/Mon 00:00', 'an approved weekly task is done until Monday 00:00 Sydney (' || s || ')');
    update public.tasks set reopen_at = now() - interval '1 minute' where id = task_note;
    perform private.reopen_weekly_tasks();
    select status into s from public.tasks where id = task_note;
    r := r || pg_temp.res(s = 'open', 'the weekly task reopens when the new week starts');

    -- Not yet
    perform pg_temp.as_user(c_ta1);
    insert into public.task_submissions (task_id) values (task_check) returning id into sub2;
    r := r || pg_temp.res(sub2 is not null, 'a check-in task is sent with a single tap (no note)');
    perform pg_temp.as_user(c_pa);
    begin
      perform public.decide_submission(sub2, 'not_yet', '  ');
      r := r || text 'FAIL | Not yet needs a reason';
    exception when raise_exception then
      r := r || text 'PASS | "Not yet" needs a reason';
    end;
    perform public.decide_submission(sub2, 'not_yet', 'Nearly there, finish it off');
    perform pg_temp.as_user(c_ta1);
    select reason into s from public.task_submissions where id = sub2;
    r := r || pg_temp.res(s = 'Nearly there, finish it off', 'the teen sees the "Not yet" reason');
    select status into s from public.tasks where id = task_check;
    r := r || pg_temp.res(s = 'open', 'after "Not yet" the task is open again to retry');
    select balance into n from public.teen_balances where teen_id = ta1;
    r := r || pg_temp.res(n = 5, '"Not yet" costs nothing (balance still ' || n || ')');
    insert into public.task_submissions (task_id) values (task_check);
    r := r || text 'PASS | the teen can try again';

    -- No cap
    insert into public.task_submissions (task_id) values (task_big) returning id into sub2;
    perform pg_temp.as_user(c_pa);
    perform public.decide_submission(sub2, 'approve');
    select balance into n from public.teen_balances where teen_id = ta1;
    r := r || pg_temp.res(n = 50005, 'no cap on credits (balance ' || n || ')');

    -- Shout-outs
    perform public.decide_shoutout(shout1, 'approve', 5);
    perform public.decide_shoutout(shout1, 'approve', 5);
    select count(*) into n from public.credit_ledger where source_id = shout1;
    r := r || pg_temp.res(n = 1, 'shout-out approved with 5 credits, once');
    perform public.decide_shoutout(shout2, 'not_yet', null, null);
    select status || ': ' || reason into s from public.shoutouts where id = shout2;
    r := r || pg_temp.res(s like 'not_yet: Thanks for telling me%', 'shout-out "Not yet" keeps a kind reason');
    select balance into n from public.teen_balances where teen_id = ta1;
    r := r || pg_temp.res(n = 50010, 'balance after shout-outs (' || n || ')');

    -- Ideas
    j := public.decide_idea(idea1, 'approve', 'Wash and dry the dog', 15);
    select count(*) into n from public.tasks where teen_id = ta1 and title = 'Wash and dry the dog' and credits = 15 and status = 'open';
    r := r || pg_temp.res(n = 1, 'approving an idea (with edits) creates a real task');
    perform public.decide_idea(idea2, 'decline');
    select status into s from public.task_ideas where id = idea2;
    r := r || pg_temp.res(s = 'declined', 'declining an idea closes it');
    select count(*) into n from public.tasks where title = 'Sort the garage';
    r := r || pg_temp.res(n = 0, 'a declined idea creates no task');

    -- Audit
    select string_agg(distinct action, ',' order by action) into s from public.audit_log
     where family_id = fa and action in ('task_approved', 'task_not_yet', 'shoutout_approved', 'shoutout_not_yet', 'idea_approved', 'idea_declined');
    r := r || pg_temp.res(s = 'idea_approved,idea_declined,shoutout_approved,shoutout_not_yet,task_approved,task_not_yet',
                          'every kind of decision is in audit_log (' || coalesce(s, 'none') || ')');

    -- Teen still can't see family B, and sees own ledger only
    perform pg_temp.as_user(c_ta1);
    select count(*) into n from public.credit_ledger where teen_id <> ta1;
    r := r || pg_temp.res(n = 0, 'teen sees only their own credit history');

    -- Anonymous
    perform pg_temp.as_user(null);
    begin
      perform count(*) from public.tasks;
      r := r || text 'FAIL | anonymous must not read tasks';
    exception when insufficient_privilege then
      r := r || text 'PASS | anonymous cannot read tasks';
    end;
    begin
      perform public.decide_idea(idea1, 'approve');
      r := r || text 'FAIL | anonymous must not decide';
    exception when insufficient_privilege then
      r := r || text 'PASS | anonymous cannot call decision functions';
    end;

    raise exception 'stage2_tests_rollback';
  exception when others then
    if sqlerrm <> 'stage2_tests_rollback' then
      r := r || ('ERROR | ' || sqlerrm);
    end if;
  end;
  perform pg_temp.as_admin();
  return query select unnest(r);
end $$;

select * from pg_temp.run_stage2_tests();
