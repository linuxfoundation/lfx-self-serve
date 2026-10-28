// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerCalls } = vi.hoisted(() => ({ loggerCalls: [] as unknown[][] }));

// Every logger call is recorded so a test can assert on what reaches the log, not just on behaviour.
vi.mock('./logger.service', () => {
  const record =
    (returns?: unknown) =>
    (...args: unknown[]) => {
      loggerCalls.push(args);
      return returns;
    };
  return {
    logger: {
      startOperation: record(0),
      success: record(),
      error: record(),
      warning: record(),
      debug: record(),
      info: record(),
    },
  };
});

const { CdpService } = await import('./cdp.service');
const { CDP_CONFIG } = await import('@lfx-one/shared/constants');

const LFID = 'e2e-employee';
const MEMBER_ID = 'cdp-member-1';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, statusText: `${status}`, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

/** URLs every stubbed `fetch` call was made against, in order. */
function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  loggerCalls.length = 0;
  vi.stubEnv('CDP_ACCESS_TOKEN', 'test-token');
  vi.stubEnv('CDP_API_URL', 'https://cdp.test/api');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/**
 * #4225 / PR #4318 — the point of this reader is that `GET /api/orgs/me/role-grants` stays a read.
 * `getWorkExperiencesForUser` resolves through `resolveMember`, which creates a member when CDP has
 * none; these tests pin the read-only path so a later refactor cannot quietly bring the write back.
 */
describe('CdpService.getWorkExperiencesForKnownUser', () => {
  it('never creates a CDP member when the caller has no profile', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Member not found' }, 404));

    await expect(new CdpService().getWorkExperiencesForKnownUser(undefined, LFID)).resolves.toEqual([]);

    const urls = requestedUrls(fetchMock);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(CDP_CONFIG.ENDPOINTS.RESOLVE_MEMBER);
    // Resolve is itself a POST (`/v1/members/resolve`), so the guarantee is about the endpoint, not
    // the verb: nothing may hit `/v1/members` itself, which is what creates a member.
    expect(urls.some((url) => url.endsWith(CDP_CONFIG.ENDPOINTS.CREATE_MEMBER))).toBe(false);
  });

  it('treats a 2xx resolve carrying no memberId as "no work history", not an outage', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await expect(new CdpService().getWorkExperiencesForKnownUser(undefined, LFID)).resolves.toEqual([]);

    expect(requestedUrls(fetchMock)).toHaveLength(1);
  });

  // #4225 — the caller's LFID is a username. The reader's own log calls drop it, but it also routes
  // through `resolveMemberId`, whose debug lines used to carry the raw `lfids` (PR #4318 review).
  // This pins the whole path, so neither site can reintroduce it.
  it("never writes the caller's LFID into any log line", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Member not found' }, 404));

    await new CdpService().getWorkExperiencesForKnownUser(undefined, LFID);

    expect(loggerCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(loggerCalls)).not.toContain(LFID);
  });

  it('reads the work history of a member that already exists', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ memberId: MEMBER_ID })).mockResolvedValueOnce(
      jsonResponse({
        memberId: MEMBER_ID,
        workExperiences: [
          {
            id: 'we-1',
            organizationId: 'cdev-org-1',
            organizationName: 'Acme Motors',
            organizationLogo: '',
            jobTitle: 'Engineer',
            verified: true,
            verifiedBy: LFID,
            source: 'lfxOne',
            startDate: '2024-01-15',
            endDate: null,
            createdAt: '2024-01-15',
            updatedAt: '2024-01-15',
          },
        ],
      })
    );

    const entries = await new CdpService().getWorkExperiencesForKnownUser(undefined, LFID);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ organization: 'Acme Motors', organizationId: 'cdev-org-1', endDate: undefined, needsReview: false });
    expect(requestedUrls(fetchMock).some((url) => url.includes(`/v1/members/${MEMBER_ID}/work-experiences`))).toBe(true);
  });
});

/** A write whose settlement the test controls, recording when it starts. */
function deferredWrite(started: string[], name: string): { write: () => Promise<void>; resolve: () => void; reject: (err: Error) => void } {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const settled = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    write: () => {
      started.push(name);
      return settled;
    },
    resolve,
    reject,
  };
}

/**
 * #4523 — parallel identity writes against one member deadlock CDP, so a reconcile runs its writes
 * one at a time and a second reconcile for the same member on this pod is dropped.
 */
describe('CdpService.runMemberIdentityWrites', () => {
  it('runs the writes one at a time, in order', async () => {
    const started: string[] = [];
    const first = deferredWrite(started, 'first');
    const second = deferredWrite(started, 'second');

    expect(new CdpService().runMemberIdentityWrites(undefined, 'member-serial', [first.write, second.write])).toBe(true);

    expect(started).toEqual(['first']);
    first.resolve();
    await vi.waitFor(() => expect(started).toEqual(['first', 'second']));
    second.resolve();
  });

  it('skips a second chain for a member already writing, across CdpService instances, until the first settles', async () => {
    const started: string[] = [];
    const first = deferredWrite(started, 'first');
    const duplicate = deferredWrite(started, 'duplicate');
    const other = deferredWrite(started, 'other-member');

    expect(new CdpService().runMemberIdentityWrites(undefined, 'member-busy', [first.write])).toBe(true);
    expect(new CdpService().runMemberIdentityWrites(undefined, 'member-busy', [duplicate.write])).toBe(false);
    expect(new CdpService().runMemberIdentityWrites(undefined, 'member-other', [other.write])).toBe(true);
    expect(started).toEqual(['first', 'other-member']);

    first.resolve();
    other.resolve();
    await vi.waitFor(() => expect(new CdpService().runMemberIdentityWrites(undefined, 'member-busy', [duplicate.write])).toBe(true));
    expect(started).toEqual(['first', 'other-member', 'duplicate']);
    duplicate.resolve();
  });

  it('keeps going after a failed write and logs it as a warning', async () => {
    const started: string[] = [];
    const failing = deferredWrite(started, 'failing');
    const next = deferredWrite(started, 'next');

    new CdpService().runMemberIdentityWrites(undefined, 'member-failing', [failing.write, next.write]);
    failing.reject(new Error('deadlock'));

    await vi.waitFor(() => expect(started).toEqual(['failing', 'next']));
    expect(loggerCalls.some(([, operation]) => operation === 'run_cdp_member_identity_writes')).toBe(true);
    next.resolve();
  });
});

describe('CdpService.getMemberIdentitiesForUser', () => {
  it('returns the resolved member id alongside the identities', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ memberId: MEMBER_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ identities: [{ id: 'id-1', platform: 'github', type: 'username', value: 'dev-gh', verified: true, source: 'cdp' }] })
      );

    const result = await new CdpService().getMemberIdentitiesForUser(undefined, LFID);

    expect(result.memberId).toBe(MEMBER_ID);
    expect(result.identities).toEqual([expect.objectContaining({ id: 'id-1', platform: 'github', value: 'dev-gh' })]);
    expect(requestedUrls(fetchMock)[1]).toContain(CDP_CONFIG.ENDPOINTS.MEMBER_IDENTITIES(MEMBER_ID));
  });

  it('reports no member and no identities when CDP has no profile', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ memberId: MEMBER_ID })).mockResolvedValueOnce(jsonResponse({ message: 'Member not found' }, 404));

    await expect(new CdpService().getMemberIdentitiesForUser(undefined, LFID)).resolves.toEqual({ memberId: null, identities: [] });
  });
});
