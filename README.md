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
- Family waivers: one parent signs once for several children, and themselves
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
- `GET /api/admin/members` - members and sales from Squarespace
- `GET /api/admin/conversion` - how many waiver signers became members (both
  Squarespace routes take `?refresh=true` to skip the half-hour cache)

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

The admin area has three pages behind one sign-in:

- **`/admin`** - home: approve or remove admin accounts, change the passcode,
  and links to the other two pages.
- **`/admin/waiver`** (also `/waiver/admin`) - waiver charts, how many signers
  became members, and the waiver list.
- **`/admin/members`** - members and sales from Squarespace.

Moving between them happens in the page, so a passcode sign-in carries over;
reloading asks for the passcode again. Sign-in offers **Sign in with Google**
above the passcode.

Anyone can sign in with Google, but a new account only files a request: it sees
nothing until an existing admin approves it, and the gym inbox
(`WAIVER_NOTIFY_EMAIL`) is emailed when a request comes in. Admins approve,
deny, and remove people on the admin home page; the Home tab shows how many are
waiting. Removing
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

## Family Waivers

One waiver can cover a parent and their children. The form starts with
**Who's training?** - *Just me*, *My kids*, or *Me and my kids* - then takes the
signer's contact details once, and a card per person: **You** (if the signer
trains) and **Child 1, 2, ...** with "+ Add another child". Each card has a date
of birth and that person's own classes; children start with Kids Classes
ticked. One signature covers everyone.

Behind it, every person gets their own row, so the waiver list, the charts and
conversion stay per person. The rows share a `submission_id`, the contact
details and the signature, and are stored with a single `INSERT`, so a family is
saved whole or not at all. A child's row has the parent in `parent_name`.

- **One PDF** lists everyone, with "Signed by ... as parent or legal guardian
  of ..." under the signature.
- **One email each** to the gym and the parent, not one per child.
- **One follow-up** per family, greeting the parent.
- **One MatTracker call** with the parent as signer and everyone as participants.
- In the admin waiver list, a family's waivers show **Family of N**, and the
  detail panel says who signed and who else was on the same waiver.

The form refuses someone under 18 signing for themselves, and anyone 18 or over
listed as a child - they sign their own. The backend checks both too, allows at
most 10 people per waiver, and still accepts the older one-person form from a
page loaded before this shipped.

## MatTracker Accounts

Each new waiver sets up MatTracker (spartracker) accounts for the people it
covers, so a member's account is waiting the first time they sign in there with
Google on the same email. The backend calls
`POST /api/waiver-signed` with:

- **signer** - whoever signed: the parent when the form has a parent's name,
  otherwise the person themselves, with the waiver's email.
- **participants** - everyone the waiver covers: each child, plus the parent if
  they train (see Family Waivers).
- **waiver_id** - `waiver_<submission id>` (`waiver_<id>` for waivers from
  before family waivers), which MatTracker keys on, so a repeat of the same
  waiver changes nothing.

The call goes out right after the waiver is stored and never fails a signing.
Its outcome is written to the row (`mattracker_synced_at`, `mattracker_error`),
a sweep retries failures every `SPARTRACKER_RETRY_MINUTES` (default 30) for 24
tries - about half a day - and the waiver's detail panel shows the status with a
**Send to MatTracker** button that sends it again by hand. Only waivers signed
after this shipped are sent; older ones show "Not sent - signed before MatTracker
sync", and the button still works for them.

| Variable | Purpose |
| --- | --- |
| `SPARTRACKER_WAIVER_URL` | The endpoint, under `email:` in the Helm values |
| `SPARTRACKER_WAIVER_TOKEN` | Bearer token MatTracker issued for this app only - in `app-secrets` |
| `SPARTRACKER_RETRY_MINUTES` | How often failures are retried (default `30`) |

With either of the first two unset nothing is sent, and waivers signed meanwhile
go out once both are present. Docker Compose leaves them unset, so a local run
never creates real accounts. To add the token to the cluster:

```bash
kubectl -n gravitas patch secret app-secrets \
  -p '{"stringData":{"SPARTRACKER_WAIVER_TOKEN":"<token>"}}'
kubectl -n gravitas rollout restart deploy/backend
```

## Admin Dashboard

The waiver page (`/admin/waiver`) shows a set of charts above the waiver list:

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

- **Waivers to members** - with Squarespace connected, how many waiver signers
  went on to pay, how long it typically took, by the month they signed, and
  split by whether they were sent the one-week follow-up. Waivers are matched
  to membership charges by email; a charge up to a day before signing still
  counts (people pay on the spot), Add Child counts, and anyone who had paid
  before signing is left out as an existing or past member. Only these counts
  reach the waiver page - never the member list.

In the waiver list, each waiver is tagged **Kid** or **Adult** with its age
today, from the date of birth - anyone older than 13 is an adult. With
Squarespace connected, waivers whose signer went on to pay are **blue** with a
"Became a member" tag (every waiver a family signed under the same email is
marked), existing members are tagged "Already a member", and the detail panel
says when they joined. A filter above the list shows all waivers, adults, kids,
or just the ones that became members.

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

With `SQUARESPACE_API_KEY` set, the membership page (`/admin/members`) shows
members and sales read from the Squarespace Orders API:

- **Tiles** - current members, children added, joined and left this month, and
  monthly membership revenue (what current members pay each month, Add Child
  included, with annual plans spread over twelve months); then sales this month
  and over the last 12 months, split by category.
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

**Coaches are left out.** Coaches train free on a 100%-off discount ("Coach",
"Coach 2"). Any membership charge carrying a discount with the word "coach" in
its name is ignored - it adds nothing to the member count, the chart, the
member table, or waiver conversion - and the member count's tile says how many
coaches were left out. Name a new coach discount with "Coach" in it and it is
excluded automatically. Other discounts ("2 class", "Military") still count:
those people pay.

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
