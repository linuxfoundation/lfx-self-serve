// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared program-review e2e setup. The page is server-rendered against the real BFF, which
 * `page.route` cannot reach, so the SSR pass for the synthetic program id already paints an error
 * state (404 or 403). Angular's transfer cache only replays successful responses, so the browser
 * re-fetches the program; `openProgramReview` waits for that stubbed GET so assertions run against
 * the stubbed state rather than the server-rendered one.
 */

import type { MentorshipProgramReview, MentorshipUpstreamProgramStatus } from '@lfx-one/shared/interfaces';
import { expect, Page, Response } from '@playwright/test';

export const PROGRAM_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
export const PROGRAM_REVIEW_LOAD_TIMEOUT = 30_000;

const REVIEW_URL = `/mentorship/program-review/${PROGRAM_ID}`;
const REVIEW_API = `**/api/mentorship/program-review/${PROGRAM_ID}`;
export const DECISION_API = `${REVIEW_API}/decision`;

/**
 * The page renders exactly one of these at its top level: loading, the program with its review card,
 * or one of the error states. The review card's own status blocks are nested and not counted.
 */
const OUTCOME_SELECTOR = ['loading', 'request', 'forbidden', 'not-found', 'invalid-link', 'error']
  .map((id) => `[data-testid="mentorship-program-review-${id}"]`)
  .join(', ');

/** A synthetic program with every detail filled in; override fields to test their empty states. */
export function reviewProgram(overrides: Partial<MentorshipProgramReview> = {}): MentorshipProgramReview {
  return {
    id: PROGRAM_ID,
    name: 'Test Program',
    status: 'pending',
    projectName: 'Test Foundation',
    description: '<p>Learn the codebase.</p>',
    logoUrl: null,
    repoUrl: 'https://github.com/test-org/test-repo',
    codeOfConductUrl: 'https://test-org.example/coc',
    ciiProjectId: '1234',
    skills: ['go', 'kubernetes'],
    hasDetails: true,
    ...overrides,
  };
}

export async function stubProgramReview(page: Page, status: number, program?: MentorshipProgramReview, delayMs = 0): Promise<void> {
  await page.route(REVIEW_API, async (route) => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(program ?? { error: 'stubbed' }),
    });
  });
}

export async function stubProgramDecision(page: Page, status: number, decided: MentorshipUpstreamProgramStatus = 'published'): Promise<void> {
  await page.route(DECISION_API, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(status === 200 ? { id: PROGRAM_ID, name: 'Test Program', status: decided } : { error: 'stubbed' }),
    })
  );
}

/** Navigates without waiting for the program GET — for links the page rejects before calling the API. */
export async function gotoProgramReview(page: Page, query = '', programId = PROGRAM_ID): Promise<void> {
  await page.goto(`/mentorship/program-review/${programId}${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

/**
 * Navigates and waits for the browser's stubbed program GET, so the page shows the stubbed state.
 * Hydration leaves the unclaimed server-rendered outcome in the DOM until the app is stable, so it
 * also waits until loading is gone and a single outcome remains — the client's own render.
 */
export async function openProgramReview(page: Page, query = ''): Promise<void> {
  const stubbedLoad = page.waitForResponse(isProgramLoad, { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
  await page.goto(`${REVIEW_URL}${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await stubbedLoad;
  await expect(page.getByTestId('mentorship-program-review-loading')).toHaveCount(0, { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
  await expect(page.getByTestId('mentorship-program-review').locator(OUTCOME_SELECTOR)).toHaveCount(1, { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
}

function isProgramLoad(response: Response): boolean {
  return response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith(`/api/mentorship/program-review/${PROGRAM_ID}`);
}
