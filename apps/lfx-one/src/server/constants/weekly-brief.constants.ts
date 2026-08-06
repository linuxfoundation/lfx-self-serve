// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mock-mode only: GET /current for this committee uid returns a quiet-week (no_sources) error
 * brief, unless a mock generate/save has already stored a different brief for this uid (mock
 * state is in-memory per committee — see `mockBriefByCommittee` in weekly-brief.service.ts).
 */
export const WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID = 'wb-mock-quiet-week';
