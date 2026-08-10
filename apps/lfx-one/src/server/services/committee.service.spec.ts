// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberVisibility } from '@lfx-one/shared/enums';
import type { Committee, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors project.service.spec.ts / meeting.service.spec.ts: the `@lfx-one/shared/*` alias isn't
// wired into this app's vitest config, so runtime (non-type-only) imports need stubs.
const {
  proxyRequest,
  addAccessToResources,
  addAccessToResource,
  checkSingleAccessStrict,
  fetchWithETag,
  updateWithETag,
  resolveAuditUserDisplayName,
  isImpersonating,
} = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  addAccessToResources: vi.fn(),
  // getCommitteeById's single-resource variant (LFXV2-3080 tests) — distinct from the plural
  // list-oriented addAccessToResources every other describe block in this file already uses.
  addAccessToResource: vi.fn(),
  // Defaults true — most updateCommittee tests aren't exercising the project-writer gate on
  // chat_webhook_url (LFXV2-3080) and shouldn't need to know it exists to pass.
  checkSingleAccessStrict: vi.fn(() => Promise.resolve(true)),
  fetchWithETag: vi.fn(),
  updateWithETag: vi.fn(),
  resolveAuditUserDisplayName: vi.fn(),
  isImpersonating: vi.fn(() => false),
}));

vi.mock('@lfx-one/shared/enums', () => ({
  CommitteeMemberRole: {},
  CommitteeMemberVisibility: { HIDDEN: 'hidden', BASIC_PROFILE: 'basic_profile' },
}));
vi.mock('@lfx-one/shared/utils', () => ({ invitationRequiresOrganization: vi.fn() }));
vi.mock('@lfx-one/shared/constants', () => ({
  SLACK_INCOMING_WEBHOOK_URL_PATTERN: /^https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+$/,
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public addAccessToResources = addAccessToResources;
    public addAccessToResource = addAccessToResource;
    public checkSingleAccessStrict = checkSingleAccessStrict;
  },
}));
vi.mock('./etag.service', () => ({
  ETagService: class {
    public fetchWithETag = fetchWithETag;
    public updateWithETag = updateWithETag;
  },
}));
vi.mock('./project.service', () => ({ ProjectService: class {} }));
vi.mock('../helpers/query-service.helper', async () => {
  const actual = await vi.importActual<typeof import('../helpers/query-service.helper')>('../helpers/query-service.helper');
  return {
    fetchAllQueryResources: vi.fn(actual.fetchAllQueryResources),
  };
});
vi.mock('../utils/auth-helper', () => ({ resolveAuditUserDisplayName, getUsernameFromAuth: vi.fn(), isImpersonating }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));

import type { Request } from 'express';

import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { logger } from '../services/logger.service';
import { CommitteeService } from './committee.service';

const req = {} as unknown as Request;

function pageOf(committees: Partial<Committee>[], pageToken?: string): QueryServiceResponse<Committee> {
  return { resources: committees.map((c) => ({ id: `committee:${c.uid}`, data: c as Committee })), page_token: pageToken } as QueryServiceResponse<Committee>;
}

describe('CommitteeService — create picker methods', () => {
  let service: CommitteeService;

  beforeEach(() => {
    proxyRequest.mockReset();
    addAccessToResources.mockReset();
    resolveAuditUserDisplayName.mockReset();
    vi.mocked(fetchAllQueryResources).mockReset();
    service = new CommitteeService();
  });

  describe('getDirectGrantCommittees', () => {
    it('queries filter_grants=direct and returns only writer-permitted committees', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'a' }, { uid: 'b' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, committees: Committee[]) =>
        Promise.resolve(committees.map((c) => ({ ...c, writer: c.uid === 'a' })))
      );

      const result = await service.getDirectGrantCommittees(req);

      expect(result.map((c) => c.uid)).toEqual(['a']);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'committee', filter_grants: 'direct' });
    });
  });

  describe('searchCreatableCommittees', () => {
    it('queries name=<term> with a small page size and filters to writer-permitted matches', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'match-1' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, committees: Committee[]) => Promise.resolve(committees.map((c) => ({ ...c, writer: true }))));

      const result = await service.searchCreatableCommittees(req, 'security');

      expect(result.map((c) => c.uid)).toEqual(['match-1']);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'committee', name: 'security', page_size: 20 });
    });

    it('excludes non-writer matches even when the query service returns them', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'writer-committee' }, { uid: 'inherited-not-writer' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, committees: Committee[]) =>
        Promise.resolve(committees.map((c) => ({ ...c, writer: c.uid === 'writer-committee' })))
      );

      const result = await service.searchCreatableCommittees(req, 'security');

      expect(result.map((c) => c.uid)).toEqual(['writer-committee']);
    });

    it('continues to the next page when the first page has no writer-permitted matches', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'visible-only' }], 'token-2'));
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'inherited-writer' }]));
      addAccessToResources.mockImplementation((_req: Request, committees: Committee[]) =>
        Promise.resolve(committees.map((c) => ({ ...c, writer: c.uid === 'inherited-writer' })))
      );

      const result = await service.searchCreatableCommittees(req, 'security');

      expect(result.map((c) => c.uid)).toEqual(['inherited-writer']);
      expect(proxyRequest).toHaveBeenCalledTimes(2);
      expect(proxyRequest.mock.calls[1][4]).toMatchObject({ page_token: 'token-2' });
    });

    it('stops paging once the page cap is reached, even if pages remain', async () => {
      proxyRequest.mockResolvedValue(pageOf([{ uid: 'no-match' }], 'more'));
      addAccessToResources.mockImplementation((_req: Request, committees: Committee[]) => Promise.resolve(committees.map((c) => ({ ...c, writer: false }))));

      const result = await service.searchCreatableCommittees(req, 'security');

      expect(result).toEqual([]);
      expect(proxyRequest).toHaveBeenCalledTimes(5);
    });
  });

  it('never issues a type=committee query-service call without filter_grants or name', async () => {
    proxyRequest.mockResolvedValue(pageOf([]));
    addAccessToResources.mockImplementation((_req: Request, committees: Committee[]) => Promise.resolve(committees));

    await service.getDirectGrantCommittees(req);
    await service.searchCreatableCommittees(req, 'term');

    const paramsSent = proxyRequest.mock.calls.filter((call) => call[4]?.type === 'committee').map((call) => call[4]);
    expect(paramsSent.length).toBeGreaterThan(0);
    for (const params of paramsSent) {
      expect(params['filter_grants'] === 'direct' || typeof params['name'] === 'string').toBe(true);
    }
  });
});

describe('CommitteeService — getCommitteeDocuments', () => {
  let service: CommitteeService;

  beforeEach(() => {
    proxyRequest.mockReset();
    resolveAuditUserDisplayName.mockReset();
    vi.mocked(fetchAllQueryResources).mockReset();
    resolveAuditUserDisplayName.mockReturnValue('Resolved Display Name');
    service = new CommitteeService();
  });

  it('threads resolveAuditUserDisplayName into uploaded_by for folders, links, and files', async () => {
    proxyRequest
      .mockResolvedValueOnce([{ uid: 'folder-1', name: 'Folder', created_by: { name: 'Ada Lovelace' }, committee_uid: 'committee-1' }])
      .mockResolvedValueOnce([{ uid: 'link-1', name: 'Link', url: 'https://example.com', created_by: { name: 'Bob Builder' }, committee_uid: 'committee-1' }]);
    vi.mocked(fetchAllQueryResources).mockResolvedValueOnce([
      {
        uid: 'file-1',
        name: 'File',
        content_type: 'application/pdf',
        created_by: { name: 'Carol Danvers' },
        uploaded_by_username: 'legacyuser',
        committee_uid: 'committee-1',
      },
    ]);

    const result = await service.getCommitteeDocuments(req, 'committee-1');

    expect(result).toHaveLength(3);
    expect(result.every((doc) => doc.uploaded_by === 'Resolved Display Name')).toBe(true);
    expect(resolveAuditUserDisplayName).toHaveBeenCalledTimes(3);
    expect(resolveAuditUserDisplayName).toHaveBeenCalledWith({ name: 'Ada Lovelace' }, undefined);
    expect(resolveAuditUserDisplayName).toHaveBeenCalledWith({ name: 'Bob Builder' }, undefined);
    expect(resolveAuditUserDisplayName).toHaveBeenCalledWith({ name: 'Carol Danvers' }, 'legacyuser');
  });
});

describe('CommitteeService.acceptCommitteeInvite — post-acceptance membership confirmation', () => {
  let service: CommitteeService;
  // Typed from the method itself rather than `ReturnType<typeof vi.spyOn>`: the bare
  // ReturnType picks up `vi.spyOn`'s unparameterised default signature
  // (`(this: unknown, ...args: unknown[]) => unknown`), which the real spy is not
  // assignable to.
  let getCommitteeById: MockInstance<CommitteeService['getCommitteeById']>;

  const COMMITTEE_UID = 'committee-1';
  const INVITE_UID = 'invite-1';

  /** The confirmation is opt-in, so most callers pass nothing and must not pay for it. */
  const acceptWithConfirmation = () => service.acceptCommitteeInvite(req, COMMITTEE_UID, INVITE_UID, undefined, { confirmMembership: true });

  const denied = (status: number) => Object.assign(new Error(`upstream ${status}`), { statusCode: status });

  beforeEach(() => {
    vi.useFakeTimers();
    proxyRequest.mockReset();
    proxyRequest.mockResolvedValue(undefined);
    vi.mocked(logger.warning).mockClear();
    service = new CommitteeService();
    getCommitteeById = vi.spyOn(service, 'getCommitteeById');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not confirm membership by default', async () => {
    await service.acceptCommitteeInvite(req, COMMITTEE_UID, INVITE_UID);

    expect(getCommitteeById).not.toHaveBeenCalled();
  });

  it('returns without delay when membership is already visible', async () => {
    getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, my_role: 'Member' } as any);

    await acceptWithConfirmation();

    expect(getCommitteeById).toHaveBeenCalledOnce();
    expect(getCommitteeById).toHaveBeenCalledWith(req, COMMITTEE_UID, { includeMembership: true });
    // First probe is immediate — nothing was scheduled.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves as soon as membership appears within the budget', async () => {
    getCommitteeById
      .mockResolvedValueOnce({ uid: COMMITTEE_UID } as any)
      .mockResolvedValueOnce({ uid: COMMITTEE_UID } as any)
      .mockResolvedValueOnce({ uid: COMMITTEE_UID, my_role: 'Member' } as any);

    const pending = acceptWithConfirmation();
    await vi.runAllTimersAsync();
    await pending;

    expect(getCommitteeById).toHaveBeenCalledTimes(3);
  });

  it('proceeds and warns when the budget is exhausted', async () => {
    getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID } as any);

    const pending = acceptWithConfirmation();
    await vi.runAllTimersAsync();

    // Fails open: acceptance is still reported successful, the committee view covers the tail.
    await expect(pending).resolves.toBeUndefined();
    expect(vi.mocked(logger.warning)).toHaveBeenCalledTimes(1);
  });

  it('treats a 403 during confirmation as not-ready rather than a failure', async () => {
    getCommitteeById
      .mockRejectedValueOnce(denied(403))
      .mockRejectedValueOnce(denied(403))
      .mockResolvedValueOnce({ uid: COMMITTEE_UID, my_role: 'Member' } as any);

    const pending = acceptWithConfirmation();
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBeUndefined();
    expect(getCommitteeById).toHaveBeenCalledTimes(3);
    expect(vi.mocked(logger.warning)).not.toHaveBeenCalled();
  });

  it('stops polling on a non-403 error but still reports acceptance', async () => {
    getCommitteeById.mockRejectedValue(denied(500));

    const pending = acceptWithConfirmation();
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBeUndefined();
    expect(getCommitteeById).toHaveBeenCalledOnce();
    expect(vi.mocked(logger.warning)).toHaveBeenCalledTimes(1);
  });

  it('adds no delay when re-accepting an invite whose membership already exists', async () => {
    getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, my_role: 'Member' } as any);

    await acceptWithConfirmation();
    await acceptWithConfirmation();

    expect(getCommitteeById).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('CommitteeService — chat_webhook_url (LFXV2-3080)', () => {
  let service: CommitteeService;

  const COMMITTEE_UID = 'committee-1';
  const VALID_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/XXXX';

  beforeEach(() => {
    proxyRequest.mockReset();
    addAccessToResources.mockReset();
    addAccessToResource.mockReset();
    checkSingleAccessStrict.mockReset().mockResolvedValue(true);
    fetchWithETag.mockReset();
    updateWithETag.mockReset();
    resolveAuditUserDisplayName.mockReset();
    isImpersonating.mockReset().mockReturnValue(false);
    // Pass-through default — most tests here don't care about access-check enrichment itself.
    addAccessToResource.mockImplementation((_req: Request, committee: Committee) => Promise.resolve(committee));
    service = new CommitteeService();
  });

  describe('getCommitteeById', () => {
    it('computes has_slack_webhook from the upstream chat_webhook_url field and never returns the raw value', async () => {
      proxyRequest
        .mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1', chat_webhook_url: VALID_WEBHOOK_URL })
        .mockResolvedValueOnce({}); // GET /committees/:id/settings

      const result = await service.getCommitteeById(req, COMMITTEE_UID);

      expect(result.has_slack_webhook).toBe(true);
      expect('chat_webhook_url' in result).toBe(false);
    });

    it('reports has_slack_webhook: false when no webhook is configured upstream', async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }).mockResolvedValueOnce({});

      const result = await service.getCommitteeById(req, COMMITTEE_UID);

      expect(result.has_slack_webhook).toBe(false);
    });

    it('reports has_slack_webhook: false for a stored value that fails the Slack allowlist (e.g. written by a non-BFF caller)', async () => {
      proxyRequest
        .mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1', chat_webhook_url: 'https://evil.example.com/x' })
        .mockResolvedValueOnce({});

      const result = await service.getCommitteeById(req, COMMITTEE_UID);

      expect(result.has_slack_webhook).toBe(false);
      expect('chat_webhook_url' in result).toBe(false);
    });
  });

  describe('getSlackWebhookUrlStrict', () => {
    it('returns the raw webhook URL when configured', async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, chat_webhook_url: VALID_WEBHOOK_URL });

      await expect(service.getSlackWebhookUrlStrict(req, COMMITTEE_UID)).resolves.toBe(VALID_WEBHOOK_URL);
    });

    it('returns null when not configured', async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID });

      await expect(service.getSlackWebhookUrlStrict(req, COMMITTEE_UID)).resolves.toBeNull();
    });
  });

  describe('getCommitteeForSlackShare', () => {
    it('returns name, project_uid, and the raw webhook URL from a single fetch', async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1', chat_webhook_url: VALID_WEBHOOK_URL });

      await expect(service.getCommitteeForSlackShare(req, COMMITTEE_UID)).resolves.toEqual({
        name: 'Test',
        project_uid: 'project-1',
        chat_webhook_url: VALID_WEBHOOK_URL,
      });
      expect(proxyRequest).toHaveBeenCalledOnce();
    });

    it('returns chat_webhook_url: null when not configured', async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' });

      await expect(service.getCommitteeForSlackShare(req, COMMITTEE_UID)).resolves.toMatchObject({ chat_webhook_url: null });
    });

    it('throws 404 when the committee does not exist', async () => {
      proxyRequest.mockResolvedValueOnce(undefined);

      await expect(service.getCommitteeForSlackShare(req, COMMITTEE_UID)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('updateCommittee', () => {
    it('rejects any chat_webhook_url change during impersonation (403 IMPERSONATION_READ_ONLY), before touching upstream — even a well-formed URL, and even a clear (null)', async () => {
      isImpersonating.mockReturnValue(true);

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL })).rejects.toMatchObject({
        statusCode: 403,
        code: 'IMPERSONATION_READ_ONLY',
      });
      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: null })).rejects.toMatchObject({
        statusCode: 403,
        code: 'IMPERSONATION_READ_ONLY',
      });

      expect(fetchWithETag).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('does not block other fields during impersonation — only chat_webhook_url is guarded', async () => {
      isImpersonating.mockReturnValue(true);
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' });
      updateWithETag.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Updated', project_uid: 'project-1' });

      await expect(service.updateCommittee(req, COMMITTEE_UID, { name: 'Updated' })).resolves.toMatchObject({ uid: COMMITTEE_UID });
    });

    it('rejects a chat_webhook_url change (403 NOT_PROJECT_WRITER) when the caller is a committee writer but not a project writer — choosing the Slack destination must require the same authorization as sending to it, and rejects the whole save, not just the webhook field', async () => {
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' });
      checkSingleAccessStrict.mockResolvedValueOnce(false);

      // chat_channel (core) and member_visibility (settings) alongside chat_webhook_url — pins
      // the client-facing toast's claim that nothing on this save persisted, not just the
      // webhook: both updateWithETag call sites (core PUT and settings PUT) go through the same
      // mocked function, so a single "not called" assertion covers both.
      await expect(
        service.updateCommittee(req, COMMITTEE_UID, {
          chat_webhook_url: VALID_WEBHOOK_URL,
          chat_channel: '#general',
          member_visibility: CommitteeMemberVisibility.BASIC_PROFILE,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'NOT_PROJECT_WRITER',
      });

      expect(checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'project', id: 'project-1', access: 'writer' });
      expect(updateWithETag).not.toHaveBeenCalled();
    });

    it('does not run the project-writer check for updates that omit chat_webhook_url', async () => {
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' });
      updateWithETag.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Updated', project_uid: 'project-1' });

      await expect(service.updateCommittee(req, COMMITTEE_UID, { name: 'Updated' })).resolves.toMatchObject({ uid: COMMITTEE_UID });

      expect(checkSingleAccessStrict).not.toHaveBeenCalled();
    });

    it('rejects a chat_webhook_url that does not match the hooks.slack.com pattern, before touching upstream', async () => {
      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: 'https://evil.example.com/x' })).rejects.toMatchObject({
        statusCode: 400,
      });

      expect(fetchWithETag).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('accepts a well-formed hooks.slack.com URL', async () => {
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' });
      updateWithETag.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1', chat_webhook_url: VALID_WEBHOOK_URL });
      // getSlackWebhookUrlStrict's read-back confirmation GET.
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, chat_webhook_url: VALID_WEBHOOK_URL });

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL })).resolves.toMatchObject({ uid: COMMITTEE_UID });
    });

    it('throws SLACK_WEBHOOK_NOT_PERSISTED when upstream silently drops the field instead of reporting a false success (no committee-service schema support yet)', async () => {
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' });
      // Upstream's PUT response doesn't echo chat_webhook_url back — simulates today's real
      // committee-service, which has no field for it at all.
      updateWithETag.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' });
      // The read-back confirmation GET also comes back without it.
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID });

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL })).rejects.toMatchObject({
        statusCode: 409,
        code: 'SLACK_WEBHOOK_NOT_PERSISTED',
      });
    });

    it('never returns chat_webhook_url on the response even if upstream happens to echo it back', async () => {
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' });
      updateWithETag.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1', chat_webhook_url: VALID_WEBHOOK_URL });
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, chat_webhook_url: VALID_WEBHOOK_URL });

      const result = await service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL });

      expect('chat_webhook_url' in result).toBe(false);
    });

    it('does not perform the read-back confirmation GET when chat_webhook_url is not part of the update', async () => {
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' });
      updateWithETag.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Updated', project_uid: 'project-1' });

      await service.updateCommittee(req, COMMITTEE_UID, { name: 'Updated' });

      // The read-back check (getSlackWebhookUrlStrict) is the only caller of a bare GET
      // /committees/:id via proxyRequest in this flow — its absence proves the check was skipped.
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('normalizes an empty-string chat_webhook_url to null instead of a spurious read-back mismatch', async () => {
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' });
      updateWithETag.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' });
      // Read-back GET — nothing configured upstream, matching the normalized null.
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID });

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: '' })).resolves.toMatchObject({ uid: COMMITTEE_UID });
    });

    it('runs the read-back check after the settings update, so unrelated settings changes are not silently discarded when the webhook fails to persist', async () => {
      fetchWithETag
        .mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' }) // core committee fetch
        .mockResolvedValueOnce({ data: {}, etag: 'settings-etag-1' }); // settings fetch
      updateWithETag
        .mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }) // core PUT — webhook silently dropped
        .mockResolvedValueOnce(undefined); // settings PUT
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID }); // read-back GET, still no webhook

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL, is_audit_enabled: true })).rejects.toMatchObject({
        statusCode: 409,
        code: 'SLACK_WEBHOOK_NOT_PERSISTED',
      });

      // Both the core PUT and the settings PUT ran before the throw — is_audit_enabled was not
      // silently dropped just because the webhook failed to persist.
      expect(updateWithETag).toHaveBeenCalledTimes(2);
    });
  });

  describe('chat_webhook_url redaction on list/create paths (not just getCommitteeById/updateCommittee)', () => {
    it('getCommittees never returns chat_webhook_url even if the query-service index carries it', async () => {
      proxyRequest.mockResolvedValueOnce(
        pageOf([{ uid: COMMITTEE_UID, chat_webhook_url: VALID_WEBHOOK_URL } as Partial<Committee> & { chat_webhook_url: string }])
      );
      addAccessToResources.mockResolvedValueOnce([
        { uid: COMMITTEE_UID, chat_webhook_url: VALID_WEBHOOK_URL, writer: true } as Committee & { chat_webhook_url: string },
      ]);

      const result = await service.getCommittees(req, { tags: 'project_uid:project-1' }, { skipMailingListEnrichment: true });

      expect(result).toHaveLength(1);
      expect('chat_webhook_url' in result[0]).toBe(false);
    });

    it('createCommittee never returns chat_webhook_url even if upstream happens to echo it back', async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', chat_webhook_url: VALID_WEBHOOK_URL });

      const result = await service.createCommittee(req, { name: 'Test', category: 'general' });

      expect('chat_webhook_url' in result).toBe(false);
    });

    it('createCommittee strips a chat_webhook_url from the create payload before it reaches upstream — the field is update-only and unvalidated here (no pattern check, no impersonation guard)', async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test' });

      await service.createCommittee(req, {
        name: 'Test',
        category: 'general',
        ...({ chat_webhook_url: 'https://evil.example.com/x' } as unknown as Record<string, never>),
      });

      expect(proxyRequest).toHaveBeenCalledOnce();
      const sentBody = proxyRequest.mock.calls[0][5];
      expect(sentBody).not.toHaveProperty('chat_webhook_url');
    });

    it('createCommittee resolves (does not throw) when upstream returns a null body — stripChatWebhookUrl must tolerate null the same way the old bare spread did', async () => {
      proxyRequest.mockResolvedValueOnce(null);

      // The regression this guards against: an unguarded destructure inside stripChatWebhookUrl
      // (`const { chat_webhook_url, ...rest } = null`) throws synchronously, which would reject
      // this promise instead of resolving it — .resolves fails the test if that happens.
      await expect(service.createCommittee(req, { name: 'Test', category: 'general' })).resolves.toBeDefined();
    });
  });
});
