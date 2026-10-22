// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NatsSubjects } from '@lfx-one/shared/enums';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { publish, getEffectiveUsername, getEffectiveEmail, loggerSuccess } = vi.hoisted(() => ({
  publish: vi.fn<(subject: string, data: string) => Promise<void>>(),
  getEffectiveUsername: vi.fn<() => string | null>(),
  getEffectiveEmail: vi.fn<() => string | null>(),
  loggerSuccess: vi.fn(),
}));

vi.mock('../services/nats.service', () => ({
  NatsService: class {
    public publish = publish;
    public getCodec = () => ({ encode: (data: string) => data });
  },
}));
vi.mock('../services/committee.service', () => ({ CommitteeService: class {} }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername, getEffectiveEmail }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: loggerSuccess, warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ServiceValidationError } from '../errors';
import { InviteController } from './invite.controller';

const secret = 'test-secret-must-be-at-least-32-bytes!';

// Builds an HS256 invite token the same way the Go invite service does (raw UTF-8 secret bytes).
function signInviteToken(key: string = secret): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    invite_uid: 'invite-123',
    jti: 'invite-123',
    email: 'alice@example.com',
    resource_uid: 'project-1',
    role: 'Member',
    return_url: 'https://app.lfx.dev/project/overview',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createHmac('sha256', Buffer.from(key)).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('INVITE_SERVICE_JWT_SECRET', secret);
  publish.mockResolvedValue(undefined);
  getEffectiveUsername.mockReturnValue('alice-lfid');
  getEffectiveEmail.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('InviteController.acceptInvite', () => {
  it('publishes invite_uid, username and the original signed token on INVITE_ACCEPTED', async () => {
    const token = signInviteToken();
    const res = buildRes();
    const next = vi.fn();

    await new InviteController().acceptInvite({ body: { token }, path: '/api/invite/accept' } as any, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
    const [subject, data] = publish.mock.calls[0];
    expect(subject).toBe(NatsSubjects.INVITE_ACCEPTED);
    expect(JSON.parse(data)).toEqual({ invite_uid: 'invite-123', username: 'alice-lfid', token });
    // The token is a bearer credential and must never be added to the logged metadata.
    expect(JSON.stringify(loggerSuccess.mock.calls[0][3])).not.toContain(token);
    expect(res.json).toHaveBeenCalledWith({ return_url: 'https://app.lfx.dev/project/overview' });
  });

  it('does not publish when the token signature is invalid', async () => {
    const token = signInviteToken('a-different-secret-that-is-32-bytes-long!');
    const next = vi.fn();

    await new InviteController().acceptInvite({ body: { token }, path: '/api/invite/accept' } as any, buildRes(), next);

    expect(publish).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });
});
