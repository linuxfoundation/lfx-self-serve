// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as clas.route.spec.ts: validation.helper's import graph transitively reaches
// Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUsernameFromAuth } = vi.hoisted(() => ({ getUsernameFromAuth: vi.fn<() => Promise<string | null>>() }));
const { getMyClas, resolveIdentity, getPdfUrl, searchClaGroups, listGithubAccounts, prepareSign, getClaManagers, createClaManagerRequest } = vi.hoisted(() => ({
  getMyClas: vi.fn(),
  resolveIdentity: vi.fn(),
  getPdfUrl: vi.fn(),
  searchClaGroups: vi.fn(),
  listGithubAccounts: vi.fn(),
  prepareSign: vi.fn(),
  getClaManagers: vi.fn(),
  createClaManagerRequest: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));
vi.mock('../services/cla.service', () => ({
  ClaService: class {
    public getMyClas = getMyClas;
    public resolveIdentity = resolveIdentity;
    public getPdfUrl = getPdfUrl;
    public searchClaGroups = searchClaGroups;
    public listGithubAccounts = listGithubAccounts;
    public prepareSign = prepareSign;
    public getClaManagers = getClaManagers;
    public createClaManagerRequest = createClaManagerRequest;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { AuthenticationError, MicroserviceError } from '../errors';
import { ClasController } from './clas.controller';

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as any;
}

const iclaAgreement = { id: 'sig-icla', kind: 'ICLA', projectName: 'p', signedOn: '2022-01-01', status: 'valid', pdfAvailable: true };
const resolvedIdentity = { lfUsername: 'alice', emails: [], githubIds: [], githubUsernames: [], githubLinked: false };

beforeEach(() => {
  vi.clearAllMocks();
  getUsernameFromAuth.mockResolvedValue('alice');
  resolveIdentity.mockResolvedValue(resolvedIdentity);
});

describe('ClasController.getMyClas', () => {
  it('returns 401 (via next) when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new ClasController().getMyClas({ params: {} } as any, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('never passes request-supplied identity to the service (session-derived only)', async () => {
    const response = { agreements: [iclaAgreement], identity: { matchedUserIds: 1, unmatched: false, githubLinked: true } };
    getMyClas.mockResolvedValue(response);
    const res = buildRes();
    // A malicious body/query attempting to select another user's data.
    const req = { params: {}, body: { userId: 'someone-else' }, query: { userID: 'someone-else' } } as any;

    await new ClasController().getMyClas(req, res, vi.fn());

    // The service is called with only (req); the controller passes no identity argument.
    expect(getMyClas).toHaveBeenCalledWith(req);
    expect(getMyClas).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(response);
  });

  it('forwards upstream failures to the error handler', async () => {
    getMyClas.mockRejectedValue(new MicroserviceError('boom', 502, 'UPSTREAM_ERROR', { service: 'cla_service' }));
    const next = vi.fn();

    await new ClasController().getMyClas({ params: {} } as any, buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(MicroserviceError);
  });
});

describe('ClasController.getPdfUrl', () => {
  it('returns the presigned URL for an owned ICLA', async () => {
    getPdfUrl.mockResolvedValue({ url: 'https://s3/signed.pdf', expiresInSeconds: 900 });
    const res = buildRes();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-icla' } } as any, res, vi.fn());

    expect(getPdfUrl).toHaveBeenCalledWith(expect.anything(), 'sig-icla', resolvedIdentity);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://s3/signed.pdf', expiresInSeconds: 900 });
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('returns 404 (never 403) when the endpoint reports no owned PDF (unknown / not-owned / ECLA)', async () => {
    // Ownership + ICLA-eligibility is enforced upstream; the service returns null on the endpoint's 404.
    getPdfUrl.mockResolvedValue(null);
    const res = buildRes();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-x' } } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('forwards non-404 upstream failures to the error handler', async () => {
    getPdfUrl.mockRejectedValue(new MicroserviceError('boom', 502, 'UPSTREAM_ERROR', { service: 'cla_service' }));
    const next = vi.fn();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-icla' } } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(MicroserviceError);
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-icla' } } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(resolveIdentity).not.toHaveBeenCalled();
  });
});

describe('ClasController.getClaGroupOptions', () => {
  const envelope = {
    searchTerm: 'cncf',
    resultCount: 1,
    truncated: false,
    results: [{ claGroupId: 'cg-1', projectName: 'CNCF', matchTypes: ['project'], organizations: [] }],
  };

  it('returns the search envelope, not a bare array of options', async () => {
    searchClaGroups.mockResolvedValue(envelope);
    const res = buildRes();

    await new ClasController().getClaGroupOptions({ params: {}, query: { q: 'cncf' } } as any, res, vi.fn());

    // `truncated` describes the result set, so it cannot ride inside an array of results.
    expect(res.json).toHaveBeenCalledWith(envelope);
    expect(Array.isArray(res.json.mock.calls[0][0])).toBe(false);
  });

  it('forwards the picker query to the search as the search term', async () => {
    searchClaGroups.mockResolvedValue(envelope);

    const req = { params: {}, query: { q: 'cncf' } } as any;
    await new ClasController().getClaGroupOptions(req, buildRes(), vi.fn());

    // If the controller dropped it, the producer would 400 on a missing required term.
    expect(searchClaGroups).toHaveBeenCalledWith(req, 'cncf');
  });

  it('trims the query before it becomes the search term', async () => {
    searchClaGroups.mockResolvedValue(envelope);

    await new ClasController().getClaGroupOptions({ params: {}, query: { q: '  cncf  ' } } as any, buildRes(), vi.fn());

    // Upstream measures minLength against the trimmed term and 400s on the difference.
    expect(searchClaGroups).toHaveBeenCalledWith(expect.anything(), 'cncf');
  });

  it('answers a term shorter than three trimmed characters itself, without calling upstream', async () => {
    const res = buildRes();

    await new ClasController().getClaGroupOptions({ params: {}, query: { q: 'cn' } } as any, res, vi.fn());

    // Defense in depth behind the picker's own gate: upstream 422s a two-character term, and a
    // contributor mid-word has made no mistake worth surfacing as an error.
    expect(searchClaGroups).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ searchTerm: 'cn', resultCount: 0, truncated: false, results: [] });
  });

  it('treats a repeated or malformed q as an empty query rather than failing', async () => {
    const res = buildRes();

    // Express parses a repeated ?q=&q= into an array; it must not reach the search as one.
    await new ClasController().getClaGroupOptions({ params: {}, query: { q: ['a', 'b'] } } as any, res, vi.fn());

    expect(searchClaGroups).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ searchTerm: '', resultCount: 0, truncated: false, results: [] });
  });

  it('stays available while impersonating — selection is a read', async () => {
    searchClaGroups.mockResolvedValue(envelope);
    const res = buildRes();

    await new ClasController().getClaGroupOptions({ params: {}, query: { q: 'cncf' }, impersonation: { active: true } } as any, res, vi.fn());

    // The hand-off is impersonation-blocked at the route because signing is a write; searching
    // for a project to sign is not, and blocking it would make the picker untestable in support.
    expect(res.json).toHaveBeenCalledWith(envelope);
  });

  it('forwards an upstream failure to the error handler instead of an empty set', async () => {
    searchClaGroups.mockRejectedValue(new MicroserviceError('boom', 502, 'UPSTREAM_ERROR', { service: 'cla_service' }));
    const res = buildRes();
    const next = vi.fn();

    await new ClasController().getClaGroupOptions({ params: {}, query: { q: 'cncf' } } as any, res, next);

    // An empty envelope would render as "no matching projects" — a wrong answer, not an outage.
    expect(next.mock.calls[0][0]).toBeInstanceOf(MicroserviceError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().getClaGroupOptions({ params: {}, query: {} } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
  });
});

// ---------------------------------------------------------------------------
// GitHub account selection and binding (#1252)
// ---------------------------------------------------------------------------

describe('ClasController.getGithubAccounts', () => {
  const options = { accounts: [{ githubId: '12345', githubUsername: 'octocat' }] };

  it('returns the linked accounts for the picker', async () => {
    listGithubAccounts.mockResolvedValue(options);
    const res = buildRes();

    await new ClasController().getGithubAccounts({ params: {}, query: {} } as any, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(options);
  });

  it('forwards a lookup failure instead of answering with zero accounts', async () => {
    listGithubAccounts.mockRejectedValue(new MicroserviceError('identity lookup failed', 502, 'UPSTREAM_ERROR', { service: 'cla_service' }));
    const res = buildRes();
    const next = vi.fn();

    await new ClasController().getGithubAccounts({ params: {}, query: {} } as any, res, next);

    // An empty list routes the contributor into account-linking. A failure reported that way
    // would send someone who already linked an account to go fix nothing.
    expect(next.mock.calls[0][0]).toBeInstanceOf(MicroserviceError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().getGithubAccounts({ params: {}, query: {} } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(listGithubAccounts).not.toHaveBeenCalled();
  });
});

describe('ClasController.prepareSign', () => {
  const CLA_GROUP_ID = '3fee6d72-0c80-4145-99c2-fb382b3a93fb';
  const prepared = {
    userId: 'u-1',
    signUrl: 'https://easycla.dev.communitybridge.org/#/cla/project/cg-1/user/u-1?redirect=enc',
    githubId: '12345',
    githubUsername: 'octocat',
    skippedIdentities: [],
  };

  /** The body the browser actually sends: the chosen account and the confirmed group, nothing else. */
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { githubId: '12345', claGroupId: CLA_GROUP_ID, ...overrides };
  }

  it('returns the prepared session, including the producer address', async () => {
    prepareSign.mockResolvedValue(prepared);
    const res = buildRes();

    await new ClasController().prepareSign({ params: {}, query: {}, body: body() } as any, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(prepared);
  });

  it('passes only the chosen account and the confirmed group to the service', async () => {
    prepareSign.mockResolvedValue(prepared);
    const req = { params: {}, query: {}, body: body() } as any;

    await new ClasController().prepareSign(req, buildRes(), vi.fn());

    expect(prepareSign).toHaveBeenCalledWith(req, '12345', CLA_GROUP_ID);
  });

  it('ignores a handle sent alongside the account number', async () => {
    prepareSign.mockResolvedValue(prepared);

    // The service reads the handle from the session's own accounts. Accepting one here would let
    // a caller pair an account number they own with a handle they do not — and the CLA service
    // resolves that handle live through GitHub to admit the number.
    const req = { params: {}, query: {}, body: body({ githubUsername: 'someone-else' }) } as any;
    await new ClasController().prepareSign(req, buildRes(), vi.fn());

    expect(prepareSign).toHaveBeenCalledWith(req, '12345', CLA_GROUP_ID);
    expect(prepareSign.mock.calls[0]).toHaveLength(3);
  });

  it('ignores a return address sent by the caller', async () => {
    prepareSign.mockResolvedValue(prepared);

    // EasyCLA stores this value and later redirects to it verbatim, so a client-supplied one
    // would turn the hand-off into an open redirect. It is derived from the request instead.
    const req = { params: {}, query: {}, body: body({ returnUrl: 'https://attacker.example/steal' }) } as any;
    await new ClasController().prepareSign(req, buildRes(), vi.fn());

    expect(prepareSign).toHaveBeenCalledWith(req, '12345', CLA_GROUP_ID);
  });

  it.each([undefined, '', '   ', 'abc', '12a', '-1', '0', '1.5'])('rejects %p as an account number', async (githubId) => {
    const res = buildRes();

    await new ClasController().prepareSign({ params: {}, query: {}, body: body({ githubId }) } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prepareSign).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   ', 'cg-1', 'not-a-uuid', '3fee6d72-0c80-4145-99c2', '3fee6d72-0c80-4145-99c2-fb382b3a93fbb'])(
    'rejects %p as a CLA group id',
    async (claGroupId) => {
      const res = buildRes();

      // Required upstream, and the producer 400s a shape it cannot parse — answering here keeps
      // a malformed group from spending a gateway round trip to learn the same thing.
      await new ClasController().prepareSign({ params: {}, query: {}, body: body({ claGroupId }) } as any, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prepareSign).not.toHaveBeenCalled();
    }
  );

  it('forwards an upstream refusal rather than falling back to another account', async () => {
    prepareSign.mockRejectedValue(
      new MicroserviceError('the provided identity does not belong to the authenticated user', 403, 'FORBIDDEN', { service: 'cla_service' })
    );
    const res = buildRes();
    const next = vi.fn();

    await new ClasController().prepareSign({ params: {}, query: {}, body: body() } as any, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(MicroserviceError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().prepareSign({ params: {}, query: {}, body: body() } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(prepareSign).not.toHaveBeenCalled();
  });
});

const SIGNATURE_ID = '3fee6d72-0c80-4145-99c2-fb382b3a93fb';
const managerList = {
  signatureId: SIGNATURE_ID,
  managers: [{ lfUsername: 'jdoe', name: 'Jane Doe' }],
  resultCount: 1,
};

describe('ClasController.getClaManagers', () => {
  it('returns the manager list for an owned ECLA', async () => {
    getClaManagers.mockResolvedValue(managerList);
    const res = buildRes();

    await new ClasController().getClaManagers({ params: { signatureId: SIGNATURE_ID } } as any, res, vi.fn());

    expect(getClaManagers).toHaveBeenCalledWith(expect.anything(), SIGNATURE_ID, resolvedIdentity);
    expect(res.json).toHaveBeenCalledWith(managerList);
  });

  it('returns 404 (never an empty list) when upstream reports unknown / not-owned / ICLA', async () => {
    getClaManagers.mockResolvedValue(null);
    const res = buildRes();

    await new ClasController().getClaManagers({ params: { signatureId: SIGNATURE_ID } } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ managers: [] }));
  });

  it.each(['', '   ', 'not-a-uuid', 'sig-1'])('rejects %p as a signature id', async (signatureId) => {
    const res = buildRes();

    await new ClasController().getClaManagers({ params: { signatureId } } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getClaManagers).not.toHaveBeenCalled();
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().getClaManagers({ params: { signatureId: SIGNATURE_ID } } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(resolveIdentity).not.toHaveBeenCalled();
  });
});

describe('ClasController.createClaManagerRequest', () => {
  const receipt = {
    requestId: 'r-1',
    signatureId: SIGNATURE_ID,
    requestType: 'removal' as const,
    status: 'sent' as const,
    recipients: ['jdoe'],
  };

  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { requestType: 'removal', recipients: ['jdoe'], ...overrides };
  }

  it('returns the producer receipt', async () => {
    createClaManagerRequest.mockResolvedValue(receipt);
    const res = buildRes();

    await new ClasController().createClaManagerRequest({ params: { signatureId: SIGNATURE_ID }, body: body() } as any, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(receipt);
    expect(createClaManagerRequest).toHaveBeenCalledWith(expect.anything(), SIGNATURE_ID, resolvedIdentity, {
      requestType: 'removal',
      recipients: ['jdoe'],
    });
  });

  it.each(['', 'approve', 'CONTACT', undefined])('rejects %p as a request type', async (requestType) => {
    const res = buildRes();

    await new ClasController().createClaManagerRequest({ params: { signatureId: SIGNATURE_ID }, body: body({ requestType }) } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createClaManagerRequest).not.toHaveBeenCalled();
  });

  it('forwards a contact request carrying a message', async () => {
    createClaManagerRequest.mockResolvedValue({ ...receipt, requestType: 'contact' as const });

    await new ClasController().createClaManagerRequest(
      { params: { signatureId: SIGNATURE_ID }, body: body({ requestType: 'contact', message: '  who owns our list?  ' }) } as any,
      buildRes(),
      vi.fn()
    );

    expect(createClaManagerRequest).toHaveBeenCalledWith(expect.anything(), SIGNATURE_ID, resolvedIdentity, {
      requestType: 'contact',
      recipients: ['jdoe'],
      message: 'who owns our list?',
    });
  });

  // The producer refuses a blank contact message; answering here keeps it a usable 400. The
  // control-character case is blank only after sanitization, which is what the producer validates.
  it.each([undefined, '', '   \n\t ', '\x07\x1b', ' \r\n \x07 \t '])('rejects a contact request whose message is %j', async (message) => {
    const res = buildRes();

    await new ClasController().createClaManagerRequest(
      { params: { signatureId: SIGNATURE_ID }, body: body({ requestType: 'contact', message }) } as any,
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createClaManagerRequest).not.toHaveBeenCalled();
  });

  it('still accepts approval and removal with no message at all', async () => {
    createClaManagerRequest.mockResolvedValue(receipt);

    for (const requestType of ['approval', 'removal'] as const) {
      createClaManagerRequest.mockClear();
      await new ClasController().createClaManagerRequest({ params: { signatureId: SIGNATURE_ID }, body: body({ requestType }) } as any, buildRes(), vi.fn());

      expect(createClaManagerRequest).toHaveBeenCalledWith(expect.anything(), SIGNATURE_ID, resolvedIdentity, { requestType, recipients: ['jdoe'] });
    }
  });

  // Emoji are two UTF-16 units each; counting units would reject at half the producer's rune cap.
  it('measures the message cap in code points, matching the producer rune limit', async () => {
    createClaManagerRequest.mockResolvedValue(receipt);

    await new ClasController().createClaManagerRequest(
      { params: { signatureId: SIGNATURE_ID }, body: body({ message: '🙂'.repeat(4096) }) } as any,
      buildRes(),
      vi.fn()
    );

    expect(createClaManagerRequest).toHaveBeenCalled();
  });

  // The producer strips control characters before it measures, so they must not consume the cap.
  it('does not count stripped control characters against the message cap', async () => {
    createClaManagerRequest.mockResolvedValue(receipt);

    await new ClasController().createClaManagerRequest(
      { params: { signatureId: SIGNATURE_ID }, body: body({ message: `${'x'.repeat(4096)}${'\x07'.repeat(50)}` }) } as any,
      buildRes(),
      vi.fn()
    );

    expect(createClaManagerRequest).toHaveBeenCalledWith(
      expect.anything(),
      SIGNATURE_ID,
      expect.anything(),
      expect.objectContaining({ message: 'x'.repeat(4096) })
    );
  });

  it('rejects an empty recipient list', async () => {
    const res = buildRes();

    await new ClasController().createClaManagerRequest({ params: { signatureId: SIGNATURE_ID }, body: body({ recipients: [] }) } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createClaManagerRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['jdoe', null],
    ['jdoe', 1],
    ['jdoe', true],
    ['jdoe', '  '],
  ])('rejects a recipient list that is not all non-empty strings (%j)', async (...recipients) => {
    const res = buildRes();

    await new ClasController().createClaManagerRequest({ params: { signatureId: SIGNATURE_ID }, body: body({ recipients }) } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createClaManagerRequest).not.toHaveBeenCalled();
  });

  it('trims valid recipient strings rather than coercing mixed values', async () => {
    createClaManagerRequest.mockResolvedValue(receipt);

    await new ClasController().createClaManagerRequest(
      { params: { signatureId: SIGNATURE_ID }, body: body({ recipients: ['  jdoe  '] }) } as any,
      buildRes(),
      vi.fn()
    );

    expect(createClaManagerRequest).toHaveBeenCalledWith(expect.anything(), SIGNATURE_ID, resolvedIdentity, expect.objectContaining({ recipients: ['jdoe'] }));
  });

  it('rejects a message longer than 4096 characters', async () => {
    const res = buildRes();

    await new ClasController().createClaManagerRequest(
      { params: { signatureId: SIGNATURE_ID }, body: body({ message: 'x'.repeat(4097) }) } as any,
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createClaManagerRequest).not.toHaveBeenCalled();
  });

  it('forwards a trimmed optional message', async () => {
    createClaManagerRequest.mockResolvedValue(receipt);

    await new ClasController().createClaManagerRequest(
      { params: { signatureId: SIGNATURE_ID }, body: body({ message: '  please  ' }) } as any,
      buildRes(),
      vi.fn()
    );

    expect(createClaManagerRequest).toHaveBeenCalledWith(expect.anything(), SIGNATURE_ID, resolvedIdentity, expect.objectContaining({ message: 'please' }));
  });

  it('returns 404 when the signature is unknown, not-owned, or an ICLA', async () => {
    createClaManagerRequest.mockResolvedValue(null);
    const res = buildRes();

    await new ClasController().createClaManagerRequest({ params: { signatureId: SIGNATURE_ID }, body: body() } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
