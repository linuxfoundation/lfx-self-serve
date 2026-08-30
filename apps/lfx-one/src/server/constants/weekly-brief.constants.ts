// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mock-mode only: `WeeklyBriefService#getCurrentBrief` returns a quiet-week (no_sources) error
 * brief for this committee uid, unless a mock generate/save has already stored a different
 * brief for it (mock state is in-memory per committee — see `mockBriefByCommittee` in
 * weekly-brief.service.ts). Service-level only, not reachable through the real HTTP path: the
 * controller's `assertCommitteeRead` runs a live FGA check before this service is ever called,
 * and no FGA tuple exists for this synthetic uid, so a real request 403s before mock mode is
 * even relevant. Exercised directly by `weekly-brief.service.spec.ts`, not via the running app.
 */
export const WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID = 'wb-mock-quiet-week';

/**
 * Deadline for `WeeklyBriefService#withStaleness`'s committee-activity fetch (GH-1966).
 * `MicroserviceProxyService` itself sets no timeout, but every proxied call still inherits
 * `ApiClientService`'s per-request `AbortSignal.timeout` (30s by default) — so the pre-existing
 * ceiling was ~30s, not unbounded. Still far too long for a purely informational badge to
 * potentially delay the brief's own primary content, so this tightens it and degrades to
 * `staleness: null` on expiry rather than waiting out the full request budget (general review
 * finding, full-branch sweep).
 *
 * Deliberately well under `WEEKLY_BRIEF_POLL_INTERVAL_MS` (4000ms, `@lfx-one/shared/constants`)
 * — that's the client's own per-tick timeout on `GET /current` while `pollUntilTerminal` polls a
 * generate/regenerate to completion. This fetch runs on every such tick once the brief reaches a
 * shareable state, in parallel with (not in addition to) `withCallerRating`; a value close to or
 * over 4s here could itself push a tick over the client's timeout and burn poll attempts on a
 * brief that generated fine (full-branch sweep handoff, not independently loaded as a KB
 * pattern). Not derived from that constant via a shared import — this file is deliberately
 * import-free (see the sibling `weekly-brief.service.spec.ts` comment on why) — so keep the two
 * in sync by hand if either changes.
 */
export const WEEKLY_BRIEF_STALENESS_FETCH_TIMEOUT_MS = 1_500;
