// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { test } from '@playwright/test';

/**
 * Env-var-driven fixture for the newsletter live-service specs
 * (`newsletter-live-send*.spec.ts`). Those specs are the deliberate exception
 * to this suite's `page.route()`-mocked convention — they exercise the real
 * newsletter-service / committee-service / project-service stack, so they
 * need a seeded project + committee to target instead of fixture data.
 *
 * Required env vars (set in `apps/lfx-one/.env`, alongside `TEST_USERNAME` /
 * `TEST_PASSWORD` — see `docs/architecture/testing/e2e-testing.md`):
 *
 * - `LIVE_PROJECT_SLUG` — slug of a seeded project the test user can manage
 *   (ED / project-writer) newsletters for.
 * - `LIVE_PROJECT_UID` — that same project's UID (newsletter edit/analytics
 *   routes are UID-keyed, not slug-keyed).
 * - `LIVE_COMMITTEE_UID` — UID of a committee under that project with at
 *   least one member, so a send has a real recipient.
 * - `LIVE_COMMITTEE_NAME` — that committee's display name, needed to select
 *   it from the audience picker's rendered option list (PrimeNG `p-select`
 *   options are chosen by visible label, not by value).
 *
 * All four are required together — a partially-configured environment skips
 * cleanly via `skipWhenLiveEnvMissing()` rather than failing on a missing
 * fixture.
 */
export interface LiveNewsletterEnv {
  projectSlug: string;
  projectUid: string;
  committeeUid: string;
  committeeName: string;
}

const LIVE_ENV_PRESENT =
  !!process.env.LIVE_PROJECT_SLUG && !!process.env.LIVE_PROJECT_UID && !!process.env.LIVE_COMMITTEE_UID && !!process.env.LIVE_COMMITTEE_NAME;

export function liveEnvPresent(): boolean {
  return LIVE_ENV_PRESENT;
}

/**
 * Skips the current test when the live-service env vars aren't configured.
 * Mirrors the `skipWhenAuthMissing()` pattern used by the mocked specs —
 * gated on explicit env vars rather than URL sniffing, so a genuinely broken
 * live stack still fails loudly rather than silently skipping.
 */
export function skipWhenLiveEnvMissing(): void {
  if (!LIVE_ENV_PRESENT) {
    test.skip(true, 'LIVE_PROJECT_SLUG / LIVE_PROJECT_UID / LIVE_COMMITTEE_UID / LIVE_COMMITTEE_NAME not configured — see live-env.helper.ts');
  }
}

export function getLiveEnv(): LiveNewsletterEnv {
  return {
    projectSlug: process.env.LIVE_PROJECT_SLUG || '',
    projectUid: process.env.LIVE_PROJECT_UID || '',
    committeeUid: process.env.LIVE_COMMITTEE_UID || '',
    committeeName: process.env.LIVE_COMMITTEE_NAME || '',
  };
}
