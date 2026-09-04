// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The shared utils barrel transitively pulls in @angular/common (partially compiled); load the
// JIT compiler so those injectables resolve under vitest (mirrors user.service.spec.ts).
import '@angular/compiler';

import { MEETING_INVITE_PRIMARY_SENTINEL, NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { natsRequest, loggerMock } = vi.hoisted(() => ({
  natsRequest: vi.fn(),
  loggerMock: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./nats.service', () => ({
  NatsService: vi.fn(() => ({
    getCodec: () => ({
      encode: (value: string) => new TextEncoder().encode(value),
      decode: (data: Uint8Array) => new TextDecoder().decode(data),
    }),
    request: natsRequest,
  })),
}));
vi.mock('./logger.service', () => ({ logger: loggerMock }));

import { MeetingPreferenceService } from './meeting-preference.service';

const req = {} as unknown as Request;
const V1_TOKEN = 'v1-token';
const ALTERNATE_EMAIL = 'alice@acme-motors.example';

// The service only reads `response.data`, so a reply is just the encoded JSON body.
function reply(body: unknown): { data: Uint8Array } {
  return { data: new TextEncoder().encode(JSON.stringify(body)) };
}

function decodeRequestPayload(callIndex = 0): { token: string; email?: string } {
  return JSON.parse(new TextDecoder().decode(natsRequest.mock.calls[callIndex][1]));
}

// Every logger argument across the suite, flattened — used to prove no raw address is logged.
function loggedPayloads(): string {
  return JSON.stringify(Object.values(loggerMock).flatMap((fn) => fn.mock.calls));
}

describe('MeetingPreferenceService', () => {
  let service: MeetingPreferenceService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MeetingPreferenceService();
  });

  describe('getMeetingInviteEmail', () => {
    it('returns the override when one is set', async () => {
      natsRequest.mockResolvedValue(reply({ email_id: 'email-1', email: ALTERNATE_EMAIL }));

      await expect(service.getMeetingInviteEmail(req, V1_TOKEN)).resolves.toEqual({ email_id: 'email-1', email: ALTERNATE_EMAIL });
      expect(natsRequest.mock.calls[0][0]).toBe(NatsSubjects.MEETING_PREFERRED_EMAIL_GET);
      expect(decodeRequestPayload()).toEqual({ token: V1_TOKEN });
    });

    it('returns null fields when the user has no override (invitations follow primary)', async () => {
      natsRequest.mockResolvedValue(reply({ email_id: null, email: null }));

      await expect(service.getMeetingInviteEmail(req, V1_TOKEN)).resolves.toEqual({ email_id: null, email: null });
    });

    // A reply missing both keys is a contract break, not a confirmed "no override" — treating it
    // as { email_id: null, email: null } would silently re-enable Remove on the actual invite
    // identity, so it must fail closed like a transport error instead.
    it('fails closed to null on a reply missing both fields, rather than normalizing to no-override', async () => {
      natsRequest.mockResolvedValue(reply({}));

      await expect(service.getMeetingInviteEmail(req, V1_TOKEN)).resolves.toBeNull();
      expect(loggerMock.warning).toHaveBeenCalledWith(req, 'get_meeting_invite_email', expect.any(String), { keys: [] });
    });

    it('fails closed to null when a field has the wrong type', async () => {
      natsRequest.mockResolvedValue(reply({ email_id: 123, email: ALTERNATE_EMAIL }));

      await expect(service.getMeetingInviteEmail(req, V1_TOKEN)).resolves.toBeNull();
    });

    it('fails open to null when the reply carries an error', async () => {
      natsRequest.mockResolvedValue(reply({ error: 'v1 lookup failed' }));

      await expect(service.getMeetingInviteEmail(req, V1_TOKEN)).resolves.toBeNull();
      expect(loggerMock.warning).toHaveBeenCalledWith(req, 'get_meeting_invite_email', expect.any(String), { error: 'v1 lookup failed' });
    });

    it('redacts an address embedded in the upstream error before logging it', async () => {
      natsRequest.mockResolvedValue(reply({ error: `${ALTERNATE_EMAIL} is not an active, verified address` }));

      await service.getMeetingInviteEmail(req, V1_TOKEN);

      expect(loggerMock.warning).toHaveBeenCalledWith(req, 'get_meeting_invite_email', expect.any(String), {
        error: '[redacted-email] is not an active, verified address',
      });
    });

    it('fails open to null when the transport throws', async () => {
      natsRequest.mockRejectedValue(new Error('timeout'));

      await expect(service.getMeetingInviteEmail(req, V1_TOKEN)).resolves.toBeNull();
    });

    // A slow read only fails open to "no override", and the settings page awaits it on load —
    // so GET deliberately keeps the shared fast-fail budget rather than the longer SET one.
    it('uses the shared request timeout', async () => {
      natsRequest.mockResolvedValue(reply({ email_id: null, email: null }));

      await service.getMeetingInviteEmail(req, V1_TOKEN);

      expect(natsRequest.mock.calls[0][2]).toEqual({ timeout: NATS_CONFIG.REQUEST_TIMEOUT });
    });
  });

  describe('setMeetingInviteEmail', () => {
    it('returns the updated preference on success', async () => {
      natsRequest.mockResolvedValue(reply({ email_id: 'email-1', email: ALTERNATE_EMAIL }));

      await expect(service.setMeetingInviteEmail(req, V1_TOKEN, ALTERNATE_EMAIL)).resolves.toEqual({
        success: true,
        data: { email_id: 'email-1', email: ALTERNATE_EMAIL },
      });
      expect(natsRequest.mock.calls[0][0]).toBe(NatsSubjects.MEETING_PREFERRED_EMAIL_SET);
      expect(decodeRequestPayload()).toEqual({ token: V1_TOKEN, email: ALTERNATE_EMAIL });
    });

    it('forwards the reset sentinel verbatim so upstream clears the override', async () => {
      natsRequest.mockResolvedValue(reply({ email_id: null, email: null }));

      await expect(service.setMeetingInviteEmail(req, V1_TOKEN, MEETING_INVITE_PRIMARY_SENTINEL)).resolves.toEqual({
        success: true,
        data: { email_id: null, email: null },
      });
      expect(decodeRequestPayload().email).toBe(MEETING_INVITE_PRIMARY_SENTINEL);
      expect(loggerMock.debug).toHaveBeenCalledWith(req, 'set_meeting_invite_email', expect.any(String), { is_reset: true });
    });

    it('logs an explicit selection as a non-reset', async () => {
      natsRequest.mockResolvedValue(reply({ email_id: 'email-1', email: ALTERNATE_EMAIL }));

      await service.setMeetingInviteEmail(req, V1_TOKEN, ALTERNATE_EMAIL);

      expect(loggerMock.debug).toHaveBeenCalledWith(req, 'set_meeting_invite_email', expect.any(String), { is_reset: false });
    });

    // The responder gives its downstream call a 15s deadline; giving up first would return an
    // error to the browser while the mutation still lands upstream.
    it('outlasts the responder deadline with a dedicated per-call timeout', async () => {
      natsRequest.mockResolvedValue(reply({ email_id: 'email-1', email: ALTERNATE_EMAIL }));

      await service.setMeetingInviteEmail(req, V1_TOKEN, ALTERNATE_EMAIL);

      expect(natsRequest.mock.calls[0][2]).toEqual({ timeout: NATS_CONFIG.MEETING_PREFERENCE_SET_TIMEOUT });
      expect(NATS_CONFIG.MEETING_PREFERENCE_SET_TIMEOUT).toBeGreaterThan(15000);
    });

    it.each([
      ['is not an active, verified address', 'validation'],
      ['Email is not yet available, please retry', 'sync_pending'],
      ['retry shortly', 'sync_pending'],
      // The meeting-service's user-service client wraps network failures as "user-service request
      // failed: <cause>" and maps HTTP 429/502/503/504 to a retryable error with no error-type
      // field on the wire — both must classify as retryable rather than falling to `upstream`.
      ['user-service request failed: connection reset', 'unavailable'],
      ['HTTP 503 error: upstream unavailable', 'unavailable'],
      ['HTTP 502 error', 'unavailable'],
      ['something else broke', 'upstream'],
    ])('classifies the upstream error %j as %s', async (upstreamError, reason) => {
      natsRequest.mockResolvedValue(reply({ error: upstreamError }));

      await expect(service.setMeetingInviteEmail(req, V1_TOKEN, ALTERNATE_EMAIL)).resolves.toEqual({
        success: false,
        reason,
        error: upstreamError,
      });
    });

    // A rejected NATS request is always a transport failure (timeout, no responder, connection
    // refused, ...) — application-level errors instead come back as a resolved `{ error }` reply
    // and go through classifyPreferredEmailError. So every rejection here maps to `unavailable`,
    // regardless of the error's message or shape.
    it.each([
      ['request timeout', new Error('request timeout')],
      ['uppercase TIMEOUT message', new Error('TIMEOUT')],
      ['NatsError-shaped code', Object.assign(new Error('some transport message'), { code: 'TIMEOUT' })],
      ['connection refused', new Error('connection refused')],
      ['non-Error rejection', 'some string rejection'],
    ])('maps the transport failure %j to unavailable', async (_label, natsError) => {
      natsRequest.mockRejectedValue(natsError);

      await expect(service.setMeetingInviteEmail(req, V1_TOKEN, ALTERNATE_EMAIL)).resolves.toEqual({
        success: false,
        reason: 'unavailable',
        error: 'Service temporarily unavailable',
      });
    });

    // A resolved reply that fails to parse or has the wrong shape is an upstream contract
    // failure, not a dropped request — it must not be folded into the transport catch and
    // mislabeled `unavailable` (retryable) instead of `upstream`.
    it('classifies a malformed resolved reply as upstream, not a transport failure', async () => {
      natsRequest.mockResolvedValue({ data: new TextEncoder().encode('not json') });

      await expect(service.setMeetingInviteEmail(req, V1_TOKEN, ALTERNATE_EMAIL)).resolves.toEqual({
        success: false,
        reason: 'upstream',
        error: 'Internal server error',
      });
    });

    // A reply that parses fine but is missing both keys must not be read as a confirmed write of
    // "no override" — same contract-break guard as the GET path.
    it('classifies a reply missing both fields as upstream, not a confirmed no-override write', async () => {
      natsRequest.mockResolvedValue(reply({}));

      await expect(service.setMeetingInviteEmail(req, V1_TOKEN, ALTERNATE_EMAIL)).resolves.toEqual({
        success: false,
        reason: 'upstream',
        error: 'Internal server error',
      });
    });
  });

  // `data.email` is not covered by the Pino redact paths, so the address must never reach the
  // logger in the first place — on the happy path or on either failure path.
  describe('PII', () => {
    it.each([
      ['success', () => natsRequest.mockResolvedValue(reply({ email_id: 'email-1', email: ALTERNATE_EMAIL }))],
      ['upstream error', () => natsRequest.mockResolvedValue(reply({ error: `${ALTERNATE_EMAIL} is not an active, verified address` }))],
      ['transport failure', () => natsRequest.mockRejectedValue(new Error('timeout'))],
    ])('keeps the raw address out of the logs on %s', async (_label, arrange) => {
      arrange();

      await service.getMeetingInviteEmail(req, V1_TOKEN);
      await service.setMeetingInviteEmail(req, V1_TOKEN, ALTERNATE_EMAIL);

      expect(loggedPayloads()).not.toContain(ALTERNATE_EMAIL);
    });
  });
});
