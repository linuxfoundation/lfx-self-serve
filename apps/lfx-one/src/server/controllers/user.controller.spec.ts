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
vi.mock('../helpers/validation.helper', () => ({ getStringQueryParam: getStringQueryParamMock }));
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
