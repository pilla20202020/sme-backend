# Changelog

All notable changes to `uw-backend` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

There is no version-tagged release history for this service yet, so entries below are grouped by merge date instead of a semantic version. Once releases are tagged, switch to `## [x.y.z] - YYYY-MM-DD` headers.

## 2026-07-27 – 2026-07-29

### Added
- Eligibility act ID recorded in the audit log for compliance tracking.
- Enrollment status history logging on every status change, plus a backfill of initial history rows for existing enrollments.
- Rejection reason capture in the change-enrollment-status flow.
- `EnrollmentPlanService` implementing soft-delete support for enrollment plans, backed by a new `is_removed` column.

### Changed
- Policy report now retains only the most relevant plan instead of all plans (later reverted — see Fixed).
- Pipeline stats include the `ready_to_activate` status in tracking and queries.
- OTP email parameters refactored for clarity.
- Enrollment list sorting now prioritizes most-recently-updated enrollments.
- Representative email added to the CC list on member registration link emails.
- `approve-enrollment` and `edit-plan-selection` rewired to go through `EnrollmentPlanService`.
- List/read paths for enrollment plans now filter out soft-removed (`is_removed`) rows; the list endpoint prefers `plan_selections` for its plan field.

### Fixed
- Policy report reverted to include all plans instead of just the last one.
- Pricing calculation issue.
- Payment summary not updating correctly on plan submission.
- `SIGNATURE_REMINDER` email subject line clarity.
- Incorrect `isRemoved` flag/check causing recent enrollments and duplicate plans to display wrong.
- Approve-enrollment flow failure.
- Spelling of `L713FILEREV` corrected in the `ElgbAct` enum and `ELGB_ACT_MAP`.
- Missing `tier` column in `plan_selection`/`enrollment_plans` queries.
- Current-plan requirement incorrectly enforced on plan selection.
- Plan-selection preference reverted to prefer `plan_selections` after final review.
- Soft-removed-row collision handled correctly during plan submission.

### Chore
- Quoted the commit-msg hook argument so paths containing spaces don't break Husky.

## 2026-07-20 – 2026-07-24

### Added
- Revert eligibility check for active enrollments (blocks reverting past first-invoice eligibility).
- Policy status synchronization with NueraBenefits (controller + use case).
- Member registration-link and member-confirmation transactional emails, dispatched as background jobs.
- AI recommendation integration and a medical-detail view for underwriters.
- Signature-reminder email flow with email logging, and new email statuses in the email-logs service.
- Decline handling for member-declined enrollments in `ELGB_ACT_MAP`/`ELGB_REASON_MAP`, including withdrawn-date handling.

### Changed
- `allowedOrigins` CORS configuration hardened for production.
- Signature-reminder and enrollment emails restructured with dynamic links, additional parameters, and age calculations.
- Unread-question-answers logic reworked for enrollment statuses; `hasUnreadQuestionAnswers` removed from `EnrollmentListItem` in favor of the new logic.

### Fixed
- Effective-date computation using the wrong timezone.
- Current plan incorrectly included in the plan-switch payload.
- Missing error handling around plan-switch failures.

## 2026-07-13 – 2026-07-16

### Added
- Contract PDF generation, S3 storage, and download-URL generation for active enrollments.
- S3 signature upload integrated into the enrollment status flow.
- `declined_by_member` status added to the enrollment status machine, with a dedicated decline email flow requiring OTP verification.
- `@aws-sdk/s3-request-presigner` dependency for presigned S3 URLs.
- `origin` header added to `BenefitStoreClient` and `NueraClient` requests.

### Changed
- Decline submission flow simplified to require OTP verification.
- Unused `origin` property removed from `BenefitStoreClient`.

### Fixed
- S3 object key format switched from dashes to underscores.
- Missing associate fee in pricing.
- `ssoUserId` type mismatch — converted to `Number` in `mapSafeUser`, and to `BigInt` on the `User` model.

## 2026-07-02 – 2026-07-09

### Added
- Phone-number and user-name formatting utilities, applied across mappers and services.
- `getAttentionQueueCounts` for the dashboard's attention-queue metric.
- Resend-email functionality with a dedicated service, controller, and unit tests.
- `createEnrollmentSignature` wired into the signature email job.
- `tier` field on `RecentEnrollmentItem`, and a `pending_underwriting` filter for `getRecentEnrollments`.

### Changed
- Pipeline-stats queries optimized with distinct selection across weekly/monthly/yearly aggregation, plus cross-parameter handling.
- Weekly enrollment mapping now includes daily breakdowns and totals.
- Date formatting standardized across enrollment and user services.
- Question-message handling now includes sender details.
- Email notifications now use dynamic user types and include agent emails.
- Enrollment-rejection-by-underwriter handling added to status mappings.
- `paymentInfo`/`recurringPaymentInfo` allowed to be `null` in policy-report mapping; `null` dependents/`clientBrowser` handled in raw report generation.
- Resend-email endpoint changed from `POST` to `GET` (with corresponding request-parameter changes).
- Plan-selection use cases deduplicated.

### Fixed
- Revert action for `ready_to_activate` now correctly points back to `pending_underwriting`.
- Payment-summary and number-parsing bugs.
- Enrollment-list query now returns only the latest note per enrollment.

### Security
- Removed a hardcoded S3 access key and key ID from the codebase (credentials now sourced from configuration only); fixed an associated decline-by-member status bug and a member-portal access issue.
