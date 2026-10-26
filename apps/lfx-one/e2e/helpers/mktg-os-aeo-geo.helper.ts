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
import type { AeoGeoAnswersBody, MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { expect, Page } from '@playwright/test';
import { ApiMockHelper } from './api-mock.helper';
import { suppressCookieBanner } from './account-settings-email.helper';
import { aeoGeoEnvelopeFixture, aeoGeoQuestionsFixture } from '../../../../packages/shared/src/utils/aeo-geo.fixture';
import { aeoGeoRunQuestions } from '../../../../packages/shared/src/utils/aeo-geo.utils';

export const PAGE_LOAD_TIMEOUT = 20_000;
export const AUDIT_PROJECT = { uid: 'audit-project-1', slug: 'audit-e2e-project', name: 'Synthetic Audit Project' };
export const AUDIT_BASE = `/project/mktg-os-agents`;
const TYPE = (() => {
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'aeo-geo');
  if (!type) {
    throw new Error('Audit fixture type is not registered.');
  }
  return type;
})();
export const AUDIT_MARKDOWN =
  "# AEO/GEO Analysis: project.example\n\nOverall score: **6.5 / 10** — Strong basics, thin external authority.\n\n## Scorecard\n\nSynthetic source evidence.\n\n## What's working\n\nThe homepage gives a clear definition.\n\n## Recommendations (priority order)\n\n1. Add a detailed FAQ.\n\n## Caveats & unverified items\n\nClient-injected metadata is unverified.\n\n## Sources\n\nhttps://project.example/\nhttps://project.example/about\nhttps://project.example/faq\nhttps://project.example/blog\nhttps://project.example/guide\n";
export function auditDocument(documentId: string, keyPagesNamed = 2, typed = false): MktgRevisionResponse {
  const revision = {
    id: `000001-${'a'.repeat(64)}`,
    number: 1,
    createdAt: '2026-10-15T10:00:00Z',
    origin: 'generated' as const,
    restoredFromNumber: null,
    intakeMode: 'form' as const,
    status: '',
    contentSha256: 'a'.repeat(64),
    format: 'markdown' as const,
    commentCount: 0,
    latest: true,
    approval: null,
  };
  const response: MktgRevisionResponse = {
    project: AUDIT_PROJECT.uid,
    type: TYPE,
    documentId,
    revisions: [revision],
    revision,
    approval: null,
    approvedCurrent: null,
    markdown: AUDIT_MARKDOWN,
    sidecar: null,
    aeoGeoReport: {
      domain: 'project.example',
      report_filename: 'project.example AEO-GEO Report.md',
      overall_score: 6.5,
      verdict: 'Strong basics, thin external authority',
      auditCounts: { keyPagesNamed, pagesAudited: 5 },
      scores: { ai_crawler_access: 9, llms_txt: 3, content_answerability: 7, technical_metadata: 8, external_authority: 4, content_depth_freshness: 8 },
    },
  };
  if (typed) {
    const recorded = aeoGeoEnvelopeFixture();
    response.markdown = recorded.document_markdown;
    response.sidecar = { ...recorded };
    revision.contentSha256 = recorded.content_sha256;
    revision.id = `000001-${recorded.content_sha256}`;
    response.aeoGeoReport = {
      domain: recorded.domain,
      report_filename: recorded.report_filename,
      overall_score: recorded.overall_score,
      verdict: recorded.verdict,
      scores: recorded.scores,
      report: recorded.report,
      auditCounts: { keyPagesNamed: recorded.inputs.key_pages_count ?? 0, pagesAudited: recorded.inputs.pages_audited.length },
    };
  }
  return response;
}

/** Stub every Marketing OS call; nothing creates a live Guild session or writes a real document. */
export async function setupAudit(page: Page, options: { writer?: boolean; previous?: boolean; questions?: boolean; typed?: boolean } = {}) {
  await suppressCookieBanner(page);
  const state = {
    reportReady: false,
    persisted: false,
    generateError: false,
    documentsError: false,
    showActivity: false,
    answersSent: false,
    refused: false,
    revisionReadError: false,
  };
  const answers: AeoGeoAnswersBody[] = [];
  const sessions = new Map<string, string>();
  const documents = new Map<string, MktgRevisionResponse>();
  const namedCounts = new Map<string, number>();
  let count = 1;
  const id = () => `run-${(count++).toString(16).padStart(24, '0')}`;
  if (options.previous) {
    const previous = id();
    documents.set(previous, auditDocument(previous, 2, options.typed));
  }
  await ApiMockHelper.setupProjectSlugMock(page, { writer: options.writer ?? true });
  await page.route(`**/api/projects/${AUDIT_PROJECT.slug}*`, (route) =>
    route.fulfill({ json: { ...AUDIT_PROJECT, writer: options.writer ?? true, parent_uid: '', website_url: 'https://project.example/' } })
  );
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({ json: { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true } })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ json: { sfid: null } }));
  await page.route('**/api/nav/lens-items*', (route) => {
    const lens = new URL(route.request().url()).searchParams.get('lens');
    return route.fulfill({
      json: {
        items: lens === 'project' ? [{ ...AUDIT_PROJECT, logoUrl: null, isFoundation: false }] : [],
        lens: lens ?? 'project',
        next_page_token: null,
        upstream_failed: false,
      },
    });
  });
  await page.route('**/api/mktg-agents/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith('/aeo-geo/generate')) {
      if (state.generateError) {
        return route.fulfill({ status: 500, json: { error: 'Synthetic generation outage' } });
      }
      const documentId = id();
      const sessionId = `synthetic-session-${documentId}`;
      sessions.set(sessionId, documentId);
      const pages = route.request().postDataJSON().answers.key_pages as string | undefined;
      namedCounts.set(documentId, pages?.split('\n').filter((url) => url.trim()).length ?? 0);
      return route.fulfill({ json: { documentId, sessionId, ownerToken: 'synthetic-owner-proof' } });
    }
    if (path.endsWith('/aeo-geo/answers')) {
      answers.push(route.request().postDataJSON());
      state.answersSent = true;
      return route.fulfill({ json: { success: true } });
    }
    if (path.endsWith('/aeo-geo/result')) {
      if (state.refused) {
        return route.fulfill({ json: { status: 'refused', reply: 'The target is unreachable. Can you confirm the domain?' } });
      }
      if (options.questions && !state.answersSent) {
        return route.fulfill({
          json: { status: 'questions', questions: aeoGeoRunQuestions(aeoGeoQuestionsFixture()), questionsId: 'synthetic-questions', activity: [] },
        });
      }
      const documentId = sessions.get(route.request().postDataJSON().sessionId);
      if (!documentId) {
        return route.fulfill({ status: 400, json: { error: 'Unknown synthetic session' } });
      }
      if (!state.reportReady) {
        return route.fulfill({
          json: {
            status: 'pending',
            ...(state.showActivity && {
              activity: [{ id: 'step-1', kind: 'reading', label: 'Reading project.example', status: 'running', startedAt: new Date().toISOString() }],
            }),
          },
        });
      }
      const document = auditDocument(documentId, namedCounts.get(documentId) ?? 0, options.typed);
      if (state.persisted) {
        documents.set(documentId, document);
      }
      return route.fulfill({
        json: {
          status: 'ready',
          version: 1,
          documentMarkdown: document.markdown,
          ...(state.persisted
            ? { persistence: { project: AUDIT_PROJECT.uid, content_sha256: document.revision.contentSha256, s3_key: 'synthetic/report.md', version: 1 } }
            : {}),
        },
      });
    }
    if (path.endsWith('/documents')) {
      if (state.documentsError) {
        return route.fulfill({ status: 503, json: { error: 'Synthetic store outage' } });
      }
      return route.fulfill({
        json: {
          project: AUDIT_PROJECT.uid,
          groups: MKTG_DOCUMENT_TYPES.map((type) => ({
            type,
            documents:
              type.agentKey === TYPE.agentKey
                ? [...documents.values()].map((doc) => ({
                    agentKey: TYPE.agentKey,
                    documentId: doc.documentId,
                    revisionCount: 1,
                    latestRevisionId: doc.revision.id,
                    createdAt: doc.revision.createdAt,
                    updatedAt: doc.revision.createdAt,
                  }))
                : [],
          })),
        },
      });
    }
    const documentId = path.split('/')[5];
    const doc = documents.get(documentId);
    if (doc && method === 'GET') {
      if (state.revisionReadError) return route.fulfill({ status: 503, json: { error: 'Synthetic stored revision read outage' } });
      return route.fulfill({ json: doc });
    }
    return route.fulfill({ status: 404, json: { error: 'Synthetic document not stored' } });
  });
  await page.addInitScript(([key, flag]) => localStorage.setItem(key, JSON.stringify({ [flag]: true })), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    MKTG_OS_AGENTS_ENABLED_FLAG,
  ] as const);
  const cookies = async () =>
    page.context().addCookies([
      {
        name: PERSONA_COOKIE_KEY,
        value: encodeURIComponent(JSON.stringify({ primary: 'executive-director', all: ['executive-director'] })),
        domain: 'localhost',
        path: '/',
      },
      { name: LENS_COOKIE_KEY, value: 'project', domain: 'localhost', path: '/' },
      { name: SELECTED_PROJECT_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(AUDIT_PROJECT)), domain: 'localhost', path: '/' },
    ]);
  await cookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
  await cookies();
  const go = async (path: string) =>
    page.evaluate((url) => {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `${AUDIT_BASE}${path}?project=${AUDIT_PROJECT.slug}`);
  return { state, documents, go, answers, sessions };
}
