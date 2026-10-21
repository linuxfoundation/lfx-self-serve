// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { MktgRebuildResponse, MktgRevisionRef, Project } from '@lfx-one/shared/interfaces';

const deps = vi.hoisted(() => ({
  objects: new Map<string, { body: string; etag: string }>(),
  version: 0,
  list: vi.fn(),
  framework: vi.fn(),
  bp: { start: vi.fn(), result: vi.fn(), answer: vi.fn() },
  faq: { start: vi.fn(), result: vi.fn(), answer: vi.fn() },
  kit: { start: vi.fn(), result: vi.fn(), answer: vi.fn() },
}));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-rebuild.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-store.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/boilerplates.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/faq.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/brand-kit.utils')),
}));
vi.mock('./logger.service', () => ({ logger: { warning: vi.fn(), debug: vi.fn() } }));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public listDocuments = deps.list;
    public readExportRevision = deps.framework;
  },
}));
vi.mock('./boilerplates.service', () => ({
  BoilerplatesService: class {
    public startGeneration = deps.bp.start;
    public getResult = deps.bp.result;
    public sendAnswers = deps.bp.answer;
  },
}));
vi.mock('./faq.service', () => ({
  FaqService: class {
    public startGeneration = deps.faq.start;
    public getResult = deps.faq.result;
    public sendAnswers = deps.faq.answer;
  },
}));
vi.mock('./brand-kit.service', () => ({
  BrandKitService: class {
    public startGeneration = deps.kit.start;
    public getResult = deps.kit.result;
    public sendAnswers = deps.kit.answer;
  },
}));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public async getPrivateObject(_req: unknown, _purpose: string, key: string) {
      return deps.objects.get(key) ?? null;
    }
    public async putPrivateObjectIfAbsent(_req: unknown, _purpose: string, key: string, input: { body: Buffer }) {
      if (deps.objects.has(key)) return false;
      deps.objects.set(key, { body: input.body.toString(), etag: String(++deps.version) });
      return true;
    }
    public async putConditionalObject(_req: unknown, _purpose: string, key: string, input: { body: Buffer; ifMatch: string }) {
      if (deps.objects.get(key)?.etag !== input.ifMatch) return false;
      deps.objects.set(key, { body: input.body.toString(), etag: String(++deps.version) });
      return true;
    }
  },
}));

import { MktgRebuildService } from './mktg-rebuild.service';
import { ConflictError, MicroserviceError } from '../errors';
import { logger } from './logger.service';
import { mktgRebuildDocumentTypes } from '@lfx-one/shared/utils';

const req = { oidc: { user: { sub: 'auth0|synthetic-writer' } } } as unknown as Request;
const project = {
  uid: 'synthetic-project',
  name: 'Synthetic mesh',
  website_url: 'https://mesh.example',
  description: 'An open mesh',
  repository_url: 'https://code.example/mesh',
  writer: true,
} as Project;
const reference: MktgRevisionRef = { agentKey: 'foundation-message', revisionId: `000002-${'b'.repeat(64)}`, revisionNumber: 2, contentSha256: 'c'.repeat(64) };
const framework = JSON.stringify({
  mf: { positioning: 'Open mesh', tagline: 'Mesh, open.' },
  mh: { umbrella: 'Open mesh', line: 'Mesh, open.' },
  icp: [],
  nums: [],
});
const question = { key: 'domain', label: 'Domain', question: 'Which domain?', why: 'Missing', suggestedAnswer: 'mesh.example', basis: [] };
const ready = {
  status: 'ready',
  activity: [],
  persistence: {
    s3_key: `documents/synthetic-project/boilerplates/living/000002-${'d'.repeat(64)}.json`,
    content_sha256: 'e'.repeat(64),
    project: project.uid,
    version: 1,
  },
};
const request = (chain: MktgRebuildResponse) => ({ project: chain.project, chainId: chain.chainId, ownerToken: chain.ownerToken });

describe('MktgRebuildService', () => {
  let service: MktgRebuildService;
  beforeEach(() => {
    vi.resetAllMocks();
    deps.objects.clear();
    deps.version = 0;
    deps.list.mockResolvedValue({
      project: project.uid,
      approvedFramework: reference,
      groups: mktgRebuildDocumentTypes().map((type) => ({
        type,
        documents: [{ needsRebuild: { builtFrom: { ...reference, revisionNumber: 1 }, rebuildFrom: reference } }],
      })),
    });
    deps.framework.mockResolvedValue({ revision: { record: { bundle: { format: 'json', markdown: framework } } } });
    for (const [agent, session] of [
      [deps.bp, 'bp-session'],
      [deps.faq, 'faq-session'],
      [deps.kit, 'kit-session'],
    ] as const) {
      agent.start.mockResolvedValue(session);
      agent.result.mockResolvedValue({ status: 'pending', activity: [] });
      agent.answer.mockResolvedValue(undefined);
    }
    service = new MktgRebuildService();
  });

  it('starts only the first stale agent using project prefill and server-selected framework bytes', async () => {
    const chain = await service.start(req, project, reference.revisionId);
    expect(chain.steps.map((step) => [step.agentId, step.status])).toEqual([
      ['boilerplates', 'running'],
      ['faq', 'queued'],
      ['brand-kit', 'queued'],
    ]);
    expect(deps.bp.start).toHaveBeenCalledWith(
      req,
      expect.objectContaining({ project_name: project.name, messaging_framework: framework }),
      project.uid,
      expect.any(String),
      reference
    );
    expect(deps.faq.start).not.toHaveBeenCalled();
    expect(deps.kit.start).not.toHaveBeenCalled();
    expect(JSON.stringify(chain)).not.toContain('bp-session');
    expect(JSON.stringify(chain)).not.toContain('auth0|');
    for (const saved of deps.objects.values()) {
      expect(JSON.parse(saved.body)).not.toHaveProperty('ownerId');
      expect(saved.body).not.toContain('auth0|');
    }
  });
  it('keeps a ready-but-not-persisted result running and starts the next agent only after committed Draft', async () => {
    let chain = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockResolvedValueOnce({ status: 'ready', activity: [] });
    chain = await service.result(req, project, request(chain));
    expect(chain.steps[0].status).toBe('running');
    deps.bp.result.mockResolvedValueOnce(ready);
    chain = await service.result(req, project, request(chain));
    expect(chain.steps[0].status).toBe('draft');
    chain = await service.advance(req, project, { ...request(chain), stepIndex: 1 });
    expect(deps.faq.start).toHaveBeenCalledWith(
      req,
      expect.objectContaining({ website_url: project.website_url, messaging_framework: framework }),
      [],
      project.uid,
      expect.any(String),
      reference
    );
    expect(chain.steps[1].status).toBe('running');
    deps.faq.result.mockResolvedValue(ready);
    chain = await service.result(req, project, request(chain));
    chain = await service.advance(req, project, { ...request(chain), stepIndex: 2 });
    const kitKey = `documents/${project.uid}/brand-kit/living/000003-${'f'.repeat(64)}.json`;
    deps.kit.result.mockResolvedValue({ ...ready, persistence: { ...ready.persistence, s3_key: kitKey } });
    chain = await service.result(req, project, request(chain));
    expect(chain.steps[2].persistence?.s3_key).toBe(kitKey);
    expect(chain.steps[2].persistence?.s3_key).not.toBe(ready.persistence.s3_key);
    expect(chain.status).toBe('complete');
    expect(chain.steps.every((step) => step.status === 'draft')).toBe(true);
  });
  it('refuses an unreadable downstream before any Guild session starts', async () => {
    const listing = await deps.list();
    deps.list.mockImplementationOnce((_req, _project, strict) =>
      strict?.includes('boilerplates')
        ? Promise.reject(new MicroserviceError('Unreadable family document', 503, 'STORE_UNAVAILABLE'))
        : Promise.resolve(listing)
    );
    await expect(service.start(req, project, reference.revisionId)).rejects.toMatchObject({ statusCode: 503 });
    expect(deps.bp.start).not.toHaveBeenCalled();
    expect(deps.faq.start).not.toHaveBeenCalled();
    expect(deps.kit.start).not.toHaveBeenCalled();
    expect(deps.objects.size).toBe(0);
  });
  it('survives a new service instance and answers questions on the SAME session before continuing', async () => {
    let chain = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockResolvedValue({ status: 'questions', questions: [question], questionsId: 'q1', activity: [] });
    chain = await new MktgRebuildService().result(req, project, request(chain));
    expect(chain.status).toBe('questions');
    expect(deps.faq.start).not.toHaveBeenCalled();
    chain = await service.advance(req, project, {
      ...request(chain),
      stepIndex: 0,
      questionsId: 'q1',
      answers: [{ key: 'domain', text: 'mesh.example', origin: 'accepted' }],
    });
    expect(deps.bp.answer).toHaveBeenCalledWith(req, 'bp-session', [{ key: 'domain', text: 'mesh.example', origin: 'accepted' }], expect.any(String));
    chain = await service.result(req, project, request(chain));
    expect(chain.status).toBe('running'); // Ignore the already answered block still in Guild.
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
    deps.bp.result.mockResolvedValue(ready);
    chain = await service.result(req, project, request(chain));
    await service.advance(req, project, { ...request(chain), stepIndex: 1 });
    expect(deps.faq.start).toHaveBeenCalledTimes(1);
  });
  it('validates the exact pending question turn and never answers a later turn on retry', async () => {
    let chain = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockResolvedValue({ status: 'questions', questions: [question], questionsId: 'q1' });
    chain = await service.result(req, project, request(chain));
    await expect(service.advance(req, project, { ...request(chain), stepIndex: 0, questionsId: 'old', answers: [] })).rejects.toThrow('questions changed');
    await expect(service.advance(req, project, { ...request(chain), stepIndex: 0, questionsId: 'q1', answers: [] })).rejects.toThrow();
    expect(deps.bp.answer).not.toHaveBeenCalled();
  });
  it('rejects stale framework selection, empty stale set, and missing required project data before starting', async () => {
    await expect(service.start(req, project, `000001-${'a'.repeat(64)}`)).rejects.toThrow('framework changed');
    await expect(service.start(req, { ...project, website_url: '' }, reference.revisionId)).rejects.toThrow('Validation failed for project');
    deps.list.mockResolvedValueOnce({ approvedFramework: reference, groups: [] });
    await expect(service.start(req, project, reference.revisionId)).rejects.toThrow('Nothing needs rebuilding');
    expect(deps.bp.start).not.toHaveBeenCalled();
    expect(deps.objects.size).toBe(0);
  });
  it('stops on refusal or transport failure without starting later agents or discarding earlier Drafts', async () => {
    let chain = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockResolvedValue(ready);
    chain = await service.result(req, project, request(chain));
    chain = await service.advance(req, project, { ...request(chain), stepIndex: 1 });
    deps.faq.result.mockResolvedValueOnce({ status: 'refused', reply: 'Source unavailable' });
    chain = await service.result(req, project, request(chain));
    expect(chain.status).toBe('failed');
    expect(chain.steps[0].status).toBe('draft');
    expect(chain.steps[1].message).toBe('Source unavailable');
    expect(deps.kit.start).not.toHaveBeenCalled();
    const other = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockRejectedValueOnce(new Error('upstream unavailable'));
    expect((await service.result(req, project, request(other))).status).toBe('failed');
  });
  it('fails before the next step when the framework changed, retaining earlier Drafts', async () => {
    let chain = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockResolvedValue(ready);
    chain = await service.result(req, project, request(chain));
    deps.framework.mockRejectedValueOnce(new Error('changed selection'));
    chain = await service.advance(req, project, { ...request(chain), stepIndex: 1 });
    expect(chain.status).toBe('failed');
    expect(chain.steps[0].status).toBe('draft');
    expect(deps.faq.start).not.toHaveBeenCalled();
  });
  it.each([408, 429, 500, 502, 504])('retries a transient %i poll on the same session without failing the chain', async (status) => {
    let chain = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockRejectedValueOnce(new MicroserviceError('Transient Guild read', status, 'guild_unreachable'));
    chain = await service.result(req, project, request(chain));
    expect(chain.status).toBe('running');
    expect(chain.steps[0].status).toBe('running');
    expect(logger.warning).toHaveBeenCalledWith(req, 'mktg_rebuild_poll', expect.any(String), expect.objectContaining({ agent: 'boilerplates' }));
    deps.bp.result.mockResolvedValueOnce(ready);
    chain = await service.result(req, project, request(chain));
    expect(chain.steps[0].status).toBe('draft');
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
    expect(deps.bp.result).toHaveBeenLastCalledWith(req, 'bp-session', project.uid);
  });
  it.each([401, 403, 422])('stops a non-transient %i poll instead of retrying it', async (status) => {
    const chain = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockRejectedValueOnce(new MicroserviceError('Read denied', status, 'denied'));
    expect((await service.result(req, project, request(chain))).status).toBe('failed');
    expect(deps.faq.start).not.toHaveBeenCalled();
  });

  it.each([
    [
      'MKTG_APPROVED_CURRENT_CHANGED',
      'Selection changed',
      'The approved framework changed. Earlier Drafts are saved. Reload the family before rebuilding again.',
    ],
    ['MKTG_REBUILD_AGENT_UNAVAILABLE', 'This rebuild agent is not available.', 'This rebuild agent is not available.'],
    ['MKTG_FRAMEWORK_INPUT_MISMATCH', 'The rebuild input does not match the approved framework.', 'The rebuild input does not match the approved framework.'],
  ])('preserves the specific conflict message for %s', async (code, message, expected) => {
    deps.bp.start.mockRejectedValueOnce(new ConflictError(message, code));
    const chain = await service.start(req, project, reference.revisionId);
    expect(chain.status).toBe('failed');
    expect(chain.steps[0].message).toBe(expected);
  });

  it('binds capabilities to owner and project before reading any private chain state', async () => {
    const chain = await service.start(req, project, reference.revisionId);
    await expect(service.result({ oidc: { user: { sub: 'auth0|another' } } } as unknown as Request, project, request(chain))).rejects.toThrow(
      'another session'
    );
    await expect(service.result(req, { ...project, uid: 'other-project' }, request(chain))).rejects.toThrow('another session');
    expect(deps.bp.result).not.toHaveBeenCalled();
  });
  it('makes duplicate advance harmless and refuses concurrent CAS claims without duplicate sessions', async () => {
    const chain = await service.start(req, project, reference.revisionId);
    await service.advance(req, project, { ...request(chain), stepIndex: 0 });
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
    const key = [...deps.objects.keys()][0];
    const saved = deps.objects.get(key);
    if (!saved) throw new Error('Missing synthetic record');
    deps.objects.set(key, { ...saved, body: JSON.stringify({ ...JSON.parse(saved.body), operationId: 'interrupted' }) });
    await expect(service.advance(req, project, { ...request(chain), stepIndex: 0 })).rejects.toThrow('interrupted');
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
  });
});
