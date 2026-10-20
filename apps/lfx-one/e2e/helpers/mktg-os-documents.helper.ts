// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
  LENS_COOKIE_KEY,
  MKTG_DOCUMENT_TYPES,
  MKTG_OS_AGENTS_ENABLED_FLAG,
  PERSONA_COOKIE_KEY,
  SELECTED_PROJECT_COOKIE_KEY,
} from '@lfx-one/shared/constants';
import type { MktgDocumentDetailResponse, MktgDocumentsResponse, MktgRevisionSummary, Project } from '@lfx-one/shared/interfaces';
import { expect, Page, Route } from '@playwright/test';

import { mockProjects } from '../fixtures/mock-data/projects.mock';
import { suppressCookieBanner } from './account-settings-email.helper';
import { ApiMockHelper } from './api-mock.helper';

export const DOCUMENT_PROJECT = { uid: 'd0000000-0000-4000-8000-000000000001', slug: 'synthetic-documents', name: 'Synthetic Documents Project', writer: true };
export const DOCUMENT_TYPE = livingDocumentType();

function livingDocumentType() {
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.kind === 'living');
  if (!type) throw new Error('Documents fixtures require a living document type in the catalog');
  return type;
}
export const DOCUMENTS_URL = `/project/mktg-os-agents/documents?project=${DOCUMENT_PROJECT.slug}`;
export const DOCUMENT_VIEW_URL = `/project/mktg-os-agents/documents/${DOCUMENT_TYPE.agentKey}/living?project=${DOCUMENT_PROJECT.slug}`;

export function documentFixture(revisionCount: 3 | 9 = 3, currentNumber = 2): MktgDocumentDetailResponse {
  const revisions: MktgRevisionSummary[] = Array.from({ length: revisionCount }, (_, index) => revisionCount - index).map((number) => ({
    id: `${String(number).padStart(6, '0')}-${String(number).repeat(64)}`,
    number,
    createdAt: '2026-10-13T12:00:00.000Z',
    origin: 'generated',
    restoredFromNumber: null,
    intakeMode: 'form',
    status: '',
    contentSha256: String(number).repeat(64),
    format: 'markdown',
    commentCount: 0,
    latest: number === currentNumber,
    author: null,
  }));
  for (const revision of revisions) {
    if (revision.number > 2) revision.author = { name: 'The writer' };
    // v2 has a stored author whose name is unavailable; v1 has no author record.
    if (revision.number === 2) revision.author = { name: null };
  }
  revisions[0] = { ...revisions[0], origin: 'revised', commentCount: 4, basedOnNumber: 1 };
  const selected = revisions.find((revision) => revision.latest);
  if (!selected) throw new Error('Documents fixture requires a current revision in its history');
  return {
    project: DOCUMENT_PROJECT.uid,
    type: DOCUMENT_TYPE,
    documentId: 'living',
    revisions,
    current: { revisionId: selected.id, changedAt: '2026-10-14T12:00:00.000Z', changedBy: { name: 'The writer' } },
  };
}

export async function fulfillDocumentJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Only shell authentication uses the harness state; every domain read/write is synthetic. */
export async function setupDocuments(
  page: Page,
  options: {
    writer?: boolean;
    empty?: boolean;
    status?: number;
    writeStatus?: number;
    withoutCurrentRecord?: boolean;
    revisionCount?: 3 | 9;
    currentRevisionNumber?: number;
    longDocument?: boolean;
    revisionAuthorName?: string;
  } = {}
): Promise<void> {
  await suppressCookieBanner(page);
  const writer = options.writer ?? true;
  mockProjects[DOCUMENT_PROJECT.slug] = { ...DOCUMENT_PROJECT, parent_uid: '', public: true } as Project;
  await ApiMockHelper.setupProjectSlugMock(page, { writer });
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [MKTG_OS_AGENTS_ENABLED_FLAG]: true }),
  ] as const);
  const seedCookies = async (): Promise<void> => {
    await page.context().addCookies([
      {
        name: PERSONA_COOKIE_KEY,
        value: encodeURIComponent(JSON.stringify({ primary: 'executive-director', all: ['executive-director'] })),
        domain: 'localhost',
        path: '/',
      },
      { name: LENS_COOKIE_KEY, value: 'project', domain: 'localhost', path: '/' },
      { name: SELECTED_PROJECT_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(DOCUMENT_PROJECT)), domain: 'localhost', path: '/' },
    ]);
  };
  await seedCookies();
  await page.route('**/api/user/personas*', (route) =>
    fulfillDocumentJson(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  await page.route('**/api/projects/*/sfid*', (route) => fulfillDocumentJson(route, { sfid: null }));
  await page.route('**/api/nav/lens-items*', (route) => {
    const lens = new URL(route.request().url()).searchParams.get('lens');
    return fulfillDocumentJson(route, {
      items: lens === 'project' ? [{ ...DOCUMENT_PROJECT, logoUrl: null, isFoundation: false }] : [],
      next_page_token: null,
      upstream_failed: false,
      lens,
    });
  });
  let detail = documentFixture(options.revisionCount, options.currentRevisionNumber);
  if (options.revisionAuthorName !== undefined) {
    const name = options.revisionAuthorName;
    detail = {
      ...detail,
      revisions: detail.revisions.map((revision) => {
        if (!revision.author) return revision;
        return { ...revision, author: { ...revision.author, name } };
      }),
    };
  }
  if (options.withoutCurrentRecord) {
    detail = {
      ...detail,
      current: null,
      revisions: detail.revisions.map((revision) => ({ ...revision, latest: revision.number === (options.revisionCount ?? 3), author: null })),
    };
  }
  await page.route('**/api/mktg-agents/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const status = writer ? (options.status ?? 200) : 403;
    if (status !== 200) return fulfillDocumentJson(route, { code: status === 404 ? 'MKTG_DOCUMENT_NOT_FOUND' : 'DENIED' }, status);
    if (route.request().method() === 'POST' && path.endsWith('/restore')) {
      if (options.writeStatus)
        return fulfillDocumentJson(route, { code: options.writeStatus === 404 ? 'MKTG_DOCUMENT_NOT_FOUND' : 'DENIED' }, options.writeStatus);
      const { revisionId } = route.request().postDataJSON() as { revisionId: string };
      const selected = detail.revisions.find((revision) => revision.id === revisionId);
      if (!selected) return fulfillDocumentJson(route, { code: 'NOT_FOUND' }, 404);
      detail = {
        ...detail,
        revisions: detail.revisions.map((revision) => ({ ...revision, latest: revision.id === revisionId })),
        current: { revisionId, changedAt: '2026-10-15T13:00:00.000Z', changedBy: { name: 'The writer' } },
      };
      return fulfillDocumentJson(route, { ...detail, revision: { ...selected, latest: true } });
    }
    if (path.endsWith('/documents')) {
      const current = detail.revisions.find((revision) => revision.latest);
      if (!current) throw new Error('Documents fixture has no current revision');
      const response: MktgDocumentsResponse = {
        project: DOCUMENT_PROJECT.uid,
        groups: MKTG_DOCUMENT_TYPES.map((type) => ({
          type,
          documents:
            !options.empty && type.agentKey === DOCUMENT_TYPE.agentKey
              ? [
                  {
                    agentKey: type.agentKey,
                    documentId: 'living',
                    revisionCount: detail.revisions.length,
                    latestRevisionId: current.id,
                    currentRevisionNumber: current.number,
                    updatedAt: current.createdAt,
                    createdAt: detail.revisions[detail.revisions.length - 1].createdAt,
                  },
                ]
              : [],
        })),
      };
      return fulfillDocumentJson(route, response);
    }
    if (path.includes('/revisions/')) {
      const revision = detail.revisions.find((entry) => path.endsWith(entry.id));
      if (!revision) return fulfillDocumentJson(route, { code: 'NOT_FOUND' }, 404);
      let markdown = `# Revision ${revision.number}\n\nSynthetic document text.`;
      if (options.longDocument) {
        markdown +=
          '\n\n' +
          Array.from(
            { length: 24 },
            (_, index) =>
              `## Section ${index + 1}\n\nSynthetic document text for reading a long revision. The history bar should remain reachable while this content scrolls.`
          ).join('\n\n');
      }
      return fulfillDocumentJson(route, { ...detail, revision, markdown });
    }
    if (path.endsWith('/living')) return fulfillDocumentJson(route, detail);
    return fulfillDocumentJson(route, {}, 404);
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 20_000 });
  await seedCookies();
}

/** SPA navigation keeps all project reads in page.route rather than server-side SSR. */
export async function openDocuments(page: Page, url = DOCUMENTS_URL): Promise<void> {
  await page.evaluate((destination) => {
    history.pushState({}, '', destination);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
  await expect(page.getByTestId('mktg-documents-page').or(page.getByTestId('mktg-document-view-page'))).toBeVisible({ timeout: 20_000 });
}
