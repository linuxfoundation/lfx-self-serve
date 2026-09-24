// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUsernameFromAuth } = vi.hoisted(() => ({ getUsernameFromAuth: vi.fn<() => Promise<string | null>>() }));
const {
  listClaGroups,
  getPdfUrl,
  getCclaPreview,
  getSignOptions,
  requestCorporateSignature,
  getApprovalList,
  updateApprovalList,
  updateEclaAutoCreate,
  checkAcs,
  getManagers,
  addManager,
  removeManager,
  getContributorAcknowledgments,
  invalidateAcknowledgment,
  getActivityLog,
} = vi.hoisted(() => ({
  listClaGroups: vi.fn(),
  getPdfUrl: vi.fn(),
  getCclaPreview: vi.fn(),
  getSignOptions: vi.fn(),
  requestCorporateSignature: vi.fn(),
  getApprovalList: vi.fn(),
  updateApprovalList: vi.fn(),
  updateEclaAutoCreate: vi.fn(),
  checkAcs: vi.fn(),
  getManagers: vi.fn(),
  addManager: vi.fn(),
  removeManager: vi.fn(),
  getContributorAcknowledgments: vi.fn(),
  invalidateAcknowledgment: vi.fn(),
  getActivityLog: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));
vi.mock('../services/org-cla.service', () => ({
  OrgClaService: class {
    public listClaGroups = listClaGroups;
    public getPdfUrl = getPdfUrl;
    public getCclaPreview = getCclaPreview;
    public getSignOptions = getSignOptions;
    public requestCorporateSignature = requestCorporateSignature;
    public getApprovalList = getApprovalList;
    public updateApprovalList = updateApprovalList;
    public updateEclaAutoCreate = updateEclaAutoCreate;
    public getManagers = getManagers;
    public addManager = addManager;
    public removeManager = removeManager;
    public getContributorAcknowledgments = getContributorAcknowledgments;
    public invalidateAcknowledgment = invalidateAcknowledgment;
    public getActivityLog = getActivityLog;
  },
}));
vi.mock('../services/org-cla-permissions.service', () => ({
  OrgClaPermissionsService: class {
    public check = checkAcs;
  },
}));
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/logger.service', () => ({ logger: loggerMock }));

import { ORG_CLA_AUTHORITY_NAME_MAX_LENGTH, ORG_CLA_AUTHORITY_NAME_MIN_LENGTH } from '@lfx-one/shared/constants';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgClasController } from './org-clas.controller';

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn(), setHeader: vi.fn() } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUsernameFromAuth.mockResolvedValue('alice');
});

describe('OrgClasController.listClaGroups', () => {
  it('returns 401 (via next) when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().listClaGroups({ params: { orgUid: '0014100000Te2ovAAB' }, query: {}, body: {} } as any, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(res.json).not.toHaveBeenCalled();
    expect(listClaGroups).not.toHaveBeenCalled();
  });

  it('never passes a client-supplied user id to the service', async () => {
    const response = { orgUid: '0014100000Te2ovAAB', claGroups: [] };
    listClaGroups.mockResolvedValue(response);
    const res = buildRes();
    const req = {
      params: { orgUid: '0014100000Te2ovAAB' },
      body: { userId: 'someone-else' },
      query: { userID: 'someone-else' },
    } as any;

    await new OrgClasController().listClaGroups(req, res, vi.fn());

    expect(listClaGroups).toHaveBeenCalledWith(req, '0014100000Te2ovAAB');
    expect(listClaGroups).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(response);
  });

  it('marks the response no-store, so the CLA list never lands in a shared cache', async () => {
    listClaGroups.mockResolvedValue({ orgUid: '0014100000Te2ovAAB', claGroups: [] });
    const res = buildRes();

    await new OrgClasController().listClaGroups({ params: { orgUid: '0014100000Te2ovAAB' }, query: {}, body: {} } as any, res, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});

describe('OrgClasController.getPdfUrl', () => {
  it('returns 401 when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getPdfUrl({ params: { orgUid: '0014100000Te2ovAAB', signatureId: 'signature-uuid-1' } } as any, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(getPdfUrl).not.toHaveBeenCalled();
  });

  it('rejects a blank signature id before calling the service', async () => {
    const { ServiceValidationError } = await import('../errors');
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getPdfUrl({ params: { orgUid: '0014100000Te2ovAAB', signatureId: '  ' } } as any, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(getPdfUrl).not.toHaveBeenCalled();
  });

  it('answers 404 when the service finds no document url', async () => {
    getPdfUrl.mockResolvedValue(null);
    const res = buildRes();

    await new OrgClasController().getPdfUrl({ params: { orgUid: '0014100000Te2ovAAB', signatureId: 'signature-uuid-1' } } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Signed document not found' });
    // The 404 is transient — it is also the answer while the document is not yet available — and
    // a 404 is heuristically cacheable, so a stored copy would outlive the condition.
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    // A handled outcome still closes the operation, or the endpoint's duration and completion
    // telemetry counts drift apart from its request count.
    expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'get_org_cla_pdf_url', expect.anything(), expect.objectContaining({ found: false }));
  });

  it('returns the url and marks the response no-store', async () => {
    getPdfUrl.mockResolvedValue({ url: 'https://s3.example.org/ccla.pdf', expiresInSeconds: 0 });
    const res = buildRes();
    const req = { params: { orgUid: '0014100000Te2ovAAB', signatureId: 'signature-uuid-1' } } as any;

    await new OrgClasController().getPdfUrl(req, res, vi.fn());

    // The grant-checked orgUid is forwarded, not dropped: it is what scopes the signature to the
    // caller's organization, so a controller that passed only the id would leave the path open.
    expect(getPdfUrl).toHaveBeenCalledWith(req, '0014100000Te2ovAAB', 'signature-uuid-1');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith({ url: 'https://s3.example.org/ccla.pdf', expiresInSeconds: 0 });
  });
});

describe('OrgClasController.getCclaPreview', () => {
  const CLA_GROUP_ID = '7f3a1c22-9d51-4a8e-b0c6-2e4f81d9a733';

  it('returns 401 when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getCclaPreview({ params: { orgUid: '0014100000Te2ovAAB', claGroupId: CLA_GROUP_ID } } as any, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(getCclaPreview).not.toHaveBeenCalled();
  });

  it('rejects a malformed CLA Group id before calling the service', async () => {
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getCclaPreview({ params: { orgUid: '0014100000Te2ovAAB', claGroupId: 'not-a-group-id' } } as any, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(getCclaPreview).not.toHaveBeenCalled();
  });

  it('streams the PDF as an attachment and marks the response no-store', async () => {
    const pdf = Buffer.from('%PDF-1.4 review-copy');
    getCclaPreview.mockResolvedValue(pdf);
    const res = buildRes();
    const req = { params: { orgUid: '0014100000Te2ovAAB', claGroupId: CLA_GROUP_ID } } as any;

    await new OrgClasController().getCclaPreview(req, res, vi.fn());

    expect(getCclaPreview).toHaveBeenCalledWith(req, CLA_GROUP_ID);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('Corporate_Contributor_License_Agreement.pdf'));
    expect(res.send).toHaveBeenCalledWith(pdf);
  });
});

// ---------------------------------------------------------------------------
// Corporate signing hand-off (#1983)
// ---------------------------------------------------------------------------

const ORG_UID = '0014100000Te2ovAAB';
const CLA_GROUP_ID = '7f3a1c22-9d51-4a8e-b0c6-2e4f81d9a733';
const PROJECT_SFID = 'a09410000182dD3AAI';

/** A request whose attestations are both genuinely affirmed. Cases override only what they test. */
function signReq(body: Record<string, unknown> = {}) {
  return {
    params: { orgUid: ORG_UID },
    query: {},
    body: { projectSfid: PROJECT_SFID, claGroupId: CLA_GROUP_ID, authorityAcked: true, embargoAcked: true, ...body },
  } as any;
}

/**
 * Runs the sign controller and returns what it rejected with.
 *
 * The rejections go to `next(error)` rather than to `res.status(400).json(...)`, so the shared
 * error handler owns the envelope and the severity — client input that fails validation is a
 * WARN, and logging it as an ERROR inflates the signal this service is watched by. Asserting
 * through `next` rather than through `res` is what keeps that true: a branch that answered
 * directly would leave `next` uncalled and fail here.
 */
async function rejectionOf(body: Record<string, unknown>): Promise<{ statusCode: number; code: string; response: Record<string, any> }> {
  const next = vi.fn();
  await new OrgClasController().requestCorporateSignature(signReq(body), buildRes(), next);

  const error = next.mock.calls[0]?.[0] as ServiceValidationError | undefined;
  expect(error, 'expected the controller to reject via next(error)').toBeInstanceOf(ServiceValidationError);

  return { statusCode: error!.statusCode, code: error!.code, response: error!.toResponse() };
}

describe('OrgClasController.getSignOptions', () => {
  it('returns 401 (via next) when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getSignOptions({ params: { orgUid: ORG_UID }, query: { search: 'nimbus' }, body: {} } as any, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(getSignOptions).not.toHaveBeenCalled();
  });

  it('answers a term below the minimum with an empty set rather than an error', async () => {
    const res = buildRes();

    await new OrgClasController().getSignOptions({ params: { orgUid: ORG_UID }, query: { search: 'ni' }, body: {} } as any, res, vi.fn());

    expect(getSignOptions).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ searchTerm: 'ni', resultCount: 0, truncated: false, results: [] });
  });

  it('trims the term before measuring it, so whitespace cannot buy the minimum', async () => {
    const res = buildRes();

    await new OrgClasController().getSignOptions({ params: { orgUid: ORG_UID }, query: { search: '  n  ' }, body: {} } as any, res, vi.fn());

    expect(getSignOptions).not.toHaveBeenCalled();
  });

  it('passes a searchable term through and answers with the envelope', async () => {
    getSignOptions.mockResolvedValue({ searchTerm: 'nimbus', resultCount: 1, truncated: false, results: [] });
    const res = buildRes();

    await new OrgClasController().getSignOptions({ params: { orgUid: ORG_UID }, query: { search: 'nimbus' }, body: {} } as any, res, vi.fn());

    expect(getSignOptions).toHaveBeenCalledWith(expect.anything(), 'nimbus');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});

/**
 * The attestation gate.
 *
 * These are the highest-value assertions in this feature. Every other failure it can have is
 * visible — a wrong URL, a missing field, a broken layout. This one is not: a request that
 * transmits an affirmation the signatory did not make succeeds at every layer and produces a
 * legally binding document, and nothing downstream can tell it apart from a genuine one.
 *
 * So the tests are written from the negative side. `false` surviving as `false` matters more
 * than `true` surviving as `true`, because the code that would break the first is the same
 * plausible-looking code — a literal, a default, a `??`, a truthiness check — that would let the
 * second keep passing.
 */
describe('OrgClasController.requestCorporateSignature — the attestations', () => {
  it('refuses when the authorization confirmation is false, and never calls upstream', async () => {
    expect((await rejectionOf({ authorityAcked: false })).statusCode).toBe(400);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  it('refuses when the compliance confirmation is false, and never calls upstream', async () => {
    expect((await rejectionOf({ embargoAcked: false })).statusCode).toBe(400);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  it('refuses when both are false', async () => {
    expect((await rejectionOf({ authorityAcked: false, embargoAcked: false })).statusCode).toBe(400);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  it('refuses when either is absent', async () => {
    expect((await rejectionOf({ authorityAcked: undefined })).statusCode).toBe(400);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  // The specific failure this guards: `Boolean(body.authorityAcked)` or `!!body.authorityAcked`
  // would accept every one of these and record an attestation nobody made.
  it.each([['true'], [1], [{}], [[]], ['yes']])('refuses the truthy non-boolean %p rather than coercing it', async (value) => {
    expect((await rejectionOf({ authorityAcked: value })).statusCode).toBe(400);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  // An operation opened and never terminated reads on a dashboard as a request still in flight.
  // The error handler is what terminates these now, so what this asserts is that the rejection
  // actually reaches it — a branch that answered on `res` directly would strand the operation.
  it.each([
    ['a withdrawn confirmation', { embargoAcked: false }],
    ['a missing project', { projectSfid: '' }],
    ['a malformed CLA group id', { claGroupId: 'not-a-uuid' }],
  ])('hands the rejection to the error handler when rejecting %s', async (_case, body) => {
    expect((await rejectionOf(body)).statusCode).toBe(400);
    expect(loggerMock.startOperation).toHaveBeenCalledTimes(1);
    // Not logged here at all: bad client input is not an operational error, and the handler
    // classifies a 400 as a warning. A `logger.error` on this path is the defect.
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  // A log line — and a response — is not a place to record a legal assertion. Naming which of the
  // two confirmations was withheld would record exactly that, so neither the value nor the field
  // is reported: the rejection is about the pair.
  it('says a confirmation is missing without saying which one, or what arrived instead', async () => {
    const { code, response } = await rejectionOf({ embargoAcked: 'yes please' });

    expect(code).toBe('VALIDATION_ERROR');
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('yes please');
    expect(serialized).not.toContain('embargoAcked');
    expect(serialized).not.toContain('authorityAcked');
    expect(response['error']).toBe('Both the authorization and compliance confirmations are required');
  });

  // The whole point of D: one envelope. Every rejection from this route carries the standard
  // `error` + `code` shape rather than the bare `{ message }` a direct `res.json` produced.
  it.each([
    ['a missing project', { projectSfid: '' }],
    ['a malformed CLA group id', { claGroupId: 'not-a-uuid' }],
    ['a withdrawn confirmation', { embargoAcked: false }],
  ])('answers %s in the standard error envelope', async (_case, body) => {
    const { response } = await rejectionOf(body);

    expect(response).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(typeof response['error']).toBe('string');
  });

  it('passes both confirmations through as the booleans that arrived, not as literals', async () => {
    requestCorporateSignature.mockResolvedValue({ signUrl: 'https://docusign.example.org/session/1' });
    const res = buildRes();

    await new OrgClasController().requestCorporateSignature(signReq(), res, vi.fn());

    // The whole request, not a subset: the service requires `projectSfid` and `claGroupId` too,
    // and a subset matcher cannot see a field that is absent.
    expect(requestCorporateSignature).toHaveBeenCalledWith(expect.anything(), ORG_UID, {
      projectSfid: PROJECT_SFID,
      claGroupId: CLA_GROUP_ID,
      authorityAcked: true,
      embargoAcked: true,
    });
  });
});

describe('OrgClasController.requestCorporateSignature — send-by-email (#2365)', () => {
  const named = {
    sendAsEmail: true,
    authorityName: 'Alex Contributor',
    authorityEmail: 'contributor@example.org',
    authorityAcked: false,
    embargoAcked: false,
  };

  it('forwards the named signatory and does not require the two confirmations', async () => {
    requestCorporateSignature.mockResolvedValue({ signUrl: '', signatureId: '' });
    const res = buildRes();

    await new OrgClasController().requestCorporateSignature(signReq(named), res, vi.fn());

    expect(requestCorporateSignature).toHaveBeenCalledWith(expect.anything(), ORG_UID, {
      projectSfid: PROJECT_SFID,
      claGroupId: CLA_GROUP_ID,
      sendAsEmail: true,
      authorityName: 'Alex Contributor',
      authorityEmail: 'contributor@example.org',
    });
  });

  it('does not pass the two confirmations even when the body sent them as true', async () => {
    requestCorporateSignature.mockResolvedValue({ signUrl: '', signatureId: '' });
    const res = buildRes();

    await new OrgClasController().requestCorporateSignature(signReq({ ...named, authorityAcked: true, embargoAcked: true }), res, vi.fn());

    const forwarded = requestCorporateSignature.mock.calls[0][2] as Record<string, unknown>;
    expect(forwarded).not.toHaveProperty('authorityAcked');
    expect(forwarded).not.toHaveProperty('embargoAcked');
  });

  it('refuses a missing name or a non-email address, and never calls upstream', async () => {
    expect((await rejectionOf({ ...named, authorityName: '   ' })).statusCode).toBe(400);
    expect((await rejectionOf({ ...named, authorityEmail: 'not-an-email' })).statusCode).toBe(400);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  it('refuses a non-string name or email rather than String()-ing it', async () => {
    expect((await rejectionOf({ ...named, authorityName: { given: 'Alex' } })).statusCode).toBe(400);
    expect((await rejectionOf({ ...named, authorityEmail: ['contributor@example.org'] })).statusCode).toBe(400);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  it('names the length limit when the signatory name is too long', async () => {
    const { statusCode, response } = await rejectionOf({
      ...named,
      authorityName: 'A'.repeat(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH + 1),
    });

    expect(statusCode).toBe(400);
    expect(JSON.stringify(response)).toContain(`${ORG_CLA_AUTHORITY_NAME_MAX_LENGTH} characters or fewer`);
    expect(JSON.stringify(response)).not.toContain('A name and email address are required');
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  /**
   * The producer declares `authority_name` `minLength: 2` but its handler only refuses a blank, so
   * a single character is rejected above it by generated request validation — at a status this
   * boundary does not relabel. The body is dropped and the dialog shows its generic failure copy,
   * which tells the manager nothing about which field to change.
   */
  it('names the minimum when the signatory name is one character', async () => {
    const { statusCode, response } = await rejectionOf({ ...named, authorityName: 'A' });

    expect(statusCode).toBe(400);
    expect(JSON.stringify(response)).toContain(`at least ${ORG_CLA_AUTHORITY_NAME_MIN_LENGTH} characters`);
    // Asserted alongside: the blank gate answers 400 too, so the status alone would not show
    // which check refused, and the blank message names both fields rather than the one at fault.
    expect(JSON.stringify(response)).not.toContain('A name and email address are required');
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  it('measures the minimum after trimming, so a space cannot buy the second character', async () => {
    expect((await rejectionOf({ ...named, authorityName: 'A ' })).statusCode).toBe(400);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  /**
   * The producer counts runes (go-openapi's `MinLength` uses `utf8.RuneCount`), so `𠮷` is one
   * character upstream and two UTF-16 units in JavaScript. A `String.length` check would pass it
   * here and let upstream answer the rejection this gate exists to pre-empt.
   */
  it('refuses a single non-BMP code point, which upstream counts as one character', async () => {
    expect((await rejectionOf({ ...named, authorityName: '𠮷' })).statusCode).toBe(400);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  it('accepts a two-code-point non-BMP name', async () => {
    requestCorporateSignature.mockResolvedValue({ signUrl: 'https://docusign.example.org/1' });
    const next = vi.fn();

    await new OrgClasController().requestCorporateSignature(signReq({ ...named, authorityName: '𠮷𠮷' }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(requestCorporateSignature).toHaveBeenCalledTimes(1);
  });

  /**
   * The producer's email pattern caps the TLD at ten letters and leaves `'` out of the local part.
   * Mirroring it would refuse these as a Self Serve validation error for a constraint that belongs
   * upstream, so the shape check stays deliberately looser than the producer's.
   */
  it('passes addresses the producer pattern would refuse, rather than owning that constraint', async () => {
    const next = vi.fn();

    for (const authorityEmail of ["o'brien@example.org", 'signatory@example.international']) {
      requestCorporateSignature.mockResolvedValue({ signUrl: 'https://docusign.example.org/1' });

      await new OrgClasController().requestCorporateSignature(signReq({ ...named, authorityEmail }), buildRes(), next);
    }

    expect(next).not.toHaveBeenCalled();
    expect(requestCorporateSignature).toHaveBeenCalledTimes(2);
  });
});

describe('OrgClasController.requestCorporateSignature', () => {
  it('returns 401 (via next) when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().requestCorporateSignature(signReq(), res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  it('rejects a missing project identifier before calling upstream', async () => {
    expect((await rejectionOf({ projectSfid: '   ' })).statusCode).toBe(400);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  // Shape-checked, not just non-empty. A malformed identifier that only fails an emptiness test
  // reaches EasyCLA's project-and-organization authorization check and returns as a 403 — which
  // this route relays in the producer's words, so the signatory is told their signing authority
  // was refused when the real fault was a bad request this boundary could have named.
  it.each([['nimbus'], ['not a salesforce id'], ['a0941000002wBz2AAE-extra'], ['../../etc/passwd']])(
    'rejects a malformed project identifier %p before calling upstream',
    async (projectSfid) => {
      expect((await rejectionOf({ projectSfid })).statusCode).toBe(400);
      expect(requestCorporateSignature).not.toHaveBeenCalled();
    }
  );

  it('rejects a CLA group identifier that is not a UUID', async () => {
    expect((await rejectionOf({ claGroupId: 'nimbus-foundation' })).statusCode).toBe(400);
    expect(requestCorporateSignature).not.toHaveBeenCalled();
  });

  // The organization is the grant-checked path segment. A body that names a different one is
  // ignored rather than honoured — otherwise the path parameter is decorative and any viewer with
  // org-lens access anywhere could open a signing session against another company.
  it('takes the organization from the path, ignoring one supplied in the body', async () => {
    requestCorporateSignature.mockResolvedValue({ signUrl: 'https://docusign.example.org/session/1' });
    const res = buildRes();

    await new OrgClasController().requestCorporateSignature(signReq({ companySfid: '0014100000OtherAAA', orgUid: '0014100000OtherAAA' }), res, vi.fn());

    expect(requestCorporateSignature).toHaveBeenCalledWith(expect.anything(), ORG_UID, expect.anything());
  });

  it('answers with the signing session and forbids caching it', async () => {
    requestCorporateSignature.mockResolvedValue({ signUrl: 'https://docusign.example.org/session/1' });
    const res = buildRes();

    await new OrgClasController().requestCorporateSignature(signReq(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ signUrl: 'https://docusign.example.org/session/1' });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('passes an upstream failure to the error handler rather than answering', async () => {
    requestCorporateSignature.mockRejectedValue(new Error('upstream refused'));
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().requestCorporateSignature(signReq(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Approval list (#1985)
function approvalReq(body?: unknown) {
  return { params: { orgUid: ORG_UID, signatureId: 'signature-uuid-1' }, body, query: {} } as any;
}

describe('OrgClasController.getApprovalList', () => {
  it('returns 401 when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getApprovalList(approvalReq(), res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(getApprovalList).not.toHaveBeenCalled();
  });

  it('rejects a blank signature id before reaching the service', async () => {
    const { ServiceValidationError } = await import('../errors');
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getApprovalList({ params: { orgUid: ORG_UID, signatureId: '  ' }, query: {} } as any, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(getApprovalList).not.toHaveBeenCalled();
  });

  it('forwards the grant-checked orgUid alongside the signature id', async () => {
    getApprovalList.mockResolvedValue({ signatureId: 'signature-uuid-1', entries: [], canEdit: true });
    const res = buildRes();
    const req = approvalReq();

    await new OrgClasController().getApprovalList(req, res, vi.fn());

    // Dropping the orgUid would leave the signature id alone selecting the list, which is what
    // scopes it to the caller's organization.
    expect(getApprovalList).toHaveBeenCalledWith(req, ORG_UID, 'signature-uuid-1');
  });

  // The body is an organization's approval rules — contributor addresses and domains — and the
  // `canEdit` flag is per-caller, so one viewer's answer must never be replayed to another.
  it('marks the response no-store', async () => {
    getApprovalList.mockResolvedValue({ signatureId: 'signature-uuid-1', entries: [], canEdit: true });
    const res = buildRes();

    await new OrgClasController().getApprovalList(approvalReq(), res, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('answers 404 when the signature is not on the organization list', async () => {
    getApprovalList.mockResolvedValue(null);
    const res = buildRes();

    await new OrgClasController().getApprovalList(approvalReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'CLA agreement not found' });
    // A 404 is heuristically cacheable, so the header has to be set ahead of the branch or a
    // stored copy would outlive the condition.
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    // A handled outcome still closes the operation, or the endpoint's duration and completion
    // telemetry counts drift apart from its request count.
    expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'get_org_cla_approval_list', expect.anything(), expect.objectContaining({ found: false }));
  });

  it('returns the list upstream resolved', async () => {
    const list = { signatureId: 'signature-uuid-1', entries: [{ kind: 'domain', value: 'example.com' }], canEdit: false };
    getApprovalList.mockResolvedValue(list);
    const res = buildRes();

    await new OrgClasController().getApprovalList(approvalReq(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(list);
  });
});

/**
 * Contributor Acknowledgments read (#1986). The route guard is asserted in the router spec; this
 * layer's job is to translate query parameters correctly, clamp the page size before it reaches
 * the producer, and answer 404 for a signature this organization does not hold.
 */
function ackReq(query: Record<string, string> = {}, params: Record<string, string> = {}) {
  return { params: { orgUid: ORG_UID, signatureId: 'signature-uuid-1', ...params }, query, body: undefined } as any;
}

function ackList(overrides: Record<string, unknown> = {}) {
  return { signatureId: 'signature-uuid-1', list: [], canEdit: true, resultCount: 0, totalCount: 0, nextKey: null, ...overrides };
}

describe('OrgClasController.getContributorAcknowledgments', () => {
  it('returns 401 when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getContributorAcknowledgments(ackReq(), res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(getContributorAcknowledgments).not.toHaveBeenCalled();
  });

  it('rejects a blank signature id before reaching the service', async () => {
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getContributorAcknowledgments(ackReq({}, { signatureId: '  ' }), res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(getContributorAcknowledgments).not.toHaveBeenCalled();
  });

  it('forwards the trimmed search term to the service so filtering is server-side, not client-side', async () => {
    getContributorAcknowledgments.mockResolvedValue(ackList());
    const req = ackReq({ search: '  ahmed  ' });

    await new OrgClasController().getContributorAcknowledgments(req, buildRes(), vi.fn());

    // A search that only lived on the browser would filter the already-loaded page and silently
    // miss every match on the pages that follow.
    expect(getContributorAcknowledgments).toHaveBeenCalledWith(req, ORG_UID, 'signature-uuid-1', expect.objectContaining({ search: 'ahmed' }));
  });

  it('forwards a non-empty nextKey to the service, and drops an empty one', async () => {
    getContributorAcknowledgments.mockResolvedValue(ackList());

    await new OrgClasController().getContributorAcknowledgments(ackReq({ nextKey: 'cursor-xyz' }), buildRes(), vi.fn());
    expect(getContributorAcknowledgments).toHaveBeenLastCalledWith(
      expect.anything(),
      ORG_UID,
      'signature-uuid-1',
      expect.objectContaining({ nextKey: 'cursor-xyz' })
    );

    await new OrgClasController().getContributorAcknowledgments(ackReq({ nextKey: '   ' }), buildRes(), vi.fn());
    expect(getContributorAcknowledgments).toHaveBeenLastCalledWith(
      expect.anything(),
      ORG_UID,
      'signature-uuid-1',
      expect.objectContaining({ nextKey: undefined })
    );
  });

  it('clamps pageSize to the producer-safe range', async () => {
    getContributorAcknowledgments.mockResolvedValue(ackList());

    // Above the ceiling — a request the producer would reject with 400 becomes a silent 100.
    await new OrgClasController().getContributorAcknowledgments(ackReq({ pageSize: '5000' }), buildRes(), vi.fn());
    expect(getContributorAcknowledgments).toHaveBeenLastCalledWith(expect.anything(), ORG_UID, 'signature-uuid-1', expect.objectContaining({ pageSize: 100 }));

    // Zero would runaway-loop upstream — clamped to 1.
    await new OrgClasController().getContributorAcknowledgments(ackReq({ pageSize: '0' }), buildRes(), vi.fn());
    expect(getContributorAcknowledgments).toHaveBeenLastCalledWith(expect.anything(), ORG_UID, 'signature-uuid-1', expect.objectContaining({ pageSize: 1 }));

    // A non-numeric hint is treated as "give me the default", not a 400.
    await new OrgClasController().getContributorAcknowledgments(ackReq({ pageSize: 'many' }), buildRes(), vi.fn());
    expect(getContributorAcknowledgments).toHaveBeenLastCalledWith(expect.anything(), ORG_UID, 'signature-uuid-1', expect.objectContaining({ pageSize: 50 }));
  });

  it('answers 404 when the signature is not on the organization list', async () => {
    getContributorAcknowledgments.mockResolvedValue(null);
    const res = buildRes();

    await new OrgClasController().getContributorAcknowledgments(ackReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    // A 404 is heuristically cacheable, so the header is set ahead of the branch or a stored copy
    // outlives the condition.
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  // The body carries every listed contributor's identity attributes and a per-caller `canEdit`
  // flag, so a shared cache must not hold it.
  it('marks the response no-store', async () => {
    getContributorAcknowledgments.mockResolvedValue(ackList());
    const res = buildRes();

    await new OrgClasController().getContributorAcknowledgments(ackReq(), res, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});

/**
 * The delta arrives from a browser, so every part of it is untrusted. Validation lives here rather
 * than in the service because these are malformed *requests* — a 400 naming the offending entry is
 * the answer, and the producer's own 400 arrives as one joined sentence about every failure at
 * once, which cannot be pointed at a form field.
 */
describe('OrgClasController.updateApprovalList — rejecting a malformed delta', () => {
  async function reject(body: unknown): Promise<{ status: number; message: string }> {
    const res = buildRes();
    await new OrgClasController().updateApprovalList(approvalReq(body), res, vi.fn());

    return { status: res.status.mock.calls[0]?.[0], message: res.json.mock.calls[0]?.[0]?.message };
  }

  it('returns 401 when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().updateApprovalList(approvalReq({ add: [], remove: [] }), res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(updateApprovalList).not.toHaveBeenCalled();
  });

  it('rejects a blank signature id before reaching the service', async () => {
    const { ServiceValidationError } = await import('../errors');
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().updateApprovalList({ params: { orgUid: ORG_UID, signatureId: '  ' }, body: {} } as any, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(updateApprovalList).not.toHaveBeenCalled();
  });

  // The producer answers 400 "missing approval list items" for this. Answered here so the copy is
  // usable and the round trip is not spent to learn that nothing changed.
  it('rejects a delta that would change nothing', async () => {
    expect(await reject({ add: [], remove: [] })).toEqual({ status: 400, message: 'Provide at least one entry to add or remove' });
  });

  it('rejects an entry that appears on both sides of the same change', async () => {
    expect(
      await reject({
        add: [{ kind: 'email', value: 'Contributor@example.com' }],
        remove: [{ kind: 'email', value: 'contributor@example.com' }],
      })
    ).toEqual({ status: 400, message: 'The same entry cannot be added and removed in one change' });
  });

  it('rejects a body with neither side present', async () => {
    expect((await reject({})).status).toBe(400);
  });

  it('rejects a missing body rather than throwing on it', async () => {
    expect((await reject(undefined)).status).toBe(400);
  });

  it('rejects a side that is not an array, naming which one', async () => {
    expect(await reject({ add: 'example.com' })).toEqual({ status: 400, message: '"add" must be an array of approval list entries' });
    expect(await reject({ remove: { kind: 'domain' } })).toEqual({ status: 400, message: '"remove" must be an array of approval list entries' });
  });

  it('rejects an unknown criteria type', async () => {
    expect(await reject({ add: [{ kind: 'bitbucket-user', value: 'someone' }] })).toEqual({
      status: 400,
      message: 'Each approval list entry needs a known criteria type',
    });
  });

  it('rejects an entry with no criteria type', async () => {
    expect((await reject({ add: [{ value: 'example.com' }] })).status).toBe(400);
  });

  it('rejects a null entry', async () => {
    expect((await reject({ add: [null] })).status).toBe(400);
  });

  // Nothing is coerced: `String({})` is `"[object Object]"`, which would sail past a blank check
  // and then be stored as an approval rule that can never match anybody.
  it('rejects a non-string value rather than coercing it', async () => {
    expect(await reject({ add: [{ kind: 'domain', value: { toString: () => 'example.com' } }] })).toEqual({
      status: 400,
      message: 'Each approval list entry needs a text value',
    });
    expect((await reject({ add: [{ kind: 'domain', value: 42 }] })).status).toBe(400);
    expect((await reject({ add: [{ kind: 'domain', value: null }] })).status).toBe(400);
  });

  it('rejects a blank value', async () => {
    expect((await reject({ add: [{ kind: 'domain', value: '   ' }] })).status).toBe(400);
  });

  it('rejects a value the producer would refuse, carrying the reason', async () => {
    expect(await reject({ add: [{ kind: 'email', value: 'not-an-email' }] })).toEqual({
      status: 400,
      message: 'invalid approval list email not-an-email',
    });
  });

  // The producer validates removals by the same rules as additions and rejects the whole request
  // if one fails, so the remove side cannot be waved through.
  it('validates the remove side as strictly as the add side', async () => {
    expect((await reject({ add: [], remove: [{ kind: 'email', value: 'not-an-email' }] })).status).toBe(400);
  });

  // A cap the producer does not have. It exists because every removal invalidates the
  // acknowledgements that matched the removed rule, synchronously and without a reported count —
  // so an unbounded delta is an unbounded amount of irreversible work in one request.
  it('rejects a delta larger than the cap, counting both sides together', async () => {
    const add = Array.from({ length: 60 }, (_, index) => ({ kind: 'email', value: `user${index}@example.com` }));
    const remove = Array.from({ length: 60 }, (_, index) => ({ kind: 'domain', value: `d${index}.example.com` }));

    expect(await reject({ add, remove })).toEqual({ status: 400, message: 'A single change may cover at most 100 entries' });
  });

  it('allows the same value on both sides when the criteria types differ', async () => {
    updateApprovalList.mockResolvedValue({ outcome: 'updated', list: { signatureId: 'signature-uuid-1', entries: [], canEdit: true } });
    const res = buildRes();

    await new OrgClasController().updateApprovalList(
      approvalReq({
        add: [{ kind: 'github-username', value: 'octocat' }],
        remove: [{ kind: 'gitlab-username', value: 'octocat' }],
      }),
      res,
      vi.fn()
    );

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(updateApprovalList).toHaveBeenCalled();
  });

  it('accepts a delta at exactly the cap', async () => {
    updateApprovalList.mockResolvedValue({ outcome: 'updated', list: { signatureId: 'signature-uuid-1', entries: [], canEdit: true } });
    const add = Array.from({ length: 100 }, (_, index) => ({ kind: 'email', value: `user${index}@example.com` }));
    const res = buildRes();

    await new OrgClasController().updateApprovalList(approvalReq({ add, remove: [] }), res, vi.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(updateApprovalList).toHaveBeenCalled();
  });

  it('reaches the service for none of the rejected deltas', async () => {
    await reject({ add: [{ kind: 'email', value: 'not-an-email' }] });

    expect(updateApprovalList).not.toHaveBeenCalled();
  });
});

describe('OrgClasController.updateApprovalList — applying the delta', () => {
  const UPDATED = { outcome: 'updated', list: { signatureId: 'signature-uuid-1', entries: [{ kind: 'domain', value: 'example.com' }], canEdit: true } };

  it('forwards the trimmed delta and the grant-checked orgUid', async () => {
    updateApprovalList.mockResolvedValue(UPDATED);
    const res = buildRes();
    const req = approvalReq({ add: [{ kind: 'domain', value: '  example.com  ' }], remove: [] });

    await new OrgClasController().updateApprovalList(req, res, vi.fn());

    expect(updateApprovalList).toHaveBeenCalledWith(req, ORG_UID, 'signature-uuid-1', { add: [{ kind: 'domain', value: 'example.com' }], remove: [] });
  });

  it('forwards an absent side as an empty array, so the service takes no undefined', async () => {
    updateApprovalList.mockResolvedValue(UPDATED);
    const res = buildRes();

    await new OrgClasController().updateApprovalList(approvalReq({ add: [{ kind: 'domain', value: 'example.com' }] }), res, vi.fn());

    expect(updateApprovalList).toHaveBeenCalledWith(expect.anything(), ORG_UID, 'signature-uuid-1', {
      add: [{ kind: 'domain', value: 'example.com' }],
      remove: [],
    });
  });

  it('returns the updated list and marks it no-store', async () => {
    updateApprovalList.mockResolvedValue(UPDATED);
    const res = buildRes();

    await new OrgClasController().updateApprovalList(approvalReq({ add: [{ kind: 'domain', value: 'example.com' }], remove: [] }), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(UPDATED.list);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('answers 404 when the signature is not on the organization list', async () => {
    updateApprovalList.mockResolvedValue({ outcome: 'not-found' });
    const res = buildRes();

    await new OrgClasController().updateApprovalList(approvalReq({ add: [{ kind: 'domain', value: 'example.com' }], remove: [] }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'CLA agreement not found' });
  });

  // 400 rather than 404: the agreement exists, and saying "not found" would send a CLA manager
  // looking for a missing agreement instead of telling them it is unsigned.
  it('answers 400 with its own copy for an unsigned agreement', async () => {
    updateApprovalList.mockResolvedValue({ outcome: 'not-signed' });
    const res = buildRes();

    await new OrgClasController().updateApprovalList(approvalReq({ add: [{ kind: 'domain', value: 'example.com' }], remove: [] }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'This CLA has not been signed yet, so it has no approval list to change' });
  });

  it('answers 403 when the caller is not a CLA manager on the agreement', async () => {
    updateApprovalList.mockResolvedValue({ outcome: 'forbidden' });
    const res = buildRes();

    await new OrgClasController().updateApprovalList(approvalReq({ add: [{ kind: 'domain', value: 'example.com' }], remove: [] }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Only a CLA manager named on this CLA can change its approval list' });
  });

  it('logs how many entries each side carried, so an invalidating change is auditable', async () => {
    updateApprovalList.mockResolvedValue(UPDATED);
    const res = buildRes();

    await new OrgClasController().updateApprovalList(
      approvalReq({ add: [{ kind: 'domain', value: 'new.example.com' }], remove: [{ kind: 'domain', value: 'old.example.com' }] }),
      res,
      vi.fn()
    );

    expect(logger.success).toHaveBeenCalledWith(
      expect.anything(),
      'update_org_cla_approval_list',
      expect.anything(),
      expect.objectContaining({ added: 1, removed: 1 })
    );
  });

  it('hands an upstream failure to the error handler rather than answering it', async () => {
    updateApprovalList.mockRejectedValue(new Error('upstream exploded'));
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().updateApprovalList(approvalReq({ add: [{ kind: 'domain', value: 'example.com' }], remove: [] }), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.json).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Auto ECLA toggle (#1988)
//
// The handler uses `requireAgreementContext`, which enforces a UUID-shaped signatureId. The
// shared `approvalReq` helper uses `signature-uuid-1` — fine for `updateApprovalList` (which does
// only a `.trim()` check), but rejected as a validation error here before the service is called.
// A local helper carries a real UUID so these tests exercise the write path rather than the guard.
// ---------------------------------------------------------------------------

function autoEclaReq(body?: unknown, signatureId = '0f9b8c7d-1234-4abc-89de-0123456789ab') {
  return { params: { orgUid: ORG_UID, signatureId }, body, query: {} } as any;
}

describe('OrgClasController.updateEclaAutoCreate — validating the body', () => {
  it('rejects a missing body with 400', async () => {
    const res = buildRes();

    await new OrgClasController().updateEclaAutoCreate(autoEclaReq({}), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Body must include boolean "autoCreateEcla"' });
    expect(updateEclaAutoCreate).not.toHaveBeenCalled();
  });

  it('rejects a stringified boolean rather than coercing it, so "false" cannot turn the toggle on', async () => {
    const res = buildRes();

    await new OrgClasController().updateEclaAutoCreate(autoEclaReq({ autoCreateEcla: 'false' }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(updateEclaAutoCreate).not.toHaveBeenCalled();
  });

  it('rejects a numeric value rather than coercing it, so 0 cannot flip the flag', async () => {
    const res = buildRes();

    await new OrgClasController().updateEclaAutoCreate(autoEclaReq({ autoCreateEcla: 0 }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(updateEclaAutoCreate).not.toHaveBeenCalled();
  });
});

describe('OrgClasController.updateEclaAutoCreate — applying the write', () => {
  const SIGNATURE_UUID = '0f9b8c7d-1234-4abc-89de-0123456789ab';

  it('forwards the target state and the grant-checked orgUid, and echoes the new value back', async () => {
    updateEclaAutoCreate.mockResolvedValue({ outcome: 'updated', autoCreateEcla: true });
    const res = buildRes();
    const req = autoEclaReq({ autoCreateEcla: true }, SIGNATURE_UUID);

    await new OrgClasController().updateEclaAutoCreate(req, res, vi.fn());

    expect(updateEclaAutoCreate).toHaveBeenCalledWith(req, ORG_UID, SIGNATURE_UUID, true);
    expect(res.json).toHaveBeenCalledWith({ autoCreateEcla: true });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('answers 404 when the signature is not on the organization list', async () => {
    updateEclaAutoCreate.mockResolvedValue({ outcome: 'not-found' });
    const res = buildRes();

    await new OrgClasController().updateEclaAutoCreate(autoEclaReq({ autoCreateEcla: true }, SIGNATURE_UUID), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'CLA agreement not found' });
  });

  it('answers 400 with its own copy for an unsigned agreement', async () => {
    updateEclaAutoCreate.mockResolvedValue({ outcome: 'not-signed' });
    const res = buildRes();

    await new OrgClasController().updateEclaAutoCreate(autoEclaReq({ autoCreateEcla: true }, SIGNATURE_UUID), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'This CLA has not been signed yet, so its Auto ECLA setting cannot be changed' });
  });

  it('hands an upstream failure to the error handler rather than answering it', async () => {
    updateEclaAutoCreate.mockRejectedValue(new Error('upstream exploded'));
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().updateEclaAutoCreate(autoEclaReq({ autoCreateEcla: true }, SIGNATURE_UUID), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('OrgClasController.checkPermission', () => {
  const ORG = '0014100000Te2ovAAB';
  const PROJECT = 'a09410000182dD2AAI';

  function req(body: unknown) {
    return { params: { orgUid: ORG }, body, query: {} } as any;
  }

  it('answers 400 for an unknown action rather than interpolating it', async () => {
    const res = buildRes();

    await new OrgClasController().checkPermission(req({ action: 'self_serve_request_corporate_signature:create' }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(checkAcs).not.toHaveBeenCalled();
  });

  it('passes the path org and typed action, never a client-supplied company id', async () => {
    checkAcs.mockResolvedValue(true);
    const res = buildRes();

    await new OrgClasController().checkPermission(req({ action: 'sign', projectSfid: PROJECT, companySfid: '0014100000OtherOrgAA' }), res, vi.fn());

    expect(checkAcs).toHaveBeenCalledWith(expect.anything(), ORG, 'sign', PROJECT);
    expect(res.json).toHaveBeenCalledWith({ allowed: true });
  });

  it('returns allowed false when ACS denies, as 200', async () => {
    checkAcs.mockResolvedValue(false);
    const res = buildRes();

    await new OrgClasController().checkPermission(req({ action: 'approval-list-update', projectSfid: PROJECT }), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ allowed: false });
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('accepts the manager-delete action the Managers tab uses', async () => {
    checkAcs.mockResolvedValue(true);
    const res = buildRes();

    await new OrgClasController().checkPermission(req({ action: 'cla-manager-delete', projectSfid: PROJECT }), res, vi.fn());

    expect(checkAcs).toHaveBeenCalledWith(expect.anything(), ORG, 'cla-manager-delete', PROJECT);
    expect(res.json).toHaveBeenCalledWith({ allowed: true });
  });

  // The Overview toggle uses the ACS hop before rendering (#1988), so the typed action has to
  // be accepted here. Without this a viewer who legitimately holds the grant would still see the
  // toggle hidden — the check fails-closed at 400.
  it('accepts the auto-ecla-update action the Overview toggle uses', async () => {
    checkAcs.mockResolvedValue(true);
    const res = buildRes();

    await new OrgClasController().checkPermission(req({ action: 'auto-ecla-update', projectSfid: PROJECT }), res, vi.fn());

    expect(checkAcs).toHaveBeenCalledWith(expect.anything(), ORG, 'auto-ecla-update', PROJECT);
    expect(res.json).toHaveBeenCalledWith({ allowed: true });
  });
});

describe('OrgClasController — CLA manager path parameters', () => {
  const ORG_UID = '0014100000Te2ovAAB';
  const SIGNATURE_ID = '0f9b8c7d-1234-4abc-89de-0123456789ab';

  it('rejects a signature id that is not UUID-shaped before calling the service', async () => {
    const { ServiceValidationError } = await import('../errors');
    const next = vi.fn();

    await new OrgClasController().listManagers({ params: { orgUid: ORG_UID, signatureId: '../../admin' } } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(getManagers).not.toHaveBeenCalled();
  });

  it('rejects an LF username that can walk out of the path segment before calling the service', async () => {
    const { ServiceValidationError } = await import('../errors');
    const next = vi.fn();

    await new OrgClasController().removeManager(
      { params: { orgUid: ORG_UID, signatureId: SIGNATURE_ID, lfUsername: 'a porter/../..' } } as any,
      buildRes(),
      next
    );

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(removeManager).not.toHaveBeenCalled();
  });

  it('answers 404 when the agreement is not on this organization list', async () => {
    getManagers.mockResolvedValue(null);
    const res = buildRes();

    await new OrgClasController().listManagers({ params: { orgUid: ORG_UID, signatureId: SIGNATURE_ID } } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'list_org_cla_managers', expect.anything(), expect.objectContaining({ found: false }));
  });

  it('answers a removal with 204 and no body', async () => {
    removeManager.mockResolvedValue(true);
    const res = buildRes();

    await new OrgClasController().removeManager({ params: { orgUid: ORG_UID, signatureId: SIGNATURE_ID, lfUsername: 'aporter' } } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.json).not.toHaveBeenCalled();
  });

  it.each(['john.doe', 'ab'])('forwards an EasyCLA LF username %s to the service', async (lfUsername) => {
    removeManager.mockResolvedValue(true);
    const res = buildRes();

    await new OrgClasController().removeManager({ params: { orgUid: ORG_UID, signatureId: SIGNATURE_ID, lfUsername } } as any, res, vi.fn());

    expect(removeManager).toHaveBeenCalledWith(expect.anything(), ORG_UID, SIGNATURE_ID, lfUsername);
  });

  it.each(['.', '..'])('rejects a dot-segment LF username %s before calling the service', async (lfUsername) => {
    const next = vi.fn();

    await new OrgClasController().removeManager({ params: { orgUid: ORG_UID, signatureId: SIGNATURE_ID, lfUsername } } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(removeManager).not.toHaveBeenCalled();
  });
});

/**
 * Invalidate one contributor acknowledgment (#2807).
 *
 * The controller's own job is the untrusted body and the outcome→status mapping. Authorization
 * lives in front of it (`blockDuringImpersonation` then `requireOrgLensAccess`, asserted in the
 * route spec) and beneath it (the roster gate and the ownership verify, asserted in the service
 * spec) — so nothing here can stand in for either.
 */
describe('OrgClasController.invalidateAcknowledgment', () => {
  const ORG = '0014100000Te2ovAAB';

  const SIGNATURE_ID = '11111111-1111-4111-8111-111111111111';
  const ACK_ID = '22222222-2222-4222-8222-222222222222';

  function invalidateReq(body: unknown = {}, params: Record<string, string> = {}): any {
    return {
      params: { orgUid: ORG, signatureId: SIGNATURE_ID, acknowledgmentSignatureId: ACK_ID, ...params },
      query: {},
      body,
    };
  }

  beforeEach(() => {
    invalidateAcknowledgment.mockResolvedValue({ outcome: 'invalidated', result: { signatureId: 'ecla-sig-1' } });
  });

  it('returns 401 (via next) when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq(), res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(invalidateAcknowledgment).not.toHaveBeenCalled();
  });

  it('rejects a missing acknowledgment id rather than addressing the producer with an empty segment', async () => {
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq({}, { acknowledgmentSignatureId: '  ' }), res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(invalidateAcknowledgment).not.toHaveBeenCalled();
  });

  it('rejects an acknowledgment id that is not a signature uuid', async () => {
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq({}, { acknowledgmentSignatureId: 'not-a-uuid' }), res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(invalidateAcknowledgment).not.toHaveBeenCalled();
  });

  /**
   * The reason is a four-value enum on the producer's contract. Refusing an unknown value here
   * rather than forwarding it means the CLA manager gets copy the tab can render, instead of the
   * producer's own validation wording arriving through a 400 the tab has to guess at.
   */
  it('refuses a reason the producer does not define, without calling the service', async () => {
    const res = buildRes();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq({ reason: 'because-i-said-so' }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(invalidateAcknowledgment).not.toHaveBeenCalled();
  });

  it('accepts each reason the producer defines', async () => {
    for (const reason of ['signed-in-error', 'should-be-corporate', 'compliance', 'other']) {
      invalidateAcknowledgment.mockClear();
      await new OrgClasController().invalidateAcknowledgment(invalidateReq({ reason }), buildRes(), vi.fn());

      expect(invalidateAcknowledgment).toHaveBeenCalledWith(expect.anything(), ORG, SIGNATURE_ID, ACK_ID, { reason });
    }
  });

  /**
   * Refused, not truncated. The note is written to a legal audit trail, and a note silently cut
   * at the cap is recorded as something the CLA manager did not write.
   */
  it('refuses a note past the producer cap rather than truncating it', async () => {
    const res = buildRes();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq({ note: 'x'.repeat(2049) }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(invalidateAcknowledgment).not.toHaveBeenCalled();
  });

  it('accepts a note exactly at the cap', async () => {
    const res = buildRes();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq({ note: 'x'.repeat(2048) }), res, vi.fn());

    expect(invalidateAcknowledgment).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  /**
   * The producer counts runes. 2,048 non-BMP characters are 4,096 UTF-16 units, so a `.length`
   * check would refuse a note the producer accepts.
   */
  it('accepts a note of 2048 code points that a UTF-16 count would refuse', async () => {
    const note = '𠮷'.repeat(2048);
    expect(note.length).toBe(4096);
    const res = buildRes();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq({ note }), res, vi.fn());

    expect(invalidateAcknowledgment).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  it('refuses a note of 2049 code points', async () => {
    const res = buildRes();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq({ note: '𠮷'.repeat(2049) }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(invalidateAcknowledgment).not.toHaveBeenCalled();
  });

  it('drops a non-string note rather than passing it to the producer', async () => {
    const res = buildRes();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq({ note: { toString: 'nope' } }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(invalidateAcknowledgment).not.toHaveBeenCalled();
  });

  it('answers 404 for an acknowledgment that is not on this agreement', async () => {
    invalidateAcknowledgment.mockResolvedValue({ outcome: 'not-found' });
    const res = buildRes();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('answers 403 for a caller who is not a CLA manager on this agreement', async () => {
    invalidateAcknowledgment.mockResolvedValue({ outcome: 'forbidden' });
    const res = buildRes();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('answers 400 with its own copy for an unsigned agreement', async () => {
    invalidateAcknowledgment.mockResolvedValue({ outcome: 'not-signed' });
    const res = buildRes();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: expect.stringContaining('has not been signed yet') });
  });

  it('marks the response no-store, so a write receipt never lands in a shared cache', async () => {
    const res = buildRes();

    await new OrgClasController().invalidateAcknowledgment(invalidateReq(), res, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  /**
   * The free-text note is a CLA manager's own words about a named contributor, so it stays out of
   * the metadata this handler writes. The reason is one of four fixed enum values and carries no
   * such detail, which is why it is the only one of the two that is logged.
   *
   * Asserted against the metadata argument alone. The whole `req` is the logger's first argument
   * on every call in this file, so scanning all arguments would match the note on the request body
   * and pass or fail for reasons this handler does not control.
   */
  it('logs the reason but not the free-text note', async () => {
    await new OrgClasController().invalidateAcknowledgment(invalidateReq({ reason: 'other', note: 'left the company in March' }), buildRes(), vi.fn());

    // Read off the hoisted spy, not the `logger` import: that import is typed as the real service,
    // so `.mock` is not on it and the app build (which type-checks server specs, unlike
    // `check-types`) rejects it.
    const metadata = loggerMock.success.mock.calls.map((call: unknown[]) => call[3]);

    expect(JSON.stringify(metadata)).not.toContain('left the company in March');
    expect(metadata).toContainEqual(expect.objectContaining({ reason: 'other' }));
  });
});

/**
 * Activity Log read (#1987). The route guard is asserted in the router spec; this layer's job is
 * to translate query parameters correctly, clamp the page size before it reaches the producer,
 * answer 404 for a signature this organization does not hold, and NOT forward
 * `returnAllEvents` even if the client tried to send it. That flag only raises the page
 * limit on the same partition.
 */
function activityReq(query: Record<string, string> = {}, params: Record<string, string> = {}) {
  return { params: { orgUid: ORG_UID, signatureId: 'signature-uuid-1', ...params }, query, body: undefined } as any;
}

function activityPage(overrides: Record<string, unknown> = {}) {
  return { signatureId: 'signature-uuid-1', list: [], resultCount: 0, nextKey: null, ...overrides };
}

describe('OrgClasController.getActivityLog', () => {
  it('returns 401 when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getActivityLog(activityReq(), res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(getActivityLog).not.toHaveBeenCalled();
  });

  it('rejects a blank signature id before reaching the service', async () => {
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().getActivityLog(activityReq({}, { signatureId: '  ' }), res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(getActivityLog).not.toHaveBeenCalled();
  });

  it('forwards a non-empty nextKey to the service, and drops an empty one', async () => {
    getActivityLog.mockResolvedValue(activityPage());

    await new OrgClasController().getActivityLog(activityReq({ nextKey: 'cursor-xyz' }), buildRes(), vi.fn());
    expect(getActivityLog).toHaveBeenLastCalledWith(expect.anything(), ORG_UID, 'signature-uuid-1', expect.objectContaining({ nextKey: 'cursor-xyz' }));

    await new OrgClasController().getActivityLog(activityReq({ nextKey: '   ' }), buildRes(), vi.fn());
    expect(getActivityLog).toHaveBeenLastCalledWith(expect.anything(), ORG_UID, 'signature-uuid-1', expect.objectContaining({ nextKey: undefined }));
  });

  it('clamps pageSize to the producer-safe range', async () => {
    getActivityLog.mockResolvedValue(activityPage());

    // Above the ceiling — a request the producer would reject with 400 becomes a silent 100.
    await new OrgClasController().getActivityLog(activityReq({ pageSize: '5000' }), buildRes(), vi.fn());
    expect(getActivityLog).toHaveBeenLastCalledWith(expect.anything(), ORG_UID, 'signature-uuid-1', expect.objectContaining({ pageSize: 100 }));

    // Zero would runaway-loop upstream — clamped to 1.
    await new OrgClasController().getActivityLog(activityReq({ pageSize: '0' }), buildRes(), vi.fn());
    expect(getActivityLog).toHaveBeenLastCalledWith(expect.anything(), ORG_UID, 'signature-uuid-1', expect.objectContaining({ pageSize: 1 }));

    // A non-numeric hint is treated as "give me the default", not a 400.
    await new OrgClasController().getActivityLog(activityReq({ pageSize: 'many' }), buildRes(), vi.fn());
    expect(getActivityLog).toHaveBeenLastCalledWith(expect.anything(), ORG_UID, 'signature-uuid-1', expect.objectContaining({ pageSize: 50 }));
  });

  // `returnAllEvents` only raises the page limit on the same partition. Even if a client
  // sent it, the controller must not hand it to the service — the service does not read it
  // either, so this is one of two layers pinning that the flag stops at the BFF.
  it('never forwards a returnAllEvents flag to the service, even if the caller tried', async () => {
    getActivityLog.mockResolvedValue(activityPage());

    await new OrgClasController().getActivityLog(activityReq({ returnAllEvents: 'true' }), buildRes(), vi.fn());

    const lastCallOptions = getActivityLog.mock.calls.at(-1)?.[3] as Record<string, unknown>;
    expect(lastCallOptions).not.toHaveProperty('returnAllEvents');
    expect(JSON.stringify(lastCallOptions ?? {})).not.toContain('returnAllEvents');
  });

  it('answers 404 when the signature is not on the organization list', async () => {
    getActivityLog.mockResolvedValue(null);
    const res = buildRes();

    await new OrgClasController().getActivityLog(activityReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    // A 404 is heuristically cacheable, so the header is set ahead of the branch or a stored copy
    // outlives the condition.
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  // The body carries actor names and timestamps, so a shared cache must not hold it.
  it('marks the response no-store', async () => {
    getActivityLog.mockResolvedValue(activityPage());
    const res = buildRes();

    await new OrgClasController().getActivityLog(activityReq(), res, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
