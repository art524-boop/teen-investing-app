# Teen Investing App (working name) — project guide for Claude Code

A gamified family investing app for Australian teens. A parent invests for their teen; the teen earns credits by doing tasks and passing learning modules, and credits unlock milestone investments. This repo is the **test app**: real logins and saved data, but **practice money only** (no broker, no real payments, no real ETF prices). Only the two founders test it for now.

The design reference is `reference/prototype-v6.html` (a single-file prototype). Match its screens, wording, colours and behaviour. Its JavaScript engine (wallet, orders, market clock, milestones, steady plan, modules, garden) is the source of truth for the rules below.

## Stack
- React + TypeScript + Vite, built as an installable web app (PWA: manifest, service worker, icons).
- Supabase: Auth, Postgres with row-level security (RLS), Realtime, Edge Functions. Region: Sydney (ap-southeast-2).
- Netlify hosting, deployed from GitHub. Each pull request gets a preview link.
- Plain CSS (or CSS modules) with the v6 colour variables. No UI framework unless asked.

## Working rules
- Plan first, then build. Show the plan and wait for "go" before large changes.
- Build in stages (see "Stages"). Finish and verify one stage before starting the next.
- All database changes are SQL migrations in `supabase/migrations/`. Never edit tables by hand in the dashboard.
- Every table has RLS on. Write an RLS test for each table (a parent from family A cannot read family B; a teen cannot write money or credit tables).
- All money and credit changes happen in server code (Postgres functions or Edge Functions), never directly from the phone.
- Secrets live in Supabase/Netlify environment variables. Nothing secret in the repo. Commit `.env.example`, never `.env`.
- Ask before creating anything that costs money (paid plans, SMS providers, custom domains).
- Accessibility: 44px tap targets, visible focus, labels on every input, reduced-motion support, works with a screen reader.
- Every money screen says "Practice money". Wherever an ETF is named, show a short general-information note.

## Users and logins (one app, two logins)
- **Parent:** email + password, plus two-step verification with an authenticator app (Supabase MFA, TOTP). SMS codes come later; they cost money.
- **Teen:** no email. Joins once with a parent's invite code, then logs in with a username + 6-digit PIN.
  - Each teen is a Supabase Auth user with `app_metadata.role = 'teen'` and `family_id`, created only by an Edge Function.
  - The teen's auth email is synthetic and non-routable (`<teen_id>@teens.invalid`). The auth password is `HMAC(server_secret, PIN)`, computed only inside the Edge Function, so the PIN alone can never be used against Supabase Auth directly.
  - The `teen-login` Edge Function checks the username, counts failures (lock for 15 minutes after 5 wrong PINs), then signs in and returns the session.
  - The parent can reset a teen's PIN (Edge Function).
- Parents have `app_metadata.role = 'parent'`. RLS policies use the role and `family_id` from the JWT.

## Key rules (from v6)
1. Credits are points; 1 credit stands for $1 of the family's pledge. Earned from tasks, shout-outs and passed modules. **No cap** on credits.
2. "Not yet" never costs anything; the teen sees the reason and can retry.
3. Milestones: the parent sets the amount (at least $100, **no upper limit**). Each level needs that many credits. On parent approval, that amount moves from the practice wallet into the milestone plan and the next learning topic unlocks.
4. Steady plan: parent sets amount, frequency (weekly, fortnightly, monthly), ETF split, and an auto-invest amount (at least $100). Practice money is added on the due day at 9 am Sydney time and invested once the auto-invest amount is reached.
5. Invest now: buy any listed ETF with free wallet cash. Minimum $50 per ETF (one setting).
6. Market hours: Mon–Fri 10:00–16:00 Sydney time. Inside: fill instantly at the current price. Outside: wait for the next open with a countdown. Waiting orders can be cancelled, except milestone orders. Weekends only (no public holidays yet).
7. Prices: made-up, one per ETF per trading day, created by a scheduled server job using v6's `priceSource` logic. The app only reads prices from its own database.
8. Modules: 10 questions, pass at 8/10, 3 credits on the first pass only. Retakes reshuffle questions and answers.
9. Teen view: no dollar amounts unless the parent turns on "show real values". The garden never shrinks. Weather updates monthly.
10. Audit log: every approval and money action is recorded (who, what, when, how much). Never edited or deleted.

## Data model (20 tables; create each in the stage that needs it)
families, parents, teens, invites, tasks, task_submissions, task_ideas, shoutouts, credit_ledger, module_attempts, module_progress, milestones, plans, wallets, orders, order_lines, etfs, prices, audit_log, feedback.
Field lists are in `docs/scope.md`. Holdings are calculated from order_lines. Module questions and the made-up ETF list are seeded from the v6 code.

## Privacy
- Teen data: nickname, age band (13–17), avatar, username, PIN only. No email, phone, date of birth, photos or location.
- Parent consent is ticked when a teen is added and saved with the date.
- No ads, no third-party trackers or analytics, no chat, no public profiles.
- A "Delete our family's data" button removes everything, including auth users.

## Stages
1. Logins and family setup
2. Tasks, approvals, "Not yet", shout-outs, task ideas — live sync between phones
3. Learn modules and credits
4. Practice wallet, prices, Invest now, market hours, steady plan, milestones
5. Garden, Journey, Home portfolio
6. Audit log screen, delete-data, privacy pages, feedback, PWA polish
