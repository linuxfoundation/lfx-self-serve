// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks. stripHostKey is kept as a spy so we can assert every list item is sanitized;
// its real behaviour (deleting host_key) is covered in meeting.helper.spec.ts.
const { stripHostKeyMock, getStringQueryParamMock, getEffectiveEmailMock, userSvc } = vi.hoisted(() => ({
  stripHostKeyMock: vi.fn(),
  getStringQueryParamMock: vi.fn(() => undefined),
  getEffectiveEmailMock: vi.fn(() => 'user@example.com'),
  userSvc: {
    getUserMeetings: vi.fn(),
    getUserPastMeetings: vi.fn(),
    getUserLatestPastMeetings: vi.fn(),
  },
}));

vi.mock('../helpers/meeting.helper', () => ({ stripHostKey: stripHostKeyMock }));
vi.mock('../helpers/validation.helper', async () => {
  const { ServiceValidationError } = await import('../errors');
  return {
    getStringQueryParam: getStringQueryParamMock,
    // Real regex-based check (mirrors formation.controller.spec.ts) so validation-bypass
    // behavior is actually exercised for foundation_uid handling.
    validateFoundationUidParameter: vi.fn((value: unknown, req: any, next: (err: unknown) => void, options: { operation: string }) => {
      if (value === undefined) {
        return true;
      }
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
        next(
          new ServiceValidationError(
            [{ field: 'foundation_uid', message: 'foundation_uid must be a valid project uid', code: 'VALIDATION_ERROR' }],
            'Validation failed',
            { operation: options.operation, path: req.path }
          )
        );
        return false;
      }
      return true;
    }),
  };
});
vi.mock('../services/user.service', () => ({
  UserService: vi.fn(function () {
    return userSvc;
  }),
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail: getEffectiveEmailMock }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { UserController } from './user.controller';

function buildRes() {
  return { json: vi.fn(), set: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() } as any;
}

const req = { query: {}, path: '/api/user/meetings', log: {} } as any;

describe('UserController — host_key stripping on list endpoints', () => {
  let controller: UserController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new UserController();
    getEffectiveEmailMock.mockReturnValue('user@example.com');
  });

  it('strips host_key from every meeting in getUserMeetings', async () => {
    const meetings = [
      { id: 'm1', host_key: 'a' },
      { id: 'm2', host_key: 'b' },
    ];
    userSvc.getUserMeetings.mockResolvedValue(meetings);
    const res = buildRes();
    const next = vi.fn();

    await controller.getUserMeetings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(stripHostKeyMock).toHaveBeenCalledTimes(2);
    expect(stripHostKeyMock).toHaveBeenCalledWith(meetings[0]);
    expect(stripHostKeyMock).toHaveBeenCalledWith(meetings[1]);
    expect(res.json).toHaveBeenCalledWith(meetings);
  });

  it('strips host_key from every meeting in getUserPastMeetings', async () => {
    const meetings = [{ id: 'pm1', host_key: 'a' }];
    userSvc.getUserPastMeetings.mockResolvedValue(meetings);
    const res = buildRes();
    const next = vi.fn();

    await controller.getUserPastMeetings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(stripHostKeyMock).toHaveBeenCalledTimes(1);
    expect(stripHostKeyMock).toHaveBeenCalledWith(meetings[0]);
    expect(res.json).toHaveBeenCalledWith(meetings);
  });

  it('strips host_key from every meeting in getUserLatestPastMeetings', async () => {
    const meetings = [{ id: 'lpm1', host_key: 'a' }];
    userSvc.getUserLatestPastMeetings.mockResolvedValue(meetings);
    const res = buildRes();
    const next = vi.fn();

    await controller.getUserLatestPastMeetings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(stripHostKeyMock).toHaveBeenCalledTimes(1);
    expect(stripHostKeyMock).toHaveBeenCalledWith(meetings[0]);
    expect(res.json).toHaveBeenCalledWith(meetings);
  });
});

describe('UserController — foundation_uid validation on meeting list endpoints (PR #2436)', () => {
  let controller: UserController;

  function buildQueryReq(query: Record<string, unknown> = {}): any {
    return { query, path: '/api/user/meetings', log: {} };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new UserController();
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    userSvc.getUserMeetings.mockResolvedValue([]);
    userSvc.getUserPastMeetings.mockResolvedValue([]);
    userSvc.getUserLatestPastMeetings.mockResolvedValue([]);
  });

  const cases: {
    name: string;
    invoke: (controller: UserController, req: any, res: any, next: any) => Promise<void>;
    serviceMock: () => ReturnType<typeof vi.fn>;
  }[] = [
    { name: 'getUserMeetings', invoke: (c, req, res, next) => c.getUserMeetings(req, res, next), serviceMock: () => userSvc.getUserMeetings },
    {
      name: 'getUserPastMeetings',
      invoke: (c, req, res, next) => c.getUserPastMeetings(req, res, next),
      serviceMock: () => userSvc.getUserPastMeetings,
    },
    {
      name: 'getUserLatestPastMeetings',
      invoke: (c, req, res, next) => c.getUserLatestPastMeetings(req, res, next),
      serviceMock: () => userSvc.getUserLatestPastMeetings,
    },
  ];

  for (const { name, invoke, serviceMock } of cases) {
    it(`${name} forwards a valid foundation_uid to the service`, async () => {
      const next = vi.fn();

      await invoke(controller, buildQueryReq({ foundation_uid: 'aaif-uid-1' }), buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(serviceMock()).toHaveBeenCalled();
    });

    it(`${name} rejects a malformed foundation_uid via next() instead of forwarding to the service`, async () => {
      const next = vi.fn();

      await invoke(controller, buildQueryReq({ foundation_uid: 'has a space' }), buildRes(), next);

      expect(serviceMock()).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ServiceValidationError' }));
    });

    it(`${name} rejects a non-string foundation_uid (e.g. a repeated query param) via next()`, async () => {
      const next = vi.fn();

      await invoke(controller, buildQueryReq({ foundation_uid: ['a', 'b'] }), buildRes(), next);

      expect(serviceMock()).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ServiceValidationError' }));
    });
  }
});
