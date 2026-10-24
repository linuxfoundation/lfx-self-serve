// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MktgDocumentRedraftContext, ObjectStorePutInput } from '@lfx-one/shared/interfaces';
import { redraftContextFixture } from '@lfx-one/shared/utils/__fixtures__/mktg-redraft-context.fixture';
import { MKTG_REDRAFT_CONTEXT_MAX_BYTES } from '@lfx-one/shared/constants';
const calls = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
const objects = vi.hoisted(() => new Map<string, string>());
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public getObject = calls.get;
    public putConditionalObject = calls.put;
  },
}));
import { MktgDocumentRedraftContextService } from './mktg-document-redraft-context.service';
import { AuthorizationError, ConflictError, MicroserviceError, ServiceValidationError } from '../errors';

const SESSION = 'synthetic-redraft-session';
const req = {} as Request;
function input(agent: MktgDocumentRedraftContext['agentKey'] = 'foundation-message') {
  return redraftContextFixture(agent);
}

describe('immutable private redraft context', () => {
  let service: MktgDocumentRedraftContextService;
  beforeEach(() => {
    vi.resetAllMocks();
    objects.clear();
    service = new MktgDocumentRedraftContextService();
    calls.get.mockImplementation(async (_req, _purpose, key: string) => (objects.has(key) ? { body: objects.get(key), metadata: {} } : null));
    calls.put.mockImplementation(async (_req, _purpose, key: string, value: ObjectStorePutInput) => {
      if (objects.has(key)) return false;
      objects.set(key, Buffer.from(value.body).toString('utf8'));
      return true;
    });
  });
  it('writes only a hash-keyed contract snapshot, never raw session or owner tokens', async () => {
    const context = await service.create(req, SESSION, input());
    const key = `document-redrafts/${MktgDocumentRedraftContextService.runId(SESSION)}.json`;
    expect(calls.put).toHaveBeenCalledWith(
      req,
      'marketing-os-artifacts',
      key,
      expect.objectContaining({ ifNoneMatch: '*', cacheControl: 'private, no-store' })
    );
    const body = objects.get(key) ?? '';
    expect(body).not.toContain(SESSION);
    expect(body).not.toContain('ownerToken');
    expect(body).not.toContain('requestedBy');
    expect(await service.forSession(req, SESSION)).toEqual(context);
  });
  it('deduplicates semantically identical immutable creation even when input property order changes', async () => {
    const first = await service.create(req, SESSION, input());
    const value = input();
    const reordered = Object.fromEntries(Object.entries(value).reverse()) as typeof value;
    expect(await service.create(req, SESSION, reordered)).toEqual(first);
    expect(objects.size).toBe(1);
  });
  it('never replaces a differently bound send or comment snapshot', async () => {
    await service.create(req, SESSION, input());
    const original = [...objects.values()];
    await expect(service.create(req, SESSION, { ...input(), requestId: 'different-request' })).rejects.toBeInstanceOf(ConflictError);
    expect([...objects.values()]).toEqual(original);
  });
  it('handles concurrent identical creates through the existing conditional primitive', async () => {
    const [a, b] = await Promise.all([service.create(req, SESSION, input()), service.create(req, SESSION, input())]);
    expect(a).toEqual(b);
    expect(objects.size).toBe(1);
  });
  it('distinguishes confirmed absence from storage/access failures', async () => {
    expect(await service.forSession(req, SESSION)).toBeNull();
    calls.get.mockRejectedValueOnce(new MicroserviceError('Unavailable', 503, 'UNAVAILABLE'));
    await expect(service.forSession(req, SESSION)).rejects.toMatchObject({ statusCode: 503 });
  });
  it('fails closed on corrupt bytes or a descriptor filed under the wrong session hash', async () => {
    const key = `document-redrafts/${MktgDocumentRedraftContextService.runId(SESSION)}.json`;
    objects.set(key, '{ private malformed comment');
    await expect(service.forSession(req, SESSION)).rejects.toMatchObject({
      code: 'MKTG_REDRAFT_CONTEXT_CORRUPT',
      message: 'Stored redraft context is unreadable.',
    });
    objects.set(key, JSON.stringify(redraftContextFixture()));
    await expect(service.forSession(req, SESSION)).rejects.toMatchObject({ code: 'MKTG_REDRAFT_CONTEXT_CORRUPT' });
  });
  it('rejects forbidden fields before writing and bounds serialized context bytes', async () => {
    const value = input();
    await expect(service.create(req, SESSION, { ...value, sessionId: SESSION } as typeof value)).rejects.toBeInstanceOf(ServiceValidationError);
    const big = input('brand-kit');
    big.comments[0].anchor.passage = 's'.repeat(MKTG_REDRAFT_CONTEXT_MAX_BYTES);
    await expect(service.create(req, SESSION, big)).rejects.toBeInstanceOf(ServiceValidationError);
    expect(calls.put).not.toHaveBeenCalled();
  });
  it('compares canonical authorized project and registered agent; no mismatch fallback', () => {
    const context = redraftContextFixture();
    expect(() => service.assertScope(context, context.project, context.agentKey)).not.toThrow();
    for (const project of [undefined, 'other-project']) expect(() => service.assertScope(context, project, context.agentKey)).toThrow(AuthorizationError);
    expect(() => service.assertScope(context, context.project, 'brand-kit')).toThrow(AuthorizationError);
  });
});
