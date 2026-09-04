// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberVisibility } from '@lfx-one/shared/enums';
import type { Committee, CommitteeInvite, QueryServiceResponse } from '@lfx-one/shared/interfaces';
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
  enrichWithProjectData,
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
  // Default: pass items through unchanged — most tests don't exercise includeProjectMetadata.
  enrichWithProjectData: vi.fn((_req: unknown, items: unknown[]) => Promise.resolve(items)),
}));

vi.mock('@lfx-one/shared/enums', () => ({
  CommitteeMemberRole: {},
  CommitteeMemberVisibility: { HIDDEN: 'hidden', BASIC_PROFILE: 'basic_profile' },
}));
vi.mock('@lfx-one/shared/utils', () => ({ invitationRequiresOrganization: vi.fn() }));
vi.mock('@lfx-one/shared/constants', () => ({
  SLACK_INCOMING_WEBHOOK_URL_PATTERN: /^https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+$/,
  CHAT_WEBHOOK_URL_MAX_LENGTH: 500,
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
vi.mock('./project.service', () => ({
  ProjectService: class {
    public enrichWithProjectData = enrichWithProjectData;
  },
}));
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

import { MicroserviceError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
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
    enrichWithProjectData.mockReset().mockImplementation((_req: unknown, items: unknown[]) => Promise.resolve(items));
    // Pass-through default — most tests here don't care about access-check enrichment itself.
    addAccessToResource.mockImplementation((_req: Request, committee: Committee) => Promise.resolve(committee));
    // On by default here — this suite's own updateCommittee tests below cover the FEATURE_DISABLED
    // gate explicitly; every other test in this block exercises what happens once it's enabled.
    process.env[ServerFeatureFlag.WeeklyBriefSlack] = 'true';
    service = new CommitteeService();
  });

  afterEach(() => {
    delete process.env[ServerFeatureFlag.WeeklyBriefSlack];
  });

  describe('getCommitteeById', () => {
    it('computes has_slack_webhook from the settings-resource has_chat_webhook boolean and never returns the raw value', async () => {
      // Seeded on the SETTINGS response (second proxyRequest call), not the base one, and via the
      // upstream-computed has_chat_webhook boolean — per LFXV2-3094 / lfx-v2-committee-service
      // PR #179, upstream never returns the raw chat_webhook_url on any read, so has_chat_webhook
      // is the only real signal available.
      proxyRequest
        .mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }) // GET /committees/:id
        .mockResolvedValueOnce({ has_chat_webhook: true }); // GET /committees/:id/settings

      const result = await service.getCommitteeById(req, COMMITTEE_UID);

      expect(result.has_slack_webhook).toBe(true);
      expect('chat_webhook_url' in result).toBe(false);
      // has_chat_webhook itself is upstream's raw wire field, not part of the Committee contract
      // (has_slack_webhook is) — it must not ride out on the response just because it's spread
      // in from the settings fetch.
      expect('has_chat_webhook' in result).toBe(false);
    });

    it('reports has_slack_webhook: false when no webhook is configured upstream', async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }).mockResolvedValueOnce({ has_chat_webhook: false });

      const result = await service.getCommitteeById(req, COMMITTEE_UID);

      expect(result.has_slack_webhook).toBe(false);
    });

    it('strips a chat_webhook_url that unexpectedly shows up on the base committee resource too — defense-in-depth beyond the settings-resource source', async () => {
      proxyRequest
        .mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1', chat_webhook_url: VALID_WEBHOOK_URL })
        .mockResolvedValueOnce({ has_chat_webhook: false });

      const result = await service.getCommitteeById(req, COMMITTEE_UID);

      expect('chat_webhook_url' in result).toBe(false);
      // has_slack_webhook is sourced from settings.has_chat_webhook only — a base-resource leak
      // of the raw URL alone must not flip it true.
      expect(result.has_slack_webhook).toBe(false);
    });

    it('never returns chat_webhook_url on the includeProjectMetadata: true (enriched) path — the one actually used by GET /api/committees/:id', async () => {
      // Seeded on the SETTINGS resource, not the base one: the base-resource field is already
      // destructured away at the top of getCommitteeById, before merged/enriched ever exist —
      // seeding it there would make this pass even with the enriched-path strip deleted. Settings
      // is the one source that reaches `merged`/`enriched` unstripped, so it's the only seed that
      // actually exercises the stripChatWebhookUrl(enriched) call this test claims to cover.
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }).mockResolvedValueOnce({
        chat_webhook_url: VALID_WEBHOOK_URL,
      });
      enrichWithProjectData.mockImplementationOnce((_req: unknown, items: unknown[]) =>
        Promise.resolve((items as Committee[]).map((item) => ({ ...item, project_slug: 'test-project' })))
      );

      const result = await service.getCommitteeById(req, COMMITTEE_UID, { includeProjectMetadata: true });

      expect('chat_webhook_url' in result).toBe(false);
      expect(result.project_slug).toBe('test-project');
    });
  });

  describe('updateCommittee', () => {
    it('rejects a chat_webhook_url change (409 FEATURE_DISABLED) when the server-side kill switch is off, before touching upstream — independent of WG_WEEKLY_BRIEF_SLACK_FLAG, which is UI-only and never reaches this method', async () => {
      delete process.env[ServerFeatureFlag.WeeklyBriefSlack];

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL })).rejects.toMatchObject({
        statusCode: 409,
        code: 'FEATURE_DISABLED',
      });

      expect(fetchWithETag).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('does not gate updates that omit chat_webhook_url on the kill switch', async () => {
      delete process.env[ServerFeatureFlag.WeeklyBriefSlack];
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' });
      updateWithETag.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Updated', project_uid: 'project-1' });

      await expect(service.updateCommittee(req, COMMITTEE_UID, { name: 'Updated' })).resolves.toMatchObject({ uid: COMMITTEE_UID });
    });

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

    it('throws a typed 502 (not an untyped 500, and not a silent success) when updateWithETag returns a null body', async () => {
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' });
      updateWithETag.mockResolvedValueOnce(null);

      await expect(service.updateCommittee(req, COMMITTEE_UID, { name: 'Updated' })).rejects.toMatchObject({
        statusCode: 502,
        code: 'UPSTREAM_INVALID_RESPONSE',
      });
    });

    it('throws a typed 502 when the no-core-update GET fallback returns a null body, but only after the settings write it must not block already ran', async () => {
      proxyRequest.mockResolvedValueOnce(null); // response-shaping GET (no core fields to update)
      fetchWithETag.mockResolvedValueOnce({ data: {}, etag: 'etag-settings' }); // updateCommitteeSettings' own fetch
      updateWithETag.mockResolvedValueOnce({}); // updateCommitteeSettings' own PUT

      await expect(service.updateCommittee(req, COMMITTEE_UID, { business_email_required: true })).rejects.toMatchObject({
        statusCode: 502,
        code: 'UPSTREAM_INVALID_RESPONSE',
      });

      // The guard is checked after the settings update specifically so an empty
      // response-shaping GET can't block an otherwise-successful settings write.
      expect(updateWithETag).toHaveBeenCalledOnce();
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

    it('authorizes the webhook against the effective post-update project when the same PUT also moves the committee (project_uid) — a writer of only the old project must not pair the move with a webhook they control', async () => {
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-a' }, etag: 'etag-1' });
      // The rejection itself isn't what pins the fix — the toHaveBeenCalledWith below is: the
      // check must target the incoming project-b (committeeData.project_uid), not the
      // committee's current project-a, which is what the pre-fix code passed.
      checkSingleAccessStrict.mockResolvedValueOnce(false);

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL, project_uid: 'project-b' })).rejects.toMatchObject({
        statusCode: 403,
        code: 'NOT_PROJECT_WRITER',
      });

      expect(checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'project', id: 'project-b', access: 'writer' });
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

    it("rejects non-string chat_webhook_url JSON values (false, 0, objects) with a 400 before any write — the declared string|null type doesn't stop a raw req.body cast, and a truthiness-only check would otherwise let falsy non-strings skip the pattern test entirely", async () => {
      for (const badValue of [false, 0, { url: VALID_WEBHOOK_URL }]) {
        await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: badValue as unknown as string })).rejects.toMatchObject({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
        });
      }

      expect(fetchWithETag).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('rejects a chat_webhook_url longer than CHAT_WEBHOOK_URL_MAX_LENGTH, even if it otherwise matches the pattern, before touching upstream', async () => {
      const overLongUrl = `https://hooks.slack.com/services/T000/B000/${'X'.repeat(500)}`;

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: overLongUrl })).rejects.toMatchObject({
        statusCode: 400,
      });

      expect(fetchWithETag).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('rejects a webhook-only change (403 NOT_PROJECT_WRITER) with no other core or settings field, before any write — the project-writer check must not depend on another core field being present to trigger it', async () => {
      // No core field in this payload, so the old (pre-LFXV2-3094) code path would have skipped
      // the authorization check entirely by going straight to the no-core-update GET fallback.
      // The webhook-only branch must fetch project_uid and run the same check regardless.
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }); // webhook-only branch's committee GET
      checkSingleAccessStrict.mockResolvedValueOnce(false);

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL })).rejects.toMatchObject({
        statusCode: 403,
        code: 'NOT_PROJECT_WRITER',
      });

      expect(checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'project', id: 'project-1', access: 'writer' });
      expect(fetchWithETag).not.toHaveBeenCalled();
      expect(updateWithETag).not.toHaveBeenCalled();
    });

    it('throws a typed 404 (not a misleading 403 NOT_PROJECT_WRITER, and before any write) for a webhook-only change on a committee that no longer exists', async () => {
      // The webhook-only branch's committee GET resolves null (deleted/nonexistent committee).
      // Thrown immediately, before the authorization check and before updateCommitteeSettings —
      // deferring to the generic response-shaping guard further down would let the settings
      // write (including the webhook itself) commit with no project-writer check at all, since
      // assertWebhookChangeAuthorized never runs without a project_uid to check against.
      proxyRequest.mockResolvedValueOnce(null); // webhook-only branch's committee GET

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL })).rejects.toMatchObject({
        statusCode: 404,
      });

      expect(checkSingleAccessStrict).not.toHaveBeenCalled();
      expect(fetchWithETag).not.toHaveBeenCalled();
      expect(updateWithETag).not.toHaveBeenCalled();
    });

    it('accepts a well-formed hooks.slack.com URL, PUTting it through the settings endpoint (not the base committee PUT)', async () => {
      // Webhook-only payload — no core field — so this goes through the settings-only branch: a
      // plain GET for project_uid/response-shaping, then the settings fetchWithETag/updateWithETag
      // pair. No read-back confirmation GET — the upstream schema (LFXV2-3094/#177) is merged and
      // deployed, so a normal updateWithETag failure already surfaces correctly on its own.
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }); // webhook-only branch's committee GET
      fetchWithETag.mockResolvedValueOnce({ data: {}, etag: 'settings-etag-1' }); // updateCommitteeSettings' own fetch
      updateWithETag.mockResolvedValueOnce(undefined); // updateCommitteeSettings' own PUT

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL })).resolves.toMatchObject({ uid: COMMITTEE_UID });

      // Pins the actual contract this PR is about: chat_webhook_url must land in the SETTINGS
      // PUT body, not the base committee PUT — a regression that dropped it from the settings
      // body or hit the wrong resource would otherwise still pass every other test here.
      expect(updateWithETag).toHaveBeenCalledWith(
        req,
        'LFX_V2_SERVICE',
        `/committees/${COMMITTEE_UID}/settings`,
        'settings-etag-1',
        expect.objectContaining({ chat_webhook_url: VALID_WEBHOOK_URL }),
        'update_committee_settings'
      );
    });

    it('never echoes has_chat_webhook (upstream read-only computed field) back in the settings PUT body, even though it rides in via the current-settings fetch', async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' });
      fetchWithETag.mockResolvedValueOnce({
        data: { business_email_required: false, has_chat_webhook: true },
        etag: 'settings-etag-1',
      });
      updateWithETag.mockResolvedValueOnce(undefined);

      await service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL });

      const settingsPutBody = updateWithETag.mock.calls[0][4];
      expect('has_chat_webhook' in settingsPutBody).toBe(false);
      // Confirms the strip targets only has_chat_webhook — a real current setting alongside it
      // must still survive into the PUT body unchanged.
      expect(settingsPutBody.business_email_required).toBe(false);
    });

    it('accepts a combined core-field + webhook change, PUTting the core fields to the base resource and chat_webhook_url to settings', async () => {
      // The production UI (committee-settings-tab.component.ts) always sends chat_channel/
      // join_mode/website alongside chat_webhook_url in one save — this is the actual happy path
      // that reaches upstream, not the webhook-only branch alone. Every other core+webhook test
      // above only covers the authorization-failure side of this branch.
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'core-etag-1' });
      updateWithETag.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1', chat_channel: '#general' }); // core PUT
      fetchWithETag.mockResolvedValueOnce({ data: {}, etag: 'settings-etag-1' }); // updateCommitteeSettings' own fetch
      updateWithETag.mockResolvedValueOnce(undefined); // updateCommitteeSettings' own PUT

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_channel: '#general', chat_webhook_url: VALID_WEBHOOK_URL })).resolves.toMatchObject({
        uid: COMMITTEE_UID,
        chat_channel: '#general',
      });

      expect(checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'project', id: 'project-1', access: 'writer' });
      expect(updateWithETag).toHaveBeenNthCalledWith(
        1,
        req,
        'LFX_V2_SERVICE',
        `/committees/${COMMITTEE_UID}`,
        'core-etag-1',
        expect.objectContaining({ chat_channel: '#general' }),
        'update_committee'
      );
      expect(updateWithETag).toHaveBeenNthCalledWith(
        2,
        req,
        'LFX_V2_SERVICE',
        `/committees/${COMMITTEE_UID}/settings`,
        'settings-etag-1',
        expect.objectContaining({ chat_webhook_url: VALID_WEBHOOK_URL }),
        'update_committee_settings'
      );
    });

    it('never returns chat_webhook_url on the response even if upstream happens to echo it back', async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1', chat_webhook_url: VALID_WEBHOOK_URL });
      fetchWithETag.mockResolvedValueOnce({ data: {}, etag: 'settings-etag-1' });
      updateWithETag.mockResolvedValueOnce(undefined);

      const result = await service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL });

      expect('chat_webhook_url' in result).toBe(false);
    });

    it('does not run the webhook-only branch when chat_webhook_url is not part of the update', async () => {
      fetchWithETag.mockResolvedValueOnce({ data: { uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }, etag: 'etag-1' });
      updateWithETag.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Updated', project_uid: 'project-1' });

      await service.updateCommittee(req, COMMITTEE_UID, { name: 'Updated' });

      // The webhook-only branch's committee GET is the only bare proxyRequest call site in this
      // flow — its absence proves the branch was skipped.
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it("sends an empty-string chat_webhook_url through to the settings PUT payload as-is — upstream treats null/omitted as preserve, only '' as clear", async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' });
      fetchWithETag.mockResolvedValueOnce({ data: {}, etag: 'settings-etag-1' });
      updateWithETag.mockResolvedValueOnce(undefined);

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: '' })).resolves.toMatchObject({ uid: COMMITTEE_UID });

      expect(updateWithETag).toHaveBeenCalledWith(
        req,
        'LFX_V2_SERVICE',
        `/committees/${COMMITTEE_UID}/settings`,
        'settings-etag-1',
        expect.objectContaining({ chat_webhook_url: '' }),
        'update_committee_settings'
      );
    });

    it("normalizes an explicit null chat_webhook_url to '' in the settings PUT payload too — a caller sending null to THIS API means clear, same as '', even though upstream's own null means preserve", async () => {
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' });
      fetchWithETag.mockResolvedValueOnce({ data: {}, etag: 'settings-etag-1' });
      updateWithETag.mockResolvedValueOnce(undefined);

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: null })).resolves.toMatchObject({ uid: COMMITTEE_UID });

      expect(updateWithETag).toHaveBeenCalledWith(
        req,
        'LFX_V2_SERVICE',
        `/committees/${COMMITTEE_UID}/settings`,
        'settings-etag-1',
        expect.objectContaining({ chat_webhook_url: '' }),
        'update_committee_settings'
      );
    });

    it('sends chat_webhook_url alongside other settings fields in a single settings PUT when there is no core update', async () => {
      // chat_webhook_url and is_audit_enabled are both settings-routed fields — no core field in
      // this payload, so only ONE PUT happens (settings), not two.
      proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1' }); // webhook-only branch's committee GET
      fetchWithETag.mockResolvedValueOnce({ data: {}, etag: 'settings-etag-1' });
      updateWithETag.mockResolvedValueOnce(undefined);

      await expect(service.updateCommittee(req, COMMITTEE_UID, { chat_webhook_url: VALID_WEBHOOK_URL, is_audit_enabled: true })).resolves.toMatchObject({
        uid: COMMITTEE_UID,
      });

      expect(updateWithETag).toHaveBeenCalledTimes(1);
      expect(updateWithETag).toHaveBeenCalledWith(
        req,
        'LFX_V2_SERVICE',
        `/committees/${COMMITTEE_UID}/settings`,
        'settings-etag-1',
        expect.objectContaining({ chat_webhook_url: VALID_WEBHOOK_URL, is_audit_enabled: true }),
        'update_committee_settings'
      );
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

    it('getCommitteesByIds never returns chat_webhook_url even if the query-service index carries it', async () => {
      proxyRequest.mockResolvedValueOnce(
        pageOf([{ uid: COMMITTEE_UID, chat_webhook_url: VALID_WEBHOOK_URL } as Partial<Committee> & { chat_webhook_url: string }])
      );

      const result = await service.getCommitteesByIds(req, [COMMITTEE_UID]);

      expect(result.size).toBe(1);
      expect('chat_webhook_url' in (result.get(COMMITTEE_UID) ?? {})).toBe(false);
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

    it('createCommittee throws a typed 502 (not an untyped 500, and not a silent uid-less success) when upstream returns a null body', async () => {
      proxyRequest.mockResolvedValueOnce(null);

      // Fails loud, not silently: a body-less create response means the committee-service never
      // confirmed anything was created. Resolving with a uid-less object instead would let the
      // controller respond 201 with committee.uid undefined, and the client's post-create flow
      // reads that uid immediately to add members.
      await expect(service.createCommittee(req, { name: 'Test', category: 'general' })).rejects.toMatchObject({
        statusCode: 502,
        code: 'UPSTREAM_INVALID_RESPONSE',
      });
    });

    it('createCommittee throws before attempting the settings update when upstream returns a null body AND a settings field was requested', async () => {
      proxyRequest.mockResolvedValueOnce(null);

      await expect(service.createCommittee(req, { name: 'Test', category: 'general', is_audit_enabled: true })).rejects.toMatchObject({
        statusCode: 502,
        code: 'UPSTREAM_INVALID_RESPONSE',
      });

      // The settings PUT itself must not have been attempted — there's no committee uid to target.
      expect(updateWithETag).not.toHaveBeenCalled();
    });
  });
});

describe('CommitteeService.getCommitteesByIds', () => {
  let service: CommitteeService;

  beforeEach(() => {
    proxyRequest.mockReset();
    vi.mocked(fetchAllQueryResources).mockReset();
    service = new CommitteeService();
  });

  it('returns an empty map without calling upstream when given no uids', async () => {
    const result = await service.getCommitteesByIds(req, []);

    expect(result.size).toBe(0);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('chunks more than 100 uids into separate batched requests, keyed by uid', async () => {
    const firstBatch = Array.from({ length: 100 }, (_, i) => `uid-${i}`);
    const secondBatch = ['uid-100', 'uid-101'];
    const uids = [...firstBatch, ...secondBatch];

    proxyRequest
      .mockResolvedValueOnce(pageOf(firstBatch.map((uid) => ({ uid, project_name: `Project ${uid}` }))))
      .mockResolvedValueOnce(pageOf(secondBatch.map((uid) => ({ uid, project_name: `Project ${uid}` }))));

    const result = await service.getCommitteesByIds(req, uids);

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'committee', filters_or: firstBatch.map((uid) => `uid:${uid}`) });
    expect(proxyRequest.mock.calls[1][4]).toMatchObject({ type: 'committee', filters_or: secondBatch.map((uid) => `uid:${uid}`) });
    expect(result.size).toBe(102);
    expect(result.get('uid-101')?.project_name).toBe('Project uid-101');
  });

  it('propagates a batch failure to the caller rather than failing soft (per failOnPartial callers)', async () => {
    const firstBatch = Array.from({ length: 100 }, (_, i) => `uid-${i}`);
    const secondBatch = ['uid-100'];

    proxyRequest.mockResolvedValueOnce(pageOf(firstBatch.map((uid) => ({ uid, project_name: `Project ${uid}` })))).mockRejectedValueOnce(new Error('boom'));

    await expect(service.getCommitteesByIds(req, [...firstBatch, ...secondBatch])).rejects.toThrow('boom');
    expect(logger.warning).toHaveBeenCalledWith(req, 'get_committees_by_ids', expect.any(String), expect.objectContaining({ batch_size: secondBatch.length }));
  });
});

describe('CommitteeService.getCommitteeBase', () => {
  let service: CommitteeService;
  const COMMITTEE_UID = 'committee-1';

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new CommitteeService();
  });

  it("returns the base committee from a single plain GET, not getCommitteeById's enriched fan-out", async () => {
    proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, name: 'Test', project_uid: 'project-1', category: 'Board' });

    const result = await service.getCommitteeBase(req, COMMITTEE_UID);

    expect(result).toMatchObject({ uid: COMMITTEE_UID, category: 'Board' });
    // Exactly one upstream call — no settings, no access-check, unlike getCommitteeById.
    expect(proxyRequest).toHaveBeenCalledOnce();
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `/committees/${COMMITTEE_UID}`, 'GET');
  });

  it('returns undefined when upstream resolves with no committee body (the empty-body-parses-to-null case, not a 404)', async () => {
    proxyRequest.mockResolvedValueOnce(null);

    const result = await service.getCommitteeBase(req, COMMITTEE_UID);

    expect(result).toBeUndefined();
  });

  it('strips chat_webhook_url before returning — this is a raw-upstream-fetch read path, same invariant as every other Committee-returning method', async () => {
    proxyRequest.mockResolvedValueOnce({ uid: COMMITTEE_UID, category: 'Board', chat_webhook_url: 'https://hooks.slack.com/services/T1/B1/secret' });

    const result = await service.getCommitteeBase(req, COMMITTEE_UID);

    expect(result).not.toHaveProperty('chat_webhook_url');
    expect(result).toMatchObject({ uid: COMMITTEE_UID, category: 'Board' });
  });

  it('propagates a genuine upstream error (e.g. 404) rather than normalizing it to undefined', async () => {
    const upstreamError = MicroserviceError.fromMicroserviceResponse(
      404,
      'Not Found',
      undefined,
      'LFX_V2_SERVICE',
      `/committees/${COMMITTEE_UID}`,
      'get_committee'
    );
    proxyRequest.mockRejectedValueOnce(upstreamError);

    // Identity, not just type/status — proves the exact upstream error propagates rather than
    // getting caught and re-thrown as a freshly constructed lookalike (which a type/status-only
    // assertion couldn't tell apart from this).
    await expect(service.getCommitteeBase(req, COMMITTEE_UID)).rejects.toBe(upstreamError);
  });
});

describe('CommitteeService.getMyPendingInvitations — inviter/expiry mapping', () => {
  let service: CommitteeService;

  const baseInvite = (over: Partial<CommitteeInvite>): CommitteeInvite => ({
    uid: 'invite-1',
    committee_uid: 'committee-1',
    invitee_email: 'invitee@example.com',
    status: 'pending',
    created_at: '2026-01-02T03:04:05Z',
    committee_name: 'Technical Steering Committee',
    ...over,
  });

  // Computed relative to now so the expired-invite filter behaves deterministically regardless of
  // the wall clock (a hardcoded date would flip from future to past over time).
  const futureExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // fetchAllQueryResources (real impl) unwraps resources[].data, so wrap each invite accordingly.
  const mockInvites = (invites: CommitteeInvite[]): void => {
    proxyRequest.mockResolvedValue({ resources: invites.map((data) => ({ data })) });
  };

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new CommitteeService();
    // Isolate the raw-invite → PendingInvitation mapping from committee/project enrichment.
    (service as unknown as { getCommitteesByIds: unknown }).getCommitteesByIds = vi.fn().mockResolvedValue(new Map());
  });

  it('maps inviter_name and expires_at from a fully populated inviter', async () => {
    mockInvites([
      baseInvite({
        inviter: { name: 'First Last', username: 'first-last', email: 'first.last@example.com', avatar: 'https://cdn.example.com/avatar.png' },
        expires_at: futureExpiry,
      }),
    ]);

    const [row] = await service.getMyPendingInvitations(req, 'invitee@example.com');

    expect(row.inviter_name).toBe('First Last');
    expect(row.expires_at).toBe(futureExpiry);
  });

  it('falls back to the username for a username-only partial inviter, and keeps expires_at', async () => {
    mockInvites([
      baseInvite({
        inviter: { username: 'first-last' },
        expires_at: futureExpiry,
      }),
    ]);

    const [row] = await service.getMyPendingInvitations(req, 'invitee@example.com');

    expect(row.inviter_name).toBe('first-last');
    expect(row.expires_at).toBe(futureExpiry);
  });

  it('maps both to null on legacy invites missing inviter and expiry', async () => {
    mockInvites([baseInvite({})]);

    const [row] = await service.getMyPendingInvitations(req, 'invitee@example.com');

    expect(row.inviter_name).toBeNull();
    expect(row.expires_at).toBeNull();
  });

  it('falls back to the username when the inviter name is whitespace-only', async () => {
    mockInvites([baseInvite({ inviter: { name: '   ', username: 'first-last' } })]);

    const [row] = await service.getMyPendingInvitations(req, 'invitee@example.com');

    expect(row.inviter_name).toBe('first-last');
  });

  it('maps inviter_name to null when both name and username are absent', async () => {
    mockInvites([baseInvite({ inviter: { email: 'first.last@example.com' } })]);

    const [row] = await service.getMyPendingInvitations(req, 'invitee@example.com');

    expect(row.inviter_name).toBeNull();
  });

  it('excludes an invite whose expiry has passed (accept would be rejected upstream)', async () => {
    mockInvites([baseInvite({ uid: 'expired-invite', expires_at: pastExpiry })]);

    const rows = await service.getMyPendingInvitations(req, 'invitee@example.com');

    expect(rows).toHaveLength(0);
  });

  it('keeps invites with no expiry or an unparseable expiry, dropping only the expired one', async () => {
    mockInvites([
      baseInvite({ uid: 'legacy-no-expiry' }),
      baseInvite({ uid: 'unparseable-expiry', expires_at: 'not-a-date' }),
      baseInvite({ uid: 'expired', expires_at: pastExpiry }),
    ]);

    const rows = await service.getMyPendingInvitations(req, 'invitee@example.com');

    expect(rows.map((r) => r.uid).sort()).toEqual(['legacy-no-expiry', 'unparseable-expiry']);
  });
});
