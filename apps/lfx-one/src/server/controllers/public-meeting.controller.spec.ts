// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibility } from '@lfx-one/shared/enums';
import type { Meeting } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MEETING_ID = 'meeting-1111';
const PROJECT_UID = 'project-2222';

// Hoisted, per-test-controllable mocks. The controller (and the real meeting.helper it delegates
// to for the host-key gate) reach these through the module mocks registered below.
const {
  checkAccessMock,
  generateM2MTokenMock,
  getEffectiveEmailMock,
  getEffectiveUsernameMock,
  validatePasswordMock,
  meetingSvc,
  projectSvc,
  addInvitedStatusToMeetingMock,
} = vi.hoisted(() => ({
  checkAccessMock: vi.fn(),
  generateM2MTokenMock: vi.fn(),
  getEffectiveEmailMock: vi.fn(),
  getEffectiveUsernameMock: vi.fn(),
  validatePasswordMock: vi.fn(),
  meetingSvc: {
    getMeetingById: vi.fn(),
    getMeetingRegistrants: vi.fn(),
    getMeetingRegistrantsByEmail: vi.fn(),
  },
  projectSvc: { getProjectById: vi.fn() },
  addInvitedStatusToMeetingMock: vi.fn(),
}));

// The `@lfx-one/shared/*` path alias isn't wired into vitest; stub the one runtime shared import
// the controller/gate use. validation.helper is mocked wholesale (see below) so its heavy
// shared/constants + shared/utils module graph never loads.
vi.mock('@lfx-one/shared/enums', () => ({ MeetingVisibility: { PUBLIC: 'public', PRIVATE: 'private' } }));
vi.mock('../helpers/validation.helper', () => ({ validateUidParameter: vi.fn(() => true) }));

vi.mock('../services/meeting.service', () => ({
  MeetingService: vi.fn(function () {
    return meetingSvc;
  }),
}));
vi.mock('../services/project.service', () => ({
  ProjectService: vi.fn(function () {
    return projectSvc;
  }),
}));
vi.mock('../services/committee.service', () => ({
  CommitteeService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: vi.fn(function () {
    return { checkAccess: checkAccessMock };
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock('../utils/auth-helper', () => ({
  getEffectiveEmail: getEffectiveEmailMock,
  getEffectiveUsername: getEffectiveUsernameMock,
  getUsernameFromAuth: vi.fn(),
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: generateM2MTokenMock }));
vi.mock('../utils/security.util', () => ({ validatePassword: validatePasswordMock }));

// Keep the real host-key gate (applyHostKeyVisibility + stripHostKey); stub only the
// registrant-lookup helpers so we don't need M2M/registrant plumbing.
vi.mock('../helpers/meeting.helper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/meeting.helper')>();
  return { ...actual, addInvitedStatusToMeeting: addInvitedStatusToMeetingMock, checkPastMeetingAccess: vi.fn() };
});

import { PublicMeetingController } from './public-meeting.controller';

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: MEETING_ID,
    project_uid: PROJECT_UID,
    visibility: MeetingVisibility.PUBLIC,
    restricted: false,
    host_key: '123456',
    committees: [],
    ...overrides,
  } as Meeting;
}

function buildProject() {
  return { name: 'Proj', slug: 'proj', logo_url: 'logo', uid: PROJECT_UID, parent_uid: 'parent' };
}

function buildReqRes(authenticated: boolean) {
  const req = {
    params: { id: MEETING_ID },
    query: {},
    bearerToken: 'user-token',
    oidc: { isAuthenticated: () => authenticated },
    path: '/public/api/meetings/' + MEETING_ID,
    log: {},
  } as any;
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
  const next = vi.fn();
  return { req, res, next };
}

function accessMap(entries: Array<[string, boolean]>): Map<string, boolean> {
  return new Map(entries);
}

describe('PublicMeetingController.getMeetingById host_key gating', () => {
  let controller: PublicMeetingController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicMeetingController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    getEffectiveEmailMock.mockReturnValue('user@example.com');
    getEffectiveUsernameMock.mockReturnValue('user');
    projectSvc.getProjectById.mockResolvedValue(buildProject());
    meetingSvc.getMeetingRegistrants.mockResolvedValue([]);
    // Default invited helper: not invited, host_key preserved on the returned object.
    addInvitedStatusToMeetingMock.mockImplementation(async (_req: any, meeting: Meeting) => ({ ...meeting, invited: false }));
  });

  it('strips host_key for an authenticated non-organizer on a PUBLIC non-restricted meeting (the leak regression)', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    checkAccessMock.mockResolvedValue(
      accessMap([
        [MEETING_ID, false],
        [PROJECT_UID, false],
      ])
    );
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBeUndefined();
    expect(payload.meeting.can_view_host_key).toBe(false);
  });

  it('keeps host_key for a meeting organizer', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    checkAccessMock.mockResolvedValue(accessMap([[MEETING_ID, true]]));
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBe('123456');
    expect(payload.meeting.can_view_host_key).toBe(true);
  });

  it('keeps host_key for a project writer who is not the organizer', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    checkAccessMock.mockResolvedValue(
      accessMap([
        [MEETING_ID, false],
        [PROJECT_UID, true],
      ])
    );
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBe('123456');
    expect(payload.meeting.can_view_host_key).toBe(true);
  });

  it('strips host_key for an unauthenticated caller and never runs an access check', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting());
    const { req, res, next } = buildReqRes(false);

    await controller.getMeetingById(req, res, next);

    expect(checkAccessMock).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.host_key).toBeUndefined();
    expect(payload.meeting.can_view_host_key).toBe(false);
  });

  it('strips host_key for an invited non-organizer on a private restricted meeting', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(buildMeeting({ visibility: MeetingVisibility.PRIVATE, restricted: true }));
    addInvitedStatusToMeetingMock.mockImplementation(async (_req: any, meeting: Meeting) => ({ ...meeting, invited: true }));
    checkAccessMock.mockResolvedValue(
      accessMap([
        [MEETING_ID, false],
        [PROJECT_UID, false],
      ])
    );
    const { req, res, next } = buildReqRes(true);

    await controller.getMeetingById(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.meeting.invited).toBe(true);
    expect(payload.meeting.host_key).toBeUndefined();
  });
});
