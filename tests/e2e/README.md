# Stage 1 end-to-end tests

Three layers of tests, all against the real Supabase project:

| Test | What it covers | How to run |
| --- | --- | --- |
| `supabase/tests/rls_stage1.sql` | 54 row-level-security checks: family A can't see family B, teens can't read each other or write anything, audit log is append-only (but goes with its family on delete-data), PIN lock and join rate-limit helpers | Paste into the Supabase SQL editor. It rolls itself back. Every row should say PASS. |
| `tests/e2e/stage1-api.mjs` | 48 checks through the real Edge Functions: two-step verification, add teen, join, log in, 5-wrong-PIN lock, PIN reset, new invite, audit log, join rate limit | `NODE_USE_ENV_PROXY=1 node --env-file=.env tests/e2e/stage1-api.mjs` (the proxy variable is only needed behind a proxy) |
| `tests/e2e/stage1-ui.mjs` | 22 checks with two emulated phones (iPhone 13 + Pixel 7) walking the whole Stage 1 loop in the browser, plus PWA manifest and service worker | `npm run build && npm run preview`, then `node tests/e2e/stage1-ui.mjs` |

## Test accounts

Parent sign-up needs a real email confirmation, so the tests use throwaway parents created
directly in the database (SQL editor). Use an `@example.com` address and a password you keep
out of the repo:

```sql
-- One confirmed parent. Run once per test parent; change the email, names and password.
with u as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'e2e-parent-a@example.com', extensions.crypt('<password>', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"E2E Parent A","family_name":"E2E Family A","consent":"true"}', now(), now(),
    '', '', '', '', '', '', '', '')
  returning id, email)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       'email', now(), now(), now() from u;
```

Environment for the scripts:

- `E2E_PASSWORD` – the test parents' password
- `E2E_PARENT_A`, `E2E_PARENT_B` – two fresh parents (API test; they must not have an authenticator yet)
- `E2E_PARENT_C` – a fresh parent for the UI test (no authenticator yet)
- `APP_URL` – defaults to `http://localhost:4173`
- `PW_CHROMIUM` – path to an installed Chromium if Playwright's own download is missing
- `SHOTS` – optional folder for screenshots

The API test ends with the join rate-limit check, which blocks your IP from joining for 15
minutes. Clear it afterwards with `delete from private.join_blocks; delete from private.join_failures;`.

## Cleaning up test data

```sql
begin;
set local app.deleting_family = 'on';  -- lets audit_log rows go with their family
delete from auth.users where id in (
  select t.id from public.teens t join public.families f on f.id = t.family_id where f.name like 'E2E%');
delete from auth.users where email like 'e2e-parent-%@example.com';
delete from public.families where name like 'E2E%';
commit;
```
