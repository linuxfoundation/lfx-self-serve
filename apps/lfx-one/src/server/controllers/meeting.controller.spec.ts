// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors of the real `@lfx-one/shared/constants` values — the barrel is stubbed below, so these
// are what the controller under test actually reads.
const MEETING_AGENDA_MAX_LENGTH = 2000;
const MEETING_AGENDA_PROMPT_MAX_LENGTH = 1000;

const MEETING_ID = 'meeting-1111';
const V2_COMMITTEE_UID = 'cmte-v2-aaaa';
const V1_COMMITTEE_SFID = 'a09v1SFIDaaaa';

const { meetingSvc, aiSvc, committeeSvc, resolveCommitteeV2UidsToV1IdsMock } = vi.hoisted(() => ({
  meetingSvc: {
    getMeetingById: vi.fn(),
    getMeetingRegistrants: vi.fn(),
    getMeetingRegistrantsByEmail: vi.fn(),
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
// Literals rather than the consts above: `vi.mock` factories are hoisted, so they can't close over
// module-level bindings. Kept in sync with `MEETING_AGENDA_*` in the shared constants barrel.
vi.mock('@lfx-one/shared/constants', () => ({ MEETING_AGENDA_MAX_LENGTH: 2000, MEETING_AGENDA_PROMPT_MAX_LENGTH: 1000 }));
// `truncateToUtf16Units` is the real implementation: the truncation assertions below are about what
// the controller sends upstream, so stubbing it would test the stub. `string.utils` has no imports of
// its own, so pulling it in directly doesn't drag the aliased barrel's graph along.
vi.mock('@lfx-one/shared/utils', async () => ({
  resolveMeetingOrganizer: vi.fn(() => null),
  truncateToUtf16Units: (await import('../../../../../packages/shared/src/utils/string.utils')).truncateToUtf16Units,
}));

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

    // GH-1464: in edit mode the rail imposes no section locking, so the organizer can reach Agenda &
    // Resources with the title cleared; the project context also resolves asynchronously. A title /
    // type / project must therefore not be requirements.
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

    it('rejects a whitespace-only title and goal rather than prompting on blanks', async () => {
      await controller.generateAgenda(buildReq({ body: { title: '   ', context: '\n\t' } }), buildRes(), next);

      expect(aiSvc.generateMeetingAgenda).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(FakeValidationError));
    });

    it('trims the descriptors it forwards, since both land verbatim in the prompt', async () => {
      await controller.generateAgenda(buildReq({ body: { title: '  TAC Monthly  ', context: ' Plan Q3 ' } }), buildRes(), next);

      expect(aiSvc.generateMeetingAgenda).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: 'TAC Monthly', context: 'Plan Q3' }));
    });

    // An over-budget descriptor is truncated, not dropped. Dropping made the endpoint's contract
    // impossible for the client to satisfy: the client guard tests for the *presence* of a title or
    // goal, so an over-budget title with no goal passed the client and then failed `!title && !context`
    // here as an unfixable "could not generate an agenda".
    it('truncates a goal that exceeds the prompt budget instead of dropping it', async () => {
      const req = buildReq({ body: { title: 'TAC Monthly', context: 'x'.repeat(MEETING_AGENDA_PROMPT_MAX_LENGTH + 50) } });

      await controller.generateAgenda(req, buildRes(), next);

      // Asserted on the actual argument rather than `objectContaining`, which would also pass if the
      // key were present with a value stripped elsewhere.
      const [, request] = aiSvc.generateMeetingAgenda.mock.calls[0];
      expect(request.context).toBe('x'.repeat(MEETING_AGENDA_PROMPT_MAX_LENGTH));
      expect(request.title).toBe('TAC Monthly');
    });

    it('truncates an over-budget title and still generates when it is the only descriptor', async () => {
      const req = buildReq({ body: { title: 'y'.repeat(MEETING_AGENDA_PROMPT_MAX_LENGTH + 50) } });

      await controller.generateAgenda(req, buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      const [, request] = aiSvc.generateMeetingAgenda.mock.calls[0];
      expect(request.title).toBe('y'.repeat(MEETING_AGENDA_PROMPT_MAX_LENGTH));
    });

    // The controller used to drop maxCharacters, so the client's agenda cap never reached the model.
    it('forwards the caller-supplied maxCharacters cap', async () => {
      await controller.generateAgenda(buildReq({ body: { title: 'TAC Monthly', maxCharacters: 1200 } }), buildRes(), next);

      expect(aiSvc.generateMeetingAgenda).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxCharacters: 1200 }));
    });

    // maxCharacters reaches the model twice — as the response schema's maxLength and inside the
    // prompt — so an unvalidated body value would surface as an opaque upstream failure.
    it.each([
      ['a non-numeric value', 'abc', MEETING_AGENDA_MAX_LENGTH],
      ['an absent value', undefined, MEETING_AGENDA_MAX_LENGTH],
      ['a value above the agenda cap', MEETING_AGENDA_MAX_LENGTH + 500, MEETING_AGENDA_MAX_LENGTH],
      ['a negative value', -1, MEETING_AGENDA_MAX_LENGTH],
      ['a zero cap', 0, MEETING_AGENDA_MAX_LENGTH],
      ['a fractional value', 900.7, 900],
    ])('resolves %s to a usable agenda cap', async (_label, supplied, expected) => {
      await controller.generateAgenda(buildReq({ body: { title: 'TAC Monthly', maxCharacters: supplied } }), buildRes(), next);

      expect(aiSvc.generateMeetingAgenda).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxCharacters: expected }));
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

    // The key is deleted, not nulled: upstream declares `committee_uid` a non-nullable optional
    // `string`, so omission is on-contract and an explicit `null` is not.
    it('strips an unresolvable committee_uid rather than forwarding a v2 UID upstream', async () => {
      resolveCommitteeV2UidsToV1IdsMock.mockResolvedValue(new Map());
      const req = buildReq({ body: [{ email: 'a@example.com', committee_uid: V2_COMMITTEE_UID }] });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      const [, forwarded] = meetingSvc.addMeetingRegistrant.mock.calls[0];
      expect(forwarded).not.toHaveProperty('committee_uid');
    });

    it('drops a client-sent null committee_uid instead of proxying it upstream', async () => {
      const req = buildReq({ body: [{ email: 'a@example.com', committee_uid: null }] });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      const [, forwarded] = meetingSvc.addMeetingRegistrant.mock.calls[0];
      expect(forwarded).not.toHaveProperty('committee_uid');
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

    // Upstream stores the v1 SFID, but every client-side comparison (and the create path) works in
    // v2 UIDs — handing back the SFID would make one field mean two things by direction.
    it('normalizes the enriched committee_uid from the v1 SFID back to the v2 UID', async () => {
      const res = buildRes();

      await controller.getMeetingRegistrants(buildReq({ query: { include_committee: 'true' } }), res, next);

      expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ committee_uid: V2_COMMITTEE_UID })]);
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

  describe('getMyMeetingRegistrants', () => {
    const registrant = { uid: 'reg-1', email: 'a@example.com', committee_uid: V1_COMMITTEE_SFID };

    beforeEach(() => {
      meetingSvc.getMeetingById.mockResolvedValue({ uid: MEETING_ID, organizer: true, committees: [{ uid: V2_COMMITTEE_UID }] });
      meetingSvc.getMeetingRegistrantsByEmail.mockResolvedValue([{ uid: 'reg-self', email: 'user@example.com' }]);
      meetingSvc.getMeetingRegistrants.mockResolvedValue([{ ...registrant }]);
      resolveCommitteeV2UidsToV1IdsMock.mockResolvedValue(new Map([[V2_COMMITTEE_UID, V1_COMMITTEE_SFID]]));
      committeeSvc.getCommitteeById.mockResolvedValue({ uid: V2_COMMITTEE_UID, name: 'TAC', category: 'Technical' });
      committeeSvc.getCommitteeMembers.mockResolvedValue([{ email: 'a@example.com', role: { name: 'Chair' }, voting: { status: 'Voting Rep' } }]);
    });

    it('enriches committee metadata for a registrant of the meeting', async () => {
      const res = buildRes();

      await controller.getMyMeetingRegistrants(buildReq(), res, next);

      expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ committee_name: 'TAC', committee_uid: V2_COMMITTEE_UID })]);
    });

    // Group attribution is decoration; the guest list is not. The v2 → v1 mapping goes over NATS, so a
    // transient committee-service problem must not turn this listing into a 500 — and this is the
    // degradation `MeetingRegistrant.committee_uid`'s docstring promises on both read paths.
    it('degrades to unenriched rows when the committee mapping lookup fails', async () => {
      resolveCommitteeV2UidsToV1IdsMock.mockRejectedValue(new Error('nats timeout'));
      const res = buildRes();

      await controller.getMyMeetingRegistrants(buildReq(), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith([registrant]);
    });
  });
});
