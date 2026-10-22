// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MKTG_REBUILD_ACTIVE_TTL_MS, MKTG_REBUILD_TTL_MS } from '@lfx-one/shared/constants';
import type { Request } from 'express';
import type { MktgRebuildResponse, MktgRevisionRef, Project } from '@lfx-one/shared/interfaces';

const deps = vi.hoisted(() => ({
  objects: new Map<string, { body: string; etag: string }>(),
  version: 0,
  publish: vi.fn(),
  published: vi.fn(),
  claim: vi.fn(),
  conditional: vi.fn(),
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
      if (key.endsWith('.json')) await deps.publish();
      await deps.claim(key);
      if (deps.objects.has(key)) return false;
      deps.objects.set(key, { body: input.body.toString(), etag: String(++deps.version) });
      if (key.endsWith('.json')) await deps.published();
      return true;
    }
    public async putConditionalObject(_req: unknown, _purpose: string, key: string, input: { body: Buffer; ifMatch: string }) {
      await deps.conditional(key, input);
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
  const activeKey = `rebuilds/${project.uid}/active`;
  const marker = () => JSON.parse(deps.objects.get(activeKey)?.body ?? '{}');
  afterEach(() => vi.useRealTimers());
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

  it('attaches concurrent starts to one chain with one Guild session', async () => {
    let second: MktgRebuildResponse | undefined;
    deps.bp.start.mockImplementationOnce(async () => {
      second = await new MktgRebuildService().start(req, project, reference.revisionId);
      expect(second.steps[0].status).toBe('running');
      await expect(service.advance(req, project, { ...request(second), stepIndex: 0 })).resolves.toMatchObject({
        steps: [expect.objectContaining({ status: 'running' }), expect.anything(), expect.anything()],
      });
      await expect(service.result(req, project, request(second))).resolves.toMatchObject({
        steps: [expect.objectContaining({ status: 'running' }), expect.anything(), expect.anything()],
      });
      await expect(service.advance(req, project, { ...request(second), stepIndex: 0, answers: [] })).rejects.toThrow('interrupted');
      return 'bp-session';
    });
    const first = await service.start(req, project, reference.revisionId);
    expect(first.status).toBe('running');
    expect(first.steps[0].status).toBe('running');
    expect(second).toMatchObject({ chainId: first.chainId, attached: true });
    expect([...deps.objects.keys()].filter((key) => key.endsWith('.json'))).toHaveLength(1);
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
    expect(deps.faq.start).not.toHaveBeenCalled();
  });
  it.each(['active', '.json'])('returns fresh progress when a queued advance loses the %s CAS', async (suffix) => {
    let raced = false;
    deps.conditional.mockImplementation(async (key: string) => {
      if (raced || !key.endsWith(suffix)) return;
      raced = true;
      const attached = await service.start(req, project, reference.revisionId);
      await service.result(req, project, request(attached));
      await service.advance(req, project, { ...request(attached), stepIndex: 0 });
    });
    const chain = await service.start(req, project, reference.revisionId);
    expect(raced).toBe(true);
    expect(chain.steps[0].status).toBe('running');
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
  });
  it('fails a simultaneous start closed while the winner is still publishing, then attaches on retry', async () => {
    const starts = await Promise.allSettled([service.start(req, project, reference.revisionId), service.start(req, project, reference.revisionId)]);
    expect(starts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(starts.find((result) => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 503 } });
    expect((await service.start(req, project, reference.revisionId)).chainId).toBe(marker().chainId);
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
  });
  it('mints a separate writer capability on attach, never sharing the first writer token', async () => {
    const first = await service.start(req, project, reference.revisionId);
    const otherReq = { oidc: { user: { sub: 'auth0|second-writer' } } } as unknown as Request;
    const attached = await service.start(otherReq, project, reference.revisionId);
    expect(attached).toMatchObject({ chainId: first.chainId, status: 'running', attached: true });
    expect(attached.ownerToken).not.toBe(first.ownerToken);
    await expect(service.result(otherReq, project, request(first))).rejects.toThrow('another session');
    await expect(service.result(otherReq, project, request(attached))).resolves.toMatchObject({ chainId: first.chainId });
    expect(JSON.stringify(marker())).not.toContain('auth0|');
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('answers after a questions pause beyond the lease TTL unless reclaimed: %s', async (reclaim) => {
    vi.useFakeTimers();
    let chain = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockResolvedValueOnce({ status: 'questions', questions: [question], questionsId: 'q1' });
    chain = await service.result(req, project, request(chain));
    vi.advanceTimersByTime(MKTG_REBUILD_ACTIVE_TTL_MS + 1);
    if (reclaim) await service.start(req, project, reference.revisionId);
    const answer = service.advance(req, project, {
      ...request(chain),
      stepIndex: 0,
      questionsId: 'q1',
      answers: [{ key: 'domain', text: 'mesh.example', origin: 'accepted' }],
    });
    if (reclaim) {
      await expect(answer).rejects.toMatchObject({ code: 'MKTG_REBUILD_EXPIRED' });
      expect(deps.bp.answer).not.toHaveBeenCalled();
    } else {
      await expect(answer).resolves.toMatchObject({ status: 'running' });
      expect(marker().expiresAt).toBe(Date.now() + MKTG_REBUILD_ACTIVE_TTL_MS);
      expect(deps.bp.answer).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects an expired passive poll without reviving the lease', async () => {
    vi.useFakeTimers();
    const chain = await service.start(req, project, reference.revisionId);
    const expired = deps.objects.get(activeKey);
    vi.advanceTimersByTime(MKTG_REBUILD_ACTIVE_TTL_MS + 1);
    await expect(service.result(req, project, request(chain))).rejects.toMatchObject({ code: 'MKTG_REBUILD_EXPIRED', statusCode: 409 });
    expect(deps.objects.get(activeKey)).toEqual(expired);
    expect(deps.bp.result).not.toHaveBeenCalled();
  });
  it('lets concurrent polls and already-started advances observe the saved chain without conflicting', async () => {
    const chain = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockImplementationOnce(async () => {
      await expect(service.result(req, project, request(chain))).resolves.toMatchObject({ chainId: chain.chainId });
      await expect(service.advance(req, project, { ...request(chain), stepIndex: 0 })).resolves.toMatchObject({ chainId: chain.chainId });
      await expect(service.advance(req, project, { ...request(chain), stepIndex: 0, answers: [] })).rejects.toThrow('interrupted');
      return { status: 'pending', activity: [] };
    });
    await expect(Promise.all([service.result(req, project, request(chain)), service.result(req, project, request(chain))])).resolves.toHaveLength(2);
    expect(deps.bp.result).toHaveBeenCalledTimes(1);
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
  });
  it.each(['CAS', 'outage'])('keeps durable progress successful when its lease renewal fails: %s', async (failure) => {
    const chain = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockResolvedValueOnce(ready);
    deps.conditional.mockImplementation(async (key) => {
      if (key === activeKey) {
        if (failure === 'outage') throw new MicroserviceError('Synthetic renewal failure', 503, 'STORE_UNAVAILABLE');
        deps.objects.set(key, { body: JSON.stringify(marker()), etag: String(++deps.version) });
      }
    });
    await expect(service.result(req, project, request(chain))).resolves.toMatchObject({
      steps: [expect.objectContaining({ status: 'draft' }), expect.anything(), expect.anything()],
    });
    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'mktg_rebuild_renew',
      expect.any(String),
      expect.objectContaining({ project: project.uid, chainId: chain.chainId, err: expect.anything() })
    );
  });
  it('returns saved terminal progress even when releasing its marker fails', async () => {
    const chain = await service.start(req, project, reference.revisionId);
    deps.bp.result.mockResolvedValueOnce({ status: 'refused', reply: 'Synthetic refusal' });
    deps.conditional.mockImplementation(async (key) => {
      if (key === activeKey) throw new MicroserviceError('Synthetic release failure', 503, 'STORE_UNAVAILABLE');
    });
    await expect(service.result(req, project, request(chain))).resolves.toMatchObject({ status: 'failed' });
    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'mktg_rebuild_release',
      expect.any(String),
      expect.objectContaining({ project: project.uid, chainId: chain.chainId, err: expect.anything() })
    );
    deps.conditional.mockReset();
    expect((await service.start(req, project, reference.revisionId)).chainId).not.toBe(chain.chainId);
  });
  it('refuses attachment when the approved framework supersedes the active chain input', async () => {
    await service.start(req, project, reference.revisionId);
    const listing = await deps.list();
    const revisionId = `000003-${'e'.repeat(64)}`;
    deps.list.mockResolvedValueOnce({ ...listing, approvedFramework: { ...reference, revisionId } });
    await expect(service.start(req, project, revisionId)).rejects.toMatchObject({ code: 'MKTG_REBUILD_FRAMEWORK_CHANGED' });
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('claims a missing legacy marker unless another chain wins the CAS: %s', async (competing) => {
    const chain = await service.start(req, project, reference.revisionId);
    const replacement = { ...marker(), chainId: '12345678-1234-4123-8123-123456789abc' };
    deps.objects.delete(activeKey);
    if (competing)
      deps.claim.mockImplementation(async (key) => {
        if (key === activeKey) deps.objects.set(key, { body: JSON.stringify(replacement), etag: String(++deps.version) });
      });
    const poll = service.result(req, project, request(chain));
    if (competing) {
      await expect(poll).rejects.toMatchObject({ code: 'MKTG_REBUILD_EXPIRED' });
      expect(marker()).toEqual(replacement);
      expect(deps.bp.result).not.toHaveBeenCalled();
    } else {
      await expect(poll).resolves.toMatchObject({ chainId: chain.chainId });
      expect(marker().chainId).toBe(chain.chainId);
      expect(deps.bp.result).toHaveBeenCalledTimes(1);
    }
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
  });
  it('reclaims a crashed marker by TTL and fences the old chain before another Guild call', async () => {
    vi.useFakeTimers();
    const first = await service.start(req, project, reference.revisionId);
    vi.advanceTimersByTime(MKTG_REBUILD_ACTIVE_TTL_MS + 1);
    const replacement = await service.start(req, project, reference.revisionId);
    expect(replacement.chainId).not.toBe(first.chainId);
    expect(marker().chainId).toBe(replacement.chainId);
    await expect(service.advance(req, project, { ...request(first), stepIndex: 0 })).rejects.toThrow('no longer active');
    expect(deps.bp.start).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(MKTG_REBUILD_TTL_MS + 1);
    expect((await service.start(req, project, reference.revisionId)).chainId).not.toBe(replacement.chainId);
  });
  it('refreshes durable progress, but not stalled polls, attached starts or duplicate advances', async () => {
    vi.useFakeTimers();
    let chain = await service.start(req, project, reference.revisionId);
    const original = marker().expiresAt;
    vi.advanceTimersByTime(60000);
    await service.result(req, project, request(chain));
    await service.start(req, project, reference.revisionId);
    expect(marker().expiresAt).toBe(original);
    deps.bp.result.mockResolvedValueOnce({
      status: 'pending',
      activity: [{ id: 'writing', kind: 'writing', label: 'Drafting', status: 'running', startedAt: new Date().toISOString() }],
    });
    chain = await service.result(req, project, request(chain));
    expect(marker().expiresAt).toBe(original + 60000);
    vi.advanceTimersByTime(60000);
    await service.advance(req, project, { ...request(chain), stepIndex: 0 });
    expect(marker().expiresAt).toBe(original + 60000);
  });
  it('expires the marker on publication failure, returns 503, and never starts Guild', async () => {
    deps.publish.mockRejectedValueOnce(new MicroserviceError('Synthetic publication failure', 503, 'STORE_UNAVAILABLE'));
    await expect(service.start(req, project, reference.revisionId)).rejects.toMatchObject({ statusCode: 503 });
    expect(marker().expiresAt).toBe(0);
    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'mktg_rebuild_publish',
      expect.any(String),
      expect.objectContaining({ project: project.uid, chainId: marker().chainId, err: expect.anything() })
    );
    expect(deps.bp.start).not.toHaveBeenCalled();
    await expect(service.start(req, project, reference.revisionId)).resolves.toMatchObject({ status: 'running' });
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('retains a landed publication after its acknowledgement fails, with concurrent advance: %s', async (concurrent) => {
    deps.published.mockImplementationOnce(async () => {
      if (concurrent) {
        const attached = await service.start(req, project, reference.revisionId);
        await service.advance(req, project, { ...request(attached), stepIndex: 0 });
      }
      throw new MicroserviceError('Synthetic acknowledgement failure', 503, 'STORE_UNAVAILABLE');
    });
    const chain = await service.start(req, project, reference.revisionId);
    const retained = marker();
    expect(retained).toMatchObject({ chainId: chain.chainId, expiresAt: expect.any(Number) });
    expect(retained.expiresAt).toBeGreaterThan(Date.now());
    const retry = await service.start(req, project, reference.revisionId);
    expect(retry).toMatchObject({ chainId: chain.chainId, attached: true });
    expect(marker()).toEqual(retained);
    await service.advance(req, project, { ...request(retry), stepIndex: 0 });
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
    expect([...deps.objects.keys()].filter((key) => key.endsWith('.json'))).toHaveLength(1);
  });
  it('keeps a failed publication closed until expiry when conditional cleanup is unavailable', async () => {
    vi.useFakeTimers();
    deps.publish.mockRejectedValueOnce(new MicroserviceError('Synthetic failure', 503, 'STORE_UNAVAILABLE'));
    deps.conditional.mockRejectedValueOnce(new MicroserviceError('Synthetic cleanup failure', 503, 'STORE_UNAVAILABLE'));
    await expect(service.start(req, project, reference.revisionId)).rejects.toMatchObject({ statusCode: 503 });
    await expect(service.start(req, project, reference.revisionId)).rejects.toMatchObject({ statusCode: 503 });
    expect(deps.bp.start).not.toHaveBeenCalled();
    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'mktg_rebuild_publish',
      expect.any(String),
      expect.objectContaining({ project: project.uid, chainId: marker().chainId, err: expect.anything() })
    );
    vi.advanceTimersByTime(MKTG_REBUILD_ACTIVE_TTL_MS + 1);
    await expect(service.start(req, project, reference.revisionId)).resolves.toMatchObject({ status: 'running' });
  });
  it('does not let a late terminal release expire a replacement chain marker', async () => {
    const chain = await service.start(req, project, reference.revisionId);
    const replacement = { ...marker(), chainId: '12345678-1234-4123-8123-123456789abc' };
    deps.bp.result.mockImplementationOnce(async () => {
      deps.objects.set(activeKey, { body: JSON.stringify(replacement), etag: String(++deps.version) });
      return { status: 'refused', reply: 'Synthetic refusal' };
    });
    expect((await service.result(req, project, request(chain))).status).toBe('failed');
    expect(marker()).toEqual(replacement);
  });
  it.each([undefined, '{', JSON.stringify({ status: 'running' })])('fails closed behind an interrupted/unreadable publication: %s', async (body) => {
    const chain = await service.start(req, project, reference.revisionId);
    const key = `rebuilds/${project.uid}/${chain.chainId}.json`;
    if (body === undefined) deps.objects.delete(key);
    else deps.objects.set(key, { body, etag: 'unreadable' });
    await expect(service.start(req, project, reference.revisionId)).rejects.toMatchObject({ statusCode: 503 });
    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'mktg_rebuild_attach',
      expect.any(String),
      expect.objectContaining({ project: project.uid, chainId: chain.chainId, err: expect.anything() })
    );
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
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
    expect(marker().expiresAt).toBe(0);
    expect((await service.start(req, project, reference.revisionId)).chainId).not.toBe(chain.chainId);
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
    expect(marker().expiresAt).toBe(0);
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
    const key = `rebuilds/${project.uid}/${chain.chainId}.json`;
    const saved = deps.objects.get(key);
    if (!saved) throw new Error('Missing synthetic record');
    deps.objects.set(key, { ...saved, body: JSON.stringify({ ...JSON.parse(saved.body), operationId: 'interrupted' }) });
    await expect(service.advance(req, project, { ...request(chain), stepIndex: 0 })).resolves.toMatchObject({ chainId: chain.chainId });
    await expect(service.advance(req, project, { ...request(chain), stepIndex: 0, answers: [] })).rejects.toThrow('interrupted');
    expect(deps.bp.start).toHaveBeenCalledTimes(1);
  });
});
