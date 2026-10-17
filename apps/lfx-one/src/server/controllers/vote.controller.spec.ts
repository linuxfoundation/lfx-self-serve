// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getVotes, getVotesSummary, getVoteStatusCounts } = vi.hoisted(() => ({ getVotes: vi.fn(), getVotesSummary: vi.fn(), getVoteStatusCounts: vi.fn() }));
vi.mock('../services/vote.service', () => ({
  VoteService: class {
    public getVotes = getVotes;
    public getVotesSummary = getVotesSummary;
    public getVoteStatusCounts = getVoteStatusCounts;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: vi.fn(), success: vi.fn(), sanitize: vi.fn((value: unknown) => value) } }));
vi.mock('@lfx-one/shared/utils', () => ({ codePointLength: (value: string) => [...value].length }));

import { ServiceValidationError } from '../errors';
import { VoteController } from './vote.controller';

describe('VoteController management reads', () => {
  const controller = new VoteController();
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn();
  const request = (query: Record<string, unknown>) => ({ query }) as unknown as Request;
  beforeEach(() => vi.resetAllMocks());

  it.each([
    {},
    { parent: '' },
    { parent: 'project:' },
    { parent: 'committee:synthetic' },
    { parent: 'project:a:b' },
    { parent: 'project: ' },
    { parent: ['project:a', 'project:b'] },
    { parent: { uid: 'a' } },
    { parent: 'project:a', group: '' },
    { parent: 'project:a', group: ' ' },
    { parent: 'project:a', group: ['A'] },
    { parent: 'project:a', group: { name: 'A' } },
    ...['name', 'filters', 'status', 'page_token', 'page_size', 'type', 'closing_soon'].map((key) => ({ parent: 'project:a', [key]: 'anything' })),
  ])('rejects malformed or unsupported summary queries %j', async (query) => {
    await controller.getVotesSummary(request(query), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(getVotesSummary).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Synthetic Board', ' Synthetic Board '])('forwards only the validated scope and summary: %s', async (group) => {
    const summary = { active_votes: 3, closing_soon: 1, as_of: '2026-10-09T12:00:00Z' };
    getVotesSummary.mockResolvedValue(summary);
    const req = request({ parent: 'project:synthetic', ...(group && { group }) });
    await controller.getVotesSummary(req, res, next);
    expect(getVotesSummary).toHaveBeenCalledWith(req, 'project:synthetic', group?.trim());
    expect(json).toHaveBeenCalledWith(summary);
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates summary failure via next(error)', async () => {
    const error = new Error('scope failed');
    getVotesSummary.mockRejectedValue(error);
    await controller.getVotesSummary(request({ parent: 'project:synthetic' }), res, next);
    expect(next).toHaveBeenCalledWith(error);
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { parent: '' },
    { parent: 'project:' },
    { parent: 'committee:synthetic' },
    { parent: 'project:a:b' },
    { parent: ['project:a', 'project:b'] },
    { parent: 'project:a', name: '' },
    { parent: 'project:a', name: ' ' },
    { parent: 'project:a', name: ['A'] },
    { parent: 'project:a', group: '' },
    { parent: 'project:a', group: ['A'] },
    { parent: 'project:a', group: { name: 'A' } },
    ...['filters', 'status', 'page_token', 'page_size', 'type', 'closing_soon'].map((key) => ({ parent: 'project:a', [key]: 'anything' })),
  ])('rejects malformed or unsupported status-counts queries %j', async (query) => {
    await controller.getVoteStatusCounts(request(query), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(getVoteStatusCounts).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    { name: undefined, group: undefined },
    { name: 'Steering', group: 'Synthetic Board' },
    { name: ' Steering ', group: ' Synthetic Board ' },
  ])('forwards only the validated status-counts scope: %j', async ({ name, group }) => {
    const counts = { all: 5, active: 2, disabled: 0, ended: 3 };
    getVoteStatusCounts.mockResolvedValue(counts);
    const req = request({ parent: 'project:synthetic', ...(name && { name }), ...(group && { group }) });
    await controller.getVoteStatusCounts(req, res, next);
    expect(getVoteStatusCounts).toHaveBeenCalledWith(req, 'project:synthetic', name?.trim(), group?.trim());
    expect(json).toHaveBeenCalledWith(counts);
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates status-counts failure via next(error)', async () => {
    const error = new Error('scope failed');
    getVoteStatusCounts.mockRejectedValue(error);
    await controller.getVoteStatusCounts(request({ parent: 'project:synthetic' }), res, next);
    expect(next).toHaveBeenCalledWith(error);
    expect(json).not.toHaveBeenCalled();
  });

  it('propagates closing flag validation errors from the service', async () => {
    const req = request({ closing_soon: 'invalid' });
    const error = ServiceValidationError.forField('closing_soon', 'Expected a single true or false value', { operation: 'get_votes', service: 'vote_service' });
    getVotes.mockRejectedValueOnce(error);
    await controller.getVotes(req, res, next);
    expect(getVotes).toHaveBeenCalledWith(req, req.query);
    expect(next).toHaveBeenCalledWith(error);
    expect(json).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, 25])('forwards optional total_records without changing ordinary responses: %s', async (totalRecords) => {
    const result = { data: [], page_token: undefined, ...(totalRecords !== undefined && { total_records: totalRecords }) };
    getVotes.mockResolvedValue(result);
    await controller.getVotes(request({}), res, next);
    expect(json).toHaveBeenCalledWith(result);
  });
});
