// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// UserService's import graph transitively pulls in @angular/common (partially compiled); load the
// JIT compiler so those injectables resolve under vitest (mirrors auth.middleware.spec.ts).
import '@angular/compiler';

import { UserMetadata } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// UserService's constructor instantiates several collaborators (NATS, Snowflake, etc.). Stub each
// module so `new UserService()` is cheap and side-effect-free — validateUserMetadata is a pure,
// synchronous method and touches none of them.
vi.mock('./nats.service', () => ({ NatsService: vi.fn() }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: vi.fn(() => ({})) } }));
vi.mock('./meeting.service', () => ({ MeetingService: vi.fn() }));
vi.mock('./project.service', () => ({ ProjectService: vi.fn() }));
vi.mock('./microservice-proxy.service', () => ({ MicroserviceProxyService: vi.fn() }));
vi.mock('./access-check.service', () => ({ AccessCheckService: vi.fn() }));
vi.mock('./committee.service', () => ({ CommitteeService: vi.fn() }));
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { UserService } from './user.service';

describe('UserService.validateUserMetadata', () => {
  let service: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserService();
  });

  describe('bio length cap (code points, not UTF-16 units)', () => {
    it('accepts a bio at the 2000-code-point limit', () => {
      expect(service.validateUserMetadata({ bio: 'a'.repeat(2000) } as UserMetadata)).toBe(true);
    });

    it('rejects a bio one code point over the limit', () => {
      expect(() => service.validateUserMetadata({ bio: 'a'.repeat(2001) } as UserMetadata)).toThrow(/Bio is too long/);
    });

    it('accepts 2000 emoji (String.length 4000) — the code-point cap matches the auth-service rune cap', () => {
      const bio = '😀'.repeat(2000);
      expect(bio.length).toBe(4000);
      expect(service.validateUserMetadata({ bio } as UserMetadata)).toBe(true);
    });

    it('rejects 2001 emoji, counting code points rather than UTF-16 units', () => {
      expect(() => service.validateUserMetadata({ bio: '😀'.repeat(2001) } as UserMetadata)).toThrow(/Bio is too long/);
    });

    it('accepts an empty bio (optional field)', () => {
      expect(service.validateUserMetadata({ bio: '' } as UserMetadata)).toBe(true);
    });

    it('accepts metadata without a bio', () => {
      expect(service.validateUserMetadata({} as UserMetadata)).toBe(true);
    });
  });
});
