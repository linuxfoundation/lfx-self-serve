// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_CONTRACT_ID } from '@lfx-one/shared/constants/brand-kit.constants';
import { BRAND_KIT_INTAKE, FOUNDATION_MESSAGE_INTAKE } from '@lfx-one/shared/constants/mktg-run.constants';
import { FOUNDATION_MESSAGE_WEBSITE_KEY } from '@lfx-one/shared/constants/foundation-message.constants';
import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MKTG_OS_AGENTS_ENABLED_FLAG } from '@lfx-one/shared/constants/feature-flags.constants';
import { LENS_COOKIE_KEY } from '@lfx-one/shared/constants/lens.constants';
import { MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants/mktg-document-store.constants';
import { MKTG_SLIDES_EXPORT_API_PATH } from '@lfx-one/shared/constants/mktg-slides-export.constants';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants/persona.constants';
import { SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants/project-context.constants';
import type { BoilerplatesEnvelope } from '@lfx-one/shared/interfaces/boilerplates.interface';
import type { FaqEnvelope } from '@lfx-one/shared/interfaces/faq.interface';
import type { MktgFrameworkAsset, MktgRunResultResponse } from '@lfx-one/shared/interfaces/mktg-run.interface';
import type { MktgRevisionResponse, MktgRevisionSummary } from '@lfx-one/shared/interfaces/mktg-document-store.interface';
import type { MktgDocumentRunProgress } from '@lfx-one/shared/interfaces/mktg-document-run.interface';
import type { Project } from '@lfx-one/shared/interfaces/project.interface';
import { buildMktgRunActivity } from '@lfx-one/shared/utils/mktg-run-activity.utils';
import { noQuestionsActivityPayloads } from '@lfx-one/shared/utils/__fixtures__/mktg-run-activity.no-questions';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, Page } from '@playwright/test';
import { mockProjects } from '../fixtures/mock-data/projects.mock';
import { suppressCookieBanner } from './account-settings-email.helper';
import { ApiMockHelper } from './api-mock.helper';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';

const PAGE_LOAD_TIMEOUT = 20_000;

export const ASSET_PROJECT: Project = {
  uid: 'p0000000-0000-0000-0000-00000000a551',
  slug: 'asset-view-example',
  name: 'Asset Example',
  description: 'Synthetic collaboration project.',
  public: true,
  parent_uid: '',
  stage: 'graduated',
  category: 'project',
  funding_model: [],
  charter_url: '',
  legal_entity_type: '',
  legal_entity_name: '',
  legal_parent_uid: '',
  autojoin_enabled: false,
  formation_date: '2026-10-01',
  logo_url: '',
  repository_url: '',
  website_url: 'https://project.example',
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
  mailing_list_count: 0,
};

/** Header/approval scenarios reuse main's canonical FAQ envelope, not a second FAQ contract fixture. */
export function nativeAssetRevisionResponse(key: 'faq' | 'boilerplates', unreadable = false): MktgRevisionResponse {
  const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === key);
  if (!type) throw new Error('Missing document type');
  const revision: MktgRevisionSummary = {
    id: `000001-${'a'.repeat(64)}`,
    number: 1,
    createdAt: '2026-10-19T10:00:00Z',
    origin: 'generated',
    restoredFromNumber: null,
    intakeMode: 'form',
    status: '',
    contentSha256: 'a'.repeat(64),
    format: 'json',
    commentCount: 0,
    latest: true,
    approval: null,
  };
  const fixtureName = key === 'faq' ? 'faq-envelope.json' : 'boilerplates.envelope.json';
  const native = JSON.parse(readFileSync(resolve(__dirname, '../../../../packages/shared/src/utils/__fixtures__', fixtureName), 'utf8')) as
    | FaqEnvelope
    | BoilerplatesEnvelope;
  return {
    project: ASSET_PROJECT.uid,
    type,
    documentId: 'living',
    revisions: [revision],
    approvedCurrent: null,
    approval: null,
    revision,
    markdown: unreadable ? '{"unexpected":"synthetic source text"}' : JSON.stringify(native.content),
    sidecar: { mode: native.mode, report: native.report, checks: native.checks },
  };
}

/** All four native document layouts use synthetic assets and the real document read contract. */
export function columnAssetRevisionResponse(key: 'faq' | 'boilerplates' | 'foundation-message' | 'brand-kit'): MktgRevisionResponse {
  const base = nativeAssetRevisionResponse('faq');
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === key);
  if (!type) throw new Error('Missing native document type');
  let response = { ...base, type };
  if (key === 'boilerplates') {
    const envelope = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../packages/shared/src/utils/__fixtures__/boilerplates.envelope.json'), 'utf8')
    ) as BoilerplatesEnvelope;
    response = { ...response, markdown: JSON.stringify(envelope.content), sidecar: { mode: envelope.mode, report: envelope.report, checks: envelope.checks } };
  } else if (key === 'foundation-message') {
    const framework = draftFrameworkAsset();
    response = {
      ...response,
      markdown: JSON.stringify(framework.content),
      sidecar: { mode: framework.mode, report: framework.report, checks: framework.checks },
    };
  } else if (key === 'brand-kit') {
    const kit = brandKitTestRevision();
    response = {
      ...response,
      markdown: '',
      sidecar: {
        contract: BRAND_KIT_CONTRACT_ID,
        project_name: kit.projectName,
        project: kit.project,
        version: kit.version,
        mode: kit.mode,
        kit: kit.kit,
        chapters: kit.chapters,
        report: kit.report,
        inputs: { website_url: kit.websiteUrl },
        generated_at: kit.generatedAt,
        agent: { agent_version: kit.agentVersion },
      },
    };
  }
  const approval = { approvedAt: '2026-10-19T11:00:00Z', approvedBy: null };
  const revision = { ...response.revision, approval };
  return { ...response, revision, revisions: [revision], approval, approvedCurrent: { revisionId: revision.id, number: revision.number } };
}

/** Synthetic preview: no live generation, credentials or customer data. */
export function draftFrameworkAsset(): MktgFrameworkAsset {
  return {
    kind: 'messaging-framework',
    mode: 'draft',
    content: {
      mf: {
        vision: 'Open collaboration.',
        mission: 'Build together.',
        positioning: 'A synthetic toolkit for contributors.',
        tagline: 'Build openly.',
        goals: [
          {
            id: 'adoption',
            n: 1,
            t: 'Adoption',
            vp: 'Collaborate.',
            key: 'Build openly.',
            proof: [['1,200 contributors', 'Website']],
            bite: 'Open collaboration',
            icps: ['users'],
          },
        ],
        crosscut: 'Every goal grows the audience.',
        say: ['open collaboration'],
        avoid: [],
        anchor: ['Which goal does this serve?'],
        notes: '',
      },
      icp: [
        {
          id: 'users',
          name: 'End users',
          kind: 'Individual',
          who: 'Contributors.',
          goals: ['adoption'],
          need: 'Collaborate.',
          value: 'Open tools.',
          lead: 'Build openly.',
          proof: [['1,200 contributors', 'Website']],
          cta: 'Contribute.',
          channels: ['Docs'],
          objection: ['Too early?', null],
          personas: [['Contributor', 'reliability']],
          basis: 'Website',
        },
      ],
      mh: {
        umbrella: 'Open collaboration.',
        line: 'Build openly.',
        pillars: [{ t: 'Open', m: 'Build together.', p: [['Open development', 'Docs']] }],
        found: 'A Linux Foundation project.',
        aud: [['End users', 'Build openly.']],
      },
      nums: [['1,200', 'contributors']],
    },
    report: { sources_read: [], sources_failed: [], gaps: [], notes: '' },
    checks: { findings: [] },
  };
}

/** Loaded asset without approval: real controls must remain gated, not just the metadata badge. */
export async function openUnapprovedAssetDocument(page: Page, key: 'foundation-message' | 'brand-kit', pendingApproval = false): Promise<void> {
  await openAssetDocument(page, 'faq');
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === key);
  if (!type) throw new Error('Missing synthetic document type');
  const base = nativeAssetRevisionResponse('faq');
  const framework = draftFrameworkAsset();
  const kit = brandKitTestRevision();
  const sidecar =
    key === 'brand-kit'
      ? {
          contract: 'brand-kit-output/v2',
          project_name: kit.projectName,
          project: kit.project,
          version: kit.version,
          mode: kit.mode,
          kit: kit.kit,
          chapters: kit.chapters,
          report: kit.report,
          inputs: { website_url: kit.websiteUrl },
          generated_at: kit.generatedAt,
          agent: { agent_version: kit.agentVersion },
        }
      : { content: framework.content, report: framework.report, checks: framework.checks, mode: framework.mode };
  const revision = { ...base.revision, latest: !pendingApproval };
  const approved = { ...revision, id: `000002-${'b'.repeat(64)}`, number: 2, latest: true, approval: { approvedAt: '2026-10-19T11:00:00Z', approvedBy: null } };
  const response = {
    ...base,
    type,
    sidecar,
    revision,
    revisions: pendingApproval ? [approved, revision] : [revision],
    approvedCurrent: pendingApproval ? { revisionId: approved.id, number: 2 } : null,
    markdown: JSON.stringify(framework.content),
  };
  await page.route(`**${BRAND_KIT_INTAKE.endpoints.stored}**`, (route) => route.fulfill({ status: 404, json: { error: 'No approved branding' } }));
  await page.route(`**/api/mktg-agents/documents/${key}/living?*`, (route) => route.fulfill({ json: response }));
  await page.route(`**/api/mktg-agents/documents/${key}/living/revisions/**`, (route) => {
    // Deliberately hold the approved GET while the test asserts the eager last-export read.
    if (pendingApproval && new URL(route.request().url()).pathname.endsWith(approved.id)) return;
    return route.fulfill({ json: response });
  });
  await page.evaluate(
    (url) => {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    `/project/mktg-os-agents/documents/${key}/living?project=${ASSET_PROJECT.slug}${pendingApproval ? '&revision=' + revision.id : ''}`
  );
  await expect(page.getByTestId('mktg-document-view-page')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

/** The run owns research/writing until the server supplies its exact stored-revision receipt. */
export async function openDraftAssetRun(page: Page, immediateReceipt = true) {
  const asset = draftFrameworkAsset();
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === FOUNDATION_MESSAGE_INTAKE.agentId);
  if (!type) throw new Error('Missing framework document type');
  const base = nativeAssetRevisionResponse('faq');
  const revisionId = base.revision.id;
  const runId = 'b'.repeat(64);
  const state = { started: false, finished: false, persisted: false, readyWithoutReceiptPolls: 0, posts: [] as string[] };
  const response: MktgRevisionResponse = {
    ...base,
    type,
    current: { revisionId, changedAt: base.revision.createdAt, changedBy: null },
    markdown: JSON.stringify(asset.content),
    sidecar: { content: asset.content, report: asset.report, checks: asset.checks, mode: asset.mode },
    runs: [],
  };
  const runs = (): MktgDocumentRunProgress[] => {
    if (!state.started || state.persisted) return [];
    return [
      {
        project: ASSET_PROJECT.uid,
        agentKey: type.agentKey,
        documentId: 'living',
        runId,
        state: state.finished ? 'storing' : 'writing',
        startedAt: base.revision.createdAt,
      },
    ];
  };
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/mktg-') && request.method() === 'POST') state.posts.push(path);
  });
  // Register before the precise routes: no unhandled marketing request reaches a live agent or store.
  await page.route('**/api/mktg-*/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: { error: 'Unexpected synthetic write' } });
    if (path.endsWith('/comments')) return route.fulfill({ json: { revisionId, threads: [] } });
    if (path.endsWith('/documents')) return route.fulfill({ json: { project: ASSET_PROJECT.uid, groups: [], runs: runs() } });
    if (path.includes('/intakes/') && path.endsWith('/last')) return route.fulfill({ json: { intake: null } });
    if (path.endsWith('/last')) return route.fulfill({ json: { last: null, latestRevision: null } });
    return route.fulfill({ status: 503, json: { error: 'Unexpected synthetic read' } });
  });
  await openAssetDocument(page, 'faq');
  await page.route(`**${FOUNDATION_MESSAGE_INTAKE.endpoints.generate}`, (route) => {
    state.started = true;
    return route.fulfill({ json: { sessionId: 'synthetic-run-session', ownerToken: 'synthetic-run-capability', runId } });
  });
  await page.route(`**${FOUNDATION_MESSAGE_INTAKE.endpoints.result}`, (route) => {
    const result: MktgRunResultResponse = { status: 'pending', activity: buildMktgRunActivity(noQuestionsActivityPayloads('checked', true)) };
    if (state.finished) {
      result.status = 'ready';
      result.version = 1;
      result.documentMarkdown = '';
      result.asset = asset;
      if (state.persisted) {
        result.persistence = {
          s3_key: `documents/${ASSET_PROJECT.uid}/${type.agentKey}/living/${revisionId}.json`,
          content_sha256: base.revision.contentSha256,
          project: ASSET_PROJECT.uid,
          version: 1,
          document_location: { agent_key: type.agentKey, document_id: 'living', revision_id: revisionId },
        };
      } else state.readyWithoutReceiptPolls++;
    }
    return route.fulfill({ json: result });
  });
  await page.route(`**${BRAND_KIT_INTAKE.endpoints.stored}**`, (route) => route.fulfill({ status: 404, json: { error: 'No approved branding' } }));
  await page.route(`**/api/mktg-agents/documents/${type.agentKey}/living?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const json = state.persisted ? response : { project: ASSET_PROJECT.uid, type, documentId: 'living', revisions: [], approvedCurrent: null, runs: runs() };
    return route.fulfill({ json });
  });
  await page.route(`**/api/mktg-agents/documents/${type.agentKey}/living/revisions/**`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: response }) : route.fallback()
  );
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/${FOUNDATION_MESSAGE_INTAKE.agentId}?project=${ASSET_PROJECT.slug}`);
  await expect(page.getByTestId('mktg-agent-run-submit-button')).toBeVisible();
  await page.locator('[data-test="mktg-intake-project_name"]').fill(ASSET_PROJECT.name);
  await page.locator(`[data-test="mktg-intake-${FOUNDATION_MESSAGE_WEBSITE_KEY}"]`).fill('https://project.example');
  const firstResult = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === FOUNDATION_MESSAGE_INTAKE.endpoints.result
  );
  await page.getByTestId('mktg-agent-run-submit-button').getByRole('button').click();
  await firstResult;
  await expect(page.getByTestId('mktg-agent-run-status')).toContainText('You can leave', { timeout: PAGE_LOAD_TIMEOUT });
  await expect(page).not.toHaveURL(/\/documents\//);
  return {
    revisionId,
    state,
    generatePath: FOUNDATION_MESSAGE_INTAKE.endpoints.generate,
    resultPath: FOUNDATION_MESSAGE_INTAKE.endpoints.result,
    finish: () => {
      state.finished = true;
      state.persisted = immediateReceipt;
    },
    persist: () => {
      state.finished = true;
      state.persisted = true;
    },
  };
}

/** Stub native asset reads; cookie suppression precedes every navigation. */
export async function openAssetDocument(
  page: Page,
  key: 'faq' | 'boilerplates' | 'foundation-message' | 'brand-kit',
  status = 200,
  writer = true,
  unreadable = false,
  responseOverride?: MktgRevisionResponse
): Promise<void> {
  await suppressCookieBanner(page);
  mockProjects[ASSET_PROJECT.slug] = ASSET_PROJECT;
  await ApiMockHelper.setupProjectSlugMock(page, { writer });
  await page.addInitScript(([storageKey, flag]) => localStorage.setItem(storageKey, JSON.stringify({ [flag]: true })), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    MKTG_OS_AGENTS_ENABLED_FLAG,
  ] as const);
  const cookies = [
    { name: PERSONA_COOKIE_KEY, value: { primary: 'executive-director', all: ['executive-director'] } },
    { name: LENS_COOKIE_KEY, value: 'project' },
    { name: SELECTED_PROJECT_COOKIE_KEY, value: { uid: ASSET_PROJECT.uid, slug: ASSET_PROJECT.slug, name: ASSET_PROJECT.name } },
  ].map(({ name, value }) => ({ name, value: typeof value === 'string' ? value : encodeURIComponent(JSON.stringify(value)), domain: 'localhost', path: '/' }));
  await page.context().addCookies(cookies);
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({ json: { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: writer } })
  );
  await page.route('**/api/nav/lens-items*', (route) => {
    const projectLens = new URL(route.request().url()).searchParams.get('lens') === 'project';
    return route.fulfill({
      json: { items: projectLens ? [ASSET_PROJECT] : [], next_page_token: null, upstream_failed: false, lens: projectLens ? 'project' : 'foundation' },
    });
  });
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ json: { sfid: null } }));
  await page.route(`**${MKTG_SLIDES_EXPORT_API_PATH}/last?*`, (route) => route.fulfill({ json: { last: null, latestRevision: null } }));
  let response =
    responseOverride ?? (key === 'faq' || key === 'boilerplates' ? nativeAssetRevisionResponse(key, unreadable) : columnAssetRevisionResponse(key));
  await page.route('**/api/mktg-agents/documents/*/living/comments?*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { revisionId: new URL(route.request().url()).searchParams.get('revision') ?? response.revision.id, threads: [] } });
  });
  await page.route('**/api/mktg-agents/documents?*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { project: ASSET_PROJECT.uid, groups: [] } });
  });
  await page.route(`**${BRAND_KIT_INTAKE.endpoints.stored}**`, (route) => route.fulfill({ status: 404, json: { error: 'No approved branding' } }));
  await page.route(`**/api/mktg-agents/documents/${key}/living/revisions/*/approve?*`, (route) => {
    const approval = { approvedAt: '2026-10-19T11:00:00Z', approvedBy: { name: 'Project writer' } };
    const revision = { ...response.revision, approval };
    response = { ...response, approval, revision, revisions: [revision], approvedCurrent: { revisionId: revision.id, number: revision.number } };
    return route.fulfill({ json: response });
  });
  await page.route(`**/api/mktg-agents/documents/${key}/living?*`, (route) => route.fulfill({ json: response }));
  await page.route(`**/api/mktg-agents/documents/${key}/living/revisions/**`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (status === 0) return;
    return route.fulfill({ status, json: status === 200 ? response : { error: 'Synthetic read failure' } });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sidebar')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
  await page.context().addCookies(cookies);
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/documents/${key}/living?project=${ASSET_PROJECT.slug}`);
  await expect(page.getByTestId('mktg-document-view-page')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}
