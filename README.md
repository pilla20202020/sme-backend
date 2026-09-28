# uw-backend — Underwriting REST API

NestJS REST API powering the L713 insurance underwriting and enrollment platform. Handles SSO-based admin authentication, RBAC, member management, policy enrollment workflows, job scheduling, and audit logging.

## Tech Stack

- **Framework:** [NestJS](https://nestjs.com/) v11 (TypeScript)
- **Database:** PostgreSQL (`uw` database)
- **ORM:** [Prisma](https://www.prisma.io/) v7 with `@prisma/adapter-pg`
- **Auth:** JWT (`@nestjs/jwt`) + Passport + SSO
- **Validation:** `class-validator` / `class-transformer`
- **Password hashing:** `bcrypt`

## Project Structure

```
src/
├── auth/                    # SSO session exchange, JWT verification, RBAC guards/decorators
│   ├── guards/               # JwtAuthGuard, RolesGuard, PermissionsGuard
│   └── dto/
├── users/                    # Admin users module (CRUD + RBAC)
├── modules/
│   ├── enrollments/           # Core underwriting/enrollment domain — controllers, use-cases,
│   │                          #   services, repositories, mappers, member-portal guards, jobs
│   ├── dashboard/              # Summary + pipeline-stats endpoints for the admin dashboard
│   └── activity-logs/          # Audit-trail logging for enrollment/user actions
├── infrastructure/            # Outbound adapters to external systems
│   ├── nuera/                  # NueraBenefits sync (policy status, plan switch)
│   ├── benefit-store/          # Plan catalog / pricing lookups
│   ├── message-center/         # Transactional email sending + delivery-status polling
│   ├── ai-recommendation/      # AI medical-recommendation client
│   └── s3/                     # Signature/contract PDF storage (AWS S3)
├── job-queue/                 # Internal async job queue (DB-backed) + worker/scheduler
├── prisma/                    # PrismaService & module
└── common/
    ├── dto/                    # Shared DTOs (e.g. pagination)
    ├── interceptors/            # TransformInterceptor (response envelope)
    ├── pipes/, logger/, eligibility/, utils/
prisma/
├── schema.prisma              # Database schema (25 tables, 7 enums)
├── seed.ts                    # Seed script with realistic dummy data
├── migrations/                # Prisma migration history
└── prisma.config.ts
docs/                          # Deep-dive design docs (auth, RBAC, user provisioning, full auth flow)
schema-docs.html                # Interactive schema documentation (open in browser)
```

## Database Schema

The schema covers the full underwriting and enrollment lifecycle. See [`schema-docs.html`](schema-docs.html) for an interactive reference with hover tooltips on every column.

### Table Groups

| Group | Tables |
|---|---|
| **RBAC** | `roles`, `permissions`, `users` (admin staff), `user_roles`, `role_permissions` |
| **Members** | `members` (policy holders — no login, personal info only) |
| **Agents & Groups** | `agents`, `groups` |
| **Plans** | `plans` |
| **Enrollment** | `l713_enrollments`, `enrollment_status_history`, `enrollment_notes`, `plan_selections`, `browser_metadata` |
| **Communication** | `email_logs`, `automated_reminders`, `signatures` |
| **Audit** | `data_access_log` |
| **Jobs** | `jobs`, `job_logs`, `recurring_job_schedules` |
| **Legacy** | `policies`, `pending_underwriting_status`, `underwriting_questions`, `enrollment_signature`, `enrollment_status_change_log`, `email_send_log` |

> **Admin users vs Members:** `users` table = SSO-authenticated admin staff (underwriters, support, admins). `members` table = policy holders (personal/demographic data only, no login).

## API Reference

Every route is served under a global `/api/v1` prefix (see `src/main.ts`). Highlights:

| Method | Path                              | Description                                    |
|--------|-----------------------------------|-------------------------------------------------|
| POST   | /api/v1/auth/session               | Exchange an SSO access token for a session cookie |
| GET    | /api/v1/auth/me                    | Current authenticated user's profile             |
| GET    | /api/v1/users                      | List admin users (paginated)                     |
| POST   | /api/v1/users                      | Create an admin user                             |
| GET    | /api/v1/dashboard                  | Dashboard summary widgets                        |
| GET    | /api/v1/enrollments                | List/filter/sort enrollments                     |
| POST   | /api/v1/enrollments/change-status  | Approve/reject/revert/activate an enrollment     |
| GET    | /api/v1/email-logs                 | List an enrollment's email log                   |
| POST   | /api/v1/webhooks/enrollments       | NueraBenefits webhook — create enrollment (HMAC-signed) |
| POST   | /api/v1/open/update-policy-status/:policyId | NueraBenefits policy-status push (public) |

This is a small sample — the full endpoint-by-endpoint reference (auth requirements, request/response schemas, curl examples) lives in [`aaid_artifacts/docs/api-reference.md`](aaid_artifacts/docs/api-reference.md). A live, interactive Swagger UI is also mounted at `/api/docs` whenever the app is running.

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL (database name: `uw`, default port `5432`)
- npm

### Installation

```bash
npm install
```

### Environment Setup

Create a `.env` file in the project root. **Never commit real values** — the checked-in `.env` in this repo currently holds live QA/prod secrets and should be rotated and removed from version control.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (used directly by `PrismaService` and `prisma.config.ts`) |
| `APP_URL` | Yes | This service's own public origin; sent as the `origin` header to Nuera/Benefit Store/Message Center clients |
| `PORT` | No (default `3000`) | HTTP port the app listens on |
| `NODE_ENV` | No | `production` enables secure cookies and enforces `FRONTEND_URL` being set |
| `FRONTEND_URL` | Yes in production | Comma-separated list of allowed CORS origins |
| `SSO_JWKS_URI` (or `AUTH_JWKS_URI`) | Yes | JWKS endpoint for RS256 SSO token verification |
| `SSO_APP_INIT_URI` | No | SSO app-init endpoint used by the auth flow |
| `SSO_ISSUER` (or `AUTH_ISSUER`) | Recommended | Expected JWT `iss` claim |
| `SSO_AUDIENCE` (or `AUTH_AUDIENCE`) | Recommended | Expected JWT `aud` claim |
| `WEBHOOK_SECRET` | Yes | HMAC key validating inbound `POST /webhooks/enrollments` calls from NueraBenefits |
| `NUERA_SYSTEM_API_URL` / `NUERA_SYSTEM_API_KEY` | Yes | NueraBenefits API base URL + key (policy sync, plan switch) |
| `MESSAGE_CENTER_API_URL` / `MESSAGE_CENTER_API_KEY` | Yes | Message Center API base URL + key (transactional email sending/status) |
| `BENEFIT_STORE_API_URL` / `BENEFIT_STORE_API_KEY` | Yes | Benefit Store API base URL + key (plan catalog/pricing) |
| `MED_DETAILS_URL` / `AI_RECOMMENDATION_TOKEN` | Yes | AI recommendation service base URL + auth token |
| `MEMBER_PORTAL_JWT_SECRET` | Yes | Signs the short-lived (30 min) member-portal session token |
| `MEMBER_PORTAL_URL` | Yes | Base URL used when building member-portal links sent by email |
| `AWS_REGION` / `AWS_S3_BUCKET` / `AWS_S3_URL` | Yes | S3 bucket for signature images and generated contract PDFs (uses the default AWS SDK credential chain — no access keys in `.env`) |
| `LOG_DIR` / `LOG_LEVEL` | No | Winston logger output directory / level (`src/common/logger/winston.config.ts`) |

Notes:

- `SSO_JWKS_URI` is required for RS256 token verification; `SSO_ISSUER`/`SSO_AUDIENCE` are optional but strongly recommended. Legacy aliases `AUTH_JWKS_URI`, `AUTH_ISSUER`, and `AUTH_AUDIENCE` are also supported (`SSO_*` takes precedence).
- AWS S3 credentials come from the standard SDK credential provider chain (IAM role, shared config, or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env vars) — do not hardcode keys in `.env` (a prior incident required removing hardcoded S3 keys from the codebase, see `CHANGELOG.md`).

### Database Setup

```bash
# Apply all migrations
npx prisma migrate deploy

# Seed with dummy data (roles, users, members, enrollments, jobs, etc.)
npx prisma db seed

# (Optional) Open Prisma Studio
npx prisma studio
```

### Running the App

```bash
# Development
npm start

# Watch mode (auto-reload)
npm run start:dev

# Production
npm run start:prod
```

The server starts on **http://localhost:3000**.

## Scripts

| Command                  | Description                              |
|--------------------------|------------------------------------------|
| `npm run build`          | Compile TypeScript to `dist/`            |
| `npm run start:dev`      | Start with file watching                 |
| `npm run start:debug`    | Start with debugger attached             |
| `npm run lint`           | Lint and auto-fix source files           |
| `npm run format`         | Format source files with Prettier        |
| `npx prisma migrate dev` | Create and apply a new migration         |
| `npx prisma db seed`     | Populate database with seed data         |
| `npx prisma studio`      | Open Prisma Studio (visual DB browser)   |

## Seed Data

Running `npx prisma db seed` populates:

- 4 roles, 10 permissions, 4 admin users (wired with role permissions)
- 2 groups, 2 agents, 3 plans
- 3 members (Jane Collins, Robert Harmon, Maria Gutierrez)
- 3 enrollments in various statuses (approved, under_review, active)
- Status history, notes, plan selections, email logs, signatures
- 3 jobs (completed, pending, failed) + job logs + 3 recurring schedules

Seed is idempotent for reference data (roles, users, plans, groups); re-running adds new log/history rows. Use `npx prisma migrate reset` to wipe and reseed from scratch.

## Testing

```bash
# Unit tests
npm test

# Watch mode
npm run test:watch

# e2e tests
npm run test:e2e

# Coverage report
npm run test:cov
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for recent notable changes.

## License

UNLICENSED


