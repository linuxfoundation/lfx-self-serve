// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MEETING_ID = 'meeting-1111';
const V2_COMMITTEE_UID = 'cmte-v2-aaaa';
const V1_COMMITTEE_SFID = 'a09v1SFIDaaaa';

const { meetingSvc, aiSvc, committeeSvc, resolveCommitteeV2UidsToV1IdsMock } = vi.hoisted(() => ({
  meetingSvc: {
    getMeetingById: vi.fn(),
    getMeetingRegistrants: vi.fn(),
    addMeetingRegistrant: vi.fn(),
  },
  aiSvc: { generateMeetingAgenda: vi.fn() },
  committeeSvc: { getCommitteeById: vi.fn(), getCommitteeMembers: vi.fn() },
  resolveCommitteeV2UidsToV1IdsMock: vi.fn(),
}));

// The `@lfx-one/shared/*` path alias isn't wired into vitest, and the controller only uses those
// imports as types — stub the barrels so their runtime module graphs never load.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/enums', () => ({}));
vi.mock('@lfx-one/shared/constants', () => ({}));
vi.mock('@lfx-one/shared/utils', () => ({ resolveMeetingOrganizer: vi.fn(() => null) }));

vi.mock('../helpers/validation.helper', () => ({ validateUidParameter: vi.fn(() => true) }));
vi.mock('../helpers/meeting.helper', () => ({
  addInvitedStatusToMeeting: vi.fn(),
  applyHostKeyVisibility: vi.fn(),
  enrichMeetingsWithCreatedBy: vi.fn(),
  stripHostKey: vi.fn(),
}));
vi.mock('../helpers/committee-v1-mapping.helper', () => ({
  resolveCommitteeV2UidsToV1Ids: resolveCommitteeV2UidsToV1IdsMock,
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail: vi.fn(() => 'user@example.com') }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: vi.fn() }));

vi.mock('../services/meeting.service', () => ({ MeetingService: vi.fn(() => meetingSvc) }));
vi.mock('../services/ai.service', () => ({ AiService: vi.fn(() => aiSvc) }));
vi.mock('../services/committee.service', () => ({ CommitteeService: vi.fn(() => committeeSvc) }));
vi.mock('../services/nats.service', () => ({ NatsService: vi.fn(() => ({})) }));
vi.mock('../services/user.service', () => ({ UserService: vi.fn(() => ({})) }));
vi.mock('../services/access-check.service', () => ({ AccessCheckService: vi.fn(() => ({})) }));
vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    sanitize: vi.fn((value: unknown) => value),
  },
}));

class FakeValidationError extends Error {
  public constructor(public readonly fields: unknown) {
    super('validation');
  }
}
vi.mock('../errors', () => ({
  ServiceValidationError: {
    forField: (field: string) => new FakeValidationError({ [field]: 'required' }),
    fromFieldErrors: (fields: unknown) => new FakeValidationError(fields),
  },
}));

const { MeetingController } = await import('./meeting.controller');

function buildRes(): Response {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res), send: vi.fn(() => res) } as unknown as Response;
  return res;
}

function buildReq(overrides: Partial<Request> = {}): Request {
  return { params: { uid: MEETING_ID }, query: {}, body: {}, path: '/api/meetings', ...overrides } as unknown as Request;
}

describe('MeetingController', () => {
  let controller: InstanceType<typeof MeetingController>;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new MeetingController();
    next = vi.fn();
  });

  describe('generateAgenda', () => {
    beforeEach(() => {
      aiSvc.generateMeetingAgenda.mockResolvedValue({ agenda: 'Roll call', estimatedDuration: 30 });
    });

    // GH-1464: the composer surfaces the helper from any section and from Quick create, so it can
    // be invoked before a title / type / project exist. Those must not be hard requirements.
    it('generates from a free-text goal alone, with no title, type, or project', async () => {
      const req = buildReq({ body: { context: 'Plan the Q3 release' } });

      await controller.generateAgenda(req, buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(aiSvc.generateMeetingAgenda).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ context: 'Plan the Q3 release', title: undefined, meetingType: undefined, projectName: undefined })
      );
    });

    it('generates from a title alone, with no goal', async () => {
      await controller.generateAgenda(buildReq({ body: { title: 'TAC Monthly' } }), buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(aiSvc.generateMeetingAgenda).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'TAC Monthly' }));
    });

    it('rejects only when neither a title nor a goal is provided', async () => {
      await controller.generateAgenda(buildReq({ body: { projectName: 'ASWF' } }), buildRes(), next);

      expect(aiSvc.generateMeetingAgenda).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(FakeValidationError));
    });

    // The controller used to drop maxCharacters, so the client's agenda cap never reached the model.
    it('forwards the caller-supplied maxCharacters cap', async () => {
      await controller.generateAgenda(buildReq({ body: { title: 'TAC Monthly', maxCharacters: 1200 } }), buildRes(), next);

      expect(aiSvc.generateMeetingAgenda).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxCharacters: 1200 }));
    });
  });

  describe('addMeetingRegistrants', () => {
    beforeEach(() => {
      meetingSvc.addMeetingRegistrant.mockImplementation((_req: Request, registrant: Record<string, unknown>) => Promise.resolve(registrant));
    });

    // GH-1463: upstream stores a v1 SFID and derives type: 'committee' from it. Forwarding the v2
    // UID the picker works in would persist a bogus committee reference.
    it('rewrites a group guest committee_uid from the v2 UID to the v1 SFID', async () => {
      resolveCommitteeV2UidsToV1IdsMock.mockResolvedValue(new Map([[V2_COMMITTEE_UID, V1_COMMITTEE_SFID]]));
      const req = buildReq({ body: [{ email: 'a@example.com', committee_uid: V2_COMMITTEE_UID }] });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      expect(meetingSvc.addMeetingRegistrant).toHaveBeenCalledWith(req, expect.objectContaining({ committee_uid: V1_COMMITTEE_SFID }));
    });

    it('strips an unresolvable committee_uid rather than forwarding a v2 UID upstream', async () => {
      resolveCommitteeV2UidsToV1IdsMock.mockResolvedValue(new Map());
      const req = buildReq({ body: [{ email: 'a@example.com', committee_uid: V2_COMMITTEE_UID }] });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      expect(meetingSvc.addMeetingRegistrant).toHaveBeenCalledWith(req, expect.objectContaining({ committee_uid: null }));
    });

    it('skips the mapping lookup entirely for directly-added guests', async () => {
      const req = buildReq({ body: [{ email: 'a@example.com' }] });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      expect(resolveCommitteeV2UidsToV1IdsMock).not.toHaveBeenCalled();
      expect(meetingSvc.addMeetingRegistrant).toHaveBeenCalledWith(req, expect.objectContaining({ email: 'a@example.com' }));
    });
  });

  describe('getMeetingRegistrants', () => {
    const registrant = { uid: 'reg-1', email: 'a@example.com', committee_uid: V1_COMMITTEE_SFID };

    beforeEach(() => {
      meetingSvc.getMeetingRegistrants.mockResolvedValue([{ ...registrant }]);
      meetingSvc.getMeetingById.mockResolvedValue({ uid: MEETING_ID, committees: [{ uid: V2_COMMITTEE_UID }] });
      resolveCommitteeV2UidsToV1IdsMock.mockResolvedValue(new Map([[V2_COMMITTEE_UID, V1_COMMITTEE_SFID]]));
      committeeSvc.getCommitteeById.mockResolvedValue({ uid: V2_COMMITTEE_UID, name: 'TAC', category: 'Technical' });
      committeeSvc.getCommitteeMembers.mockResolvedValue([{ email: 'a@example.com', role: { name: 'Chair' }, voting: { status: 'Voting Rep' } }]);
    });

    // GH-1463: the composer's Guests rows render a "via [Group]" chip, which needs this metadata at
    // open time — the plain projection omits it.
    it('enriches committee metadata when include_committee=true', async () => {
      const res = buildRes();

      await controller.getMeetingRegistrants(buildReq({ query: { include_committee: 'true' } }), res, next);

      expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ committee_name: 'TAC', committee_role: 'Chair', committee_category: 'Technical' })]);
    });

    it('leaves registrants unenriched by default, without fetching the meeting', async () => {
      const res = buildRes();

      await controller.getMeetingRegistrants(buildReq(), res, next);

      expect(meetingSvc.getMeetingById).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith([registrant]);
    });

    it('degrades to unenriched rows when the meeting fetch fails', async () => {
      meetingSvc.getMeetingById.mockRejectedValue(new Error('upstream down'));
      const res = buildRes();

      await controller.getMeetingRegistrants(buildReq({ query: { include_committee: 'true' } }), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith([registrant]);
    });
  });
});
