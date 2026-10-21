// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  BRAND_KIT_INTAKE,
  FOUNDATION_MESSAGE_INTAKE,
  FOUNDATION_MESSAGE_WEBSITE_KEY,
  FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
  LENS_COOKIE_KEY,
  MKTG_DOCUMENT_TYPES,
  MKTG_OS_AGENTS_ENABLED_FLAG,
  MKTG_SLIDES_EXPORT_API_PATH,
  PERSONA_COOKIE_KEY,
  SELECTED_PROJECT_COOKIE_KEY,
} from '@lfx-one/shared/constants';
import type { FaqEnvelope, MktgFrameworkAsset, MktgRevisionResponse, MktgRevisionSummary, Project } from '@lfx-one/shared/interfaces';
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
export function nativeAssetRevisionResponse(key: 'faq', unreadable = false): MktgRevisionResponse {
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
  const native = JSON.parse(readFileSync(resolve(__dirname, '../../../../packages/shared/src/utils/__fixtures__/faq-envelope.json'), 'utf8')) as FaqEnvelope;
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

/** Real run route + synthetic POSTs; never reconstruct receipt identity from content. */
export async function openDraftAssetRun(page: Page, receipt = true): Promise<string> {
  await openAssetDocument(page, 'faq');
  const asset = draftFrameworkAsset();
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === FOUNDATION_MESSAGE_INTAKE.agentId);
  if (!type) throw new Error('Missing framework document type');
  const base = nativeAssetRevisionResponse('faq');
  const revisionId = base.revision.id;
  const response: MktgRevisionResponse = {
    ...base,
    type,
    markdown: JSON.stringify(asset.content),
    sidecar: { content: asset.content, report: asset.report, checks: asset.checks, mode: asset.mode },
  };
  await page.route(`**${FOUNDATION_MESSAGE_INTAKE.endpoints.generate}`, (route) =>
    route.fulfill({ json: { sessionId: 'synthetic-run-session', ownerToken: 'synthetic-run-capability' } })
  );
  await page.route(`**${FOUNDATION_MESSAGE_INTAKE.endpoints.result}`, (route) =>
    route.fulfill({
      json: {
        status: 'ready',
        version: 1,
        documentMarkdown: '',
        asset,
        ...(receipt && {
          persistence: {
            s3_key: `documents/${ASSET_PROJECT.uid}/${type.agentKey}/living/${revisionId}.json`,
            content_sha256: 'a'.repeat(64),
            project: ASSET_PROJECT.uid,
            version: 1,
          },
        }),
      },
    })
  );
  await page.route(`**${BRAND_KIT_INTAKE.endpoints.stored}**`, (route) => route.fulfill({ status: 404, json: { error: 'No approved branding' } }));
  await page.route(`**/api/mktg-agents/documents/${type.agentKey}/living?*`, (route) => route.fulfill({ json: response }));
  await page.route(`**/api/mktg-agents/documents/${type.agentKey}/living/revisions/**`, (route) => route.fulfill({ json: response }));
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/${FOUNDATION_MESSAGE_INTAKE.agentId}?project=${ASSET_PROJECT.slug}`);
  await expect(page.getByTestId('mktg-agent-run-submit-button')).toBeVisible();
  await page.locator('[data-test="mktg-intake-project_name"]').fill(ASSET_PROJECT.name);
  await page.locator(`[data-test="mktg-intake-${FOUNDATION_MESSAGE_WEBSITE_KEY}"]`).fill('https://project.example');
  await page.getByTestId('mktg-agent-run-submit-button').getByRole('button').click();
  await expect(page.getByTestId('mktg-framework-view')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  return revisionId;
}

/** Stub the FAQ reads; cookie suppression precedes every navigation. */
export async function openAssetDocument(
  page: Page,
  key: 'faq',
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
  let response = responseOverride ?? nativeAssetRevisionResponse(key, unreadable);
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
