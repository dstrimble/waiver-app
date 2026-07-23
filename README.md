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
- `POST /api/waivers` - submit a waiver
- `GET /api/admin/waivers` - list submissions (requires `x-admin-passcode`)

## Important Legal Note

This app mirrors your existing waiver language for operational convenience. You should have legal counsel review and approve the final text for enforceability in your jurisdiction.
