// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { warning } = vi.hoisted(() => ({ warning: vi.fn() }));

vi.mock('@lfx-one/shared/constants', () => ({ NATS_CONFIG: { REQUEST_TIMEOUT: 5000 } }));
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
});
