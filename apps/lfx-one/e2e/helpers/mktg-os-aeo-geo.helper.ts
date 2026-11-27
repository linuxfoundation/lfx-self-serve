// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LENS_COOKIE_KEY, MKTG_DOCUMENT_TYPES, PERSONA_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import type { AeoGeoAnswersBody, MktgActiveRunConflict, MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { expect, Page } from '@playwright/test';
import { ApiMockHelper } from './api-mock.helper';
import { suppressCookieBanner } from './account-settings-email.helper';
import { pinMktgOsFlags } from './mktg-os-flags.helper';
import { aeoGeoEnvelopeFixture, aeoGeoQuestionsFixture } from '@lfx-one/shared/utils/aeo-geo.fixture';
import { aeoGeoRunQuestions, isAeoGeoSubmittedAnswers } from '@lfx-one/shared/utils/aeo-geo.utils';

export const PAGE_LOAD_TIMEOUT = 20_000;
export const AUDIT_PROJECT = { uid: 'audit-project-1', slug: 'audit-e2e-project', name: 'Synthetic Audit Project' };
export const AUDIT_BASE = `/project/mktg-os-agents`;
/** The BFF's 409 for a second start: the requester's own audit the run tracker still lists (who and when). */
export const AUDIT_ACTIVE_RUN: MktgActiveRunConflict = {
  code: 'MKTG_RUN_ACTIVE',
  message: 'Your AEO/GEO report run is in progress.',
  startedBy: 'Another writer',
  startedByViewer: true,
  startedAt: '2026-10-19T12:00:00.000Z',
  activeRunId: 'd'.repeat(64),
  state: 'writing',
  agentKey: 'aeo-geo',
  documentId: 'run-ffffffffffffffffffffffff',
};
const QUESTIONS_ID = 'c'.repeat(64);
/** The question about what to leave out, as aeo-geo 2.1.2 asks it: always the id exclude, here with nothing to suggest. */
const EXCLUDE_QUESTION = {
  id: 'exclude',
  question: 'Is there anything this audit should leave out: pages, sections or comparisons?',
  why: 'Neither the site nor the notes say what is out of scope for this audit.',
  suggested_answer: '',
  basis: '',
};
/** The stub's opaque run id for a session's document, as Generate returns it and an answers conflict repeats it. */
const runIdOf = (documentId: string): string => documentId.slice('run-'.length).padStart(64, '0');
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
    // The recorded typed report quotes with ', the live agent with Markdown backticks: the print and web specs read a code span.
    const report = recorded.report && {
      ...recorded.report,
      findings: recorded.report.findings.map((finding, index) =>
        index === 0 ? { ...finding, detail: finding.detail.replace("'User-agent: *'", '`User-agent: *`') } : finding
      ),
    };
    response.aeoGeoReport = {
      domain: recorded.domain,
      report_filename: recorded.report_filename,
      overall_score: recorded.overall_score,
      verdict: recorded.verdict,
      scores: recorded.scores,
      report,
      auditCounts: { keyPagesNamed: recorded.inputs.key_pages_count ?? 0, pagesAudited: recorded.inputs.pages_audited.length },
    };
  }
  return response;
}

/**
 * Stub every Marketing OS call; nothing creates a live Guild session or writes a real document.
 * `exclude`: the questions turn also asks the exclude question, last. It only changes the stubbed turn; no state is written for it.
 */
export async function setupAudit(page: Page, options: { writer?: boolean; previous?: boolean; questions?: boolean; typed?: boolean; exclude?: boolean } = {}) {
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
    revisionReadFailures: 0,
    /** The tracker lists an audit of this requester: Generate answers 409 until a start names it in `discard`. Written by the Generate stub only. */
    activeRun: false,
    /** Who already answered the questions turn: the answers stub then answers 409 MKTG_RUN_ANSWERED. Read by the answers stub only. */
    answeredBy: '',
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
      const start = route.request().postDataJSON();
      if (state.activeRun && start.discard !== AUDIT_ACTIVE_RUN.activeRunId) {
        return route.fulfill({ status: 409, json: AUDIT_ACTIVE_RUN });
      }
      state.activeRun = false;
      const documentId = id();
      const sessionId = `synthetic-session-${documentId}`;
      sessions.set(sessionId, documentId);
      const pages = start.answers.key_pages as string | undefined;
      namedCounts.set(documentId, pages?.split('\n').filter((url) => url.trim()).length ?? 0);
      return route.fulfill({ json: { documentId, sessionId, runId: runIdOf(documentId), ownerToken: 'synthetic-owner-proof' } });
    }
    if (path.endsWith('/aeo-geo/answers')) {
      const sent: AeoGeoAnswersBody = route.request().postDataJSON();
      // The BFF's own input policy: a non-answer is a plain 400, and only the exclude question takes a literal none.
      if (!isAeoGeoSubmittedAnswers(sent.answers)) {
        return route.fulfill({ status: 400, json: { error: 'Synthetic answers refusal' } });
      }
      answers.push(sent);
      // Either way the questions turn is answered: by this request, or by the one that won it first.
      state.answersSent = true;
      if (state.answeredBy) {
        return route.fulfill({
          status: 409,
          json: {
            code: 'MKTG_RUN_ANSWERED',
            message: `Already answered by ${state.answeredBy}`,
            runId: runIdOf(sessions.get(sent.sessionId) ?? ''),
            questionsId: sent.questionsId,
            answeredBy: state.answeredBy,
            answeredAt: new Date().toISOString(),
          },
        });
      }
      return route.fulfill({ json: { success: true } });
    }
    if (path.endsWith('/aeo-geo/result')) {
      if (state.refused) {
        return route.fulfill({ json: { status: 'refused', reply: 'The target is unreachable. Can you confirm the domain?' } });
      }
      if (options.questions && !state.answersSent) {
        const turn = aeoGeoQuestionsFixture();
        if (options.exclude) {
          turn.questions.push(EXCLUDE_QUESTION);
        }
        return route.fulfill({ json: { status: 'questions', questions: aeoGeoRunQuestions(turn), questionsId: QUESTIONS_ID, activity: [] } });
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
      if (state.revisionReadError && path.includes('/revisions/')) {
        state.revisionReadFailures++;
        return route.fulfill({ status: 503, json: { error: 'Synthetic stored revision read outage' } });
      }
      return route.fulfill({ json: doc });
    }
    return route.fulfill({ status: 404, json: { error: 'Synthetic document not stored' } });
  });
  await pinMktgOsFlags(page);
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
