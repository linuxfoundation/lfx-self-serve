// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
  LENS_COOKIE_KEY,
  MKTG_DOCUMENT_TYPES,
  MKTG_LAST_INTAKE_API,
  MKTG_OS_AGENTS_ENABLED_FLAG,
  PERSONA_COOKIE_KEY,
  SELECTED_PROJECT_COOKIE_KEY,
  SELECTED_FOUNDATION_COOKIE_KEY,
} from '../../../../packages/shared/src/constants';
import { createHash } from 'node:crypto';
import { findMktgRunIntake } from '../../../../packages/shared/src/utils/mktg-document-store.utils';
import type {
  FoundationMessageContent,
  MktgArtifactStoredResponse,
  MktgDocumentsResponse,
  MktgDocumentType,
  MktgRevisionResponse,
  MktgRevisionSummary,
} from '@lfx-one/shared';
import { expect, Page, Route, test as baseTest } from '@playwright/test';
import { suppressCookieBanner } from './account-settings-email.helper';
import { ApiMockHelper } from './api-mock.helper';
import { waitForHydration } from './meeting-composer-guests.helper';
import { skipWhenAuthMissing } from './auth.helper';

const unexpectedCalls = new WeakMap<Page, string[]>();

/** Every kit case fails on an unrecognized Marketing request; no quiet catch-all responses. */
export const kitTest = baseTest.extend<{ kitRequestCheck: void }>({
  timezoneId: 'UTC',
  kitRequestCheck: [
    async ({ page }, use) => {
      skipWhenAuthMissing();
      const calls: string[] = [];
      unexpectedCalls.set(page, calls);
      await use(undefined);
      expect(calls, 'Unexpected Marketing OS requests (writes are blocked, never sent live)').toEqual([]);
      unexpectedCalls.delete(page);
    },
    { auto: true },
  ],
});

export const KIT_PROJECT = { uid: 'p0000000-0000-0000-0000-00000000a119', slug: 'kit-synthetic-project', name: 'Synthetic Kit Project' };

export function kitDocuments(loaded = false): MktgDocumentsResponse {
  return {
    project: KIT_PROJECT.uid,
    groups: MKTG_DOCUMENT_TYPES.map((type) => ({
      type,
      documents:
        loaded &&
        (type.agentKey === 'foundation-message' ||
          type.agentKey === 'icp' ||
          type.agentKey === 'boilerplates' ||
          type.agentKey === 'faq' ||
          type.agentKey === 'brand-kit' ||
          type.agentKey === 'linkedin-post')
          ? [
              {
                agentKey: type.agentKey,
                documentId: type.kind === 'living' ? 'living' : 'run-000000000000000000000001',
                revisionCount: type.kind === 'living' ? 12 : 1,
                latestRevisionId: kitRevision(type).revision.id,
                approvedCurrent: null,
                createdAt: new Date().toISOString(),
                updatedAt: '2026-10-16T12:00:00Z',
              },
            ]
          : [],
    })),
  };
}

function frameworkContent(): FoundationMessageContent {
  const text = 'A synthetic fixture statement.';
  const proof: FoundationMessageContent['mf']['goals'][number]['proof'] = [['Synthetic evidence', 'Website']];
  const goal = { id: 'adoption', n: 1, t: 'Adoption', vp: text, key: text, proof, bite: text, icps: ['teams'] };
  const segment: FoundationMessageContent['icp'][number] = {
    id: 'teams',
    name: 'Project teams',
    kind: 'Organization',
    who: text,
    goals: ['adoption'],
    need: text,
    value: text,
    lead: text,
    proof,
    cta: text,
    channels: ['Community'],
    objection: ['Ready to try?', null],
    personas: [['Reviewer', 'Evidence']],
    basis: 'Website',
  };
  return {
    mf: {
      vision: text,
      mission: text,
      positioning: text,
      tagline: text,
      goals: [goal],
      crosscut: text,
      say: ['community'],
      avoid: [],
      anchor: ['Who does this serve?'],
      notes: '',
    },
    icp: [segment],
    mh: { umbrella: text, line: text, pillars: [{ t: 'Community', m: text, p: proof }], found: text, aud: [['Project teams', text]] },
    nums: [['1', 'synthetic example']],
  };
}

export function kitRevision(type: MktgDocumentType, withReport = true): MktgRevisionResponse {
  const markdown = type.agentKey === 'foundation-message' ? JSON.stringify(frameworkContent()) : '{}';
  const sha = createHash('sha256').update(markdown).digest('hex');
  const number = type.kind === 'living' ? 3 : 1;
  const revision: MktgRevisionSummary = {
    id: String(number).padStart(6, '0') + '-' + sha,
    number,
    createdAt: '2026-10-16T12:00:00Z',
    origin: 'generated',
    restoredFromNumber: null,
    intakeMode: 'form',
    status: '',
    contentSha256: sha,
    format: 'json',
    commentCount: 0,
    latest: true,
    approval: null,
  };
  return {
    project: KIT_PROJECT.uid,
    type,
    documentId: type.kind === 'living' ? 'living' : 'run-000000000000000000000001',
    revisions: [revision],
    approvedCurrent: null,
    approval: null,
    revision,
    markdown,
    sidecar:
      withReport && type.agentKey === 'foundation-message'
        ? {
            report: {
              sources_read: ['project.example', 'Synthetic plan'],
              sources_failed: [
                { name: 'README', reason: 'Timed out' },
                { name: 'Analyst note', reason: 'Login required' },
              ],
              gaps: [],
              notes: '',
            },
          }
        : null,
  };
}

export function kitJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Only the listing, framework view/source reads and required project shell are stubbed. */
export async function setupKit(
  page: Page,
  options: {
    loaded?: boolean;
    listing?: MktgDocumentsResponse;
    approvedFramework?: boolean;
    writer?: boolean;
    status?: number;
    hold?: Promise<void>;
    report?: boolean;
    revisionStatus?: number;
    revisionHold?: Promise<void>;
  } = {}
): Promise<void> {
  const writer = options.writer ?? true;
  const calls = unexpectedCalls.get(page);
  if (!calls) throw new Error('setupKit requires the kitTest fixture');
  const rejectUnexpected = (route: Route): Promise<void> => {
    calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort('blockedbyclient');
  };
  const isProjectRead = (route: Route): boolean =>
    route.request().method() === 'GET' && new URL(route.request().url()).searchParams.get('project') === KIT_PROJECT.uid;
  await suppressCookieBanner(page);
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [FEATURE_FLAG_OVERRIDE_STORAGE_KEY, JSON.stringify({ [MKTG_OS_AGENTS_ENABLED_FLAG]: true })]
  );
  await seedKitContext(page);
  await ApiMockHelper.setupProjectSlugMock(page, { writer });
  // This synthetic project intentionally overrides the helper's stock projects.
  await page.route(
    (url) => url.pathname === `/api/projects/${KIT_PROJECT.slug}` || url.pathname === `/api/projects/${KIT_PROJECT.uid}`,
    (route) => kitJson(route, { ...KIT_PROJECT, parent_uid: '', writer })
  );
  await page.route('**/api/projects/writer-summary*', (route) => kitJson(route, { hasWriterFoundation: writer, hasWriterProject: writer }));
  for (const project of [KIT_PROJECT.uid, KIT_PROJECT.slug]) {
    await page.route(`**/api/projects/${project}/sfid*`, (route) => kitJson(route, { sfid: null }));
  }
  await page.route('**/api/user/personas*', (route) =>
    kitJson(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: writer })
  );
  await page.route('**/api/nav/lens-items*', (route) => {
    const lens = new URL(route.request().url()).searchParams.get('lens') ?? 'project';
    return kitJson(route, {
      items: lens === 'project' || lens === 'foundation' ? [{ ...KIT_PROJECT, logoUrl: null, isFoundation: lens === 'foundation' }] : [],
      next_page_token: null,
      upstream_failed: false,
      lens,
    });
  });
  // Safety net: abort and FAIL the test for unexpected reads or writes, never hide a path regression.
  await page.route((url) => url.pathname.startsWith('/api/mktg-'), rejectUnexpected);
  await page.route(
    (url) => url.pathname === '/api/mktg-agents/slides-export/family/last',
    (route) => {
      const familyId = new URL(route.request().url()).searchParams.get('familyId');
      if (!isProjectRead(route) || !familyId) return rejectUnexpected(route);
      return kitJson(route, { last: null, currentMembers: [], skippedMembers: [], stale: false });
    }
  );
  const intakePaths = new Set(
    MKTG_DOCUMENT_TYPES.filter((type) => !!findMktgRunIntake(type.agentKey)).map((type) => `${MKTG_LAST_INTAKE_API}/${type.agentKey}/last`)
  );
  await page.route(
    (url) => intakePaths.has(url.pathname),
    (route) => (isProjectRead(route) ? kitJson(route, { intake: null }, writer ? 200 : 403) : rejectUnexpected(route))
  );
  await page.route(
    (url) => url.pathname === '/api/mktg-agents/foundation-message/stored',
    (route) => {
      if (!isProjectRead(route)) return rejectUnexpected(route);
      if (!options.approvedFramework) return kitJson(route, { code: 'NO_SYNTHETIC_APPROVED_FRAMEWORK' }, 404);
      const documentMarkdown = JSON.stringify(frameworkContent());
      const stored: MktgArtifactStoredResponse = {
        documentMarkdown,
        format: 'json',
        receipt: {
          project: KIT_PROJECT.uid,
          s3_key: 'synthetic/framework/approved.json',
          content_sha256: createHash('sha256').update(documentMarkdown).digest('hex'),
          version: 3,
          intake_mode: 'form',
        },
        revisionNumber: 3,
        sidecar: null,
      };
      return kitJson(route, stored);
    }
  );
  await page.route(
    (url) => url.pathname === '/api/mktg-agents/documents',
    async (route) => {
      if (!isProjectRead(route)) return rejectUnexpected(route);
      if (options.hold) await options.hold;
      const status = options.status ?? (writer ? 200 : 403);
      const listing = options.listing ?? kitDocuments(options.loaded);
      if (options.approvedFramework) {
        const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === 'foundation-message');
        if (!type) throw new Error('Missing synthetic framework type');
        const revision = kitRevision(type).revision;
        listing.approvedFramework = {
          agentKey: type.agentKey,
          revisionId: revision.id,
          revisionNumber: revision.number,
          contentSha256: revision.contentSha256,
        };
      }
      return kitJson(route, status === 200 ? listing : { error: 'Synthetic read failure' }, status);
    }
  );
  const frameworkType = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'foundation-message');
  if (!frameworkType) throw new Error('Framework document type missing from catalog');
  const framework = kitRevision(frameworkType, options.report);
  const documentPath = '/api/mktg-agents/documents/foundation-message/living';
  await page.route(
    (url) => url.pathname === documentPath,
    (route) => (isProjectRead(route) ? kitJson(route, framework) : rejectUnexpected(route))
  );
  await page.route(
    (url) => url.pathname === `${documentPath}/comments`,
    (route) => {
      if (!isProjectRead(route) || new URL(route.request().url()).searchParams.get('revision') !== framework.revision.id) return rejectUnexpected(route);
      return kitJson(route, { revisionId: framework.revision.id, threads: [] });
    }
  );
  // The framework asset view specifically reads the optional print-brand revision.
  await page.route(
    (url) => url.pathname === '/api/mktg-agents/brand-kit/stored',
    (route) => {
      if (!isProjectRead(route) || new URL(route.request().url()).searchParams.get('sidecar') !== 'true') return rejectUnexpected(route);
      const documentMarkdown = '# Synthetic legacy Brand Kit';
      const stored: MktgArtifactStoredResponse = {
        documentMarkdown,
        format: 'markdown',
        receipt: {
          s3_key: 'synthetic/brand-kit/legacy.md',
          content_sha256: createHash('sha256').update(documentMarkdown).digest('hex'),
          project: KIT_PROJECT.uid,
          version: 3,
          intake_mode: 'form',
        },
        sidecar: null,
        revisionNumber: 3,
      };
      return kitJson(route, stored);
    }
  );
  await page.route(
    (url) => url.pathname === '/api/mktg-agents/slides-export/last',
    (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (!isProjectRead(route) || params.get('agentKey') !== 'foundation-message' || params.get('documentId') !== 'living') return rejectUnexpected(route);
      return kitJson(route, { last: null, latestRevision: { id: framework.revision.id, number: 3, contentSha256: framework.revision.contentSha256 } });
    }
  );
  await page.route(
    (url) => url.pathname === `${documentPath}/revisions/${framework.revision.id}`,
    async (route) => {
      if (!isProjectRead(route)) return rejectUnexpected(route);
      if (options.revisionHold) await options.revisionHold;
      const status = options.revisionStatus ?? 200;
      return kitJson(route, status === 200 ? framework : { error: 'Synthetic revision failure' }, status);
    }
  );
}

async function seedKitContext(page: Page): Promise<void> {
  await page.context().clearCookies({ name: SELECTED_PROJECT_COOKIE_KEY });
  await page.context().clearCookies({ name: SELECTED_FOUNDATION_COOKIE_KEY });
  await page
    .context()
    .addCookies([{ name: SELECTED_PROJECT_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(KIT_PROJECT)), domain: 'localhost', path: '/' }]);
  await page.context().addCookies([
    {
      name: PERSONA_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ primary: 'executive-director', all: ['executive-director'] })),
      domain: 'localhost',
      path: '/',
    },
    { name: LENS_COOKIE_KEY, value: 'project', domain: 'localhost', path: '/' },
  ]);
}

/** SPA entry avoids SSR requests bypassing page.route. Also works at mobile widths. */
export async function openKit(page: Page, path = '', mount: 'project' | 'foundation' = 'project'): Promise<void> {
  // PersonaService always refreshes afterNextRender; a quiet SSR frame is not client readiness.
  const personaReady = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.pathname === '/api/user/personas' && !url.search;
    },
    { timeout: 20_000 }
  );
  await Promise.all([page.goto('/', { waitUntil: 'domcontentloaded' }), personaReady]);
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0, { timeout: 20_000 });
  // SSR sidebar attachment alone is not SPA readiness; use the established navigation-quiet gate.
  await waitForHydration(page);
  await seedKitContext(page);
  await page.evaluate((url) => {
    history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/${mount}/mktg-os-agents${path}?project=${KIT_PROJECT.slug}`);
}
