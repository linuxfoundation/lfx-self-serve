// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { warning } = vi.hoisted(() => ({ warning: vi.fn() }));

vi.mock('@lfx-one/shared/constants', () => ({ NATS_CONFIG: { REQUEST_TIMEOUT: 5000, LOOKUP_BATCH_CONCURRENCY: 10, LOOKUP_BATCH_BUDGET_MS: 15000 } }));
vi.mock('@lfx-one/shared/enums', () => ({ NatsSubjects: { LOOKUP_V1_MAPPING: 'lfx.lookup_v1_mapping' } }));
vi.mock('../services/logger.service', () => ({ logger: { warning } }));

import { resolveV1MappingBatch } from './v1-mapping-batch.helper';

const req = {} as unknown as Request;

// Mirrors the committee-level parse convention (second colon segment) — the shared engine is
// agnostic to any particular entity's response shape, so any representative parser exercises it.
const buildLookupKey = (id: string) => `test.uid.${id}`;
const parseResponse = (text: string) => {
  const parts = text.split(':');
  return parts.length >= 2 && parts[1] ? parts[1] : null;
};
const baseOptions = { buildLookupKey, parseResponse, logOperation: 'resolve_test_mapping', entityLabel: 'test' };

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function buildNatsService(responses: Record<string, string | Error>) {
  const request = vi.fn(async (subject: string, data: Uint8Array) => {
    const key = new TextDecoder().decode(data);
    const response = responses[key];
    if (response instanceof Error) throw response;
    return { data: encode(response ?? '') };
  });
  return {
    getCodec: () => ({
      encode: (value: string) => encode(value),
      decode: (data: Uint8Array) => new TextDecoder().decode(data),
    }),
    request,
  } as unknown as import('../services/nats.service').NatsService;
}

describe('resolveV1MappingBatch', () => {
  beforeEach(() => {
    warning.mockReset();
  });

  it('resolves an id to its parsed v1 id (second colon-delimited segment)', async () => {
    const natsService = buildNatsService({ 'test.uid.a': 'project-sfid:v1-a' });

    const result = await resolveV1MappingBatch(req, natsService, ['a'], baseOptions);

    expect(result.resolved.get('a')).toBe('v1-a');
    expect(result.resolved.size).toBe(1);
    expect(result.confirmedUnresolved.size).toBe(0);
  });

  it('resolves multiple ids concurrently, each to its own v1 id', async () => {
    const natsService = buildNatsService({ 'test.uid.a': 'proj:v1-a', 'test.uid.b': 'proj:v1-b' });

    const result = await resolveV1MappingBatch(req, natsService, ['a', 'b'], baseOptions);

    expect(result.resolved.get('a')).toBe('v1-a');
    expect(result.resolved.get('b')).toBe('v1-b');
    expect(result.resolved.size).toBe(2);
  });

  it('marks an id confirmed-unresolved when the response is empty — a genuine "no mapping" answer', async () => {
    const natsService = buildNatsService({ 'test.uid.a': '' });

    const result = await resolveV1MappingBatch(req, natsService, ['a'], baseOptions);

    expect(result.resolved.has('a')).toBe(false);
    expect(result.confirmedUnresolved.has('a')).toBe(true);
    expect(warning).toHaveBeenCalledWith(req, 'resolve_test_mapping', 'NATS lookup returned no mapping', expect.objectContaining({ v2_uid: 'a' }));
  });

  it('leaves an id indeterminate (NOT confirmed-unresolved) when the response is an error: response', async () => {
    // Verified against the real lfx-v1-sync-helper responder: `error:` means its own KV read
    // failed (JetStream unavailable, deadline exceeded) — an infrastructure fault, not proof no
    // mapping exists. Only an empty response means that. Negative-caching this would turn a
    // transient NATS-side blip into an hour of false "no mapping" answers.
    const natsService = buildNatsService({ 'test.uid.a': 'error: not found' });

    const result = await resolveV1MappingBatch(req, natsService, ['a'], baseOptions);

    expect(result.resolved.has('a')).toBe(false);
    expect(result.confirmedUnresolved.has('a')).toBe(false);
    expect(warning).toHaveBeenCalledWith(
      req,
      'resolve_test_mapping',
      'NATS lookup responder returned an error; treating as indeterminate',
      expect.objectContaining({ v2_uid: 'a', response: 'error: not found' })
    );
  });

  it('leaves an id indeterminate (NOT confirmed-unresolved) when the response has no colon-delimited second segment', async () => {
    // NATS answered with *something* — this parser just couldn't extract a usable id from it. That's
    // not proof no mapping exists (could be a shape mismatch this consumer's parser gets wrong), so
    // it must not be safe to negative-cache — the regression this test guards against a general-code
    // review caught: parse failures used to be lumped in with confirmed-unresolved.
    const natsService = buildNatsService({ 'test.uid.a': 'no-colon-here' });

    const result = await resolveV1MappingBatch(req, natsService, ['a'], baseOptions);

    expect(result.resolved.has('a')).toBe(false);
    expect(result.confirmedUnresolved.has('a')).toBe(false);
    expect(warning).toHaveBeenCalledWith(req, 'resolve_test_mapping', 'Unexpected NATS response format', expect.objectContaining({ v2_uid: 'a' }));
  });

  it('leaves an id indeterminate when the response has a blank second segment', async () => {
    const natsService = buildNatsService({ 'test.uid.a': 'proj:' });

    const result = await resolveV1MappingBatch(req, natsService, ['a'], baseOptions);

    expect(result.resolved.has('a')).toBe(false);
    expect(result.confirmedUnresolved.has('a')).toBe(false);
  });

  it('leaves an id indeterminate (neither resolved nor confirmed-unresolved) when the NATS request itself rejects', async () => {
    const natsService = buildNatsService({ 'test.uid.a': new Error('NATS timeout'), 'test.uid.b': 'proj:v1-b' });

    const result = await resolveV1MappingBatch(req, natsService, ['a', 'b'], baseOptions);

    expect(result.resolved.has('a')).toBe(false);
    expect(result.confirmedUnresolved.has('a')).toBe(false);
    expect(result.resolved.get('b')).toBe('v1-b');
    expect(warning).toHaveBeenCalledWith(req, 'resolve_test_mapping', 'Failed to resolve v2->v1 test mapping', expect.objectContaining({ v2_uid: 'a' }));
  });

  it('returns empty resolved/confirmedUnresolved for an empty input list, without calling NATS', async () => {
    const natsService = buildNatsService({});

    const result = await resolveV1MappingBatch(req, natsService, [], baseOptions);

    expect(result.resolved.size).toBe(0);
    expect(result.confirmedUnresolved.size).toBe(0);
  });

  it('caps concurrency at the default NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY (10) rather than firing every request at once', async () => {
    const ids = Array.from({ length: 15 }, (_, i) => `id-${i}`);
    const deferreds: { resolve: (value: { data: Uint8Array }) => void }[] = [];
    const request = vi.fn(
      () =>
        new Promise((resolve) => {
          deferreds.push({ resolve });
        })
    );
    const natsService = {
      getCodec: () => ({ encode: (value: string) => encode(value), decode: (data: Uint8Array) => new TextDecoder().decode(data) }),
      request,
    } as unknown as import('../services/nats.service').NatsService;

    const pending = resolveV1MappingBatch(req, natsService, ids, baseOptions);

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(10));

    deferreds.forEach((d) => d.resolve({ data: encode('proj:resolved') }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(15));

    deferreds.slice(10).forEach((d) => d.resolve({ data: encode('proj:resolved') }));
    const result = await pending;
    expect(result.resolved.size).toBe(15);
  });

  it('respects an explicit concurrency override instead of the NATS_CONFIG default', async () => {
    // Only proves the cap takes effect (2, not the mocked default of 10) — doesn't drain every
    // batch to completion, since resolving wave N only creates wave N+1's deferreds, which would
    // need their own resolve step; the concurrency-cap test above already covers full draining
    // against the default value.
    const ids = Array.from({ length: 5 }, (_, i) => `id-${i}`);
    const deferreds: { resolve: (value: { data: Uint8Array }) => void }[] = [];
    const request = vi.fn(
      () =>
        new Promise((resolve) => {
          deferreds.push({ resolve });
        })
    );
    const natsService = {
      getCodec: () => ({ encode: (value: string) => encode(value), decode: (data: Uint8Array) => new TextDecoder().decode(data) }),
      request,
    } as unknown as import('../services/nats.service').NatsService;

    resolveV1MappingBatch(req, natsService, ids, { ...baseOptions, concurrency: 2 });

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it('stops issuing further batches once the wall-clock budget is exceeded, returning the partial result resolved so far', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `id-${i}`);
    const natsService = buildNatsService(Object.fromEntries(ids.map((id) => [`test.uid.${id}`, 'proj:resolved'])));

    const dateSpy = vi.spyOn(Date, 'now');
    dateSpy.mockReturnValueOnce(0);
    dateSpy.mockReturnValueOnce(0);
    dateSpy.mockReturnValue(20000);

    const result = await resolveV1MappingBatch(req, natsService, ids, baseOptions);

    expect(result.resolved.size).toBe(10);
    expect(warning).toHaveBeenCalledWith(
      req,
      'resolve_test_mapping',
      'Lookup batch budget exceeded; returning the partial map resolved so far',
      expect.objectContaining({ resolved_count: 10, requested_count: 25 })
    );

    dateSpy.mockRestore();
  });
});
