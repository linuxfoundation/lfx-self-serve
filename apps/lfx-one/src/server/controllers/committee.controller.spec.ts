// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const COMMITTEE_ID = 'a0000000-0000-0000-0000-000000000001';
const INVITE_ID = 'b0000000-0000-0000-0000-000000000002';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { getEffectiveEmailMock, committeeSvc } = vi.hoisted(() => ({
  getEffectiveEmailMock: vi.fn(() => 'user@example.com'),
  committeeSvc: {
    getPendingInviteForUser: vi.fn(),
    acceptCommitteeInvite: vi.fn(),
    // Stub remaining methods so the constructor doesn't fail.
    getCommittees: vi.fn(),
    getCommitteeById: vi.fn(),
    getCommitteeSettings: vi.fn(),
    getPendingCommitteeInvites: vi.fn(),
    acceptPendingCommitteeInvitesAfterLfidAccept: vi.fn(),
  },
}));

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest config.
vi.mock('@lfx-one/shared/constants', () => ({ ALLOWED_FILE_TYPES: [] }));
vi.mock('@lfx-one/shared/enums', () => ({ MeetingVisibility: {} }));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/utils', () => ({ isFileTypeAllowed: vi.fn(() => true) }));

vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail: getEffectiveEmailMock }));
vi.mock('../services/committee.service', () => ({
  CommitteeService: vi.fn(function () {
    return committeeSvc;
  }),
}));
vi.mock('../services/meeting.service', () => ({
  MeetingService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/groups-engagement-stats.service', () => ({
  GroupsEngagementStatsService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: vi.fn() }));
vi.mock('../helpers/content-disposition.helper', () => ({ contentDispositionAttachment: vi.fn() }));
vi.mock('../helpers/ics.helper', () => ({
  buildVCalendar: vi.fn(),
  fetchAllMeetingPages: vi.fn(),
  meetingsToVEvents: vi.fn(),
}));
vi.mock('../helpers/validation.helper', () => ({ getStringQueryParam: vi.fn() }));

import { CommitteeController } from './committee.controller';
import { buildVCalendar, fetchAllMeetingPages, meetingsToVEvents } from '../helpers/ics.helper';
import { generateM2MToken } from '../utils/m2m-token.util';

function buildReq(body: Record<string, unknown> = {}): any {
  return { params: { id: COMMITTEE_ID, inviteId: INVITE_ID }, body, path: '/test', log: {} };
}

function buildRes(): any {
  return { status: vi.fn().mockReturnThis(), send: vi.fn(), setHeader: vi.fn() };
}

describe('CommitteeController.acceptCommitteeInvite — from_lfid_invite flag', () => {
  let controller: CommitteeController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CommitteeController();
    committeeSvc.acceptCommitteeInvite.mockResolvedValue(undefined);
  });

  describe('LFID invite path (from_lfid_invite === true)', () => {
    it('skips getPendingInviteForUser and forwards directly to acceptCommitteeInvite', async () => {
      const res = buildRes();
      const next = vi.fn();

      await controller.acceptCommitteeInvite(buildReq({ from_lfid_invite: true }), res, next);

      expect(committeeSvc.getPendingInviteForUser).not.toHaveBeenCalled();
      expect(committeeSvc.acceptCommitteeInvite).toHaveBeenCalledOnce();
      expect(res.status).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
    });

    it('propagates upstream errors via next — committee-service is the real security gate', async () => {
      // A malicious client sending from_lfid_invite: true on an invalid invite still receives
      // a rejection from the committee-service, which is authoritative for invite existence.
      const upstreamError = new Error('upstream: invite not found');
      committeeSvc.acceptCommitteeInvite.mockRejectedValue(upstreamError);
      const next = vi.fn();

      await controller.acceptCommitteeInvite(buildReq({ from_lfid_invite: true }), buildRes(), next);

      expect(committeeSvc.getPendingInviteForUser).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(upstreamError);
    });

    it('treats non-boolean truthy values as the standard path (strict === true check)', async () => {
      committeeSvc.getPendingInviteForUser.mockResolvedValue({ organization_required: false });

      await controller.acceptCommitteeInvite(buildReq({ from_lfid_invite: 'true' as any }), buildRes(), vi.fn());

      // A string 'true' must not bypass the pre-check — only the literal boolean true does.
      expect(committeeSvc.getPendingInviteForUser).toHaveBeenCalledOnce();
    });

    it('requests the membership confirmation, since this path redirects to the committee page', async () => {
      const res = buildRes();

      await controller.acceptCommitteeInvite(buildReq({ from_lfid_invite: true }), res, vi.fn());

      expect(committeeSvc.acceptCommitteeInvite).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, INVITE_ID, expect.anything(), {
        confirmMembership: true,
      });
      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('does not request the confirmation for a truthy non-boolean flag', async () => {
      committeeSvc.getPendingInviteForUser.mockResolvedValue({ organization_required: false });
      const res = buildRes();

      await controller.acceptCommitteeInvite(buildReq({ from_lfid_invite: 'true' as any }), res, vi.fn());

      expect(committeeSvc.acceptCommitteeInvite).toHaveBeenCalledWith(expect.anything(), COMMITTEE_ID, INVITE_ID, expect.anything(), {
        confirmMembership: false,
      });
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  describe('standard path (from_lfid_invite absent or false)', () => {
    it('calls getPendingInviteForUser before forwarding to acceptCommitteeInvite', async () => {
      committeeSvc.getPendingInviteForUser.mockResolvedValue({ organization_required: false });
      const res = buildRes();
      const next = vi.fn();

      await controller.acceptCommitteeInvite(buildReq({}), res, next);

      expect(committeeSvc.getPendingInviteForUser).toHaveBeenCalledOnce();
      expect(committeeSvc.acceptCommitteeInvite).toHaveBeenCalledOnce();
      expect(res.status).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next with 400 when no matching pending invite is found', async () => {
      committeeSvc.getPendingInviteForUser.mockResolvedValue(null);
      const next = vi.fn();

      await controller.acceptCommitteeInvite(buildReq({}), buildRes(), next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          validationErrors: expect.arrayContaining([
            expect.objectContaining({ field: 'inviteId', message: expect.stringContaining('No matching pending invite') }),
          ]),
        })
      );
      expect(committeeSvc.acceptCommitteeInvite).not.toHaveBeenCalled();
    });
  });
});

describe('CommitteeController.getCommitteeCalendar', () => {
  let controller: CommitteeController;

  function buildCalendarReq(id: string = COMMITTEE_ID): any {
    return { params: { id }, headers: {}, bearerToken: undefined, path: `/public/api/committees/${id}/calendar.ics` };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CommitteeController();
    (generateM2MToken as any).mockResolvedValue('m2m-token');
    (fetchAllMeetingPages as any).mockResolvedValue([]);
    (meetingsToVEvents as any).mockReturnValue([]);
    (buildVCalendar as any).mockReturnValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR');
  });

  it('passes the resolved committee name through to buildVCalendar as calname', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_ID, name: 'Technical Steering Committee' });
    const req = buildCalendarReq();
    const res = buildRes();
    const next = vi.fn();

    await controller.getCommitteeCalendar(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(buildVCalendar).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'Technical Steering Committee');
    expect(res.send).toHaveBeenCalled();
  });

  it('falls back to an undefined calname (still 200) when the committee name lookup fails', async () => {
    committeeSvc.getCommitteeById.mockRejectedValue(new Error('upstream 503'));
    const req = buildCalendarReq();
    const res = buildRes();
    const next = vi.fn();

    await controller.getCommitteeCalendar(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(buildVCalendar).toHaveBeenCalledWith(expect.anything(), expect.any(String), undefined);
    expect(res.send).toHaveBeenCalled();
  });
});
