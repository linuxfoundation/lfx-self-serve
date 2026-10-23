// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
  FOUNDATION_MESSAGE_INTAKE,
  LENS_COOKIE_KEY,
  MKTG_DOCUMENT_TYPES,
  MKTG_OS_AGENTS_ENABLED_FLAG,
  MKTG_SLIDES_EXPORT_API_PATH,
  PERSONA_COOKIE_KEY,
  SELECTED_PROJECT_COOKIE_KEY,
} from '@lfx-one/shared/constants';
import type { FoundationMessageContent, MktgDocumentRunProgress, MktgRevisionResponse, MktgRevisionSummary, Project } from '@lfx-one/shared/interfaces';
import { expect, Page, Route } from '@playwright/test';
import { mockProjects } from '../fixtures/mock-data/projects.mock';
import { ApiMockHelper } from './api-mock.helper';
import { suppressCookieBanner } from './account-settings-email.helper';

export const DATA_LOAD_TIMEOUT = 20_000;
export const ASSET_PROJECT = { uid: 'p0000000-0000-0000-0000-000000000719', slug: 'synthetic-orbit', name: 'Synthetic Orbit' };
export const ASSET_TYPE = MKTG_DOCUMENT_TYPES.find((type) => type.catalogAgentId === FOUNDATION_MESSAGE_INTAKE.agentId);
if (!ASSET_TYPE) {
  throw new Error('Missing registered framework fixture type');
}
export const ASSET_REVISION = `000001-${'a'.repeat(64)}`;
export const ASSET_FAILURE = 'Synthetic rejection. <img src=x onerror=alert(1)> Supply the missing sources.';
const pair = (a: string, b: string): [string, string] => [a, b];
const content: FoundationMessageContent = {
  mf: {
    vision: 'A vision.',
    mission: 'A mission.',
    positioning: 'For platform teams, the project is the open release toolkit.',
    tagline: 'Release, open.',
    goals: [
      { id: 'adoption', n: 1, t: 'Adoption', vp: 'VP.', key: 'Key.', proof: [pair('1,200 members', 'Website')], bite: 'Adoption in the open', icps: ['users'] },
    ],
    crosscut: 'Every column grows the audience.',
    say: ['open release'],
    avoid: [],
    anchor: ['Which goal does this serve?'],
    notes: '',
  },
  icp: [
    {
      id: 'users',
      name: 'End users',
      kind: 'Individual',
      who: 'Engineers.',
      goals: ['adoption'],
      need: 'Need.',
      value: 'Value.',
      lead: 'Ship with confidence.',
      proof: [pair('A fact', 'Docs')],
      cta: 'Try it.',
      channels: ['Docs'],
      objection: ['Too early?', null],
      personas: [pair('SRE', 'uptime')],
      basis: 'Website',
    },
  ],
  mh: {
    umbrella: 'Umbrella.',
    line: 'Release, open.',
    pillars: [{ t: 'Open', m: 'Open message.', p: [pair('Fact', 'Web')] }],
    found: 'A Linux Foundation project.',
    aud: [pair('End users', 'Ship with confidence.')],
  },
  nums: [pair('1,200', 'members')],
};

export function assetRevision(): MktgRevisionResponse {
  if (!ASSET_TYPE) {
    throw new Error('Missing asset fixture');
  }
  const revision: MktgRevisionSummary = {
    id: ASSET_REVISION,
    number: 1,
    createdAt: '2026-10-19T08:00:00Z',
    origin: 'generated' as const,
    restoredFromNumber: null,
    intakeMode: 'form' as const,
    status: '',
    contentSha256: 'a'.repeat(64),
    format: 'json' as const,
    commentCount: 0,
    latest: true,
    author: null,
    approval: null,
  };
  return {
    project: ASSET_PROJECT.uid,
    type: ASSET_TYPE,
    documentId: 'living',
    revisions: [revision],
    revision,
    approval: null,
    approvedCurrent: null,
    markdown: JSON.stringify(content),
    sidecar: { report: { sources_read: [], sources_failed: [], gaps: [], notes: '' }, checks: { findings: [] }, mode: 'draft' },
    runs: [],
  };
}
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Every Marketing OS request is synthetic, including exports/dependencies: no Guild or project edit needed. */
export async function setupAsset(
  page: Page,
  options: { writer?: boolean; mode?: 'writing' | 'questions' | 'failed' | 'ready' | 'empty' | 'error'; hold?: boolean; asset?: MktgRevisionResponse } = {}
) {
  await suppressCookieBanner(page);
  const writer = options.writer ?? true;
  mockProjects[ASSET_PROJECT.slug] = {
    ...ASSET_PROJECT,
    writer,
    parent_uid: '',
    repository_url: 'https://github.com/synthetic-org/synthetic-orbit',
    website_url: 'https://synthetic-orbit.example',
    description: 'Synthetic project',
  } as Project;
  await ApiMockHelper.setupProjectSlugMock(page, { writer });
  await page.addInitScript(
    ([key, flag]) => localStorage.setItem(key, JSON.stringify({ [flag]: true })),
    [FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MKTG_OS_AGENTS_ENABLED_FLAG]
  );
  const seed = async () =>
    page.context().addCookies(
      [
        { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify({ primary: 'executive-director', all: ['executive-director'] })) },
        { name: LENS_COOKIE_KEY, value: 'project' },
        { name: SELECTED_PROJECT_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(ASSET_PROJECT)) },
      ].map((cookie) => ({ ...cookie, domain: 'localhost', path: '/', sameSite: 'Lax' as const }))
    );
  await seed();
  await page.route('**/api/user/personas*', (route) =>
    json(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  await page.route('**/api/projects/*/sfid*', (route) => json(route, { sfid: null }));
  await page.route('**/api/nav/lens-items*', (route) =>
    json(route, { items: [{ ...ASSET_PROJECT, isFoundation: false, logoUrl: null }], next_page_token: null, upstream_failed: false, lens: 'project' })
  );
  const state = { mode: options.mode ?? 'writing', retries: [] as string[], posts: [] as string[], exportChecks: 0 };
  let release: () => void = () => undefined;
  const gate = options.hold
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  const runs = (): MktgDocumentRunProgress[] => {
    if (!ASSET_TYPE || state.mode === 'ready' || state.mode === 'empty') {
      return [];
    }
    let runState: MktgDocumentRunProgress['state'] = 'writing';
    if (state.mode === 'failed') runState = 'failed';
    if (state.mode === 'questions') runState = 'questions';
    return ['b', 'c'].map((char) => ({
      project: ASSET_PROJECT.uid,
      agentKey: ASSET_TYPE.agentKey,
      documentId: 'living',
      runId: char.repeat(64),
      startedAt: '2026-10-19T08:00:00Z',
      state: runState,
      ...(state.mode === 'failed' && { failureText: ASSET_FAILURE }),
    }));
  };
  await page.route('**/api/mktg-*/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      state.posts.push(path);
    }
    if (path.endsWith('/retry')) {
      state.retries.push(path.split('/').at(-2) ?? '');
      state.mode = 'ready';
      return json(route, { ...assetRevision(), runs: [] });
    }
    if (path === `${MKTG_SLIDES_EXPORT_API_PATH}/last` || path.includes('exports')) {
      state.exportChecks++;
      return json(route, { last: null, latestRevision: null });
    }
    if (path.includes('/stored')) {
      return json(route, {}, 404);
    }
    if (!writer) {
      return json(route, { error: 'Synthetic no access' }, 403);
    }
    if (state.mode === 'error') {
      return json(route, { error: 'Synthetic unavailable' }, 503);
    }
    if (path.endsWith('/comments')) return json(route, { revisionId: ASSET_REVISION, threads: [] });
    await gate;
    const loaded = options.asset ?? assetRevision();
    const response = { ...loaded, revisions: state.mode === 'ready' ? loaded.revisions : [], runs: runs() };
    if (path.endsWith('/documents')) {
      return json(route, { project: ASSET_PROJECT.uid, groups: MKTG_DOCUMENT_TYPES.map((type) => ({ type, documents: [] })), runs: runs() });
    }
    if (path.includes('/revisions/')) {
      return json(route, loaded);
    }
    if (path.includes('/documents/')) {
      return json(route, response);
    }
    return json(route, { error: 'Unexpected synthetic request' }, 503);
  });
  return {
    state,
    finish: () => {
      state.mode = 'ready';
      release();
    },
    open: async (suffix = '') => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/auth0\.com/);
      await expect(page.getByTestId('sidebar')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
      await seed();
      const url = `/project/mktg-os-agents/documents/${options.asset?.type.agentKey ?? ASSET_TYPE?.agentKey}/living?project=${ASSET_PROJECT.slug}${suffix}`;
      await page.evaluate((url) => {
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, url);
      await expect(page.getByTestId('mktg-document-view-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    },
  };
}
