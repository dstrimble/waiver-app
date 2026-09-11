# Waiver App

A standalone waiver submission app with e-signature support.

## Stack

- Frontend: React + Vite (served by nginx in containers)
- Backend: Node.js + Express
- Database: PostgreSQL
- Local orchestration: Docker Compose
- Deploy manifests: Kubernetes YAML in `k8s/`

## Features

- Guest information intake
- Interest selection (BJJ, Kickboxing, MMA, Kids Classes)
- Waiver and release section based on your current form
- Drawn signature capture (touch/mouse)
- Submission persisted to PostgreSQL
- Signed waiver emailed as a PDF to the gym and to the person who signed
- Follow-up instructions for signing up and managing an account
- Automatic "how was your trial week?" email a week after signing
- Admin dashboard: signup trends, interest mix, referral sources, age bands
- Admin can send the trial follow-up early, or archive a waiver
- Admin members and sales from Squarespace: members over time, current
  members, and monthly sales split into memberships, retail and events
- Admin listing endpoint secured by passcode header

## Run Locally With Docker

```bash
docker compose up --build
```

Then open http://localhost:8090.

## Run Locally Without Docker

```bash
cd backend
npm install
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=waiver_app ADMIN_PASSCODE=changeme npm run dev

# In another terminal:
cd frontend
npm install
npm run dev
```

## API

- `GET /healthz` - health check
- `GET /api/waivers/text` - waiver copy rendered by the public form
- `POST /api/waivers` - submit a waiver
- `GET /api/admin/waivers` - list submissions (requires `x-admin-passcode`)
- `GET /api/admin/stats` - aggregates for the admin charts
- `POST /api/admin/waivers/:id/followup` - send the trial follow-up now
- `POST /api/admin/waivers/:id/archive` - hide a waiver, keeping the record
- `POST /api/admin/waivers/:id/restore` - bring an archived waiver back
- `GET /api/admin/squarespace` - members and sales from Squarespace
  (`?refresh=true` skips the half-hour cache)

- `GET /api/admin/auth/config` - which Google client the sign-in button uses
- `POST /api/admin/auth/google` - trade a Google ID token for a session, or
  file an access request
- `GET /api/admin/users` - Google accounts with access or waiting for it
- `POST /api/admin/users/:id/approve` / `DELETE /api/admin/users/:id` - approve,
  deny, or remove

Apart from the two `auth/config` and `auth/google` routes, every `/api/admin/*`
route needs either the `x-admin-passcode` header or a Google session token as
`Authorization: Bearer <token>`.

## Admin Sign-In

The admin page lives at `/admin` (the old `/waiver/admin` redirects there). It
offers **Sign in with Google** above the passcode.

Anyone can sign in with Google, but a new account only files a request: it sees
nothing until an existing admin approves it, and the gym inbox
(`WAIVER_NOTIFY_EMAIL`) is emailed when a request comes in. Admins approve,
deny, and remove people under **Admin access** at the top of the page. Removing
someone ends their sessions immediately; they can ask again, and it takes a
fresh approval. Nobody can remove themselves, so there is always someone left.

An approved Google admin stays signed in for 30 days on that browser. The
passcode keeps working as before - it is how the first Google account gets
approved, and the way back in if Google sign-in is ever unavailable.

### Setup

1. In the Google Cloud console, create an **OAuth client ID** of type **Web
   application**.
2. Under **Authorized JavaScript origins** add the site's origin, e.g.
   `https://gravitas.trimblebarra.com`, plus `http://localhost`,
   `http://localhost:8090` and `http://localhost:5173` for local work. There is
   no redirect URI - the button hands the page a signed token and the backend
   verifies it.
3. Set the OAuth consent screen to **External** and publish it; only the basic
   name and email scopes are used, so no review is needed. Left in testing, only
   listed test users can sign in.
4. Put the client ID in `GOOGLE_CLIENT_ID` - under `email:` in the Helm values.
   It is not a secret; the client secret is never used.

## Waiver Confirmation Emails

On each submission the backend renders the signed waiver as a PDF and emails it
to two places over SMTP:

1. **The gym** (`WAIVER_NOTIFY_EMAIL`, default `gravitasmma@gmail.com`) - a
   summary of the submission with the PDF attached. Reply-To is the guest.
2. **The person who signed** - a confirmation with the same PDF attached, plus
   whichever sign-up and account-management links are configured.

Sending happens *after* the waiver is stored, so a mail outage never costs you a
submission. Failures are logged and written to `notification_error` on the row,
and the admin page shows the delivery status for each waiver.

If the SMTP settings are unset the app runs normally and skips sending with a
warning - handy for local development.

### SMTP credentials

Sending uses a Gmail **app password** on the sending account - the same
credential and env var names as the spartracker deployment, so one app password
covers both apps.

1. Enable 2-Step Verification on `gravitasmma@gmail.com`.
2. Create an app password at
   [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
3. Put the 16-character value in `SMTP_PASSWORD`.

| Variable | Required | Value |
| --- | --- | --- |
| `SMTP_HOST` | yes | `smtp.gmail.com` |
| `SMTP_PORT` | no | `587` (default). `465` switches to implicit TLS |
| `SMTP_STARTTLS` | no | `true` (default) |
| `SMTP_USER` | yes | `gravitasmma@gmail.com` |
| `SMTP_PASSWORD` | yes | the app password, not the account password |
| `SMTP_FROM` | yes | `Gravitas Mixed Martial Arts <gravitasmma@gmail.com>` |

Leave `SMTP_HOST` or `SMTP_FROM` empty and nothing is sent - waivers still save
and the skip is logged, which is how local development runs.

### Gym details and account links

All optional. Each unset value is simply left out of the email rather than
rendered as a placeholder; with no links set at all, the email tells the guest
to ask a coach at the front desk.

| Variable | Purpose |
| --- | --- |
| `WAIVER_NOTIFY_EMAIL` | Where the gym copy is sent (default `gravitasmma@gmail.com`) |
| `MAIL_REPLY_TO` | Reply-To on the guest's email (defaults to the notify address) |
| `GYM_NAME` | Name used in the PDF and emails |
| `GYM_SHORT_NAME` | Short name for the follow-up email copy (defaults to `GYM_NAME`) |
| `GYM_PHONE` | Shown under "Questions?" |
| `GYM_ADDRESS` | Shown under "Questions?" |
| `GYM_WEBSITE_URL` | Shown under "Questions?" |
| `SIGNUP_URL` | "Sign up for a membership" link |
| `ACCOUNT_PORTAL_URL` | "Manage your account" link (billing, contact details) |
| `SCHEDULE_URL` | "Class schedule" link |
| `DISPLAY_TIMEZONE` | Timezone for PDF timestamps (default `America/New_York`) |

`SMTP_PASSWORD` goes in the `app-secrets` Kubernetes secret; everything else
lives under `email:` in the Helm values. To add the app password to the existing
cluster secret without a full redeploy:

```bash
kubectl -n gravitas patch secret app-secrets \
  -p '{"stringData":{"SMTP_PASSWORD":"<app password>"}}'
kubectl -n gravitas rollout restart deploy/backend
```

## One-Week Follow-Up Email

A week after someone signs, the backend emails them again - asking how the free
trial week went and inviting them to become a member. It carries the same
sign-up, account, and schedule links as the confirmation email, so nothing they
were given up front goes missing. No PDF is attached; the confirmation already
delivered that.

A sweep runs every `FOLLOWUP_POLL_MINUTES` and picks up every waiver that has
come due since the last one. Each waiver is claimed in the database before its
email is sent, so a guest is never emailed twice - not by two backend replicas,
and not by two overlapping sweeps. A failed send releases the claim and is
retried on the next sweep, with the reason stored in `followup_error` on the
row. The admin page shows the follow-up status alongside the waiver's.

**Only waivers signed after this feature is deployed are ever followed up.**
Everyone already in the table is marked ineligible the moment the column is
created, so turning this on never mails your back catalogue. The admin page
shows those as "Not scheduled - signed before follow-ups".

Separately, a waiver stops being eligible `FOLLOWUP_GRACE_DAYS` after it comes
due. That stops a batch of stale nudges going out once the service has been
down for a while - a month-late "how was your trial week?" helps nobody.

| Variable | Purpose |
| --- | --- |
| `FOLLOWUP_ENABLED` | `true` (default). Set `false` to turn the follow-up off |
| `FOLLOWUP_DELAY_DAYS` | How long after signing to send (default `7`) |
| `FOLLOWUP_GRACE_DAYS` | How long a due waiver stays eligible (default `3`) |
| `FOLLOWUP_POLL_MINUTES` | How often the sweep runs (default `60`) |
| `FOLLOWUP_BATCH_SIZE` | Most waivers handled per sweep (default `50`) |
| `GYM_SHORT_NAME` | Conversational name in the copy (defaults to `GYM_NAME`) |

Sending reuses the same SMTP settings and links as the confirmation email; with
SMTP unset the sweep logs a warning and does nothing. Docker Compose ships with
`FOLLOWUP_ENABLED=false` so a local database of old waivers cannot mail anyone.

## Admin Dashboard

Unlocking the admin page loads a set of charts above the waiver list:

- **Headline tiles** - waivers all time, last 30 days, last 7 days, and how many
  follow-ups have gone out (with the number still awaiting their week).
- **Waivers signed over time** - a line, weekly or monthly, over 90 days / 12
  months / all time. The closing period is usually incomplete, so it is drawn
  dashed and labelled "to date" rather than looking like a collapse.
- **Interests over time** - stacked columns per class. This counts *selections*,
  not people: one waiver can tick several classes, so the stack totals run
  higher than the waiver count. The chart says so under its title.
- **How they heard about us** - the free-text field, grouped ignoring case
  (`Facebook`/`facebook`/`FACEBOOK` become one bar) and showing whichever
  spelling was most common. "Not specified" and the folded tail sit in neutral
  grey so they do not compete with real referral sources.
- **Age when signing** and **which day people sign** - useful for programming
  kids' classes and for staffing the front desk.

Every chart has a "Show data" toggle that swaps it for the underlying table, so
nothing is locked behind colour or hover.

The colours come from the `--viz-*` tokens in `frontend/src/styles.css` and were
run through a contrast/colour-vision validator against the chart surface - the
comment above them says so. Re-run it if you change them.

Aggregates are computed in SQL by `backend/src/waiverStats.js` and served from
`GET /api/admin/stats`. That endpoint deliberately returns counts only: the
waiver rows carry a base64 signature image each, which has no business crossing
the wire to draw a chart. Archived waivers are excluded from every figure.

### Sending a follow-up early, and archiving

Selecting a waiver reveals two actions:

**Send follow-up now** emails the trial follow-up immediately instead of waiting
out the week - handy for someone who is ready to join, or to reach a waiver
signed before the feature existed. It claims the row exactly as the automatic
sweep does, so **the automatic send is cancelled and nobody receives two**. The
button disables itself once a follow-up has gone out.

**Archive waiver** takes a waiver out of circulation without destroying it. An
archived waiver disappears from the list, drops out of every chart, and is
skipped by the follow-up sweep - but the signed record and its signature stay in
the database, because that record is the document you would rely on in a
dispute. Nothing in the app issues a `DELETE` against a waiver.

Archiving is one click and reversible: the confirmation message carries an Undo,
"Show archived" in the filter bar brings archived waivers back into the list
marked with a badge, and **Restore waiver** returns one to normal. Under the
hood it is a single `archived_at` timestamp; restoring clears it.

If you ever need a genuine erasure - someone asking for their data to be removed
outright - that is a deliberate database operation, not something the admin page
can do by accident.

## Members and Sales (Squarespace)

With `SQUARESPACE_API_KEY` set, the admin page adds a members and sales section
below the waiver charts, read from the Squarespace Orders API:

- **Tiles** - current members, children added, joined and left this month, and
  members all time; then sales this month and over the last 12 months, split by
  category.
- **Members over time** - members and children added at the end of each month.
- **Current members** - everyone paying now, with their plan, whether they pay
  for Add Child, when they joined, what they pay, and their last charge.
- **Sales by month** - stacked columns of memberships, retail and events.

### How membership is worked out

Squarespace has no "is a member" flag - Member Areas plans show up as orders,
one when someone joins and one per renewal. So each paid charge is taken to
cover its plan for a month, plus a week's grace for a late renewal; a charge
of $500 or more is a year paid up front and covers a year. A member counts
until their last charge runs out, and someone who comes back later counts as
joining again. Refunded charges cover nothing.

**Add Child is counted apart from members.** It is billed as its own plan, but
it is an add-on to a parent's membership, so it has its own line on the chart
and its own column in the table, and never adds to the member count.

### How sales are worked out

Sales are what was paid after discounts, before tax and shipping; refunded
orders are left out. Squarespace only records discounts against a whole order,
so a discount is spread across the order's lines by size. Categories:

- **Memberships** - Member Areas plans, including Add Child.
- **Events** - rank reviews and seminars (products named "Rank Review" or
  "Seminar"). Name a new event product that way and it is counted as one.
- **Retail** - everything else, including the gear pre-orders that were set up
  as services.

### Setup

API keys need the Squarespace **Commerce Advanced** plan. In Squarespace, go to
Settings > Developer API Keys, generate a key, and give it **Orders: Read Only**
- nothing else is used. Then add it to the cluster secret:

```bash
kubectl -n gravitas patch secret app-secrets \
  -p '{"stringData":{"SQUARESPACE_API_KEY":"<key>"}}'
kubectl -n gravitas rollout restart deploy/backend
```

Without the key the section says Squarespace is not connected and everything
else works as before. Fetching every order takes a few seconds, so the result is
cached in the backend for half an hour; **Refresh** fetches a new copy.

## Waiver Text

The waiver copy lives in `backend/src/waiverText.js` and is served to the public
form over `GET /api/waivers/text`. Editing it there updates the on-screen form
and the emailed PDF together, so the two can never disagree. Bump
`WAIVER_TEXT_VERSION` when the language changes - each submission stores the
version it was signed under.

## Important Legal Note

This app mirrors your existing waiver language for operational convenience. You should have legal counsel review and approve the final text for enforceability in your jurisdiction.
