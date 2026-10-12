// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { EmailService } from './email.service';

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

  it('maps an {error} reply to 502 EMAIL_SEND_FAILED', async () => {
    request.mockResolvedValue(reply({ error: 'recipient domain not allowed' }));

    const error = await service.sendEmail(req, EMAIL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error).toMatchObject({ statusCode: 502, code: 'EMAIL_SEND_FAILED' });
  });

  it('maps a NATS timeout or an unparseable reply to 502 EMAIL_SEND_FAILED', async () => {
    request.mockRejectedValueOnce(new Error('TIMEOUT'));
    await expect(service.sendEmail(req, EMAIL)).rejects.toMatchObject({ statusCode: 502, code: 'EMAIL_SEND_FAILED' });

    request.mockResolvedValueOnce({ data: new TextEncoder().encode('not json') });
    await expect(service.sendEmail(req, EMAIL)).rejects.toMatchObject({ statusCode: 502, code: 'EMAIL_SEND_FAILED' });
  });
});
