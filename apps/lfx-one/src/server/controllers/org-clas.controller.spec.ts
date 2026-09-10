// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUsernameFromAuth } = vi.hoisted(() => ({ getUsernameFromAuth: vi.fn<() => Promise<string | null>>() }));
const { listClaGroups, getPdfUrl, getSignOptions, requestCorporateSignature } = vi.hoisted(() => ({
  listClaGroups: vi.fn(),
  getPdfUrl: vi.fn(),
  getSignOptions: vi.fn(),
  requestCorporateSignature: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));
vi.mock('../services/org-cla.service', () => ({
  OrgClaService: class {
    public listClaGroups = listClaGroups;
    public getPdfUrl = getPdfUrl;
    public getSignOptions = getSignOptions;
    public requestCorporateSignature = requestCorporateSignature;
  },
}));
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/logger.service', () => ({ logger: loggerMock }));

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
