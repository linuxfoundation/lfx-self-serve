// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listNewsletters, createNewsletter, updateNewsletter, scheduleNewsletter, cancelScheduleNewsletter } = vi.hoisted(() => ({
  listNewsletters: vi.fn(),
  createNewsletter: vi.fn(),
  updateNewsletter: vi.fn(),
  scheduleNewsletter: vi.fn(),
  cancelScheduleNewsletter: vi.fn(),
}));

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest
// config — mock the barrels the controller imports from directly, same as
// committee.controller.spec.ts / project.controller.spec.ts.
vi.mock('@lfx-one/shared/constants', () => ({
  NEWSLETTER_BODY_MAX_LENGTH: 50_000,
  NEWSLETTER_RAW_CONTENT_MAX_LENGTH: 10_000,
  NEWSLETTER_SUBJECT_MAX_LENGTH: 200,
  NEWSLETTER_SYSTEM_PROMPT_MAX_LENGTH: 5_000,
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/utils', () => ({ isUuid: vi.fn((v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) }));

vi.mock('../services/newsletter.service', () => ({
  NewsletterService: class {
    public listNewsletters = listNewsletters;
    public createNewsletter = createNewsletter;
    public updateNewsletter = updateNewsletter;
    public scheduleNewsletter = scheduleNewsletter;
    public cancelScheduleNewsletter = cancelScheduleNewsletter;
  },
}));
vi.mock('../services/ai.service', () => ({ AiService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ServiceValidationError } from '../errors';
import { NewsletterController } from './newsletter.controller';

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() } as any;
}

const validPayload = {
  subject: 'Hello',
  body_html: '<p>hi</p>',
  ed_reply_email: 'ed@example.com',
  committee_uids: ['committee-1'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NewsletterController.listNewsletters — status allowlist', () => {
  it.each(['draft', 'sending', 'scheduled', 'sent'])('accepts status=%s', async (status) => {
    listNewsletters.mockResolvedValue({ newsletters: [], next_page_token: undefined });
    const res = buildRes();
    const next = vi.fn();

    await new NewsletterController().listNewsletters({ params: { projectUid: 'p1' }, query: { status }, path: '/x' } as any, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(listNewsletters).toHaveBeenCalledWith(expect.anything(), 'p1', { status, page_token: undefined });
    expect(res.json).toHaveBeenCalled();
  });

  it('rejects an unknown status value', async () => {
    const next = vi.fn();

    await new NewsletterController().listNewsletters({ params: { projectUid: 'p1' }, query: { status: 'archived' }, path: '/x' } as any, buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(listNewsletters).not.toHaveBeenCalled();
  });
});

describe('NewsletterController create/update — validateScheduledAt', () => {
  it('accepts a payload with no scheduled_at (undefined)', async () => {
    createNewsletter.mockResolvedValue({ id: 'n1', version: 1 });
    const next = vi.fn();

    await new NewsletterController().createNewsletter({ params: { projectUid: 'p1' }, body: validPayload, path: '/x' } as any, buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(createNewsletter).toHaveBeenCalledWith(expect.anything(), 'p1', validPayload);
  });

  it('accepts an explicit null scheduled_at — clears a previously saved value', async () => {
    updateNewsletter.mockResolvedValue({ id: 'n1', version: 2 });
    const next = vi.fn();
    const payload = { ...validPayload, scheduled_at: null };

    await new NewsletterController().updateNewsletter(
      {
        params: { projectUid: 'p1', newsletterUid: 'n1' },
        body: payload,
        headers: { 'if-match': '1' },
        header: (h: string) => (h === 'If-Match' ? '1' : ''),
        path: '/x',
      } as any,
      buildRes(),
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(updateNewsletter).toHaveBeenCalledWith(expect.anything(), 'p1', 'n1', 1, payload);
  });

  it('accepts a valid future scheduled_at string', async () => {
    createNewsletter.mockResolvedValue({ id: 'n1', version: 1 });
    const next = vi.fn();
    const future = new Date(Date.now() + 60 * 60_000).toISOString();

    await new NewsletterController().createNewsletter(
      { params: { projectUid: 'p1' }, body: { ...validPayload, scheduled_at: future }, path: '/x' } as any,
      buildRes(),
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(createNewsletter).toHaveBeenCalled();
  });

  it('rejects a non-parsable scheduled_at', async () => {
    const next = vi.fn();

    await new NewsletterController().createNewsletter(
      { params: { projectUid: 'p1' }, body: { ...validPayload, scheduled_at: 'not-a-date' }, path: '/x' } as any,
      buildRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(createNewsletter).not.toHaveBeenCalled();
  });

  it('rejects a scheduled_at in the past (lenient save-time rule)', async () => {
    const next = vi.fn();
    const past = new Date(Date.now() - 60 * 60_000).toISOString();

    await new NewsletterController().createNewsletter(
      { params: { projectUid: 'p1' }, body: { ...validPayload, scheduled_at: past }, path: '/x' } as any,
      buildRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(createNewsletter).not.toHaveBeenCalled();
  });

  it('rejects a non-string scheduled_at', async () => {
    const next = vi.fn();

    await new NewsletterController().createNewsletter(
      { params: { projectUid: 'p1' }, body: { ...validPayload, scheduled_at: 12345 }, path: '/x' } as any,
      buildRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(createNewsletter).not.toHaveBeenCalled();
  });
});

describe('NewsletterController create/update — empty-body clear', () => {
  const clearedPayload = { subject: 'Hello', body_html: '', body_layout: null, ed_reply_email: 'ed@example.com', committee_uids: ['committee-1'] };

  it('accepts an update that clears an existing draft (body_layout:null + empty body)', async () => {
    updateNewsletter.mockResolvedValue({ id: 'n1', version: 2 });
    const next = vi.fn();

    await new NewsletterController().updateNewsletter(
      {
        params: { projectUid: 'p1', newsletterUid: 'n1' },
        body: clearedPayload,
        headers: { 'if-match': '1' },
        header: (h: string) => (h === 'If-Match' ? '1' : ''),
        path: '/x',
      } as any,
      buildRes(),
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(updateNewsletter).toHaveBeenCalledWith(expect.anything(), 'p1', 'n1', 1, clearedPayload);
  });

  it('rejects a create with the same empty body (a new newsletter must carry content)', async () => {
    const next = vi.fn();

    await new NewsletterController().createNewsletter({ params: { projectUid: 'p1' }, body: clearedPayload, path: '/x' } as any, buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(createNewsletter).not.toHaveBeenCalled();
  });
});

describe('NewsletterController.scheduleNewsletter — If-Match + optional override', () => {
  function reqWithIfMatch(ifMatch: string | undefined, body: any = {}) {
    return {
      params: { projectUid: 'p1', newsletterUid: 'n1' },
      body,
      path: '/x',
      header: (h: string) => (h === 'If-Match' ? ifMatch || '' : ''),
    } as any;
  }

  it('requires the If-Match header', async () => {
    const next = vi.fn();

    await new NewsletterController().scheduleNewsletter(reqWithIfMatch(undefined), buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(scheduleNewsletter).not.toHaveBeenCalled();
  });

  it('arms the already-saved scheduled_at when the body has no override (empty body -> {})', async () => {
    scheduleNewsletter.mockResolvedValue({ group_id: 'g1', scheduled_at: '2026-08-12T09:00:00.000Z', total_recipients: 10, sent: 0, failed: 0 });
    const next = vi.fn();

    await new NewsletterController().scheduleNewsletter(reqWithIfMatch('3', {}), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(scheduleNewsletter).toHaveBeenCalledWith(expect.anything(), 'p1', 'n1', 3, undefined);
  });

  it('passes a valid scheduled_at override through', async () => {
    scheduleNewsletter.mockResolvedValue({ group_id: 'g1', scheduled_at: '2026-08-12T09:00:00.000Z', total_recipients: 10, sent: 0, failed: 0 });
    const next = vi.fn();
    const override = '2026-08-12T09:00:00.000Z';

    await new NewsletterController().scheduleNewsletter(reqWithIfMatch('3', { scheduled_at: override }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(scheduleNewsletter).toHaveBeenCalledWith(expect.anything(), 'p1', 'n1', 3, override);
  });

  it('rejects an empty-string scheduled_at override', async () => {
    const next = vi.fn();

    await new NewsletterController().scheduleNewsletter(reqWithIfMatch('3', { scheduled_at: '' }), buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(scheduleNewsletter).not.toHaveBeenCalled();
  });

  it('rejects a non-parsable scheduled_at override', async () => {
    const next = vi.fn();

    await new NewsletterController().scheduleNewsletter(reqWithIfMatch('3', { scheduled_at: 'garbage' }), buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(scheduleNewsletter).not.toHaveBeenCalled();
  });

  it('rejects an unknown field instead of silently treating it as no override', async () => {
    const next = vi.fn();

    await new NewsletterController().scheduleNewsletter(reqWithIfMatch('3', { scheduld_at: '2026-08-12T09:00:00.000Z' }), buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(scheduleNewsletter).not.toHaveBeenCalled();
  });

  it('rejects a malformed If-Match header', async () => {
    const next = vi.fn();

    await new NewsletterController().scheduleNewsletter(reqWithIfMatch('not-a-number'), buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(scheduleNewsletter).not.toHaveBeenCalled();
  });
});

describe('NewsletterController.cancelScheduleNewsletter — If-Match required', () => {
  it('requires the If-Match header', async () => {
    const next = vi.fn();
    const req = { params: { projectUid: 'p1', newsletterUid: 'n1' }, path: '/x', header: () => '' } as any;

    await new NewsletterController().cancelScheduleNewsletter(req, buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(cancelScheduleNewsletter).not.toHaveBeenCalled();
  });

  it('proxies through with the parsed version on a valid If-Match', async () => {
    cancelScheduleNewsletter.mockResolvedValue({ newsletter: { id: 'n1', status: 'draft', version: 4 } });
    const res = buildRes();
    const next = vi.fn();
    const req = { params: { projectUid: 'p1', newsletterUid: 'n1' }, path: '/x', header: (h: string) => (h === 'If-Match' ? '3' : '') } as any;

    await new NewsletterController().cancelScheduleNewsletter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(cancelScheduleNewsletter).toHaveBeenCalledWith(expect.anything(), 'p1', 'n1', 3);
    expect(res.json).toHaveBeenCalledWith({ newsletter: { id: 'n1', status: 'draft', version: 4 } });
  });
});
