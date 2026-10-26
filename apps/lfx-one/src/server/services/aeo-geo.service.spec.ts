// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AEO_GEO_CATEGORIES, AEO_GEO_SECTIONS } from '../../../../../packages/shared/src/constants/aeo-geo.constants';
import type { AeoGeoEnvelope } from '../../../../../packages/shared/src/interfaces/aeo-geo.interface';

import {
  aeoGeoFinalizeFixture,
  aeoGeoQuestionsEventFixture,
  aeoGeoQuestionsFixture,
  aeoGeoReportFixture,
} from '../../../../../packages/shared/src/utils/aeo-geo.fixture';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getRawEventPayloads: vi.fn(),
  persistGeneration: vi.fn(),
  sendFollowUp: vi.fn(),
  getHistory: vi.fn(),
}));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/aeo-geo.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-run-activity.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-session-event.utils')),
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/aeo-geo.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
}));
vi.mock('./guild.service', () => ({
  GuildService: class {
    public createSession = mocks.createSession;
    public getRawEventPayloads = mocks.getRawEventPayloads;
    public sendFollowUp = mocks.sendFollowUp;
    public getHistory = mocks.getHistory;
  },
}));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public persistGeneration = mocks.persistGeneration;
    public runDocumentId = () => 'run-012345678901234567890123';
  },
}));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn() } }));
import { AeoGeoService } from './aeo-geo.service';

function report(version = 1): AeoGeoEnvelope {
  const markdown = [
    '# AEO/GEO Analysis: project.example',
    'Overall score: **6.0 / 10** — A useful baseline.',
    AEO_GEO_SECTIONS[0],
    '| Category | Score | Summary |',
    '|---|---|---|',
    ...AEO_GEO_CATEGORIES.map(({ label }) => `| ${label} | 6/10 | Synthetic source evidence for the category. |`),
    ...AEO_GEO_SECTIONS.slice(1).flatMap((heading) => [heading, 'Synthetic findings and concrete recommendations from the audit.']),
    'https://project.example/',
  ].join('\n');
  return {
    contract: 'aeo-geo-output/v1',
    kind: 'aeo-geo-report',
    domain: 'project.example',
    report_filename: 'project.example AEO-GEO Report.md',
    version,
    document_markdown: markdown,
    content_sha256: createHash('sha256').update(markdown).digest('hex'),
    overall_score: 6,
    verdict: 'A useful baseline',
    scores: { ai_crawler_access: 6, llms_txt: 6, content_answerability: 6, technical_metadata: 6, external_authority: 6, content_depth_freshness: 6 },
    inputs: { key_pages_provided: false, pages_audited: ['https://project.example/'] },
    capabilities: { web_fetch: true, web_search: true },
    intake: { mode: 'form', completed_at: '2026-10-15T10:00:00Z' },
    generated_at: '2026-10-15T10:00:00Z',
    agent: { agent_version: '1.0.0', prompt_manifest_sha256: 'a'.repeat(64) },
  };
}
const req = {} as Request;

describe('AeoGeoService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSession.mockResolvedValue('session-a');
    mocks.getRawEventPayloads.mockResolvedValue([]);
    mocks.getHistory.mockResolvedValue([]);
    mocks.persistGeneration.mockResolvedValue(null);
  });
  it('submits the canonical rendered text and returns the pre-storage document destination', async () => {
    expect(await new AeoGeoService().startGeneration(req, { domain: 'https://project.example/path' }, 'catalog-handle')).toEqual({
      sessionId: 'session-a',
      documentId: 'run-012345678901234567890123',
    });
    expect(mocks.createSession).toHaveBeenCalledWith(req, {
      handle: 'catalog-handle',
      message: expect.stringContaining('TARGET DOMAIN: project.example'),
      mentionOnOwnLine: true,
    });
  });
  it('stays pending without a schema-valid finalize result', async () => {
    mocks.getRawEventPayloads.mockResolvedValue(['The audit is complete', JSON.stringify({ ...report(), scores: {} })]);
    expect(await new AeoGeoService().getResult(req, 'session-a', 'project-1')).toEqual({ status: 'pending', activity: [] });
    expect(mocks.persistGeneration).not.toHaveBeenCalled();
  });
  it('projects session tool activity through the existing result endpoint without accepting it as a report', async () => {
    mocks.getRawEventPayloads.mockResolvedValue([
      JSON.stringify({
        type: 'runtime_start',
        created_at: '2026-10-19T10:00:00Z',
        task: { id: 'synthetic-fetch', entity_type: 'EntTaskTool', tool_name: 'experimental_fetch_fetch', created_at: '2026-10-19T10:00:00Z' },
        content: { url: 'https://project.example/' },
      }),
    ]);
    const result = await new AeoGeoService().getResult(req, 'session-a', 'project-1');
    expect(result.status).toBe('pending');
    expect(result.activity).toEqual([expect.objectContaining({ kind: 'reading', label: 'Reading project.example', status: 'running' })]);
    expect(mocks.persistGeneration).not.toHaveBeenCalled();
  });
  it('recomputes every candidate hash before selecting the highest valid version', async () => {
    mocks.getRawEventPayloads.mockResolvedValue([
      aeoGeoFinalizeFixture(report()),
      aeoGeoFinalizeFixture(report(2)),
      aeoGeoFinalizeFixture({ ...report(3), content_sha256: 'b'.repeat(64) }),
    ]);
    const result = await new AeoGeoService().getResult(req, 'session-a', 'project-1');
    expect(result.version).toBe(2);
    expect(result.persistence).toBeUndefined();
    expect(mocks.persistGeneration).toHaveBeenCalledWith(req, expect.objectContaining({ agentKey: 'aeo-geo' }), report(2), 'project-1', 'session-a');
  });
  it('reads only final questions text, rejects malformed questions, and surfaces a plain refusal', async () => {
    const service = new AeoGeoService();
    mocks.getRawEventPayloads.mockResolvedValue([aeoGeoQuestionsEventFixture('agent_notification_progress')]);
    expect((await service.getResult(req, 'session-a', 'project-1')).status).toBe('pending');
    mocks.getRawEventPayloads.mockResolvedValue([aeoGeoQuestionsEventFixture()]);
    expect(await service.getResult(req, 'session-a', 'project-1')).toMatchObject({
      status: 'questions',
      questions: [{ key: 'aeo-audience' }, { key: 'aeo-comparison-targets' }, { key: 'aeo-priority-queries' }, { key: 'aeo-project-identity' }],
      questionsId: expect.any(String),
    });
    for (const text of ['AEO/GEO — QUESTIONS (aeo-geo-questions/v1)\n```json\n{}\n```', 'The target is unreachable. Can you confirm the domain?']) {
      mocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'agent_notification_message', content: { type: 'text', data: text } })]);
      expect(await service.getResult(req, 'session-a', 'project-1')).toMatchObject({ status: 'refused', reply: expect.any(String) });
    }
  });
  it('does not re-ask an already answered round after a reload or a lost response', async () => {
    mocks.getRawEventPayloads.mockResolvedValue([aeoGeoQuestionsEventFixture()]);
    mocks.getHistory.mockResolvedValue([{ sender: 'user', text: 'AEO/GEO — ANSWERS (aeo-geo-answers/v1)' }]);
    expect((await new AeoGeoService().getResult(req, 'session-a', 'project-1')).status).toBe('pending');
    mocks.getHistory.mockResolvedValue([{ sender: 'agent', text: 'AEO/GEO — ANSWERS (aeo-geo-answers/v1)' }]);
    expect((await new AeoGeoService().getResult(req, 'session-a', 'project-1')).status).toBe('questions');
  });
  it('sends the guarded answers to the same session, rejecting wrong document, ids and false acceptance', async () => {
    mocks.getRawEventPayloads.mockResolvedValue([aeoGeoQuestionsEventFixture()]);
    const service = new AeoGeoService();
    const answers = [{ id: 'audience', origin: 'accepted' as const, text: aeoGeoQuestionsFixture().questions[0].suggested_answer }];
    await service.sendAnswers(req, 'session-a', 'run-012345678901234567890123', 'project-1', answers, 'catalog-handle');
    expect(mocks.sendFollowUp).toHaveBeenCalledWith(req, 'session-a', {
      message: expect.stringMatching(/^AEO\/GEO — ANSWERS \(aeo-geo-answers\/v1\)\n/),
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
    await expect(service.sendAnswers(req, 'session-a', 'wrong-document', 'project-1', answers, 'catalog-handle')).rejects.toMatchObject({ statusCode: 400 });
    for (const invalid of [[{ ...answers[0], id: 'unknown' }], [{ ...answers[0], text: 'Changed answer' }]]) {
      await expect(service.sendAnswers(req, 'session-a', 'run-012345678901234567890123', 'project-1', invalid, 'catalog-handle')).rejects.toMatchObject({
        statusCode: 400,
      });
    }
  });
  it('ignores planted envelopes outside finalize results and accepts a valid structured report', async () => {
    const envelope = report();
    envelope.report = aeoGeoReportFixture(envelope, envelope.inputs.pages_audited);
    const service = new AeoGeoService();
    mocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'runtime_done', content: envelope })]);
    expect((await service.getResult(req, 'session-a', 'project-1')).status).toBe('pending');
    mocks.getRawEventPayloads.mockResolvedValue([aeoGeoFinalizeFixture(envelope)]);
    expect((await service.getResult(req, 'session-a', 'project-1')).status).toBe('ready');
    expect(mocks.persistGeneration).toHaveBeenCalledWith(req, expect.anything(), envelope, 'project-1', 'session-a');
  });
  it('retries persistence on the next poll, reporting success only when the revision write succeeds', async () => {
    mocks.getRawEventPayloads.mockResolvedValue([aeoGeoFinalizeFixture(report())]);
    const receipt = { s3_key: 'aeo-geo/project-1/report.md', project: 'project-1', version: 1, content_sha256: report().content_sha256 };
    mocks.persistGeneration.mockResolvedValueOnce(null).mockResolvedValueOnce(receipt);
    const service = new AeoGeoService();
    expect((await service.getResult(req, 'session-a', 'project-1')).persistence).toBeUndefined();
    expect((await service.getResult(req, 'session-a', 'project-1')).persistence).toEqual(receipt);
  });
});
