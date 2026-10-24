// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { MktgCreateRequest, MktgRequestsRecord, MktgRequestState } from '@lfx-one/shared/interfaces';
import { MKTG_REQUESTS_STORE_MAX_BYTES, MKTG_REQUEST_WITHDRAWN_NOTE } from '@lfx-one/shared/constants';

const fake = vi.hoisted(() => ({
  body: null as string | null,
  etag: 0,
  missingEtag: false,
  subject: 'oidc|synthetic-writer' as string | null,
  impersonating: false,
  get: vi.fn(),
  put: vi.fn(),
  directory: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public getObject = fake.get;
    public putConditionalObject = fake.put;
  },
}));
vi.mock('./user.service', () => ({
  UserService: class {
    public getUserInfo = fake.directory;
  },
}));
vi.mock('./logger.service', () => ({ logger: { warning: fake.warning, debug: fake.debug } }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveSub: () => fake.subject, isImpersonating: () => fake.impersonating }));

import { MktgRequestsService } from './mktg-requests.service';
import { MktgDocumentAuthorService } from './mktg-document-author.service';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  MicroserviceError,
  PreconditionFailedError,
  ResourceNotFoundError,
  ServiceValidationError,
} from '../errors';

const project = 'synthetic-project';
const req = {} as Request;
const result = { agentKey: 'faq', documentId: 'living', revisionId: `000002-${'b'.repeat(64)}` };
const createBody = (overrides: Partial<MktgCreateRequest> = {}): MktgCreateRequest => ({
  project,
  kind: 'asset',
  target: { familyId: 'positioning-brand' },
  text: 'Synthetic asset request',
  clientRequestId: randomUUID(),
  ...overrides,
});
function record(): MktgRequestsRecord {
  return JSON.parse(fake.body ?? '{}') as MktgRequestsRecord;
}
function save(value: MktgRequestsRecord): void {
  fake.body = JSON.stringify(value);
}

describe('MktgRequestsService', () => {
  let service: MktgRequestsService;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    Object.assign(fake, { body: null, etag: 0, missingEtag: false, subject: 'oidc|synthetic-writer', impersonating: false });
    fake.get.mockImplementation(async () =>
      fake.body === null ? null : { body: fake.body, etag: fake.missingEtag ? undefined : String(fake.etag), metadata: {} }
    );
    fake.put.mockImplementation(async (_req, purpose, key, input) => {
      expect(purpose).toBe('marketing-os-artifacts');
      expect(key).toBe(`requests/${project}/requests.json`);
      const matches = fake.body === null ? input.ifNoneMatch === '*' : input.ifMatch === String(fake.etag);
      if (!matches) return false;
      fake.body = input.body.toString();
      fake.etag++;
      return true;
    });
    fake.directory.mockResolvedValue({ success: true, data: { name: 'Synthetic writer', email: 'writer@example.test' } });
    service = new MktgRequestsService();
  });

  it('only confirmed absence is empty, and invalid partitions never reach storage', async () => {
    expect(await service.list(req, project)).toEqual({ requests: [], openCount: 0 });
    await expect(service.list(req, '../unsafe')).rejects.toMatchObject({ statusCode: 400 });
    expect(fake.get).toHaveBeenCalledTimes(1);
  });

  it('creates one opaque-subject record and explicitly strips subjects, tokens and receipts in public output', async () => {
    const body = createBody({ target: { familyId: 'positioning-brand', assetId: 'one-pager' }, text: '  Synthetic request kept verbatim.  ' });
    const capture = vi.spyOn(MktgDocumentAuthorService.prototype, 'captureAuthorId');
    const resolve = vi.spyOn(MktgDocumentAuthorService.prototype, 'resolveAuthor');
    const created = await service.create(req, project, body);
    expect(capture).toHaveBeenCalledWith(req);
    expect(resolve).toHaveBeenCalledWith(req, fake.subject, 'mktg_requests_author', 'Request author lookup unavailable');
    expect(record().requests[0]).toMatchObject({
      requestedBy: fake.subject,
      stateChangedBy: fake.subject,
      requesterCommittees: [],
      clientRequestId: body.clientRequestId,
      target: body.target,
      text: body.text,
    });
    expect(fake.put.mock.calls[0]?.[3]).toMatchObject({ cacheControl: 'private, no-store', contentType: 'application/json; charset=utf-8' });
    expect(created).toMatchObject({
      target: body.target,
      text: body.text,
      requestedBy: { name: 'Synthetic writer' },
      stateChangedBy: { name: 'Synthetic writer' },
      isRequester: true,
      state: 'open',
    });
    expect(JSON.stringify(created)).not.toMatch(/oidc\||clientRequestId|stateChanges|email/);
    expect(fake.directory).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fake.debug.mock.calls)).not.toContain(body.text);
    fake.subject = 'oidc|another-writer';
    expect((await service.list(req, project)).requests[0]?.isRequester).toBe(false);
  });

  it('lists and mutates historical targets after catalog retirement without blocking new requests', async () => {
    const created = await service.create(req, project, createBody());
    const stored = record();
    const target = { familyId: 'retired-family', assetId: 'retired-asset' };
    stored.requests = stored.requests.flatMap((row) => [
      { ...row, target },
      { ...row, id: randomUUID(), clientRequestId: randomUUID(), target: { ...target, agentKey: 'retired-agent', documentId: 'living' } },
    ]);
    save(stored);
    const listing = await service.list(req, project);
    expect(listing.requests.find((row) => row.id === created.id)?.target).toEqual(target);
    expect(listing.requests.some((row) => row.target.agentKey === 'retired-agent')).toBe(true);
    expect(listing.openCount).toBe(2);
    const historicalResult = result;
    expect(
      await service.changeState(req, project, created.id, { project, state: 'done', result: historicalResult, clientRequestId: randomUUID() })
    ).toMatchObject({ result: historicalResult });
    await service.create(req, project, createBody());
    expect(record().requests).toHaveLength(3);
  });

  it('deduplicates create before the cap and rejects changed content or caller', async () => {
    const body = createBody();
    const first = await service.create(req, project, body);
    expect((await service.create(req, project, body)).id).toBe(first.id);
    for (const changed of [
      createBody({ ...body, text: 'Different' }),
      createBody({ ...body, kind: 'change', target: { familyId: 'positioning-brand', agentKey: 'faq', documentId: 'living' } }),
    ])
      await expect(service.create(req, project, changed)).rejects.toBeInstanceOf(ConflictError);
    fake.subject = 'oidc|another-writer';
    await expect(service.create(req, project, body)).rejects.toBeInstanceOf(ConflictError);
    expect(fake.put).toHaveBeenCalledTimes(1);
  });

  it('caps at 500 without dropping entries, while replay at the cap succeeds', async () => {
    const body = createBody();
    const first = await service.create(req, project, body);
    const stored = record();
    const template = stored.requests[0];
    if (!template) throw new Error('Missing synthetic request');
    stored.requests = Array.from({ length: 500 }, (_, index) => (index ? { ...template, id: randomUUID(), clientRequestId: randomUUID() } : template));
    save(stored);
    expect((await service.create(req, project, body)).id).toBe(first.id);
    await expect(service.create(req, project, createBody())).rejects.toBeInstanceOf(ConflictError);
    expect(record().requests).toHaveLength(500);
    expect(fake.put).toHaveBeenCalledTimes(1);
  });

  it('retries lost CAS with the fresh ETag and surfaces 412 after eight losses', async () => {
    await service.create(req, project, createBody());
    fake.put.mockImplementationOnce(async () => {
      const snapshot = record();
      const template = snapshot.requests[0];
      if (!template) throw new Error('Missing synthetic request');
      snapshot.requests.push({ ...template, id: randomUUID(), clientRequestId: randomUUID(), text: 'Concurrent request' });
      save(snapshot);
      fake.etag++;
      return false;
    });
    await service.create(req, project, createBody());
    expect(record().requests).toHaveLength(3);
    expect(fake.put.mock.calls.at(-1)?.[3].ifMatch).toBe('2');
    expect(fake.put).toHaveBeenCalledTimes(3);
    fake.put.mockClear().mockResolvedValue(false);
    await expect(service.create(req, project, createBody())).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(fake.put).toHaveBeenCalledTimes(8);
  });

  it('finds a concurrent creator on reread without appending twice', async () => {
    const body = createBody();
    const realPut = fake.put.getMockImplementation();
    fake.put.mockImplementationOnce(async (...args) => {
      await realPut?.(...args);
      return false;
    });
    const result = await service.create(req, project, body);
    expect(record().requests).toHaveLength(1);
    expect(result.id).toBe(record().requests[0]?.id);
    expect(fake.put).toHaveBeenCalledTimes(1);
  });

  it.each(['{', '{}', '{"schema":"future","requests":[]}', 'null'])('never overwrites malformed record %s', async (body) => {
    fake.body = body;
    await expect(service.create(req, project, createBody())).rejects.toBeInstanceOf(MicroserviceError);
    expect(fake.put).not.toHaveBeenCalled();
  });

  it('refuses missing ETag, wrong project, unknown row shape and duplicate IDs', async () => {
    await service.create(req, project, createBody());
    const valid = record();
    fake.put.mockClear();
    fake.missingEtag = true;
    await expect(service.create(req, project, createBody())).rejects.toMatchObject({ code: 'MKTG_REQUESTS_CORRUPT' });
    fake.missingEtag = false;
    for (const bad of [
      { ...valid, project: 'other' },
      { ...valid, requests: [{}] },
      { ...valid, requests: [...valid.requests, ...valid.requests] },
    ]) {
      fake.body = JSON.stringify(bad);
      await expect(service.create(req, project, createBody())).rejects.toMatchObject({ code: 'MKTG_REQUESTS_CORRUPT' });
    }
    expect(fake.put).not.toHaveBeenCalled();
  });

  it('propagates read/write outages, never empty or conflict', async () => {
    const outage = new MicroserviceError('Unavailable', 503, 'SYNTHETIC_OUTAGE');
    fake.get.mockRejectedValueOnce(outage);
    await expect(service.list(req, project)).rejects.toBe(outage);
    fake.put.mockRejectedValueOnce(outage);
    await expect(service.create(req, project, createBody())).rejects.toBe(outage);
    expect(fake.put).toHaveBeenCalledTimes(1);
  });

  it('bounds stored bytes before parsing and rejects oversized writes without putting or dropping requests', async () => {
    fake.body = ' '.repeat(MKTG_REQUESTS_STORE_MAX_BYTES + 1);
    await expect(service.list(req, project)).rejects.toMatchObject({ code: 'MKTG_REQUESTS_CORRUPT' });
    fake.body = null;
    fake.subject = 'x'.repeat(MKTG_REQUESTS_STORE_MAX_BYTES);
    await expect(service.create(req, project, createBody())).rejects.toBeInstanceOf(ConflictError);
    expect(fake.put).not.toHaveBeenCalled();
  });

  it('keeps all writes unattributed only for a missing impersonation target, never the operator', async () => {
    fake.subject = null;
    await expect(service.create(req, project, createBody())).rejects.toBeInstanceOf(AuthenticationError);
    fake.impersonating = true;
    expect(await service.create(req, project, createBody())).toMatchObject({ requestedBy: null, isRequester: false });
    expect(fake.directory).not.toHaveBeenCalled();
  });

  for (const from of ['open', 'in-progress', 'done', 'declined'] as const) {
    for (const to of ['open', 'in-progress', 'done', 'declined'] as const) {
      it(`checks transition ${from} -> ${to}`, async () => {
        const row = await service.create(req, project, createBody());
        const stored = record();
        stored.requests = stored.requests.map((entry) => ({ ...entry, state: from, note: from === 'declined' ? 'Synthetic decline' : null }));
        save(stored);
        const attempt = service.changeState(req, project, row.id, { project, state: to, note: 'Synthetic note', clientRequestId: randomUUID() });
        const allowed = (from === 'open' && to !== 'open') || (from === 'in-progress' && (to === 'done' || to === 'declined'));
        if (allowed) expect(await attempt).toMatchObject({ state: to });
        else await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      });
    }
  }

  it('checks withdrawal ownership and open state on the server', async () => {
    const row = await service.create(req, project, createBody());
    const withdraw = { project, withdraw: true as const, clientRequestId: randomUUID() };
    fake.subject = 'oidc|other';
    await expect(service.changeState(req, project, row.id, withdraw)).rejects.toBeInstanceOf(AuthorizationError);
    fake.subject = 'oidc|synthetic-writer';
    expect(() => service.readState({ ...withdraw, state: 'done' })).toThrow(ServiceValidationError);
    expect(await service.changeState(req, project, row.id, withdraw)).toMatchObject({ state: 'declined', note: MKTG_REQUEST_WITHDRAWN_NOTE, withdrawn: true });
    expect(record().requests[0]?.stateChanges[0]).toMatchObject({ withdraw: true, note: MKTG_REQUEST_WITHDRAWN_NOTE });
    expect(await service.changeState(req, project, row.id, withdraw)).toMatchObject({ state: 'declined' });
    await expect(
      service.changeState(req, project, row.id, { project, state: 'declined', note: MKTG_REQUEST_WITHDRAWN_NOTE, clientRequestId: withdraw.clientRequestId })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(service.changeState(req, project, row.id, { ...withdraw, clientRequestId: randomUUID() })).rejects.toBeInstanceOf(ConflictError);
  });

  it.each(['withdrawn', 'Withdrawn', 'withdrawn.'])('allows another writer to decline with ordinary note %s', async (note) => {
    const row = await service.create(req, project, createBody());
    fake.subject = 'oidc|another-writer';
    expect(await service.changeState(req, project, row.id, { project, state: 'declined', note, clientRequestId: randomUUID() })).toMatchObject({
      note,
      state: 'declined',
      withdrawn: false,
    });
    expect(record().requests[0]?.stateChanges[0]?.withdraw).toBe(false);
  });
  it.each(['retired-agent', 'brand-kit'])('rejects result agent %s for an asset pinned to faq', async (agentKey) => {
    const row = await service.create(req, project, createBody({ target: { familyId: 'positioning-brand', agentKey: 'faq' } }));
    fake.put.mockClear();
    await expect(
      service.changeState(req, project, row.id, { project, state: 'done', result: { ...result, agentKey }, clientRequestId: randomUUID() })
    ).rejects.toBeInstanceOf(ServiceValidationError);
    expect(fake.put).not.toHaveBeenCalled();
  });

  it('keeps a complete asset completion reference in storage, receipt, public response and replay', async () => {
    const row = await service.create(req, project, createBody());
    const done = { project, state: 'done' as const, result, clientRequestId: randomUUID() };
    expect(await service.changeState(req, project, row.id, done)).toMatchObject({ result });
    expect(await service.changeState(req, project, row.id, done)).toMatchObject({ result });
    expect(record().requests[0]).toMatchObject({ result, stateChanges: [{ result, state: 'done' }] });
  });
  it('rejects a completion reference to another document on a change request', async () => {
    const row = await service.create(
      req,
      project,
      createBody({ kind: 'change', target: { familyId: 'positioning-brand', agentKey: 'faq', documentId: 'living' } })
    );
    fake.put.mockClear();
    for (const wrong of [
      { ...result, agentKey: 'brand-kit' },
      { ...result, documentId: `run-${'c'.repeat(24)}` },
    ])
      await expect(service.changeState(req, project, row.id, { project, state: 'done', result: wrong, clientRequestId: randomUUID() })).rejects.toBeInstanceOf(
        ServiceValidationError
      );
    expect(fake.put).not.toHaveBeenCalled();
    expect(await service.changeState(req, project, row.id, { project, state: 'done', result, clientRequestId: randomUUID() })).toMatchObject({ result });
  });

  it('retains state receipts across later changes, conflicts on reuse, and never leaks them', async () => {
    const row = await service.create(req, project, createBody());
    const start = { project, state: 'in-progress' as const, clientRequestId: randomUUID() };
    await service.changeState(req, project, row.id, start);
    await service.changeState(req, project, row.id, { project, state: 'done', clientRequestId: randomUUID() });
    const retried = await service.changeState(req, project, row.id, start);
    expect(retried.state).toBe('done');
    expect(retried).not.toHaveProperty('stateChanges');
    await expect(service.changeState(req, project, row.id, { ...start, note: 'Changed' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('state updates retry CAS, exhaust as 412 and report missing requests', async () => {
    const row = await service.create(req, project, createBody());
    const state = { project, state: 'done' as MktgRequestState, clientRequestId: randomUUID() };
    fake.put.mockResolvedValueOnce(false);
    await service.changeState(req, project, row.id, state);
    await expect(service.changeState(req, project, randomUUID(), state)).rejects.toBeInstanceOf(ResourceNotFoundError);
    const second = await service.create(req, project, createBody());
    fake.put.mockClear().mockResolvedValue(false);
    await expect(service.changeState(req, project, second.id, state)).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(fake.put).toHaveBeenCalledTimes(8);
  });

  it('sorts newest first and counts only open/in-progress', async () => {
    await service.create(req, project, createBody());
    const stored = record();
    const template = stored.requests[0];
    if (!template) throw new Error('Missing synthetic request');
    stored.requests = (['open', 'in-progress', 'done', 'declined'] as const).map((state, index) => ({
      ...template,
      id: randomUUID(),
      clientRequestId: randomUUID(),
      state,
      createdAt: `2026-10-2${index}T12:00:00.000Z`,
      note: state === 'declined' ? 'Synthetic decline' : null,
    }));
    save(stored);
    const result = await service.list(req, project);
    expect(result.requests.map((row) => row.state)).toEqual(['declined', 'done', 'in-progress', 'open']);
    expect(result.openCount).toBe(2);
  });

  it('bounds real directory work to four and memoizes subjects per response', async () => {
    await service.create(req, project, createBody());
    const stored = record();
    const template = stored.requests[0];
    if (!template) throw new Error('Missing synthetic request');
    stored.requests = Array.from({ length: 12 }, (_, index) => ({
      ...template,
      id: randomUUID(),
      clientRequestId: randomUUID(),
      requestedBy: `oidc|writer-${index % 6}`,
      stateChangedBy: 'oidc|editor',
    }));
    save(stored);
    let active = 0;
    let max = 0;
    fake.directory.mockClear().mockImplementation(async () => {
      active++;
      max = Math.max(max, active);
      await Promise.resolve();
      active--;
      return { success: true, data: { name: 'Synthetic member' } };
    });
    await service.list({} as Request, project);
    expect(max).toBeLessThanOrEqual(4);
    expect(fake.directory).toHaveBeenCalledTimes(7);
  });
});
