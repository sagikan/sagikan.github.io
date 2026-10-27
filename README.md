# <b style="color:#e8ebf3">Applicant Zer</b><img src="frontend/public/favicon.svg" alt="" height="20" align="abstop" />

[![Deploy](https://github.com/sagikan/sagikan.github.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/sagikan/sagikan.github.io/actions/workflows/deploy.yml)
[![CI](https://github.com/sagikan/sagikan.github.io/actions/workflows/ci.yml/badge.svg)](https://github.com/sagikan/sagikan.github.io/actions/workflows/ci.yml)

<ul style="padding-left: 15;">
    <li>Log every application from submission to offer</li>
    <li>Discover matching openings</li>
    <li>Tailor your resume to each one with Claude</li>
    <li>Let your inbox update application statuses for you</li>
</ul>

## Stack

| Layer | Tech |
|---|---|
| Frontend | React single-page app built with Vite (JS, plain CSS) |
| Backend | Node.js/Express REST API with cookie-based sessions and two-factor authentication |
| Database | PostgreSQL |
| AI | Resume parsing and tailoring, job scoring, and email classification with Claude (Anthropic API)
| Job data | JSearch and company job boards |
| Email | Brevo or SMTP for outgoing mail; Apps Script for incoming job mails |
| Hosting | GitHub Pages (frontend) and Render (backend, database) |
| CI/CD & Ops | GitHub Actions, Dependabot, and encrypted daily database backups |

## Repo Layout

```
.
├── backend/
│   ├── schema.sql           # full database schema (safe to re-run)
│   ├── scripts/             # reset-db.js
│   └── src/
│       ├── server.js        # entry point: middleware, routes, daily cleanup
│       ├── config/          # database connection and SSL
│       ├── middleware/      # auth, CSRF, rate limits, security headers
│       ├── routes/          # one file per API area
│       └── services/        # business logic by domain
│           ├── ai/  applications/  auth/  email/  jobs/  resume/  shared/
├── frontend/
│   └── src/
│       ├── App.jsx, main.jsx, index.css
│       ├── lib/             # API client, hash router
│       ├── pages/           # one file per route
│       ├── components/      # ui/, layout/, applications/, auth/, jobs/
│       ├── hooks/  utils/   # shared hooks; helpers grouped by feature
│       └── gmailSync/       # Apps Script source shown to users
└── .github/                 # workflows and Dependabot config
```

## API overview

| Prefix | Area |
|---|---|
| `/auth` | Register, login, email verification, TOTP setup and verify, password reset, logout |
| `/account` | Security status, recovery codes, 2FA reset, account deletion |
| `/applications` | CRUD for tracked applications |
| `/jobs` | Discovered jobs, search, dismiss, resume tailoring, apply, resume profile, additional PDF uploads |
| `/email` | Gmail sync status, token, settings, review of suggested updates |
| `/email/ingest` | Token-authenticated endpoint called by the Apps Script |
| `/health` | Liveness check |

> • All routes live under `/api`.<br>
> • Rate limits, request size limits, and per-field length limits are enforced server-side.

## Security Notes

<ul style="padding-left: 15;">
    <li>Passwords hashed with bcrypt; sessions in HTTP-only cookies; CSRF token and origin check on writes.</li>
    <li>TOTP secrets are encrypted at rest; recovery codes are stored hashed.</li>
    <li>Frontend ships a strict Content Security Policy; the API sends restrictive security headers.</li>
    <li>Outgoing fetches of job postings go through a safe-fetch helper.</li>
    <li>The Gmail script has read-only scope and never modifies mail.</li>
    <li>.npmrc disables install scripts and enforces a minimum package age.</li>
</ul>
