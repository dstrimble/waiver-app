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

## Waiver Text

The waiver copy lives in `backend/src/waiverText.js` and is served to the public
form over `GET /api/waivers/text`. Editing it there updates the on-screen form
and the emailed PDF together, so the two can never disagree. Bump
`WAIVER_TEXT_VERSION` when the language changes - each submission stores the
version it was signed under.

## Important Legal Note

This app mirrors your existing waiver language for operational convenience. You should have legal counsel review and approve the final text for enforceability in your jurisdiction.
