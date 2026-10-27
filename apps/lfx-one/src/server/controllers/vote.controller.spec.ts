// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getVotes,
  getVotesSummary,
  getVoteStatusCounts,
  getMyVotes,
  getVoteReminderRecipients,
  getVoteVoters,
  getVoteResults,
  sendVoteReminders,
  getMyVoteBallot,
  createVoteResponse,
  assertVoteWrite,
  hasVoteWrite,
  success,
} = vi.hoisted(() => ({
  getVotes: vi.fn(),
  getVotesSummary: vi.fn(),
  getVoteStatusCounts: vi.fn(),
  getMyVotes: vi.fn(),
  getVoteReminderRecipients: vi.fn(),
  getVoteVoters: vi.fn(),
  getVoteResults: vi.fn(),
  sendVoteReminders: vi.fn(),
  getMyVoteBallot: vi.fn(),
  createVoteResponse: vi.fn(),
  assertVoteWrite: vi.fn(),
  hasVoteWrite: vi.fn(),
  success: vi.fn(),
}));
vi.mock('../services/vote.service', () => ({
  VoteService: class {
    public getVotes = getVotes;
    public getVotesSummary = getVotesSummary;
    public getVoteStatusCounts = getVoteStatusCounts;
    public getMyVotes = getMyVotes;
    public getVoteReminderRecipients = getVoteReminderRecipients;
    public getVoteVoters = getVoteVoters;
    public getVoteResults = getVoteResults;
    public sendVoteReminders = sendVoteReminders;
    public getMyVoteBallot = getMyVoteBallot;
    public createVoteResponse = createVoteResponse;
  },
}));
vi.mock('../helpers/vote-write-access.helper', () => ({ assertVoteWrite, hasVoteWrite }));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: vi.fn(), success, sanitize: vi.fn((value: unknown) => value) } }));
vi.mock('@lfx-one/shared/utils', () => ({ codePointLength: (value: string) => [...value].length }));

import { VOTE_VOTERS_DRAFT } from '@lfx-one/shared/constants';
import { VoteVoterStatus } from '@lfx-one/shared/enums';

import { ConflictError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { VoteController } from './vote.controller';

describe('VoteController management reads', () => {
  const controller = new VoteController();
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn();
  const request = (query: Record<string, unknown>) => ({ query }) as unknown as Request;
  beforeEach(() => vi.resetAllMocks());

  it.each([true, false])('returns personal-feed completeness when explicitly requested: %s', async (complete) => {
    const result = { votes: [{ uid: 'synthetic-vote' }], complete };
    getMyVotes.mockResolvedValue(result);
    const req = request({ include_status: 'true' });

    await controller.getMyVotes(req, res, next);

    expect(getMyVotes).toHaveBeenCalledWith(req);
    expect(json).toHaveBeenCalledWith(result);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([true, false])('preserves the default array response even for an incomplete feed: %s', async (complete) => {
    const result = { votes: [{ uid: 'synthetic-vote' }], complete };
    getMyVotes.mockResolvedValue(result);

    await controller.getMyVotes(request({}), res, next);

    expect(json).toHaveBeenCalledExactlyOnceWith(result.votes);
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['false', 'TRUE', '', ['true'], { value: 'true' }])('does not opt into the envelope for a noncanonical flag: %j', async (includeStatus) => {
    const result = { votes: [], complete: false };
    getMyVotes.mockResolvedValue(result);

    await controller.getMyVotes(request({ include_status: includeStatus }), res, next);

    expect(json).toHaveBeenCalledExactlyOnceWith([]);
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates a first-page personal-feed failure instead of sending a confirmed empty response', async () => {
    const error = new Error('Personal feed unavailable');
    getMyVotes.mockRejectedValue(error);

    await controller.getMyVotes(request({}), res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(json).not.toHaveBeenCalled();
  });

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

describe('VoteController voters (#3911)', () => {
  const controller = new VoteController();
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn();
  const request = (params: Record<string, unknown>) => ({ params, path: '/votes/vote-1/voters' }) as unknown as Request;
  beforeEach(() => vi.resetAllMocks());

  it.each([' ', '', undefined])('rejects an invalid uid (%j) without checking access or reading', async (uid) => {
    await controller.getVoteVoters(request({ uid }), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(assertVoteWrite).not.toHaveBeenCalled();
    expect(getVoteVoters).not.toHaveBeenCalled();
  });

  it('passes a 403 write-gate rejection to next(error) without reading voters — voters without writer included (AC-3)', async () => {
    const forbidden = new MicroserviceError('You do not have access to manage this vote.', 403, 'FORBIDDEN', {});
    assertVoteWrite.mockRejectedValue(forbidden);
    await controller.getVoteVoters(request({ uid: 'vote-1' }), res, next);
    expect(next).toHaveBeenCalledWith(forbidden);
    expect(getVoteVoters).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('passes a 503 access-check failure to next(error) without reading voters', async () => {
    const unavailable = new MicroserviceError('Access check unavailable', 503, 'ACCESS_CHECK_UNAVAILABLE', {});
    assertVoteWrite.mockRejectedValue(unavailable);
    await controller.getVoteVoters(request({ uid: 'vote-1' }), res, next);
    expect(next).toHaveBeenCalledWith(unavailable);
    expect(getVoteVoters).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('checks vote write access, then returns the voter list and logs the count only (AC-1)', async () => {
    const voters = [{ uid: 'b-1', user_name: 'Avery Example', user_email: 'avery@acme-motors.example', status: VoteVoterStatus.VOTED }];
    assertVoteWrite.mockResolvedValue(undefined);
    getVoteVoters.mockResolvedValue(voters);
    const req = request({ uid: 'vote-1' });
    await controller.getVoteVoters(req, res, next);
    expect(assertVoteWrite).toHaveBeenCalledWith(req, 'vote-1', 'get_vote_voters');
    expect(assertVoteWrite.mock.invocationCallOrder[0]).toBeLessThan(getVoteVoters.mock.invocationCallOrder[0]);
    expect(getVoteVoters).toHaveBeenCalledWith(req, 'vote-1');
    expect(json).toHaveBeenCalledWith(voters);
    expect(success).toHaveBeenCalledWith(req, 'get_vote_voters', undefined, { vote_uid: 'vote-1', voter_count: 1 });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 200 with the participation-only rows of a pseudo-anonymous vote (#3916)', async () => {
    const voters = [
      { user_name: 'Avery Example', user_org_name: 'Acme Motors', status: 'pending' },
      { user_name: 'Blake Example', user_org_name: 'Acme Motors', status: 'responded' },
    ];
    assertVoteWrite.mockResolvedValue(undefined);
    getVoteVoters.mockResolvedValue(voters);
    const req = request({ uid: 'vote-1' });
    await controller.getVoteVoters(req, res, next);
    expect(assertVoteWrite.mock.invocationCallOrder[0]).toBeLessThan(getVoteVoters.mock.invocationCallOrder[0]);
    expect(json).toHaveBeenCalledWith(voters);
    expect(success).toHaveBeenCalledWith(req, 'get_vote_voters', undefined, { vote_uid: 'vote-1', voter_count: 2 });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes the service draft refusal to next(error) unchanged (AC-2)', async () => {
    const refusal = new ConflictError('This vote is still a draft.', VOTE_VOTERS_DRAFT, {});
    assertVoteWrite.mockResolvedValue(undefined);
    getVoteVoters.mockRejectedValue(refusal);
    await controller.getVoteVoters(request({ uid: 'vote-1' }), res, next);
    expect(next).toHaveBeenCalledWith(refusal);
    expect(json).not.toHaveBeenCalled();
  });
});

describe('VoteController results (#4330)', () => {
  const controller = new VoteController();
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn();
  const request = (params: Record<string, unknown>) => ({ params, path: '/votes/vote-1/results' }) as unknown as Request;
  beforeEach(() => vi.resetAllMocks());

  it.each([true, false])('resolves vote write access first and passes canWrite=%s to the service', async (canWrite) => {
    const results = { poll_results: [], comment_results: [], num_votes_cast: 0 };
    hasVoteWrite.mockResolvedValue(canWrite);
    getVoteResults.mockResolvedValue(results);
    const req = request({ uid: 'vote-1' });

    await controller.getVoteResults(req, res, next);

    expect(hasVoteWrite).toHaveBeenCalledWith(req, 'vote-1', 'get_vote_results');
    expect(hasVoteWrite.mock.invocationCallOrder[0]).toBeLessThan(getVoteResults.mock.invocationCallOrder[0]);
    expect(getVoteResults).toHaveBeenCalledWith(req, 'vote-1', { canWrite });
    expect(json).toHaveBeenCalledWith(results);
    expect(success).toHaveBeenCalledWith(req, 'get_vote_results', undefined, expect.objectContaining({ vote_uid: 'vote-1', can_write: canWrite }));
    expect(next).not.toHaveBeenCalled();
  });

  it('passes an access-check outage to next(error) without reading results', async () => {
    const unavailable = new MicroserviceError("Couldn't verify your access to this vote right now. Please try again.", 503, 'ACCESS_CHECK_UNAVAILABLE', {});
    hasVoteWrite.mockRejectedValue(unavailable);

    await controller.getVoteResults(request({ uid: 'vote-1' }), res, next);

    expect(next).toHaveBeenCalledWith(unavailable);
    expect(getVoteResults).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it("passes the service's non-writer 403 to next(error) unchanged", async () => {
    const forbidden = new MicroserviceError('Results are available after the vote closes.', 403, 'FORBIDDEN', {});
    hasVoteWrite.mockResolvedValue(false);
    getVoteResults.mockRejectedValue(forbidden);

    await controller.getVoteResults(request({ uid: 'vote-1' }), res, next);

    expect(next).toHaveBeenCalledWith(forbidden);
    expect(json).not.toHaveBeenCalled();
  });
});

describe('VoteController own ballot (#4331)', () => {
  const controller = new VoteController();
  const VOTE_UID = 'v0000000-0000-0000-0000-00000000c401';
  const RESPONSE_UID = 'vr000000-0000-0000-0000-00000000c401';
  const answers = [{ question_id: 'q-1', choice_ids: ['c-yes'] }];
  const json = vi.fn();
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  const res = { json, status } as unknown as Response;
  const next = vi.fn();
  beforeEach(() => vi.resetAllMocks());

  describe('getMyVoteBallot', () => {
    it("returns the caller's ballot", async () => {
      const ballot = { vote_response_uid: RESPONSE_UID, vote_uid: VOTE_UID, abstained: false, poll_answers: [], comment_responses: [] };
      getMyVoteBallot.mockResolvedValue(ballot);
      const req = { params: { uid: VOTE_UID } } as unknown as Request;

      await controller.getMyVoteBallot(req, res, next);

      expect(getMyVoteBallot).toHaveBeenCalledWith(req, VOTE_UID);
      expect(json).toHaveBeenCalledWith(ballot);
      expect(next).not.toHaveBeenCalled();
    });

    it('responds 404 when the caller has no submitted ballot', async () => {
      getMyVoteBallot.mockResolvedValue(null);

      await controller.getMyVoteBallot({ params: { uid: VOTE_UID } } as unknown as Request, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ResourceNotFoundError));
      expect(json).not.toHaveBeenCalled();
    });

    it('rejects a blank vote uid without reading the ballot', async () => {
      await controller.getMyVoteBallot({ params: { uid: ' ' }, path: '/votes/%20/my-ballot' } as unknown as Request, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(getMyVoteBallot).not.toHaveBeenCalled();
    });
  });

  describe('createVoteResponse (shared validation unchanged)', () => {
    const request = (body: unknown) => ({ params: {}, body }) as unknown as Request;

    it('forwards the ballot without inventing comment_responses', async () => {
      const req = request({ vote_uid: VOTE_UID, vote_response_uid: RESPONSE_UID, abstain: false, user_vote_content: answers });

      await controller.createVoteResponse(req, res, next);

      expect(createVoteResponse).toHaveBeenCalledWith(req, {
        vote_uid: VOTE_UID,
        vote_response_uid: RESPONSE_UID,
        abstain: false,
        user_vote_content: answers,
        comment_responses: undefined,
      });
      expect(status).toHaveBeenCalledWith(204);
    });

    it('rejects an answer with no choices', async () => {
      await controller.createVoteResponse(
        request({ vote_uid: VOTE_UID, vote_response_uid: RESPONSE_UID, abstain: false, user_vote_content: [{ question_id: 'q-1' }] }),
        res,
        next
      );

      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(createVoteResponse).not.toHaveBeenCalled();
    });
  });
});
