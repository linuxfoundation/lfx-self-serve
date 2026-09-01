// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Shared fixtures/mocks for the Formation Checklist section specs (GH-1958). */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants/feature-flags.constants';
import { Page, test } from '@playwright/test';

import { FormationApiMockHelper } from './formation-api-mock.helper';

export const DATA_LOAD_TIMEOUT = 30_000;
export const FORMATION_PROJECT_SLUG = 'cascade-data-alliance';

export function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — let the test run and surface a useful failure.
  }
}

/** Pins `formation-enabled` on/off for this page, before the app's own flag-provider bootstrap runs — see `FEATURE_FLAG_OVERRIDE_STORAGE_KEY`. */
export async function stubFormationFlag(page: Page, enabled = true): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [FORMATION_ENABLED_FLAG]: enabled }),
  ] as const);
}

export function buildBaseProject(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: `e2e-${slug}-uid`,
    slug,
    name: 'Cascade Data Alliance',
    description: 'A working-group used to exercise the Formation checklist in e2e tests.',
    public: true,
    parent_uid: '',
    stage: 'Formation - Engaged',
    category: 'foundation',
    funding_model: ['member-funded'],
    charter_url: '',
    legal_entity_type: '',
    legal_entity_name: '',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '',
    logo_url: '',
    repository_url: '',
    website_url: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    mailing_list_count: 0,
    writer: false,
    ...overrides,
  };
}

export type FormationChecklistApiState = 'ready' | 'no-template' | 'no-items' | 'error';

export async function mockFormationChecklistApis(
  page: Page,
  opts: { project: Record<string, unknown>; checklistState?: FormationChecklistApiState }
): Promise<void> {
  await page.route(`**/api/projects/${opts.project['slug']}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.project) });
  });

  const state = opts.checklistState ?? 'ready';
  if (state === 'error') {
    await page.route('**/api/projects/*/formation', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  } else if (state === 'no-template' || state === 'no-items') {
    await page.route('**/api/projects/*/formation', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          formation: {
            uid: `formation:${opts.project['slug']}`,
            parent_project_uid: opts.project['uid'],
            parent_project_slug: opts.project['slug'],
            parent_project_name: opts.project['name'],
            entity_type: 'foundation',
            template_uid: 'seed',
            template_version: 1,
            state: 'active',
            sub_stage: 'engaged',
            announcement_date: null,
            is_activating: false,
            gating_items_open: 0,
            gating_items_total: 0,
            blocking_item_title: null,
            lead: null,
            proposer: null,
            subtitle: null,
            created_at: '',
            updated_at: '',
          },
          template: state === 'no-template' ? null : { uid: 'seed', version: 1, name: 'Project formation', sections: [] },
          items: [],
          data_source: 'fixture',
        }),
      })
    );
  } else {
    await FormationApiMockHelper.setupProjectFormationMock(page, opts.project['slug'] as string);
  }

  await FormationApiMockHelper.setupFormationItemMock(page);
  await FormationApiMockHelper.setupFormationItemActionMock(page);

  // Sidebar/other project-page widgets this page also renders — stub to empty so they don't block load.
  await page.route('**/api/user/pending-actions*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
}

export async function gotoProjectOverview(page: Page, slug: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/project/overview?project=${slug}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}
