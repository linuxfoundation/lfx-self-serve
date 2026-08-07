// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { warning } = vi.hoisted(() => ({ warning: vi.fn() }));

vi.mock('@lfx-one/shared/constants', () => ({ NATS_CONFIG: { REQUEST_TIMEOUT: 5000, LOOKUP_BATCH_CONCURRENCY: 10, LOOKUP_BATCH_BUDGET_MS: 15000 } }));
vi.mock('@lfx-one/shared/enums', () => ({ NatsSubjects: { LOOKUP_V1_MAPPING: 'lfx.lookup_v1_mapping' } }));
vi.mock('../services/logger.service', () => ({ logger: { warning } }));

import { resolveCommitteeV2UidsToV1Ids } from './committee-v1-mapping.helper';

const req = {} as unknown as Request;

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

describe('resolveCommitteeV2UidsToV1Ids', () => {
  beforeEach(() => {
    warning.mockReset();
  });

  it('resolves a v2 uid to the v1 sfid (second colon-delimited segment)', async () => {
    const natsService = buildNatsService({
      'committee.uid.v2-a': 'project-sfid:v1-a',
    });

    const result = await resolveCommitteeV2UidsToV1Ids(req, natsService, ['v2-a']);

    expect(result.get('v2-a')).toBe('v1-a');
    expect(result.size).toBe(1);
  });

  it('resolves multiple uids concurrently, each to its own v1 sfid', async () => {
    const natsService = buildNatsService({
      'committee.uid.v2-a': 'proj:v1-a',
      'committee.uid.v2-b': 'proj:v1-b',
    });

    const result = await resolveCommitteeV2UidsToV1Ids(req, natsService, ['v2-a', 'v2-b']);

    expect(result.get('v2-a')).toBe('v1-a');
    expect(result.get('v2-b')).toBe('v1-b');
    expect(result.size).toBe(2);
  });

  it('omits a uid from the result map (not a thrown error) when the response is empty', async () => {
    const natsService = buildNatsService({ 'committee.uid.v2-a': '' });

    const result = await resolveCommitteeV2UidsToV1Ids(req, natsService, ['v2-a']);

    expect(result.has('v2-a')).toBe(false);
    expect(warning).toHaveBeenCalledWith(req, 'resolve_committee_v1_mapping', 'NATS lookup returned no mapping', expect.objectContaining({ v2_uid: 'v2-a' }));
  });

  it('omits a uid from the result map when the response is an error: response', async () => {
    const natsService = buildNatsService({ 'committee.uid.v2-a': 'error: not found' });

    const result = await resolveCommitteeV2UidsToV1Ids(req, natsService, ['v2-a']);

    expect(result.has('v2-a')).toBe(false);
  });

  it('omits a uid when the response has no colon-delimited second segment', async () => {
    const natsService = buildNatsService({ 'committee.uid.v2-a': 'no-colon-here' });

    const result = await resolveCommitteeV2UidsToV1Ids(req, natsService, ['v2-a']);

    expect(result.has('v2-a')).toBe(false);
    expect(warning).toHaveBeenCalledWith(req, 'resolve_committee_v1_mapping', 'Unexpected NATS response format', expect.objectContaining({ v2_uid: 'v2-a' }));
  });

  it('omits a uid when the response has a blank second segment', async () => {
    const natsService = buildNatsService({ 'committee.uid.v2-a': 'proj:' });

    const result = await resolveCommitteeV2UidsToV1Ids(req, natsService, ['v2-a']);

    expect(result.has('v2-a')).toBe(false);
  });

  it('omits a uid (does not throw or fail the batch) when the NATS request itself rejects', async () => {
    const natsService = buildNatsService({
      'committee.uid.v2-a': new Error('NATS timeout'),
      'committee.uid.v2-b': 'proj:v1-b',
    });

    const result = await resolveCommitteeV2UidsToV1Ids(req, natsService, ['v2-a', 'v2-b']);

    expect(result.has('v2-a')).toBe(false);
    expect(result.get('v2-b')).toBe('v1-b');
    expect(warning).toHaveBeenCalledWith(
      req,
      'resolve_committee_v1_mapping',
      'Failed to resolve v2->v1 committee mapping',
      expect.objectContaining({ v2_uid: 'v2-a' })
    );
  });

  it('returns an empty map for an empty input list, without calling NATS', async () => {
    const natsService = buildNatsService({});

    const result = await resolveCommitteeV2UidsToV1Ids(req, natsService, []);

    expect(result.size).toBe(0);
  });

  it('caps concurrency at NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY (10) rather than firing every request at once', async () => {
    const uids = Array.from({ length: 15 }, (_, i) => `v2-${i}`);
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

    const pending = resolveCommitteeV2UidsToV1Ids(req, natsService, uids);

    // Waits for the actual condition rather than hand-counting microtask ticks — resilient to any
    // future await added inside the batch loop (e.g. a budget check) that would shift the tick
    // topology without changing the behavior being tested.
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(10)); // capped, not all 15 at once

    deferreds.forEach((d) => d.resolve({ data: encode('proj:resolved') }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(15)); // the remaining 5 start once the first batch settles

    deferreds.slice(10).forEach((d) => d.resolve({ data: encode('proj:resolved') }));
    const result = await pending;
    expect(result.size).toBe(15);
  });

  it('stops issuing further batches once the wall-clock budget is exceeded, returning the partial map resolved so far', async () => {
    // 25 uids -> 3 batches of 10/10/5. Date.now() is stubbed so the deadline check reads "exceeded"
    // starting with the second batch, proving the loop bails out early rather than draining all 3.
    const uids = Array.from({ length: 25 }, (_, i) => `v2-${i}`);
    const natsService = buildNatsService(Object.fromEntries(uids.map((uid) => [`committee.uid.${uid}`, 'proj:resolved'])));

    const dateSpy = vi.spyOn(Date, 'now');
    dateSpy.mockReturnValueOnce(0); // deadline = 0 + 15000
    dateSpy.mockReturnValueOnce(0); // first loop check (i=0): 0 <= 15000, proceeds
    dateSpy.mockReturnValue(20000); // every check after: 20000 > 15000, budget exceeded

    const result = await resolveCommitteeV2UidsToV1Ids(req, natsService, uids);

    expect(result.size).toBe(10); // only the first batch ran before the budget check broke the loop
    expect(warning).toHaveBeenCalledWith(
      req,
      'resolve_committee_v1_mapping',
      'Lookup batch budget exceeded; returning the partial map resolved so far',
      expect.objectContaining({ resolved_count: 10, requested_count: 25 })
    );

    dateSpy.mockRestore();
  });
});
