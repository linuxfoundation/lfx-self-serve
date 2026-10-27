// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FOUNDATION_MESSAGE_CONTRACT_ID,
  MKTG_DOCUMENT_TYPES,
  MKTG_PENDING_RUN_STORAGE_KEY_PREFIX,
  MKTG_RUN_STORAGE_KEY_PREFIX,
} from '@lfx-one/shared/constants';
import type { MktgDocumentType, MktgStoredAgentRun } from '@lfx-one/shared/interfaces';
import { findMktgRunIntake, mktgRunResultIdentity } from '@lfx-one/shared/utils/mktg-document-store.utils';
import { returningRunFixture } from '@lfx-one/shared/utils/__fixtures__/mktg-returning-run.fixture';
import { expect, Page } from '@playwright/test';
import { DOCUMENT_PROJECT, DOCUMENTS_URL, fulfillDocumentJson, openDocuments, setupDocuments } from './mktg-os-documents.helper';

export const RETURNING_AGENT_TYPES = MKTG_DOCUMENT_TYPES.filter((type) => !!findMktgRunIntake(type.agentKey)?.endpoints.result);

/** Every domain request is synthetic; setupDocuments also applies suppressCookieBanner and the writer/flag mocks. */
export async function leaveAndReturnToAsset(page: Page, type: MktgDocumentType, olderReplay = false): Promise<string> {
  const intake = findMktgRunIntake(type.agentKey);
  if (!intake) throw new Error('Missing registered result intake');
  await setupDocuments(page, { empty: true });
  const fixture = returningRunFixture(type, DOCUMENT_PROJECT.uid);
  const frameworkType = MKTG_DOCUMENT_TYPES.find((candidate) => findMktgRunIntake(candidate.agentKey)?.assetView === 'messaging-framework');
  if (!frameworkType) throw new Error('Missing registered framework dependency');
  const framework = returningRunFixture(frameworkType, DOCUMENT_PROJECT.uid);
  const runId = 'b'.repeat(64);
  const run = { project: DOCUMENT_PROJECT.uid, agentKey: type.agentKey, documentId: 'living', runId, state: 'writing', startedAt: new Date().toISOString() };
  let generates = 0;
  let intakePolls = 0;
  let receiverPolls = 0;
  let onAsset = false;
  let ready = false;
  const resultPayloads: (string | null)[] = [];
  await page.route('**/api/mktg-agents/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/comments')) return fulfillDocumentJson(route, { revisionId: fixture.revision.revision.id, threads: [] });
    if (path.endsWith('/stored'))
      return fulfillDocumentJson(route, {
        receipt: { project: DOCUMENT_PROJECT.uid, s3_key: 'synthetic-framework.json', version: 1, content_sha256: 'a'.repeat(64) },
        documentMarkdown: framework.revision.markdown,
        format: 'json',
        sidecar: { contract: FOUNDATION_MESSAGE_CONTRACT_ID, content: framework.result.asset?.content },
      });
    if (path === intake.endpoints.generate) {
      generates++;
      return fulfillDocumentJson(route, { sessionId: 'synthetic-return-session', ownerToken: 'synthetic-return-proof', runId });
    }
    if (path === intake.endpoints.result) {
      resultPayloads.push(route.request().postData());
      if (!onAsset) {
        intakePolls++;
        return fulfillDocumentJson(route, { status: 'pending' });
      }
      receiverPolls++;
      ready = !olderReplay || receiverPolls > 1;
      return fulfillDocumentJson(route, ready ? fixture.result : { ...fixture.result, persistence: undefined });
    }
    if (path.endsWith('/documents'))
      return fulfillDocumentJson(route, {
        project: DOCUMENT_PROJECT.uid,
        runs: ready ? [] : [run],
        groups: MKTG_DOCUMENT_TYPES.map((candidate) => ({ type: candidate, documents: [] })),
      });
    if (path.endsWith(`/documents/${type.agentKey}/living`))
      return fulfillDocumentJson(
        route,
        ready
          ? fixture.revision
          : {
              project: DOCUMENT_PROJECT.uid,
              type,
              documentId: 'living',
              revisions: [],
              runs: [run],
            }
      );
    if (path.endsWith(`/revisions/${fixture.revision.revision.id}`)) return fulfillDocumentJson(route, fixture.revision);
    if (path.endsWith('/slides-export/last')) return fulfillDocumentJson(route, { last: null, latestRevision: null });
    return route.fallback();
  });
  await page.evaluate((url) => {
    history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/${intake.agentId}?project=${DOCUMENT_PROJECT.slug}`);
  await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
  for (const field of intake.fields) {
    if (field.optional) continue;
    let value = 'Grow synthetic adoption';
    if (field.prefill === 'project-name') value = DOCUMENT_PROJECT.name;
    if (field.format === 'github-url' || field.format === 'github-repo-url') value = 'https://github.com/synthetic-org/synthetic-orbit';
    if (field.format && field.format !== 'github-url' && field.format !== 'github-repo-url') value = 'https://synthetic.example';
    await page.locator(`#mktg-intake-${field.key}`).fill(value);
  }
  await page.getByTestId('mktg-agent-run-submit-button').getByRole('button').click();
  await expect.poll(() => intakePolls).toBeGreaterThan(0);
  if (olderReplay) {
    const digest = mktgRunResultIdentity(fixture.result, false);
    const createdAt = new Date().toISOString();
    const older = {
      version: 1,
      document: fixture.result.documentMarkdown ?? '',
      asset: fixture.result.asset,
      brandKit: fixture.result.brandKit,
      derivatives: fixture.result.derivatives,
      createdAt,
      source: { sessionId: 'synthetic-return-session', version: fixture.result.version ?? 1, identity: digest, payloadDigest: digest },
    };
    const newerDigest = mktgRunResultIdentity({ ...fixture.result, version: 2, documentMarkdown: '# Newer cached outcome' }, false);
    const cached: MktgStoredAgentRun = {
      agentId: intake.agentId,
      projectUid: DOCUMENT_PROJECT.uid,
      sessionId: 'synthetic-newer-session',
      ownerToken: 'synthetic-newer-proof',
      answers: {},
      savedAt: createdAt,
      versions: [
        older,
        {
          ...older,
          version: 2,
          document: '# Newer cached outcome',
          source: { sessionId: 'synthetic-newer-session', version: 2, identity: newerDigest, payloadDigest: newerDigest },
          documentLocation: { agentKey: type.agentKey, documentId: 'living', revisionId: `000002-${'b'.repeat(64)}` },
        },
      ],
    };
    await page.evaluate(
      ({ cached, pendingPrefix, runPrefix }) => {
        const prefix = pendingPrefix + ':';
        const suffix = ':' + cached.projectUid + ':' + cached.agentId;
        const key = Object.keys(localStorage).find((entry) => entry.startsWith(prefix) && entry.endsWith(suffix));
        if (!key) throw new Error('Missing synthetic accepted-attempt fixture');
        const subject = key.slice(prefix.length, -suffix.length);
        localStorage.setItem(runPrefix + ':' + subject + suffix, JSON.stringify(cached));
      },
      { cached, pendingPrefix: MKTG_PENDING_RUN_STORAGE_KEY_PREFIX, runPrefix: MKTG_RUN_STORAGE_KEY_PREFIX }
    );
  }
  await openDocuments(page, DOCUMENTS_URL);
  await expect(page.getByTestId(`mktg-documents-open-started-${runId}`)).toBeVisible();
  onAsset = true;
  await page.getByTestId(`mktg-documents-open-started-${runId}`).click();
  if (olderReplay) {
    await expect(page.getByTestId('mktg-document-view-run-steps')).toContainText('Saving the revision');
    await expect(page).not.toHaveURL(new RegExp(`revision=000002-${'b'.repeat(64)}`));
  }
  await expect(page.getByTestId(fixture.selector)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`revision=${fixture.revision.revision.id}`));
  await expect(page.getByTestId('mktg-document-view-run')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-unsupported-asset')).toHaveCount(0);
  expect(receiverPolls).toBeGreaterThan(0);
  expect(resultPayloads).toHaveLength(intakePolls + receiverPolls);
  for (const payload of resultPayloads) {
    expect(JSON.parse(payload ?? 'null')).toMatchObject({
      sessionId: 'synthetic-return-session',
      ownerToken: 'synthetic-return-proof',
      project: DOCUMENT_PROJECT.uid,
    });
  }
  expect(generates).toBe(1);
  return fixture.selector;
}
