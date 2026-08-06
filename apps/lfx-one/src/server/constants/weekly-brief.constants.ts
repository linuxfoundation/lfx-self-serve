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
