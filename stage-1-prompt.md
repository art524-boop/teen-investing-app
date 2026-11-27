# Stage 1 prompt — paste this into Claude Code

Read `CLAUDE.md`, `docs/scope.md` and `reference/prototype-v6.html` first. Then build **Stage 1: logins and family setup**. Show me your plan before you write code, and wait for my "go".

## Set up
1. Create a React + TypeScript + Vite app with PWA support (manifest, service worker, app icons) and the v6 colours and fonts.
2. Use the Supabase plugin to create (or connect to) a project in the **Sydney** region. Set up the Supabase CLI with `supabase/migrations/` and `supabase/functions/`.
3. Use the Netlify plugin to create a site linked to this GitHub repo, with deploy previews on. Put the Supabase URL and anon key in Netlify environment variables. Add `.env.example`.

## Database (migration 001)
Create these tables with RLS on:
- `families` (id, name, created_at, module_auto_credit default true)
- `parents` (id = auth user id, family_id, display_name, consent_at)
- `teens` (id = auth user id, family_id, nickname, age_band, avatar, username unique, show_real_values default false, consent_at, failed_pin_count, locked_until)
- `invites` (code, teen_id, expires_at, used_at)
- `audit_log` (id, family_id, actor, action, amount, created_at) — insert only through server code; no update or delete for anyone
- `feedback` (id, user_id, screen, text, created_at) — anyone signed in can add; only the app owner can read

RLS rules:
- A parent can read and change rows in their own family only.
- A teen can read their own `teens` row and their family's name, nothing else. Teens cannot update their own row.
- Write SQL tests (pgTAP or a script) proving family A cannot see family B, and a teen cannot read another teen.

## Edge Functions
- `create-teen` (parent only): creates the teen's auth user (synthetic email, `app_metadata` role `teen` + `family_id`), the `teens` row, and a 6-character invite code that expires in 7 days. Records consent and writes to `audit_log`.
- `teen-join`: takes an invite code, the chosen username and a 6-digit PIN. Checks the code is valid and unused, sets the auth password to `HMAC(TEEN_PIN_SECRET, PIN)`, marks the code used, returns a session.
- `teen-login`: username + PIN. Locks for 15 minutes after 5 wrong tries. Returns a session.
- `reset-teen-pin` (parent only): sets a new PIN for their own teen and writes to `audit_log`.
- `TEEN_PIN_SECRET` lives only in Supabase function secrets.

## Screens (match v6 styling)
**Parent**
1. Sign up: name, email, password, family name. Then set up an authenticator app (Supabase MFA, TOTP).
2. Log in: email + password, then the 6-digit authenticator code.
3. Add teen: nickname, age band (13–17), avatar picker, and a consent tick box ("I am this teen's parent or guardian and I agree to the privacy policy"). Shows the invite code with a copy button and its expiry.
4. A placeholder Home that lists the family's teens, with "Reset PIN" and "New invite code" for each.
5. Account: change password, log out.

**Teen**
1. Join with code: invite code → choose username → choose PIN (enter twice).
2. Log in: username + PIN, with a clear message when locked ("Try again in 15 minutes or ask your parent to reset your PIN").
3. A placeholder Garden that shows "Hi <nickname>" and the family name.

**Both**
- A start screen: "I'm a parent" / "I'm a teen".
- The app remembers who is signed in on that phone and opens the right side.
- A feedback button on every screen that saves to `feedback`.
- A "Practice app — no real money" banner.

## Done when
- [ ] I can sign up as a parent on one phone, set up the authenticator, and log back in.
- [ ] I can add a teen and get an invite code.
- [ ] On a second phone, the teen joins with the code, sets a username and PIN, and lands on the Garden.
- [ ] The teen can log out and back in with username + PIN; 5 wrong PINs lock the account for 15 minutes.
- [ ] The parent can reset the teen's PIN, and the old PIN stops working.
- [ ] A second test family cannot see the first family's data (RLS tests pass).
- [ ] Teen creation, consent and PIN resets appear in `audit_log`.
- [ ] The app is live on a Netlify link and installs to the home screen on iPhone and Android.
- [ ] No secrets in the repo.

When finished, tell me: the live link, how to run it locally, what you tested, and anything you changed from this plan and why.
