# Teen Investing App: Test App Scope and Data Model (27 Nov 2026)

Where this file and `CLAUDE.md` differ, `CLAUDE.md` wins. (For the test, parent two-step verification uses an authenticator app instead of SMS, and the teen PIN is handled through an Edge Function rather than a `pin_hash` column.)

## Purpose
The test app turns Prototype v6 into a real, installable app with logins and saved data, so the two founders can test it end to end on their own phones before anyone outside sees it. All investing uses practice money: no broker, no real payments, no real ETF prices.

- **One app, two logins:** a parent login (owns the family account) and a teen login. Each sees only their side; both stay in sync.

## In scope (from v6)
### Parent
- Sign-up and login with two-step verification.
- Family setup: add teens (nickname, age band, avatar) and get an invite code for each.
- Home (portfolio): practice value and chart, holdings, the teen's milestone and learning, recent activity.
- Approvals: tasks, shout-outs, task ideas, and module credits when automatic credits are off.
- Invest: practice wallet; Invest now on any listed ETF; steady plan; milestones; orders waiting for the market.
- Family settings: tasks and credit values; proof type (note or check-in); family perk; module credits on or off; show real values to the teen.
- Approval log: read-only.

### Teen
- Login: invite code once, then username and PIN.
- Garden: time slider, monthly weather and calm market notes, progress to the next milestone.
- Tasks: mark done with a note, try again after "Not yet", suggest a task, send shout-outs.
- Learn: 12 modules in 6 topics, 10 questions each, pass at 8 out of 10.
- Journey: credits over time, milestones, badges.

### Both
- Live sync: a change on one side shows on the other within seconds.
- Installable from a link, with a feedback button on every screen.

## Out of scope for now
| Left out | Why it waits |
| --- | --- |
| Real money, a broker, PayTo, identity checks | Need a licensed partner and legal review first |
| Real ETF names and live prices | Need a licensed data feed; made-up ETFs are enough |
| Selling | Keeps the first build small |
| Subscription and billing | Not needed for internal testing |
| Push notifications | In-app badges are enough |
| Photo proof for tasks | Avoids storing children's photos |
| Second parent or guardian | One parent per family for the test |
| Growth-to-18 illustration | Needs legal wording checked first |
| Demo controls (Next month, Market dip, Jump to, review notes) | Real time replaces them |
| App store versions | The installable web app is enough |
| Public holiday calendar | Weekends only |

## Key rules
1. Credits are points: 1 credit = $1 of the family's pledge. Earned from tasks, shout-outs and passed modules. No cap.
2. "Not yet" never costs anything; the teen sees the reason and can retry.
3. Milestones: parent sets the amount (at least $100, no upper limit). Each level needs that many credits. On approval, that amount moves from the practice wallet into the milestone plan and the next learning topic unlocks.
4. Steady plan: amount, frequency (weekly, fortnightly, monthly), ETF split, auto-invest amount (at least $100). Practice money added on the due day at 9 am Sydney time; invested once the auto-invest amount is reached.
5. Invest now: any listed ETF with free wallet cash. Minimum $50 per ETF (one setting).
6. Market hours: Mon–Fri 10:00–16:00 Sydney. Inside: fill instantly at the current price. Outside: wait for the next open with a countdown. Waiting orders can be cancelled, except milestone orders.
7. Prices: made-up, one per ETF per trading day, from a server job using v6's priceSource. The app reads prices only from its own database.
8. Modules: 10 questions, pass at 8/10, 3 credits on the first pass only. Retakes reshuffle.
9. Teen view: no dollar amounts unless "show real values" is on. The garden never shrinks. Weather updates monthly.
10. Audit log: every approval and money action recorded (who, what, when, how much). Never edited or deleted.

## Screens
**Parent (11):** Sign up · Log in · Add teen and invite code · Home · Approvals · Invest · ETF details and buy · Family settings · Approval log · Account (password, switch teen, delete family data, privacy policy) · Feedback

**Teen (7):** Join with code · Log in · Garden · Tasks, ideas and shout-outs · Learn (topics, key points, quiz, result) · Journey · Feedback

## Data model
All tables use RLS. Parents see and change their own family's data. Teens see their own rows and can only add submissions, ideas, shout-outs and quiz attempts. All money and credit changes happen in server code.

| Table | Main fields | Access |
| --- | --- | --- |
| families | id, name, created_at, module_auto_credit | Its parent |
| parents | id (auth user), family_id, display_name, consent_at | Self |
| teens | id (auth user), family_id, nickname, age_band, avatar, username, show_real_values, consent_at, failed_pin_count, locked_until | Parent: all; teen: own row, read |
| invites | code, teen_id, expires_at, used_at | Parent |
| tasks | id, teen_id, title, category, credits, repeats, proof_type (none, note, check-in), due_date, status | Parent: all; teen: read |
| task_submissions | id, task_id, note, submitted_at, decision, reason, credits_given, decided_at | Parent: decide; teen: add |
| task_ideas | id, teen_id, title, credits_asked, status, final_title, final_credits | Parent: decide; teen: add |
| shoutouts | id, teen_id, text, status, credits_given, decided_at | Parent: decide; teen: add |
| credit_ledger | id, teen_id, change, reason, source_type, source_id, created_at | Read; server adds |
| module_attempts | id, teen_id, module_id, score, answers, created_at | Read; teen adds |
| module_progress | teen_id, module_id, best_score, passed_at, credit_status | Read; server updates |
| milestones | id, teen_id, level, amount, credits_total, perk, reached_at, approved_at | Parent: approve; teen: read |
| plans | teen_id, kind (milestone, steady), etf_split, amount, frequency, auto_amount, active | Parent |
| wallets | teen_id, free_cash, steady_cash | Parent; server updates |
| orders | id, teen_id, kind (now, steady, milestone), amount, status (waiting, filled, cancelled), placed_at, filled_at | Parent; server fills |
| order_lines | order_id, etf_code, amount, units, price | Parent; teen reads if real values are shown |
| etfs | code, name, category, fee, risk, description | Everyone reads |
| prices | etf_code, date, price | Everyone reads; server adds |
| audit_log | id, family_id, actor, action, amount, created_at | Parent reads; server adds only |
| feedback | id, user_id, screen, text, created_at | App owner only |

Holdings are calculated from order_lines. Module questions and the made-up ETF list are seeded from the v6 code. One plan and one wallet per teen.

## Privacy and safety
- Parent consent ticked when a teen is created, saved with the date.
- Teen data: nickname, age band (13–17), avatar, username, PIN. No email, phone, date of birth, photos or location.
- Parent can reset the teen's PIN.
- No ads, no third-party trackers, no chat, no public profiles. Usage counted inside the app only.
- Database in Supabase's Sydney region.
- Plain-English privacy policy plus a teen-friendly version.
- A "Delete our family's data" button.
- "Practice money" on every money screen; general-information notes wherever an ETF is named.

## Done when (whole test app)
- A parent signs up, adds a teen, and gets an invite code.
- The teen joins and logs in on another phone.
- Task submission and approval sync between phones within 5 seconds.
- "Not yet" sends the reason, and the teen can retry.
- A milestone can be approved and invested, and the next topic unlocks.
- The steady plan auto-invests at its amount.
- Invest now fills during market hours, and waits with a countdown outside them.
- A module pass gives 3 credits once.
- Two test families cannot see each other's data.
- Every approval and money action appears in the audit log.
- Deleting family data removes everything.
- The app installs from a link on iPhone and Android.

## Numbers to record (for the later family test)
Families active each week · Tasks approved per family per week · Time from submission to decision · Modules passed per teen · Families using the steady plan or Invest now · Feedback messages and errors
