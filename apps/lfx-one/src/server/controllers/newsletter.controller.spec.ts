// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getMyNewsletters,
  listNewsletters,
  getNewsletterStatusCounts,
  createNewsletter,
  updateNewsletter,
  scheduleNewsletter,
  sendNewsletter,
  assertLiveSendAllowed,
  cancelScheduleNewsletter,
  getReadableNewsletter,
  assertPublisherRead,
  recordShare,
  recordPageView,
  testSend,
  renderPreview,
} = vi.hoisted(() => ({
  recordShare: vi.fn(),
  recordPageView: vi.fn(),
  testSend: vi.fn(),
  renderPreview: vi.fn(),
  assertPublisherRead: vi.fn(),
  getReadableNewsletter: vi.fn(),
  getMyNewsletters: vi.fn(),
  listNewsletters: vi.fn(),
  getNewsletterStatusCounts: vi.fn(),
  createNewsletter: vi.fn(),
  updateNewsletter: vi.fn(),
  scheduleNewsletter: vi.fn(),
  sendNewsletter: vi.fn(),
  assertLiveSendAllowed: vi.fn(),
  cancelScheduleNewsletter: vi.fn(),
}));

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest
// config — mock the barrels the controller imports from directly, same as
// committee.controller.spec.ts / project.controller.spec.ts.
// The caps here are deliberately far SMALLER than production (real
// NEWSLETTER_BODY_MAX_LENGTH is 100_000 and NEWSLETTER_BODY_LAYOUT_MAX_BYTES is
// 800_000) so the over-cap tests can trip them with a modest fixture. Assertions
// exercise the code path, not the production threshold — the "exceeds the cap"
// tests reject against these mocked values, not the real ones.
vi.mock('@lfx-one/shared/constants', () => ({
  NEWSLETTER_BODY_MAX_LENGTH: 50_000,
  NEWSLETTER_BODY_LAYOUT_MAX_BYTES: 5_000,
  NEWSLETTER_WRAPPER_CONTENT_MAX_BYTES: 200,
  NEWSLETTER_RAW_CONTENT_MAX_LENGTH: 10_000,
  NEWSLETTER_SUBJECT_MAX_LENGTH: 200,
  NEWSLETTER_SYSTEM_PROMPT_MAX_LENGTH: 5_000,
  SHARE_CHANNELS: ['x', 'linkedin', 'reddit', 'email', 'copy_link'],
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
const { getEffectiveEmail } = vi.hoisted(() => ({ getEffectiveEmail: vi.fn<() => string | null>(() => 'me@example.com') }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail }));
vi.mock('@lfx-one/shared/utils', () => ({ isUuid: vi.fn((v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) }));

vi.mock('../services/newsletter.service', () => ({
  NewsletterService: class {
    public getMyNewsletters = getMyNewsletters;
    public listNewsletters = listNewsletters;
    public getNewsletterStatusCounts = getNewsletterStatusCounts;
    public createNewsletter = createNewsletter;
    public updateNewsletter = updateNewsletter;
    public scheduleNewsletter = scheduleNewsletter;
    public sendNewsletter = sendNewsletter;
    public assertLiveSendAllowed = assertLiveSendAllowed;
    public cancelScheduleNewsletter = cancelScheduleNewsletter;
    public recordShare = recordShare;
    public recordPageView = recordPageView;
    public testSend = testSend;
    public renderPreview = renderPreview;
  },
}));
vi.mock('../services/ai.service', () => ({ AiService: class {} }));
vi.mock('../services/newsletter-member-benefit.service', () => ({
  NewsletterMemberBenefitService: class {
    public getReadableNewsletter = getReadableNewsletter;
    public assertPublisherRead = assertPublisherRead;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { MicroserviceError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
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
  assertLiveSendAllowed.mockResolvedValue(undefined);
});

describe('NewsletterController.getMyNewsletters', () => {
  it.each(['true', undefined, 'false', 'TRUE', '1', ['true'], { value: 'true' }])('opts in only for literal include_status=%j', async (includeStatus) => {
    const response = { newsletters: [{ id: 'n1', project_uid: 'p1', subject: 'Synthetic issue' }], complete: false };
    getMyNewsletters.mockResolvedValue(response);
    const req = { query: { include_status: includeStatus } } as any;
    const res = buildRes();
    const next = vi.fn();
    await new NewsletterController().getMyNewsletters(req, res, next);
    expect(res.json).toHaveBeenCalledWith(includeStatus === 'true' ? response : response.newsletters);
    expect(logger.success).toHaveBeenCalledWith(req, 'get_my_newsletters', 0, { count: 1, complete: false });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([new Error('discovery failed'), new MicroserviceError('expired', 401, 'UNAUTHORIZED')])(
    'propagates discovery/auth failures without serializing or duplicate logging',
    async (error) => {
      getMyNewsletters.mockRejectedValue(error);
      const res = buildRes();
      const next = vi.fn();
      await new NewsletterController().getMyNewsletters({ query: { include_status: 'true' } } as any, res, next);
      expect(next).toHaveBeenCalledExactlyOnceWith(error);
      expect(res.json).not.toHaveBeenCalled();
      expect(logger.success).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    }
  );
});

describe('NewsletterController.getNewsletter — reader ladder (#3469)', () => {
  const PROJECT_UID = '11111111-1111-4111-8111-111111111111';
  const NEWSLETTER_UID = '22222222-2222-4222-8222-222222222222';

  it('returns the issue only through the member-benefit ladder', async () => {
    const newsletter = { id: NEWSLETTER_UID, version: 1 };
    getReadableNewsletter.mockResolvedValue(newsletter);
    const res = buildRes();
    const next = vi.fn();

    await new NewsletterController().getNewsletter({ params: { projectUid: PROJECT_UID, newsletterUid: NEWSLETTER_UID }, path: '/' } as any, res, next);

    expect(getReadableNewsletter).toHaveBeenCalledWith(expect.anything(), PROJECT_UID, NEWSLETTER_UID);
    expect(res.json).toHaveBeenCalledWith(newsletter);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes a members-only refusal to the error handler instead of the issue', async () => {
    getReadableNewsletter.mockRejectedValue(Object.assign(new Error('members only'), { statusCode: 403, code: 'NEWSLETTER_MEMBERS_ONLY' }));
    const res = buildRes();
    const next = vi.fn();

    await new NewsletterController().getNewsletter({ params: { projectUid: PROJECT_UID, newsletterUid: NEWSLETTER_UID }, path: '/' } as any, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
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

  it('refuses non-publishers before proxying the body-carrying list (#3469)', async () => {
    assertPublisherRead.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { statusCode: 403, code: 'NEWSLETTER_LIST_FORBIDDEN' }));
    const next = vi.fn();

    await new NewsletterController().listNewsletters({ params: { projectUid: 'p1' }, query: {}, path: '/x' } as any, buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(listNewsletters).not.toHaveBeenCalled();
  });

  it('rejects an unknown status value', async () => {
    const next = vi.fn();

    await new NewsletterController().listNewsletters({ params: { projectUid: 'p1' }, query: { status: 'archived' }, path: '/x' } as any, buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(listNewsletters).not.toHaveBeenCalled();
  });
});

describe('NewsletterController.getStatusCounts', () => {
  it('returns the counts after the publisher gate passes', async () => {
    const counts = { draft: 2, scheduled: 1, sent: 5, optout: 3, truncated: false };
    getNewsletterStatusCounts.mockResolvedValue(counts);
    const res = buildRes();
    const next = vi.fn();

    await new NewsletterController().getStatusCounts({ params: { projectUid: 'p1' }, path: '/x' } as any, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getNewsletterStatusCounts).toHaveBeenCalledWith(expect.anything(), 'p1');
    expect(res.json).toHaveBeenCalledWith(counts);
  });

  it('refuses non-publishers before counting', async () => {
    getNewsletterStatusCounts.mockClear();
    assertPublisherRead.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { statusCode: 403, code: 'NEWSLETTER_LIST_FORBIDDEN' }));
    const next = vi.fn();

    await new NewsletterController().getStatusCounts({ params: { projectUid: 'p1' }, path: '/x' } as any, buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(getNewsletterStatusCounts).not.toHaveBeenCalled();
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

describe('NewsletterController create/update — layout validation', () => {
  it('accepts an empty blocks layout (a wrapper-only draft is saveable)', async () => {
    createNewsletter.mockResolvedValue({ id: 'n1', version: 1 });
    const next = vi.fn();
    const payload = {
      subject: 'Hello',
      body_layout: { wrapper_key: 'default', blocks: [] },
      ed_reply_email: 'ed@example.com',
      committee_uids: ['committee-1'],
    };

    await new NewsletterController().createNewsletter({ params: { projectUid: 'p1' }, body: payload, path: '/x' } as any, buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(createNewsletter).toHaveBeenCalledWith(expect.anything(), 'p1', payload);
  });

  it('rejects a present layout whose blocks is not an array', async () => {
    const next = vi.fn();
    const payload = {
      subject: 'Hello',
      body_layout: { wrapper_key: 'default', blocks: 'nope' },
      ed_reply_email: 'ed@example.com',
      committee_uids: ['committee-1'],
    };

    await new NewsletterController().createNewsletter({ params: { projectUid: 'p1' }, body: payload as any, path: '/x' } as any, buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(createNewsletter).not.toHaveBeenCalled();
  });

  it('rejects a layout whose serialized size exceeds the (mocked) cap', async () => {
    const next = vi.fn();
    const blocks = Array.from({ length: 200 }, (_, i) => ({ block_type: 'text', content: { body: `block ${i} with some filler content` } }));
    const payload = { subject: 'Hello', body_layout: { wrapper_key: 'default', blocks }, ed_reply_email: 'ed@example.com', committee_uids: ['committee-1'] };

    await new NewsletterController().createNewsletter({ params: { projectUid: 'p1' }, body: payload as any, path: '/x' } as any, buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(createNewsletter).not.toHaveBeenCalled();
  });
});

describe('NewsletterController.testSend — validateTestSendPayload', () => {
  const base = { subject: 'Hi', to_email: 'me@example.com', ed_reply_email: 'ed@example.com' };
  const nonEmptyLayout = { wrapper_key: 'default', blocks: [{ block_type: 'hero', content: {} }] };
  const run = async (body: any) => {
    const next = vi.fn();
    await new NewsletterController().testSend({ params: { projectUid: 'p1' }, body, path: '/x' } as any, buildRes(), next);
    return next;
  };

  it('passes a present non-empty layout through to the service', async () => {
    testSend.mockResolvedValue({ ok: true });
    const next = await run({ ...base, body_layout: nonEmptyLayout });
    expect(next).not.toHaveBeenCalled();
    expect(testSend).toHaveBeenCalled();
  });

  it('rejects a present but empty layout (would send a wrapper-only email)', async () => {
    const next = await run({ ...base, body_layout: { wrapper_key: 'default', blocks: [] } });
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(testSend).not.toHaveBeenCalled();
  });

  it('requires body_html when no layout is present', async () => {
    const next = await run({ ...base, body_html: '' });
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(testSend).not.toHaveBeenCalled();
  });

  it('accepts body_html when no layout is present', async () => {
    testSend.mockResolvedValue({ ok: true });
    const next = await run({ ...base, body_html: '<p>hi</p>' });
    expect(next).not.toHaveBeenCalled();
    expect(testSend).toHaveBeenCalled();
  });

  it("only sends to the caller's own email address, ignoring case", async () => {
    const other = await run({ ...base, body_html: '<p>hi</p>', to_email: 'someone-else@example.com' });
    expect(other.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(testSend).not.toHaveBeenCalled();

    testSend.mockResolvedValue({ ok: true });
    const own = await run({ ...base, body_html: '<p>hi</p>', to_email: ' Me@Example.com ' });
    expect(own).not.toHaveBeenCalled();
    // The checked, normalised address is what goes upstream.
    expect(testSend.mock.calls[0][2].to_email).toBe('me@example.com');
  });

  it('refuses a test send when the caller has no verified email', async () => {
    getEffectiveEmail.mockReturnValueOnce(null);
    const next = await run({ ...base, body_html: '<p>hi</p>' });
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(testSend).not.toHaveBeenCalled();
  });

  it('rejects ed_reply_email only when supplied and invalid', async () => {
    const supplied = await run({ ...base, body_html: '<p>hi</p>', ed_reply_email: 'notanemail' });
    expect(supplied.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(testSend).not.toHaveBeenCalled();

    testSend.mockResolvedValue({ ok: true });
    const omitted = await run({ subject: 'Hi', to_email: 'me@example.com', body_html: '<p>hi</p>' });
    expect(omitted).not.toHaveBeenCalled();
    expect(testSend).toHaveBeenCalled();
  });
});

describe('NewsletterController.renderPreview — validateRenderPreviewPayload', () => {
  const run = async (body: any) => {
    const next = vi.fn();
    await new NewsletterController().renderPreview({ params: { projectUid: 'p1' }, body, path: '/x' } as any, buildRes(), next);
    return next;
  };

  it('passes a valid layout through to the service', async () => {
    renderPreview.mockResolvedValue({ body_html: '<p>x</p>' });
    const next = await run({ body_layout: { wrapper_key: 'default', blocks: [{ block_type: 'hero', content: {} }] } });
    expect(next).not.toHaveBeenCalled();
    expect(renderPreview).toHaveBeenCalled();
  });

  it('rejects an absent layout', async () => {
    const next = await run({});
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(renderPreview).not.toHaveBeenCalled();
  });

  it('rejects a non-object layout', async () => {
    const next = await run({ body_layout: 'nope' });
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(renderPreview).not.toHaveBeenCalled();
  });

  it('rejects a serialized layout over the (mocked) cap', async () => {
    const blocks = Array.from({ length: 200 }, (_, i) => ({ block_type: 'text', content: { body: `block ${i} with filler content` } }));
    const next = await run({ body_layout: { wrapper_key: 'default', blocks } });
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(renderPreview).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-object', 'nope'],
    ['an array', ['a']],
    ['null', null],
    ['an object over the (mocked) cap', { edition: { date: 'x'.repeat(500) } }],
  ])('rejects wrapper_content that is %s', async (_label, wrapperContent) => {
    const next = await run({ body_layout: { wrapper_key: 'default', blocks: [] }, wrapper_content: wrapperContent });
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(renderPreview).not.toHaveBeenCalled();
  });

  it('passes small wrapper_content through', async () => {
    renderPreview.mockResolvedValue({ body_html: '<p>x</p>' });
    const next = await run({ body_layout: { wrapper_key: 'default', blocks: [] }, wrapper_content: { edition: { date: '4 Nov' } } });
    expect(next).not.toHaveBeenCalled();
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

describe('NewsletterController.recordShare (#4958)', () => {
  const PROJECT = '11111111-1111-1111-1111-111111111111';
  const NEWSLETTER = '22222222-2222-2222-2222-222222222222';
  const req = (body: unknown, params = { projectUid: PROJECT, newsletterUid: NEWSLETTER }) => ({ params, body, path: '/x' }) as any;

  it('proxies a valid channel and answers 204', async () => {
    recordShare.mockResolvedValue(undefined);
    const res = buildRes();
    const next = vi.fn();

    await new NewsletterController().recordShare(req({ channel: 'copy_link' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(recordShare).toHaveBeenCalledWith(expect.anything(), PROJECT, NEWSLETTER, { channel: 'copy_link' });
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it.each([[{ channel: 'myspace' }], [{}], [undefined], [{ channel: 42 }]])('rejects an invalid body %j before proxying', async (body) => {
    const next = vi.fn();

    await new NewsletterController().recordShare(req(body), buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(recordShare).not.toHaveBeenCalled();
  });

  it('rejects non-UUID path params before proxying', async () => {
    const next = vi.fn();

    await new NewsletterController().recordShare(req({ channel: 'x' }, { projectUid: 'p1', newsletterUid: NEWSLETTER }), buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(recordShare).not.toHaveBeenCalled();
  });

  it('only forwards the channel, never extra body fields', async () => {
    recordShare.mockResolvedValue(undefined);

    await new NewsletterController().recordShare(req({ channel: 'x', user: 'someone-else' }), buildRes(), vi.fn());

    expect(recordShare).toHaveBeenCalledWith(expect.anything(), PROJECT, NEWSLETTER, { channel: 'x' });
  });
});

describe('NewsletterController.recordPageView', () => {
  const PROJECT = '11111111-1111-1111-1111-111111111111';
  const NEWSLETTER = '22222222-2222-2222-2222-222222222222';
  const req = (params = { projectUid: PROJECT, newsletterUid: NEWSLETTER }) => ({ params, body: {}, path: '/x' }) as any;

  it('proxies the view and answers 204 once the reader ladder allows the issue', async () => {
    getReadableNewsletter.mockResolvedValue({ id: NEWSLETTER, status: 'sent' });
    recordPageView.mockResolvedValue(undefined);
    const res = buildRes();
    const next = vi.fn();

    await new NewsletterController().recordPageView(req(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getReadableNewsletter).toHaveBeenCalledWith(expect.anything(), PROJECT, NEWSLETTER);
    expect(recordPageView).toHaveBeenCalledWith(expect.anything(), PROJECT, NEWSLETTER);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('rejects non-UUID path params before proxying', async () => {
    const next = vi.fn();

    await new NewsletterController().recordPageView(req({ projectUid: PROJECT, newsletterUid: 'n1' }), buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(recordPageView).not.toHaveBeenCalled();
  });

  it('never records a view for a caller the reader ladder denies', async () => {
    const denied = new Error('members only');
    getReadableNewsletter.mockRejectedValue(denied);
    const next = vi.fn();

    await new NewsletterController().recordPageView(req(), buildRes(), next);

    expect(next).toHaveBeenCalledWith(denied);
    expect(recordPageView).not.toHaveBeenCalled();
  });

  it('forwards an upstream failure to the error handler', async () => {
    const failure = new Error('upstream down');
    getReadableNewsletter.mockResolvedValue({ id: NEWSLETTER, status: 'sent' });
    recordPageView.mockRejectedValue(failure);
    const next = vi.fn();

    await new NewsletterController().recordPageView(req(), buildRes(), next);

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('NewsletterController live-send lock', () => {
  const req = {
    params: { projectUid: 'p1', newsletterUid: 'n1' },
    body: {},
    path: '/x',
    header: (h: string) => (h === 'If-Match' ? '3' : ''),
  } as any;

  it.each(['sendNewsletter', 'scheduleNewsletter'] as const)('%s checks the lock for the version being sent', async (method) => {
    await new NewsletterController()[method](req, buildRes(), vi.fn());

    expect(assertLiveSendAllowed).toHaveBeenCalledWith(req, 'p1', 'n1', 3, method === 'sendNewsletter' ? 'newsletter_send' : 'newsletter_schedule');
  });

  it.each(['sendNewsletter', 'scheduleNewsletter'] as const)('%s calls nothing upstream when the lock refuses', async (method) => {
    const err = Object.assign(new Error('locked'), { statusCode: 403 });
    assertLiveSendAllowed.mockRejectedValue(err);
    const next = vi.fn();

    await new NewsletterController()[method](req, buildRes(), next);

    expect(next).toHaveBeenCalledWith(err);
    expect(sendNewsletter).not.toHaveBeenCalled();
    expect(scheduleNewsletter).not.toHaveBeenCalled();
  });

  it('still sends a basic editor draft', async () => {
    sendNewsletter.mockResolvedValue({ group_id: 'g1', total_recipients: 1, sent: 1, failed: 0 });
    const res = buildRes();
    const next = vi.fn();

    await new NewsletterController().sendNewsletter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(sendNewsletter).toHaveBeenCalledWith(req, 'p1', 'n1', 3);
    expect(res.json).toHaveBeenCalled();
  });
});
