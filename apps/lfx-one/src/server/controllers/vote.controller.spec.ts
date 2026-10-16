// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getVotes, getVotesSummary, getVoteReminderRecipients, sendVoteReminders, assertVoteWrite } = vi.hoisted(() => ({
  getVotes: vi.fn(),
  getVotesSummary: vi.fn(),
  getVoteReminderRecipients: vi.fn(),
  sendVoteReminders: vi.fn(),
  assertVoteWrite: vi.fn(),
}));
vi.mock('../services/vote.service', () => ({
  VoteService: class {
    public getVotes = getVotes;
    public getVotesSummary = getVotesSummary;
    public getVoteReminderRecipients = getVoteReminderRecipients;
    public sendVoteReminders = sendVoteReminders;
  },
}));
vi.mock('../helpers/vote-write-access.helper', () => ({ assertVoteWrite }));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: vi.fn(), success: vi.fn(), sanitize: vi.fn((value: unknown) => value) } }));
vi.mock('@lfx-one/shared/utils', () => ({ codePointLength: (value: string) => [...value].length }));

import { MicroserviceError, ServiceValidationError } from '../errors';
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

describe('VoteController reminders (#3769)', () => {
  const controller = new VoteController();
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn();
  const request = (params: Record<string, unknown>, body?: unknown) => ({ params, body, path: '/votes/vote-1/reminders' }) as unknown as Request;
  beforeEach(() => vi.resetAllMocks());

  describe('getVoteReminderRecipients', () => {
    it('rejects a missing uid without checking access or reading', async () => {
      await controller.getVoteReminderRecipients(request({ uid: ' ' }), res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(assertVoteWrite).not.toHaveBeenCalled();
      expect(getVoteReminderRecipients).not.toHaveBeenCalled();
    });

    it('passes a write-gate rejection to next(error) without reading recipients', async () => {
      const forbidden = new MicroserviceError('You do not have access to manage this vote.', 403, 'FORBIDDEN', {});
      assertVoteWrite.mockRejectedValue(forbidden);
      await controller.getVoteReminderRecipients(request({ uid: 'vote-1' }), res, next);
      expect(next).toHaveBeenCalledWith(forbidden);
      expect(getVoteReminderRecipients).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
    });

    it('checks vote write access, then returns the recipient projection', async () => {
      const recipients = [{ uid: 'r-1', user_name: 'Avery Example' }];
      assertVoteWrite.mockResolvedValue(undefined);
      getVoteReminderRecipients.mockResolvedValue(recipients);
      const req = request({ uid: 'vote-1' });
      await controller.getVoteReminderRecipients(req, res, next);
      expect(assertVoteWrite).toHaveBeenCalledWith(req, 'vote-1', 'get_vote_reminder_recipients');
      expect(getVoteReminderRecipients).toHaveBeenCalledWith(req, 'vote-1');
      expect(json).toHaveBeenCalledWith(recipients);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('sendVoteReminders', () => {
    it.each([
      undefined,
      {},
      { recipient_ids: [] },
      { recipient_ids: 'r-1' },
      { recipient_ids: ['r-1', ''] },
      { recipient_ids: ['r-1', ' '] },
      { recipient_ids: [42] },
    ])('rejects an invalid body %j without proxying', async (body) => {
      await controller.sendVoteReminders(request({ uid: 'vote-1' }, body), res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(sendVoteReminders).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
    });

    it('rejects a missing uid', async () => {
      await controller.sendVoteReminders(request({ uid: '' }, { recipient_ids: ['r-1'] }), res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(sendVoteReminders).not.toHaveBeenCalled();
    });

    it('deduplicates the recipient IDs and returns the recipient count', async () => {
      sendVoteReminders.mockResolvedValue({ recipient_count: 2 });
      const req = request({ uid: 'vote-1' }, { recipient_ids: ['r-1', 'r-2', 'r-1'] });
      await controller.sendVoteReminders(req, res, next);
      expect(sendVoteReminders).toHaveBeenCalledWith(req, 'vote-1', ['r-1', 'r-2']);
      expect(json).toHaveBeenCalledWith({ recipient_count: 2 });
      expect(next).not.toHaveBeenCalled();
    });

    it('propagates an upstream failure via next(error)', async () => {
      const upstream = new MicroserviceError('poll is not active', 400, 'BAD_REQUEST', {});
      sendVoteReminders.mockRejectedValue(upstream);
      await controller.sendVoteReminders(request({ uid: 'vote-1' }, { recipient_ids: ['r-1'] }), res, next);
      expect(next).toHaveBeenCalledWith(upstream);
      expect(json).not.toHaveBeenCalled();
    });
  });
});
