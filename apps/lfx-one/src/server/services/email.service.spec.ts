// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { EMAIL_SEND_UNCONFIRMED, EMAIL_SERVICE_PRE_SEND_REJECTIONS } from '@lfx-one/shared/constants';
import { PollStatus } from '@lfx-one/shared/enums';
import type { VoteSummaryRecipient } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request, warning } = vi.hoisted(() => ({ request: vi.fn(), warning: vi.fn() }));

vi.mock('./nats.service', () => ({
  NatsService: class {
    public request = request;
    public getCodec = () => ({ encode: (value: string) => new TextEncoder().encode(value), decode: (value: Uint8Array) => new TextDecoder().decode(value) });
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning, debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../helpers/vote-write-access.helper', () => ({ assertVoteWrite: vi.fn(async () => undefined) }));

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { EmailService } from './email.service';
import { VoteService } from './vote.service';

const req = {} as unknown as Request;
const EMAIL = { to: 'pat@acme-motors.example', subject: "You're invited", html: '<p>hi</p>', text: 'hi' };

function reply(body: unknown): { data: Uint8Array } {
  return { data: new TextEncoder().encode(JSON.stringify(body)) };
}

describe('EmailService.sendEmail', () => {
  let service: EmailService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmailService();
  });

  it('sends the pre-rendered email on the email-service subject and returns the ids', async () => {
    request.mockResolvedValue(reply({ email_id: 'e-1', group_id: 'grp_1' }));

    expect(await service.sendEmail(req, EMAIL)).toEqual({ email_id: 'e-1', group_id: 'grp_1' });
    expect(request.mock.calls[0][0]).toBe('lfx.email-service.send_email');
    expect(JSON.parse(new TextDecoder().decode(request.mock.calls[0][1]))).toEqual(EMAIL);
  });

  it('treats an empty reply as accepted-but-not-sent and logs it without the subject or recipient', async () => {
    request.mockResolvedValue(reply({}));

    expect(await service.sendEmail(req, EMAIL)).toEqual({});
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain(EMAIL.subject);
    expect(logged).not.toContain(EMAIL.to);
  });

  it.each(EMAIL_SERVICE_PRE_SEND_REJECTIONS)('maps a pre-send %s reply to a confirmed 502 rejection and logs its fixed reason', async (reason) => {
    request.mockResolvedValue(reply({ error: reason }));

    const error = await service.sendEmail(req, EMAIL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error).toMatchObject({ statusCode: 502, code: 'EMAIL_SEND_FAILED' });
    expect((error as MicroserviceError).transportFailure).toBeUndefined();
    expect(warning).toHaveBeenCalledWith(req, 'send_email', 'Email service reported a send error', { rejected_before_send: true, reason });
  });

  it.each(['email delivery failed', 'an unknown service error', `unknown failure for ${EMAIL.to}`])(
    'keeps %s unconfirmed even though the service answered',
    async (reason) => {
      request.mockResolvedValue(reply({ error: reason }));

      const error = await service.sendEmail(req, EMAIL).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(MicroserviceError);
      expect(error).toMatchObject({ statusCode: 502, code: EMAIL_SEND_UNCONFIRMED });
      // The service did answer: uncertainty must not masquerade as a BFF transport failure.
      expect((error as MicroserviceError).transportFailure).toBeUndefined();
      expect(warning).toHaveBeenCalledWith(req, 'send_email', 'Email service reported a send error', {
        rejected_before_send: false,
        reason: reason === 'email delivery failed' ? reason : 'unrecognized',
      });
      if (reason !== 'email delivery failed') expect(JSON.stringify(warning.mock.calls)).not.toContain(reason);
      expect(JSON.stringify(warning.mock.calls)).not.toContain(EMAIL.to);
    }
  );

  it('maps a NATS timeout or an unparseable reply to 502 EMAIL_SEND_FAILED marked as a transport failure', async () => {
    request.mockRejectedValueOnce(new Error('TIMEOUT'));
    await expect(service.sendEmail(req, EMAIL)).rejects.toMatchObject({ statusCode: 502, code: 'EMAIL_SEND_FAILED', transportFailure: true });

    request.mockResolvedValueOnce({ data: new TextEncoder().encode('not json') });
    await expect(service.sendEmail(req, EMAIL)).rejects.toMatchObject({ statusCode: 502, code: 'EMAIL_SEND_FAILED', transportFailure: true });
  });

  /** Real summary and email services; only access, read-only inputs and NATS are replaced. */
  function summaryService(recipients: VoteSummaryRecipient[]): VoteService {
    const summary = new VoteService();
    vi.spyOn(summary, 'getVoteById').mockResolvedValue({
      uid: 'synthetic-vote',
      name: 'Synthetic election',
      project_uid: 'synthetic-project',
      end_time: '2026-01-01T00:00:00Z',
      status: PollStatus.ENDED,
    });
    vi.spyOn(summary, 'getVoteResults').mockResolvedValue({
      poll_results: [],
      comment_results: [],
      num_recipients: recipients.length,
      num_votes_cast: 0,
      num_abstained: 0,
      poll_end_time: '2026-01-01T00:00:00Z',
    });
    vi.spyOn(summary, 'getVoteSummaryRecipients').mockResolvedValue(recipients);
    return summary;
  }

  it.each([null, { error: 'email delivery failed' }])(
    'returns an uncertain summary count for a real ambiguous reply %j, not a retry-safe 502',
    async (body) => {
      request.mockResolvedValue(reply(body));
      const summary = summaryService([{ uid: 'r-1', user_email: 'voter@example.test' }]);

      await expect(summary.sendVoteSummary(req, 'synthetic-vote')).resolves.toEqual({
        recipient_count: 0,
        failed_count: 0,
        skipped_count: 0,
        uncertain_count: 1,
        recipients: [{ uid: 'r-1', user_email: 'voter@example.test', outcome: 'uncertain' }],
      });
    }
  );

  it.each([null, { error: 'email delivery failed' }])('preserves success and uncertainty through real parsing of %j on a mixed summary', async (body) => {
    request.mockResolvedValueOnce(reply({ email_id: 'synthetic-email' })).mockResolvedValueOnce(reply(body));
    const summary = summaryService([
      { uid: 'r-1', user_email: 'one@example.test' },
      { uid: 'r-2', user_email: 'two@example.test' },
    ]);

    await expect(summary.sendVoteSummary(req, 'synthetic-vote')).resolves.toEqual({
      recipient_count: 1,
      failed_count: 0,
      skipped_count: 0,
      uncertain_count: 1,
      recipients: [
        { uid: 'r-1', user_email: 'one@example.test', outcome: 'sent' },
        { uid: 'r-2', user_email: 'two@example.test', outcome: 'uncertain' },
      ],
    });
  });

  it('serializes failed and skipped counts on the total-summary-failure 502', async () => {
    request.mockResolvedValue(reply({}));
    const summary = summaryService([{ uid: 'r-1', user_email: 'voter@example.test' }, { uid: 'r-2' }]);

    const error = await summary.sendVoteSummary(req, 'synthetic-vote').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MicroserviceError);
    expect((error as MicroserviceError).toResponse()).toMatchObject({
      code: 'VOTE_SUMMARY_SEND_FAILED',
      details: {
        recipient_count: 0,
        failed_count: 1,
        skipped_count: 1,
        uncertain_count: 0,
        recipients: [
          { uid: 'r-1', user_email: 'voter@example.test', outcome: 'failed' },
          { uid: 'r-2', outcome: 'skipped' },
        ],
      },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
