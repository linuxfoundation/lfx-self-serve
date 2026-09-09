// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ValidationError } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors of the real `@lfx-one/shared/constants` values — the barrel is stubbed below, so these
// are what the controller under test actually reads.
const MEETING_AGENDA_MAX_LENGTH = 2000;
const MEETING_AGENDA_PROMPT_MAX_LENGTH = 1000;

const MEETING_ID = 'meeting-1111';
const V2_COMMITTEE_UID = 'cmte-v2-aaaa';
const V1_COMMITTEE_SFID = 'a09v1SFIDaaaa';
const USER_TOKEN = 'user-bearer-token';
const M2M_TOKEN = 'm2m-bearer-token';

const { meetingSvc, aiSvc, committeeSvc, resolveCommitteeV2UidsToV1IdsMock, generateM2MTokenMock } = vi.hoisted(() => ({
  meetingSvc: {
    getMeetingById: vi.fn(),
    getMeetingRegistrants: vi.fn(),
    getMeetingRegistrantsByEmail: vi.fn(),
    addMeetingRegistrant: vi.fn(),
    updateMeetingRegistrant: vi.fn(),
    createMeetingRsvp: vi.fn(),
  },
  aiSvc: { generateMeetingAgenda: vi.fn() },
  committeeSvc: { getCommitteeById: vi.fn(), getCommitteeMembers: vi.fn() },
  resolveCommitteeV2UidsToV1IdsMock: vi.fn(),
  generateM2MTokenMock: vi.fn(),
}));

// The `@lfx-one/shared/*` path alias isn't wired into vitest, and the controller only uses those
// imports as types — stub the barrels so their runtime module graphs never load.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
// `MeetingType` is imported as a value (the controller narrows client input against
// `Object.values(MeetingType)`), so the stub has to carry the real members rather than being empty.
// Kept in sync with `MeetingType` in `packages/shared/src/enums/meeting.enum.ts` by hand — `vi.mock`
// factories are hoisted, so they can't import the real enum to derive from. A member added upstream
// and missed here shows up as a narrowing test that rejects a type the controller actually accepts,
// not as a false pass: every assertion below tests a value against the stub's own member list.
vi.mock('@lfx-one/shared/enums', () => ({
  MeetingType: {
    BOARD: 'Board',
    MAINTAINERS: 'Maintainers',
    MARKETING: 'Marketing',
    TECHNICAL: 'Technical',
    LEGAL: 'Legal',
    OTHER: 'Other',
    NONE: 'None',
  },
}));
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
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: generateM2MTokenMock }));

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

/**
 * Stand-in for `ServiceValidationError`, mirroring the field the real class exposes.
 *
 * `../errors` is mocked so these tests don't drag in `BaseApiError` and the shared constants behind
 * it, but the double carries `validationErrors: ValidationError[]` — the real class's own property,
 * populated by its own factories' rules — rather than a convenient `fields` map. A double with a
 * shape of its own lets an assertion pin a contract that exists nowhere but this file: it would keep
 * passing after the production error changed.
 *
 * The two factories' `message` strings are mirrored too, and they do not agree with each other:
 * `forField` *discards* the message it is handed and reports `Validation failed for <field>`
 * instead, putting the caller's message only inside `validationErrors`, while `fromFieldErrors`
 * takes the message as its own second parameter and defaults it to `Validation failed`. Both halves
 * matter — an earlier version of this double passed `forField`'s message straight to `super()`, and
 * hard-coded `fromFieldErrors`' — so a handler reading `err.message` could pass here and report
 * something else in production, in either direction. Every `fromFieldErrors` call in this controller
 * names its own message (`RSVP data validation failed`, and so on), so the default is the arm that
 * is never taken.
 */
class FakeValidationError extends Error {
  public constructor(
    message: string,
    public readonly validationErrors: ValidationError[]
  ) {
    super(message);
  }
}
vi.mock('../errors', () => ({
  ServiceValidationError: {
    forField: (field: string, message: string) =>
      new FakeValidationError(`Validation failed for ${field}`, [{ field, message, code: 'FIELD_VALIDATION_ERROR' }]),
    fromFieldErrors: (fieldErrors: Record<string, string | string[]>, message = 'Validation failed') =>
      new FakeValidationError(
        message,
        Object.entries(fieldErrors).map(([field, messages]) => ({
          field,
          message: Array.isArray(messages) ? messages.join(', ') : messages,
          code: 'FIELD_VALIDATION_ERROR',
        }))
      ),
  },
}));

const { MeetingController } = await import('./meeting.controller');
// The stubbed logger, imported after the mock is registered, so the metadata assertions read the same
// object the controller writes to.
const { logger } = await import('../services/logger.service');

function buildRes(): Response {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res), send: vi.fn(() => res) } as unknown as Response;
  return res;
}

function buildReq(overrides: Partial<Request> = {}, headers: Record<string, string> = {}): Request {
  // `get` is stubbed because the registrant batch endpoints read `content-length` off the request for
  // their `request_content_length` log field. These reqs are built by hand rather than sent over HTTP, so no
  // header exists unless a test asks for one — which is also the state a chunked request arrives in,
  // and what exercises `readContentLength`'s `null` fallback.
  return {
    params: { uid: MEETING_ID },
    query: {},
    body: {},
    path: '/api/meetings',
    get: (name: string) => headers[name.toLowerCase()],
    ...overrides,
  } as unknown as Request;
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

    // `meetingType` is the one prompt input with a closed value set, and it lands in two log lines
    // (this route's start line and `AiService`'s own) plus the prompt. Narrowing to the enum bounds all
    // three at once — a 15mb string on a route behind `express.json({ limit: '15mb' })` would otherwise
    // reach CloudWatch verbatim, and `getMeetingTypeDescription` falls back to a generic descriptor for
    // anything off the enum anyway, so an unrecognized value carries no signal worth keeping.
    it('forwards a recognized meeting type verbatim', async () => {
      await controller.generateAgenda(buildReq({ body: { title: 'TAC Monthly', meetingType: 'Technical' } }), buildRes(), next);

      expect(aiSvc.generateMeetingAgenda).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ meetingType: 'Technical' }));
    });

    it.each([
      ['an unrecognized string', 'Definitely Not A Meeting Type'],
      ['an oversized string', 'z'.repeat(50_000)],
      ['a non-string value', { toString: (): string => 'Technical' }],
    ])('drops %s rather than logging or prompting on it', async (_label, supplied) => {
      const req = buildReq({ body: { title: 'TAC Monthly', meetingType: supplied } });

      await controller.generateAgenda(req, buildRes(), next);

      const [, request] = aiSvc.generateMeetingAgenda.mock.calls[0];
      expect(request.meetingType).toBeUndefined();
      // Dropped, not truncated: a prefix of an invalid type is still an invalid type.
      expect(logger.startOperation).toHaveBeenCalledWith(req, 'generate_agenda', expect.objectContaining({ meeting_type: null }));
    });
  });

  describe('addMeetingRegistrants', () => {
    beforeEach(() => {
      meetingSvc.addMeetingRegistrant.mockImplementation((_req: Request, registrant: Record<string, unknown>) => Promise.resolve(registrant));
      // Committee attribution is allowlisted against the meeting's own committees, so the meeting has
      // to actually carry the group the request attributes a guest to.
      meetingSvc.getMeetingById.mockResolvedValue({ committees: [{ uid: V2_COMMITTEE_UID }] });
    });

    // GH-1463: upstream stores a v1 SFID and derives type: 'committee' from it. Forwarding the v2
    // UID the picker works in would persist a bogus committee reference.
    it('rewrites a group guest committee_uid from the v2 UID to the v1 SFID', async () => {
      resolveCommitteeV2UidsToV1IdsMock.mockResolvedValue(new Map([[V2_COMMITTEE_UID, V1_COMMITTEE_SFID]]));
      const req = buildReq({ body: [{ email: 'a@example.com', committee_uid: V2_COMMITTEE_UID }] });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      expect(meetingSvc.addMeetingRegistrant).toHaveBeenCalledWith(req, expect.objectContaining({ committee_uid: V1_COMMITTEE_SFID }));
    });

    // A caller can attribute a guest to any committee UID it likes; only the ones the meeting is
    // actually scoped to may be resolved, or the v1 lookup becomes an unauthorized cross-project read.
    it('strips a committee_uid the meeting is not scoped to without looking it up', async () => {
      const req = buildReq({ body: [{ email: 'a@example.com', committee_uid: 'cmte-v2-someone-elses' }] });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      expect(resolveCommitteeV2UidsToV1IdsMock).not.toHaveBeenCalled();
      const [, forwarded] = meetingSvc.addMeetingRegistrant.mock.calls[0];
      expect(forwarded).not.toHaveProperty('committee_uid');
    });

    // An unknown allowlist fails the batch rather than downgrading it: nothing has been written yet,
    // and a 201 that silently dropped every group attribution has no recovery path (the update
    // contract carries no `committee_uid`).
    it('fails the batch when the meeting committees cannot be loaded', async () => {
      const upstreamError = new Error('upstream down');
      meetingSvc.getMeetingById.mockRejectedValue(upstreamError);
      const req = buildReq({ body: [{ email: 'a@example.com', committee_uid: V2_COMMITTEE_UID }] });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      expect(next).toHaveBeenCalledWith(upstreamError);
      expect(meetingSvc.addMeetingRegistrant).not.toHaveBeenCalled();
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

    // Same unprotected position as the update endpoint's body map — see the note there.
    it('rejects a non-array body as a validation error rather than throwing', async () => {
      const req = buildReq({ body: { email: 'a@example.com' } });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(FakeValidationError));
      expect(meetingSvc.addMeetingRegistrant).not.toHaveBeenCalled();
    });

    // `email` is the only identity a new registrant has, and the per-failure log line is keyed by it —
    // so an entry without one used to reach upstream as a create with a literal `{}` body (the mapper
    // deletes the `meeting_id` added here) and be logged against `undefined`. Spreading `null` is
    // legal, so the mapping itself never threw; the entry just stopped looking empty once
    // `meeting_id` was added.
    //
    // The asserted field name is what distinguishes the email guard from the two checks that run
    // before it — without it these cases would keep passing if the guard were deleted.
    it.each([
      ['a null entry', [null]],
      ['an empty object', [{}]],
      ['a blank email', [{ email: '   ' }]],
      ['a non-string email', [{ email: 42 }]],
    ])('rejects %s rather than creating a registrant with no email', async (_label, body) => {
      const req = buildReq({ body });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      expect(next).not.toHaveBeenCalledWith(expect.any(TypeError));
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ validationErrors: [expect.objectContaining({ field: 'registrants.email' })] }));
      expect(meetingSvc.addMeetingRegistrant).not.toHaveBeenCalled();
    });

    it('records the declared content length on the operation when the request carries the header', async () => {
      const req = buildReq({ body: [{ email: 'a@example.com' }] }, { 'content-length': '2048' });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      expect(logger.startOperation).toHaveBeenCalledWith(req, 'add_meeting_registrants', expect.objectContaining({ request_content_length: 2048 }));
    });

    // `null`, not `0`: a chunked request omits the header, and logging it as `0` would make it
    // indistinguishable from a declared empty body. The empty-string case is the one that regresses
    // silently — `Number('')` is `0`, so a header that arrives blank lands on exactly the value the
    // `null` exists to stay distinct from — and the malformed cases would otherwise log a byte count
    // no real request can produce.
    //
    // The last two rows are all digits, so they clear a shape check and still can't be logged
    // honestly: past `2^53 - 1` the parsed number is no longer the one the header carried, and a long
    // enough run overflows to `Infinity`, which `JSON.stringify` writes as `null` anyway — the same
    // log line as an absent header, arrived at by accident rather than by the guard.
    it.each([
      ['declares none', undefined],
      ['sends an empty header', ''],
      ['sends a whitespace-only header', '   '],
      ['sends a non-numeric header', 'abc'],
      ['sends a negative header', '-1'],
      ['sends a fractional header', '12.5'],
      ['sends a hexadecimal header', '0x10'],
      ['sends an exponent-notation header', '1e3'],
      ['sends a signed header', '+8'],
      ['sends a header past the safe integer range', '9007199254740993'],
      ['sends a header long enough to overflow to Infinity', '9'.repeat(400)],
    ])('records a null content length when the request %s', async (_label, header) => {
      const req = buildReq({ body: [{ email: 'a@example.com' }] }, header === undefined ? {} : { 'content-length': header });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      expect(logger.startOperation).toHaveBeenCalledWith(req, 'add_meeting_registrants', expect.objectContaining({ request_content_length: null }));
    });

    it('records a zero content length when the request explicitly declares one', async () => {
      const req = buildReq({ body: [{ email: 'a@example.com' }] }, { 'content-length': '0' });

      await controller.addMeetingRegistrants(req, buildRes(), next);

      // A declared `0` is a measurement, not a missing header, so it is kept as `0` — that is the
      // distinction the `null` above is protecting.
      expect(logger.startOperation).toHaveBeenCalledWith(req, 'add_meeting_registrants', expect.objectContaining({ request_content_length: 0 }));
    });
  });

  describe('updateMeetingRegistrants', () => {
    // The edit endpoint is the one path that isn't allowlisted against the meeting's committees —
    // `UpdateMeetingRegistrantRequest` declares no `committee_uid`, but that's a compile-time
    // guarantee and `req.body` is untyped JSON that the service forwards key-for-key.
    it('strips a runtime committee_uid instead of forwarding it upstream', async () => {
      meetingSvc.updateMeetingRegistrant.mockImplementation((_req: Request, _uid: string, _regUid: string, changes: Record<string, unknown>) =>
        Promise.resolve(changes)
      );
      const req = buildReq({ body: [{ uid: 'reg-1', changes: { email: 'a@example.com', committee_uid: V1_COMMITTEE_SFID } }] });

      await controller.updateMeetingRegistrants(req, buildRes(), next);

      const [, , , forwarded] = meetingSvc.updateMeetingRegistrant.mock.calls[0];
      expect(forwarded).not.toHaveProperty('committee_uid');
      expect(forwarded).toMatchObject({ email: 'a@example.com', meeting_id: MEETING_ID });
    });

    // The body map runs before `startOperation` and outside the `try`, and `routes/meetings.route.ts`
    // registers a bare async arrow that Express 4 does not catch — so a throw here is an unhandled
    // rejection that kills the SSR worker with no log line at all. `changes` and the array-ness of the
    // body are compile-time guarantees only; every body below is reachable over HTTP.
    //
    // Rejected rather than forwarded, and both halves matter. Not throwing is the unhandled-rejection
    // guarantee; the 400 is what stops an entry with nothing to apply from reaching upstream as a
    // `PUT .../registrants/reg-1` carrying a literal `{}` — an empty write whose field semantics are
    // ITX's to define, echoed back to the client as the "updated" registrant.
    // Each case asserts `registrants.changes` specifically. Asserting only `FakeValidationError`
    // would let a case pass on one of the two checks that run first — `[null]` in particular is
    // rejected for its missing UID and never reaches this guard at all, which is why it's a separate
    // test below rather than a row here.
    it.each([
      ['omits changes', [{ uid: 'reg-1' }]],
      ['sends an empty changes object', [{ uid: 'reg-1', changes: {} }]],
      // `Object.keys('ab')` is `['0', '1']`, so a primitive would count as two changes if the guard
      // read keys without checking the type first.
      ['sends a primitive as changes', [{ uid: 'reg-1', changes: 'ab' }]],
      // `committee_uid` is stripped before forwarding, so an entry carrying only that key still
      // forwards an empty write.
      ['sends only a committee_uid', [{ uid: 'reg-1', changes: { committee_uid: V1_COMMITTEE_SFID } }]],
      // The three keys below survive `stripCommitteeUid` but not `toUpstreamRegistrantBody`:
      // `meeting_id` is deleted outright, and the renamed fields are dropped when nullish. Counting
      // raw keys let all three through the guard and into the empty `PUT` it exists to reject.
      ['sends only a meeting_id', [{ uid: 'reg-1', changes: { meeting_id: MEETING_ID } }]],
      ['sends only a null org_name', [{ uid: 'reg-1', changes: { org_name: null } }]],
      ['sends only nullish renamed fields', [{ uid: 'reg-1', changes: { org_name: null, avatar_url: undefined, occurrence_id: null } }]],
    ])('rejects an entry that %s instead of forwarding an empty write', async (_label, body) => {
      const req = buildReq({ body });

      await controller.updateMeetingRegistrants(req, buildRes(), next);

      expect(next).not.toHaveBeenCalledWith(expect.any(TypeError));
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ validationErrors: [expect.objectContaining({ field: 'registrants.changes' })] }));
      expect(meetingSvc.updateMeetingRegistrant).not.toHaveBeenCalled();
    });

    // The body map reads the entry rather than spreading it — `update?.uid ?? ''` and
    // `stripCommitteeUid(update?.changes)`, both null-safe — so a `null` entry doesn't throw. It
    // simply arrives with an empty UID, and the UID check is what turns it away.
    it('rejects a null entry on the missing-UID check rather than throwing', async () => {
      const req = buildReq({ body: [null] });

      await controller.updateMeetingRegistrants(req, buildRes(), next);

      expect(next).not.toHaveBeenCalledWith(expect.any(TypeError));
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ validationErrors: [expect.objectContaining({ field: 'registrants.uid' })] }));
      expect(meetingSvc.updateMeetingRegistrant).not.toHaveBeenCalled();
    });

    // A non-nullish value on a renamed field is a real change, so the guard has to let it through —
    // the drop list is about nullish values, not about the keys themselves.
    it('forwards an entry whose only change is a renamed field with a value', async () => {
      const req = buildReq({ body: [{ uid: 'reg-1', changes: { org_name: 'Acme' } }] });

      await controller.updateMeetingRegistrants(req, buildRes(), next);

      expect(next).not.toHaveBeenCalledWith(expect.any(FakeValidationError));
      expect(meetingSvc.updateMeetingRegistrant).toHaveBeenCalledWith(req, MEETING_ID, 'reg-1', expect.objectContaining({ org_name: 'Acme' }));
    });

    it('rejects a non-array body as a validation error rather than throwing', async () => {
      const req = buildReq({ body: { uid: 'reg-1' } });

      await controller.updateMeetingRegistrants(req, buildRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(FakeValidationError));
      expect(meetingSvc.updateMeetingRegistrant).not.toHaveBeenCalled();
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
      generateM2MTokenMock.mockResolvedValue(M2M_TOKEN);
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

    // The M2M token is swapped onto `req` for the privileged registrant reads and must come back off
    // before the request continues its lifetime. `req` outlives this handler — SSR rendering and any
    // later middleware read `req.bearerToken` — so a leaked M2M token means subsequent upstream calls
    // are made with application credentials instead of the user's, silently bypassing per-user
    // authorization. The restore lives in a `finally`, and these cover each way out of that block.
    describe('bearer token restore', () => {
      it('restores the user bearer token after the privileged reads succeed', async () => {
        const req = buildReq({ bearerToken: USER_TOKEN } as Partial<Request>);

        await controller.getMyMeetingRegistrants(req, buildRes(), next);

        // Proof the swap actually happened, so the restore assertion isn't vacuous.
        expect(meetingSvc.getMeetingRegistrants).toHaveBeenCalled();
        expect(req.bearerToken).toBe(USER_TOKEN);
      });

      it('restores the user bearer token on the non-registrant, non-organizer early return', async () => {
        meetingSvc.getMeetingById.mockResolvedValue({ uid: MEETING_ID, organizer: false, committees: [] });
        meetingSvc.getMeetingRegistrantsByEmail.mockResolvedValue([]);
        const req = buildReq({ bearerToken: USER_TOKEN } as Partial<Request>);
        const res = buildRes();

        await controller.getMyMeetingRegistrants(req, res, next);

        expect(res.json).toHaveBeenCalledWith([]);
        expect(req.bearerToken).toBe(USER_TOKEN);
      });

      it('restores the user bearer token when a privileged read throws', async () => {
        meetingSvc.getMeetingRegistrants.mockRejectedValue(new Error('upstream 503'));
        const req = buildReq({ bearerToken: USER_TOKEN } as Partial<Request>);

        await controller.getMyMeetingRegistrants(req, buildRes(), next);

        expect(next).toHaveBeenCalledWith(expect.any(Error));
        expect(req.bearerToken).toBe(USER_TOKEN);
      });

      it('deletes the token rather than leaving the M2M one when the request had none', async () => {
        // Anonymous-ish callers reach here with no bearer token at all. Assigning `undefined` back
        // would leave the key present, so the restore deletes it — assert the key itself is gone.
        const req = buildReq();

        await controller.getMyMeetingRegistrants(req, buildRes(), next);

        expect('bearerToken' in req).toBe(false);
      });
    });
  });

  // The one handler covered here that raises through `fromFieldErrors` rather than `forField`, which
  // is why it is tested at all: the two factories treat their `message` argument differently, and only
  // this one reports it as the error's own message. Without a case here the double is free to
  // hard-code a message the real class would never produce.
  describe('createMeetingRsvp', () => {
    it("reports the caller's own message when required RSVP fields are missing", async () => {
      const req = buildReq({ body: { scope: 'occurrence' } });

      await controller.createMeetingRsvp(req, buildRes(), next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'RSVP data validation failed',
          validationErrors: expect.arrayContaining([expect.objectContaining({ field: 'response', message: 'Response is required' })]),
        })
      );
      expect(meetingSvc.createMeetingRsvp).not.toHaveBeenCalled();
    });
  });
});
