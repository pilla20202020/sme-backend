# uw-backend API Reference

Base URL: `http(s)://<host>/api/v1` — a global prefix `api` plus URI versioning (`defaultVersion: '1'`) is applied to every route in [`src/main.ts`](../../src/main.ts), so every path below already includes `/api/v1`.

## Conventions

**Response envelope.** Every successful response passes through the global `TransformInterceptor` ([`src/common/interceptors/transform.interceptor.ts`](../../src/common/interceptors/transform.interceptor.ts)):
- `null`/`undefined` results (e.g. `204` responses) pass through unchanged.
- A handler that already returns `{ data, meta }` becomes `{ success: true, data, meta }` (paginated lists).
- Any other value becomes `{ success: true, data: <value> }`.

The "Response" sections below describe the `data` payload inside that envelope unless stated otherwise.

**Validation errors.** The global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `forbidUnknownValues`, `transform`) rejects bad input with `400`:
```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "errors": [{ "field": "email", "messages": ["email must be an email"], "value": "not-an-email" }]
}
```

**Global guard chain.** Registered once as `APP_GUARD` providers in `app.module.ts`, in this order, on every route: `ThrottlerGuard` (60 requests / 60s) → `JwtAuthGuard` → `RolesGuard` → `PermissionsGuard`. Routes opt out with `@Public()`.

## Auth model

| Mechanism | Where | Used for |
|---|---|---|
| **`JwtAuthGuard`** | `src/auth/jwt-auth.guard.ts` | Default admin session. Reads the `uw_access_token` httpOnly cookie (issued by `POST /auth/session`), verifies it, resolves the internal user (cached 30s), attaches `request.user`. Throws `401 Unauthorized` on a missing/invalid cookie or an inactive user. |
| **`@Public()`** | `src/auth/public.decorator.ts` | Skips `JwtAuthGuard` entirely for a route/controller. |
| **`RolesGuard` + `@Roles(...)`** | `src/auth/guards/roles.guard.ts` | User's `roles[]` must contain at least one listed role, else `403 Forbidden`. No-op if absent. |
| **`PermissionsGuard` + `@Permissions(...)`** | `src/auth/guards/permissions.guard.ts` | User's `permissions[]` must contain **all** listed permissions, else `403 Forbidden`. No-op if absent. |
| **`@CurrentUser()`** | `src/auth/decorators/current-user.decorator.ts` | Param decorator injecting `request.user`. |
| **`PortalSessionGuard`** | `src/modules/enrollments/guards/portal-session.guard.ts` | Separate member-portal auth. Reads `Authorization: Bearer <token>` — a 30-minute JWT signed with `MEMBER_PORTAL_JWT_SECRET`, issued by `POST /member/questions/verify-otp`. Attaches `request.portalUser`. Always paired with `@Public()`. |
| **`HmacGuard`** | `src/modules/enrollments/guards/hmac.guard.ts` | Validates inbound NueraBenefits webhooks via HMAC-SHA256 over the raw body, using `WEBHOOK_SECRET`. Requires `X-Signature-256` (`sha256=<hex>`), `X-Nonce`, `X-Timestamp` (±5 min skew); rejects replayed nonces (5 min cache). |

---

## Auth

### POST /api/v1/auth/session
Exchange an SSO access token for a local session; sets the `uw_access_token` cookie.
- **Auth:** `@Public()`
- **Body** (`CreateSessionDto`): `access_token: string` (required, non-empty)
- **Response `201`:** `{ userId, sub, email, firstName, lastName, roles: string[], permissions: string[] }`
- **Errors:** `401` invalid/expired/malformed token; `404` SSO user not found or inactive
```bash
curl -X POST http://localhost:3000/api/v1/auth/session \
  -H 'Content-Type: application/json' \
  -d '{"access_token":"<sso-jwt>"}'
```

### POST /api/v1/auth/logout
Clears the session cookie.
- **Auth:** `@Public()`
- **Response `204`:** no body
```bash
curl -X POST http://localhost:3000/api/v1/auth/logout --cookie "uw_access_token=<token>"
```

### GET /api/v1/auth/me
Current authenticated user's profile.
- **Auth:** `JwtAuthGuard` (cookie)
- **Response `200`:** `{ userId, sub, email, firstName, lastName, roles: string[], permissions: string[] }`
- **Errors:** `401` unauthenticated
```bash
curl http://localhost:3000/api/v1/auth/me --cookie "uw_access_token=<token>"
```

---

## Users

### POST /api/v1/users
Create an admin-provisioned user.
- **Auth:** `@Roles('admin')` + `@Permissions('user:create')`
- **Body** (`CreateUserDto`): `ssoUserId: number` (required), `email: string` (required, email, ≤255), `firstName: string` (required, ≤100), `lastName: string` (required, ≤100), `phone?: string` (≤50), `isActive?: boolean`
- **Response `201`:** `SafeUser` — `{ userId, ssoUserId, email, firstName, lastName, phone: string|null, isActive, lastLoggedInAt, createdAt, updatedAt }`
- **Errors:** `409` duplicate email/SSO id; `403` missing role/permission; `401` unauthenticated
```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H 'Content-Type: application/json' --cookie "uw_access_token=<token>" \
  -d '{"ssoUserId":42,"email":"jane@example.com","firstName":"Jane","lastName":"Doe"}'
```

### GET /api/v1/users
List admin users, paginated.
- **Auth:** `@Roles('admin')` + `@Permissions('user:read')`
- **Query** (`PaginationQueryDto`): `page?: number` (default 1), `per_page?: number` (default 25, max 100)
- **Response `200`:** `{ data: SafeUser[], meta: { total, page, per_page, total_pages } }`
```bash
curl "http://localhost:3000/api/v1/users?page=1&per_page=25" --cookie "uw_access_token=<token>"
```

---

## Dashboard

### GET /api/v1/dashboard
Summary widgets: status counts, recent enrollments/activity, weekly trend, rejection breakdown, attention queue.
- **Auth:** any authenticated user (cookie)
- **Response `200`:**
```json
{
  "counts": {},
  "recentEnrollments": [],
  "recentActivity": [],
  "weeklyEnrollments": [],
  "rejectionBreakdown": { "declined_by_uw": 0, "declined_by_member": 0 },
  "attentionQueue": {}
}
```
```bash
curl http://localhost:3000/api/v1/dashboard --cookie "uw_access_token=<token>"
```

### GET /api/v1/dashboard/pipeline-stats
Enrollment counts by status over time, for the pipeline chart.
- **Auth:** any authenticated user (cookie)
- **Query** (`PipelineStatsDto`): `timeframe?: 'weekly'|'monthly'|'yearly'` (default `weekly`), `startDate?: string` (weekly only, must be a Monday), `year?: number` (monthly only, ≥2025)
- **Response `200`:** `{ labels: string[], series: { name: string, data: number[] }[] }` (one series per status: `pending_underwriting`, `pending_response`, `pending_signature`, `ready_to_activate`, `active`, `declined_by_uw`, `declined_by_member`)
- **Errors:** `400` if `startDate` used outside `weekly`, `year` used outside `monthly`, or `startDate` isn't a Monday
```bash
curl "http://localhost:3000/api/v1/dashboard/pipeline-stats?timeframe=monthly&year=2026" --cookie "uw_access_token=<token>"
```

---

## Enrollments

### GET /api/v1/enrollments
List enrollments with filtering, sorting, pagination; enriched with AI recommendation data and (for `active`) S3 contract download links.
- **Auth:** any authenticated user (cookie)
- **Query** (`ListEnrollmentsDto`): `status?: pending_underwriting|pending_response|pending_signature|ready_to_activate|active|declined_by_uw|termed|declined_by_member`, `search?: string`, `sort_by?: enrollDate|name|premium|status|lastUpdated` (default `lastUpdated`), `sort_dir?: asc|desc` (default `desc`), plus pagination
- **Response `200`:** `{ data: EnrollmentListItem[], meta: { total, page, per_page, total_pages, counts } }`
```bash
curl "http://localhost:3000/api/v1/enrollments?status=pending_underwriting&page=1" --cookie "uw_access_token=<token>"
```

### POST /api/v1/enrollments/change-status
Transition an enrollment's status (approve / reject / revert / activate / etc.), syncing to Nuera and firing notification emails.
- **Auth:** any authenticated user (cookie)
- **Body** (`ChangeEnrollmentStatusDto`): `policyId: number` (required), `newStatus: APPROVE|ASK_QUESTION|ANSWER_QUESTION|SIGN_RECEIVED|ACTIVATE|REJECT|REVERT|DECLINE_BY_MEMBER` (required), `rejection_reason?: string|null` (only for `REJECT`)
- **Response `200`:** `{ success: true, policyId, previousStatus, currentStatus }`
- **Errors:** `404` unknown `policyId`; `400` invalid transition; `500` if the Nuera sync call fails
```bash
curl -X POST http://localhost:3000/api/v1/enrollments/change-status \
  -H 'Content-Type: application/json' --cookie "uw_access_token=<token>" \
  -d '{"policyId":123,"newStatus":"APPROVE"}'
```

### POST /api/v1/enrollments/approve
Approve a `pending_underwriting` enrollment: persists plan/pricing selection, moves it to `pending_signature`, sends the approval email.
- **Body** (`ApproveEnrollmentDto`): `policyId: number` (required), `planIds: string[]` (required), `tier: string` (required)
- **Response `200`:** `{ success, policyId, previousStatus, currentStatus }`
- **Errors:** `404` enrollment/plan not found; `400` wrong current status

### GET /api/v1/enrollments/policy-report
Fetch a policy report from Nuera.
- **Query** (`FetchPolicyReportDto`): `policyId: number` (required, positive int)
- **Response `200`:** `PolicyReportDataDto` (Nuera passthrough)
- **Errors:** `500` on upstream Nuera failure; `400` invalid query

### POST /api/v1/enrollments/edit-plan
Edit plan selection for a `pending_signature` enrollment without changing its status.
- **Body:** same as `/approve` (`ApproveEnrollmentDto`)
- **Response `200`:** `{ success: true, policyId }`
- **Errors:** `404` enrollment/plan not found; `400` wrong current status

### GET /api/v1/enrollments/l713-plans
Fetch available plans from the Benefit Store for a policy.
- **Query** (`FetchL713PlansDto`): `policyId: number` (required, positive int)
- **Response `200`:** `GetL713PlansResponseDto` (Benefit Store passthrough)
- **Errors:** `500` on upstream failure; `400` invalid query

### GET /api/v1/enrollments/get-medical-details/:policyId
Fetch AI-generated medical details/recommendation for a policy.
- **Path:** `policyId: string`
- **Response `200`:** `PolicyMedicalDetailsDto`
- **Errors:** `404` no medical details; `500` other AI-service failure

### GET /api/v1/enrollments/:policyId/notes
List notes for an enrollment.
- **Path:** `policyId: number`
- **Response `200`:** `Note[]` — `{ id, noteText, addedAt, addedBy: { userId, name } }`

### POST /api/v1/enrollments/:policyId/notes
Add a note; logs an activity entry.
- **Path:** `policyId: number`; **Body** (`AddNoteDto`): `noteText: string` (required, ≤5000)
- **Response `201`:** `Note`
- **Errors:** `404` enrollment not found

### GET /api/v1/enrollments/:policyId/questions
Get the underwriting Q&A thread for an enrollment.
- **Path:** `policyId: number`
- **Response `200`:** `{ id, question, answer: string|null, status, askedBy, sentAt, respondedAt }[]`
- **Errors:** `404` enrollment not found

### POST /api/v1/enrollments/:policyId/questions
Send follow-up underwriting questions to the member; moves the enrollment to `pending_response`.
- **Path:** `policyId: number`; **Body** (`SendQuestionsDto`): `questions: string[]` (required, ≥1, each non-empty)
- **Response `201`:** `{ threadId, questionCount, memberLink }`
- **Errors:** `404` enrollment not found; `400` empty question list

---

## Email logs

All routes require an authenticated (cookie) session.

### GET /api/v1/email-logs
List/filter an enrollment's email log, syncing live delivery status from Message Center for the current page.
- **Query** (`ListEmailLogsDto`, `per_page` default 10): `enrollment_id: string` (required, base64), `subject?`, `sent_date_from?`, `sent_date_to?`, `recipient?`, `email_status?: pending|queued|sent|delivered|opened|invalid|failed|bounced`
- **Response `200`:** `{ data: EmailLogItem[], meta: { total, page, per_page, total_pages } }` — item: `{ id, enrollmentId, msgCenterEmailLogId, subject, sentAt, to, cc, bcc, emailStatus }`
- **Errors:** `400` invalid `enrollment_id` encoding

### GET /api/v1/email-logs/:id/content
HTML preview of a specific email (proxied from Message Center).
- **Path:** `id` (base64)
- **Response `200`:** `{ previewContent: string|null }`
- **Errors:** `404` not found; `400` no Message Center id / bad encoding

### POST /api/v1/email-logs/:id/forward
Forward an email log to another address.
- **Path:** `id` (base64); **Body** (`ForwardEmailDto`): `email: string` (required)
- **Response `200`:** `{ success: true }`
- **Errors:** `404` not found; `400` no Message Center id / bad encoding

### POST /api/v1/email-logs/questionnaire-reminder
Resend the underwriting-questions email for a `pending_response` enrollment.
- **Body:** `{ enrollment_id: string }` (base64)
- **Response `200`:** `{ success: boolean }`
- **Errors:** `404` enrollment/thread not found; `400` wrong status / bad encoding

### POST /api/v1/email-logs/signature-reminder
Resend the signature-request email for a `pending_signature` enrollment; rate-limited to one per 24h.
- **Body:** `{ enrollment_id: string }` (base64)
- **Response `200`:** `{ success: boolean }`
- **Errors:** `404` not found; `400` wrong status, already sent in last 24h, or bad encoding

### GET /api/v1/email-logs/:id/resend
Resend an email log to its original recipient. *(Mutating action exposed as GET — be careful with caching/prefetching proxies.)*
- **Path:** `id` (base64)
- **Response `200`:** `{ success: true }`
- **Errors:** `404` not found; `400` no Message Center id / bad encoding

---

## Member portal (public, link/OTP-based)

None of these use the admin session cookie — they use `@Public()` plus, for most, `PortalSessionGuard` (`Authorization: Bearer <token>`).

### GET /api/v1/member/questions/access
Validate a member-portal link token before OTP.
- **Query:** `token: string` (required)
- **Response `200`:** `{ valid: true, email, action?, enrollmentId? }`
- **Errors:** `401` invalid/expired token

### POST /api/v1/member/questions/send-otp
Send a 6-digit OTP (10 min expiry).
- **Body:** `{ token: string }` (required)
- **Response `201`:** `{ message: string }`
- **Errors:** `401` invalid/expired token

### POST /api/v1/member/questions/verify-otp
Verify the OTP; issues a 30-minute portal session token.
- **Body:** `{ token: string, otp: string }` (both required, `otp` exactly 6 chars)
- **Response `201`:** `{ accessToken: string }`
- **Errors:** `401` invalid/expired OTP or link token

### GET /api/v1/member/questions
Get pending underwriting questions for the portal session.
- **Auth:** `PortalSessionGuard` (Bearer)
- **Response `200`:** `{ member: { memberName, email, plan, requestedBy }, questions: { id, question, sentAt }[] }`
- **Errors:** `401` missing/invalid bearer token

### POST /api/v1/member/questions/answers
Submit answers; moves the enrollment `pending_response` → `pending_underwriting`.
- **Auth:** `PortalSessionGuard` (Bearer)
- **Body:** `{ answers: { questionId: number, answer: string }[] }` (required)
- **Response `201`:** `{ answeredCount: number }`
- **Errors:** `400` wrong enrollment status, or a `questionId` not pending / not in this thread

### GET /api/v1/member/signature/plan-selection
Plan-selection data (member info, current/available plans, payment breakdown) for the portal session.
- **Auth:** `PortalSessionGuard` (Bearer)
- **Response `200`:** `{ policyId, status, member, enrollment, representative, currentPlanId, currentPlanPricingId, selectedPlan, availablePlans }`
- **Errors:** `404` invalid/expired link; `410` declined/terminated, wrong status, or incomplete data

### POST /api/v1/member/signature/plan-selection/submit
Submit plan selection + signature; uploads signature to S3, transitions to `ready_to_activate`.
- **Auth:** `PortalSessionGuard` (Bearer)
- **Body:** `{ selectedPlanId: string, effectiveDate: string, signatureData?: string|null }`
- **Response `201`:** `{ success, policyId, previousStatus, currentStatus }`
- **Errors:** `404` enrollment not found; `400` wrong status, unresolvable plan, Nuera plan-switch rejection

### GET /api/v1/member/signature/decline-details
Enrollment details + fixed decline-reason list for the decline page.
- **Auth:** `PortalSessionGuard` (Bearer)
- **Response `200`:** `{ memberName, planName, declineReasons: string[] }`
- **Errors:** `404` enrollment not found

### POST /api/v1/member/signature/decline
Submit a member decline; transitions to `declined_by_member`.
- **Auth:** `PortalSessionGuard` (Bearer)
- **Body:** `{ reason: string }` (must be one of the fixed decline reasons)
- **Response `201`:** no content
- **Errors:** `404` enrollment not found; `400` wrong status

---

## Plan selection (mixed auth)

### GET /api/v1/plan-selection/enrollment
Legacy public plan-selection lookup by raw enrollment id (no token verification beyond the id itself).
- **Auth:** `@Public()`
- **Query:** `id: number` (required)
- **Response `200`:** same shape as `member/signature/plan-selection`
- **Errors:** `404` not found/invalid; `410` declined/terminated/wrong status/incomplete data

### GET /api/v1/plan-selection/admin/enrollment
Admin preview of the plan-selection page (tolerant of missing member/agent/group; includes `signatureReceivedAt`).
- **Auth:** authenticated (cookie)
- **Query:** `id: number` (required)
- **Response `200`:** `{ policyId, status, signatureReceivedAt, member, enrollment, representative, currentPlanId, currentPlanPricingId, selectedPlan, availablePlans }`
- **Errors:** `401` unauthenticated; `404` not found

### POST /api/v1/plan-selection/submit
Admin/logged-in variant of the member plan-selection submit — `policyId` is in the body rather than derived from a portal session.
- **Auth:** `@Public()` (controller-level guard bypass; `@CurrentUser()` will be `undefined` for a truly anonymous caller)
- **Body** (`SubmitPlanSelectionDto`): `policyId: number`, `selectedPlanId: string`, `effectiveDate: string` (required); `signatureData?`, `reason?` (optional)
- **Response `200`:** `{ success, policyId, previousStatus, currentStatus }`
- **Errors:** `400` wrong status, unresolvable plan, Nuera rejection; `404` not found

---

## External integrations (public, signed)

### POST /api/v1/open/update-policy-status/:policyId
Receive a policy status push from NueraBenefits (terminate / withdraw / reinstate). Genuinely unauthenticated — no signature check, by design (the `open/` path signals this).
- **Auth:** `@Public()`
- **Path:** `policyId: number`
- **Body** (`UpdatePolicyStatusDto`, snake_case to match the upstream contract): `policy_status: string` (required — e.g. `TERMED`, `WITHDRAWN`, `pending_underwriting`), `policy_term_date?`, `declined_reason?`, `notes?`
- **Response `200`:** `{ success: true, policyId, status }`
- **Errors:** `404` unknown `policyId`; `400` unrecognized `policy_status`. An unparseable `policy_term_date` is logged and ignored, not rejected.

### POST /api/v1/webhooks/enrollments
Create a new enrollment from a NueraBenefits webhook (upserts member/group/agent/plans).
- **Auth:** `@Public()` + `HmacGuard` — requires `X-Signature-256`, `X-Nonce`, `X-Timestamp` signed with `WEBHOOK_SECRET`
- **Body** (`CreateEnrollmentWebhookDto`): `enrollmentType: applicant|rep|group`, `policyId: number`, `enrollmentDate: string`, `effectiveDate?`, `member: {...}`, `group: {...}`, `agent: {...}`, `plans: [{ pid, planName, premiumAmount, ... }]` (all required unless noted)
- **Response `201`:** `{ policyId, status: "pending_underwriting" }`
- **Errors:** `401` bad/missing HMAC signature; `409` `policyId` already exists
```bash
curl -X POST http://localhost:3000/api/v1/webhooks/enrollments \
  -H 'Content-Type: application/json' \
  -H 'X-Signature-256: sha256=<hex>' -H 'X-Nonce: <nonce>' -H 'X-Timestamp: <unix-seconds>' \
  -d '{"enrollmentType":"applicant","policyId":123,"enrollmentDate":"2026-07-01","member":{...},"group":{...},"agent":{...},"plans":[{...}]}'
```

---

## Dev / misc

### GET /api/v1
Root health check.
- **Auth:** `@Public()`
- **Response `200`:** `"Hello World!"` (string)

### POST /api/v1/dev/jobs/dispatch
Dispatch an arbitrary job onto the internal queue. **Unauthenticated — dev/debug surface, do not expose publicly in production.**
- **Body** (`DispatchJobDto`): `jobType: string` (required), `payload?: Record<string, unknown>`
- **Response `201`:** `{ jobId: string }`

### GET /api/v1/dev/jobs/:id
Get a job's status/details plus its logs. **Unauthenticated.**
- **Path:** `id`
- **Response `200`:** job record + `logs[]`, or `{ error: 'Job not found' }` with HTTP `200` (not a `404`) if missing

### GET /api/v1/dev/jobs
Job queue stats. **Unauthenticated.**
- **Response `200`:** `{ pending: number }`

---

## Interactive docs

A live Swagger UI is mounted at `/api/docs` (see `SwaggerModule.setup` in [`src/main.ts`](../../src/main.ts)) whenever the app is running — useful for exploring schemas interactively and trying requests against a local instance.
