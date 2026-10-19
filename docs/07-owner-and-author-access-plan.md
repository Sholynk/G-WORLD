# Owner and author access — implementation plan

Status: approval foundation, owner security and ownership-scoped author workspace implemented and tested locally. **Not deployed; production rollout checks remain.**

## Implementation progress

Implemented in the first milestone:
- Migration `0007_author_access.sql`: protected singleton owner identity and separate author applications.
- Atomic account/profile/byline/application creation and reserved owner email.
- Verification-independent approval checks at login and on every session resolution.
- Owner account-review APIs and dashboard controls with separate-code verification, account/IP rate limiting, audit events, email notifications, pagination and a pending count.
- Reversible suspension with transactional session revocation, preserving profiles/articles/bylines.
- Login/Register UI, verification resend, and corrected verification messaging.
- Unauthenticated dashboard content stays hidden while the session check redirects to Login/Register.
- SQL/repository/HTTP boundary tests in `tests/unit/author-access.test.ts`.

Implemented in the second milestone:
- Migration `0008_owner_setup.sql` and `npm run owner:provision`: operator-only, atomic owner enrollment. The command generates an unknown random bootstrap password hash; it never accepts or prints a default password or confirmation code.
- Fixed-recipient setup email with a one-hour, single-use, hashed token. Links use URL fragments, are removed from browser history on page load, and are not stored in outbox bodies or logs. Delivery uses the configured real email provider; console delivery cannot expose a setup link.
- Private setup UI for choosing a new login password and separate code (each at least 12 characters). Setup verifies email, activates the sole owner, consumes sibling links and invalidates pre-setup recovery links/sessions.
- Owner code recovery requires owner authentication, a fresh email token and the current password. Recovery revokes every session and sibling recovery token.
- Shared per-mutation confirmation checks on owner deletions, site settings, maintenance and authenticated password changes. No session-wide “already confirmed” bypass; incorrect attempts are limited by account/IP. Successful confirmations clear their failure windows.
- Owner password changes/resets enforce length and separation from the confirmation code.
- Added SQLite/API security tests and DOM-level setup/recovery form tests.

Implemented in the third milestone:
- Migrations `0009_author_workspace.sql` and `0010_reserved_article_urls.sql`: immutable account ownership on articles/uploads, profile social links, normalized application profile slugs, and reserved retired article URLs.
- Approved, verified, active authors can draft, publish, schedule, edit and delete their own articles. Byline identity is bound server-side; hero/featured placement remains owner-controlled.
- Exact admin route allowlist plus ownership checks on private reads, mutations, nested sources, images, comments and aggregate analytics. Published content remains public; login emails and review notes do not appear in public article responses.
- Dedicated My articles/media/comments/profile/analytics navigation. Profile edits synchronize the public byline and account display name; safe social links render on article author cards.
- Public engagement is limited to published articles. Scheduled publication pauses for suspended authors. Suspension keeps existing published content/bylines intact.
- Real-SQLite/full-Hono tests with two authors and an owner, including complete register → verify → approve → login → publish, forged ownership, cross-author access, CSRF and restoration. DOM tests cover author navigation, profile saving, analytics, upload routing and owner UI preservation.

**Still required before production rollout:**
1. Review existing accounts and content ownership; back up production D1. Legacy NULL-owned content remains owner-managed, never automatically assigned by matching names/bylines.
2. Verify real-provider email delivery and full-browser end-to-end behavior in staging, including private owner setup/recovery.
3. Deploy migrations, Worker and frontend, complete private owner setup, then enable registration after acceptance checks.

Safety boundary: `ENABLE_REGISTRATION=false` remains the production default. Registration also requires an initialized `site_owner` record. No owner record or credentials are seeded by migrations. Approved applicants now receive a scoped dashboard; pending/unverified/declined/suspended applicants remain blocked. Existing legacy demo accounts work only while no owner is provisioned. Provisioning is an explicit access cutover: legacy accounts without approved applications then fail closed. See `docs/06-deployment.md` for prerequisites and commands.

## Agreed requirements

- Exactly one owner: `sholabusari66@gmail.com`. No UI or public API may create another super admin.
- Owner receives a single-use email setup link and privately chooses a new password. Never seed a known password or commit credentials.
- A separate secret code confirms sensitive owner actions; it is not an author credential.
- Public author registration creates an account and linked byline profile. Access requires owner approval.
- Owner receives a dashboard application prompt and an email, and may approve or decline.
- Approved authors manage their own articles (including publishing and deletion), images, profile, analytics and article comments only.
- Suspension retains the account, profile and byline. It blocks login and revokes existing sessions. The owner can restore access.
- Suspension never deletes or transfers articles. Article deletion remains an explicit owner action.
- Unauthenticated `/admin/` visitors see Login / Register. Authenticated authors and the owner see distinct navigation and capabilities.

## Security and state design

### Owner provisioning

Provide an operator-only, idempotent bootstrap command targeting the intended D1 environment. It must refuse conflicting existing owners rather than silently promote, demote or overwrite accounts. Reserve the owner's email against public registration. Create no browser-accessible bootstrap route.

Store the owner identity in a protected singleton database record referencing the user ID. Permission checks must require that identity as well as the super-admin role. Email alone is not an authorization boundary. Enforce owner uniqueness and prevent deletion, suspension and role changes through application checks and database constraints/triggers where practical.

Issue an expiring, single-use setup token stored only as a hash; send the setup URL through the production mail provider. Setup lets the owner choose both a password and a separate confirmation code. Do not log the URL, password or code. Never use the password previously disclosed in chat.

### Confirmation code

Hash the code with the password hashing implementation and a fresh salt. Rate-limit attempts per owner and IP, with temporary lockout and security auditing. Never store code values in logs or browser storage.

Require confirmation for approve/decline, suspend/restore, destructive content/media actions, security changes and significant site-setting changes. Validate the code server-side for the specific mutation, not via a durable browser boolean. Scope any short-lived confirmation token to the owner session, action and target, and consume it once.

Code recovery must require a fresh email recovery flow and invalidate existing sessions/confirmations. Recovery is distinct from author approval and must not allow an author to acquire owner access.

### Author lifecycle

Keep approval separate from email verification and suspension. Add a review record with pending/approved/declined status, timestamps, reviewer and optional reason; adapt existing account states only after checking their schema constraints.

Proposed additional safeguard: email verification is required before author access. Registration immediately appears as pending to the owner, with verification status visible. Approval alone cannot bypass email verification. Verification and password reset cannot activate a declined or suspended account.

Account/profile/application creation must be atomic. Email delivery failure must not orphan the account or lose the application; allow safe retries without duplicate applications or notifications. Re-registration with an existing suspended email must not create a replacement account or disclose sensitive account state.

A pending applicant may receive a minimal status response after credential verification but never an author session with editorial access. Restoration only restores a previously approved account; it does not bypass review.

## API and data work

1. Add migrations for owner identity, author-review state, sensitive-action confirmation data and explicit user-to-author-profile linkage. Inventory existing accounts first; never infer ownership from matching display names.
2. Audit existing `created_by`/uploader fields and legacy records. Preserve existing content; leave ambiguous ownership owner-managed until explicitly assigned.
3. Implement a shared owner guard and author-resource ownership guards. Reuse them across list/detail/mutation routes and public-read endpoints that expose non-public content to signed-in users.
4. Apply ownership predicates inside database queries, including aggregate analytics, comments, images, article-author selection, bulk actions and related IDs. Never accept a client-supplied owner/user ID as authority.
5. Add owner application-list, approve, decline, suspend and restore endpoints. Audit every transition; make duplicate or concurrent actions safe.
6. Add author profile editing with safe name/bio/avatar/social-link validation. Author profiles cannot change role, approval state or account identity.
7. Revoke sessions on suspension and check active account eligibility on every authenticated request. Cookie deletion in one browser is insufficient.
8. Update notifications and email templates for setup, new applications, decisions, suspension and restoration. Dashboard review remains available if email delivery fails.

## Dashboard work

- Add Login/Register entry UI, email verification, pending-review and declined status messaging, and password recovery.
- Owner dashboard: pending applications, author directory and status filters, review actions, suspension/restoration controls, sensitive-action confirmation dialog and audit visibility.
- Author dashboard: own articles, own media, editable public profile, own article analytics and own article comment moderation.
- Enforce permissions in the API even when dashboard controls are hidden.
- Preserve the current vanilla HTML/CSS/JavaScript frontend and Cloudflare Pages/Worker same-origin session architecture.

## Migration and deployment

- Keep development demo identities separate from production provisioning.
- Inspect existing role holders and document mapping to the new owner/author model before migration. Do not silently grant former editors publishing access or leave legacy admin accounts with global authority.
- Back up production D1, test migrations locally, then stage the rollout.
- Configure verified email delivery and the canonical application URL before sending the setup email.
- Keep dev authentication routes disabled. Enable public registration only after approval guards and anti-abuse measures are deployed.
- Deploy schema and API compatibility changes before the new UI. Verify the owner setup path privately; never include setup tokens in deployment reports.

## Acceptance tests

- Only the provisioned owner identity can perform owner actions; registration cannot claim the owner email or request privileged roles.
- Setup links expire, are single-use and cannot be replayed concurrently.
- Registration creates exactly one account/profile/application and notifies the owner without leaking credentials.
- Pending, declined, unverified and suspended applicants cannot access author content or bypass restrictions through reset/verification endpoints.
- Authors can publish/edit/delete their own articles, manage their own uploads/profile, view their own analytics and moderate comments on their articles.
- Every cross-author list/read/write/delete/aggregate attempt fails or excludes unauthorized records, including guessed IDs and forged author IDs.
- Sensitive owner mutations reject missing/incorrect/replayed confirmation; attempt limits and lockouts work.
- Suspension immediately invalidates existing sessions and preserves content/bylines. Restoration permits subsequent login without requiring a replacement account.
- Owner identity cannot be deleted, suspended, demoted or duplicated through any exposed endpoint.
- Existing production content survives migration unchanged; ambiguous ownership is not automatically assigned.

## Completion boundary

All three implementation milestones modify repository code and add database migrations, tested locally. No production migration, owner provisioning, real setup email or deployment has been performed. Staging/email verification and the production rollout remain separate, explicitly authorized steps.
