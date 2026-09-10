// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUsernameFromAuth } = vi.hoisted(() => ({ getUsernameFromAuth: vi.fn<() => Promise<string | null>>() }));
const { listClaGroups, getPdfUrl, getApprovalList, updateApprovalList } = vi.hoisted(() => ({
  listClaGroups: vi.fn(),
  getPdfUrl: vi.fn(),
  getApprovalList: vi.fn(),
  updateApprovalList: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));
vi.mock('../services/org-cla.service', () => ({
  OrgClaService: class {
    public listClaGroups = listClaGroups;
    public getPdfUrl = getPdfUrl;
    public getApprovalList = getApprovalList;
    public updateApprovalList = updateApprovalList;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { AuthenticationError } from '../errors';
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
// Approval list (#1985)
// ---------------------------------------------------------------------------

const ORG_UID = '0014100000Te2ovAAB';

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
