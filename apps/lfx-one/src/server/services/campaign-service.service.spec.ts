// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape as access-check.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into
// this app's vitest config, so runtime collaborators are mocked. This file's own imports from
// `@lfx-one/shared/interfaces` are type-only, so esbuild elides them.
const { proxyRequest, proxyRequestWithResponse, logger } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  proxyRequestWithResponse: vi.fn(),
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn(), startOperation: vi.fn(() => 0) },
}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
    public proxyRequestWithResponse = proxyRequestWithResponse;
  },
}));

// The real logger reads request fields this spec's `{}` stand-in does not have. Mocked rather
// than fattening `req`, because the log line is not what these tests are about — and a real
// logger would print two warnings per run for the paths that deliberately exercise them.
vi.mock('./logger.service', () => ({ logger }));

import { JOB_LOST_MESSAGE } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import type { CampaignBriefOutput } from '@lfx-one/shared/interfaces';

import { MicroserviceError } from '../errors/microservice.error';
import { adaptJobPollResponse, CampaignServiceClient, deriveEventSlug, fromBriefResponse, isCampaignServiceJobId } from './campaign-service.service';

const req = {} as unknown as Request;

function briefWithSlug(slug: string): CampaignBriefOutput {
  return {
    eventDetails: {
      name: 'KubeCon EU 2026',
      dates: '2026-03-23 to 2026-03-26',
      city: 'Amsterdam',
      countryCode: 'NL',
      audience: 'platform engineers',
      themes: ['kubernetes'],
      registrationUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/',
      speakers: [],
      slug,
      formatNotes: '',
    },
    structuredCopy: { headline: 'Register now' },
    keywords: [{ term: 'kubecon', matchType: 'Exact', intentLevel: 'High', notes: '' }],
    hsUtm: 'kubecon-eu-2026',
    totalBudget: 5000,
    driveFolderUrl: 'https://drive.google.com/drive/folders/abc',
    campaignGoal: 'conversions',
    programType: 'events',
    selectedPlatforms: ['google-ads'],
  };
}

const NOT_FOUND = new MicroserviceError('not found', 404, 'NOT_FOUND', { errorBody: { code: '404', message: 'the resource was not found' } });

/**
 * An `ApiResponse` as `proxyRequestWithResponse` resolves it.
 *
 * The ETag goes in `headers`, never in `data`, because that is where campaign-service actually
 * puts it: `design/brief.go` maps it to the `ETag` response header on every brief response, so
 * the generated body struct has no such field. A fake that answered `{ etag }` out of the body
 * would pass against an implementation that reads `data.etag` and always gets `undefined` —
 * exactly the bug these specs exist to pin.
 *
 * Lower-cased key, matching `api-client.service.ts`, which builds this map from a fetch
 * `Headers` iteration.
 */
function apiResponse<T>(data: T, headers: Record<string, string> = {}): { data: T; status: number; statusText: string; headers: Record<string, string> } {
  return { data, status: 200, statusText: 'OK', headers };
}

describe('adaptJobPollResponse', () => {
  // The poller terminates on `takeWhile((s) => s.status === 'running', true)`. `queued` is the
  // state every job is in on its first tick, so forwarding it raw stops the poll immediately
  // and reports a finished create with no campaigns — for a job that has not started.
  it('maps queued to running so the first poll does not terminate the job', () => {
    expect(adaptJobPollResponse({ job_id: 'j1', status: 'queued' })).toEqual({ status: 'running' });
  });

  it('maps running to running', () => {
    expect(adaptJobPollResponse({ job_id: 'j1', status: 'running' })).toEqual({ status: 'running' });
  });

  // The mirror-image failure, and NOT a hang — `takeWhile(..., true)` is inclusive, so a raw
  // `succeeded` is emitted and the poll completes promptly. The damage is downstream:
  // `getCreateResult` matches none of its arms on that status, falls through to its last
  // `throw`, and reports "Campaign creation is taking longer than expected" for a job that
  // finished immediately and successfully — with the campaigns it created never rendered.
  it('maps succeeded to done and converts the per-platform results', () => {
    expect(
      adaptJobPollResponse({
        job_id: 'j1',
        status: 'succeeded',
        result: [{ platform: 'google-ads', ok: true, campaign_id: '123' }],
      })
    ).toEqual({
      status: 'done',
      platformResults: [{ platform: 'google-ads', ok: true, campaignId: '123', error: undefined }],
      error: undefined,
    });
  });

  // A partial job created real campaigns. Reporting the JOB as failed would hide them; each
  // platform's own `ok` flag carries the per-platform truth.
  it('maps partial to done and keeps both the succeeded and the failed platform', () => {
    const adapted = adaptJobPollResponse({
      job_id: 'j1',
      status: 'partial',
      result: [
        { platform: 'google-ads', ok: true, campaign_id: '123' },
        { platform: 'meta-ads', ok: false, error: 'budget rejected' },
      ],
    });

    expect(adapted.status).toBe('done');
    expect(adapted.platformResults).toEqual([
      { platform: 'google-ads', ok: true, campaignId: '123', error: undefined },
      { platform: 'meta-ads', ok: false, campaignId: undefined, error: 'budget rejected' },
    ]);
  });

  it('maps failed to error and always carries a message', () => {
    expect(adaptJobPollResponse({ job_id: 'j1', status: 'failed' })).toEqual({
      status: 'error',
      platformResults: undefined,
      error: 'campaign creation failed',
    });
    expect(adaptJobPollResponse({ job_id: 'j1', status: 'failed', error: 'no credentials' }).error).toBe('no credentials');
  });

  // An unrecognised status is a contract change, not a terminal state. `done` would claim
  // campaigns exist that nobody verified.
  it('treats an unrecognised status as an error rather than as done', () => {
    const adapted = adaptJobPollResponse({ job_id: 'j1', status: 'cancelled' } as never);
    expect(adapted.status).toBe('error');
    expect(adapted.error).toContain('cancelled');
  });

  // campaign-service reports neither ad-group/keyword/ad counts nor a campaign URL. Synthesising
  // a `result` here would make the implementation tab render "0 ad groups · 0 keywords · 0 ads"
  // and an empty link for a campaign that really has them.
  it('never synthesises a CampaignCreateResponse result', () => {
    const adapted = adaptJobPollResponse({ job_id: 'j1', status: 'succeeded', result: [{ platform: 'google-ads', ok: true, campaign_id: '1' }] });
    expect(adapted.result).toBeUndefined();
  });
});

describe('isCampaignServiceJobId', () => {
  // Creation is NOT cut over: it still mints `job_<epoch>_<rand>` in `campaign-proxy.service.ts`,
  // and campaign-service's `get-job` declares `Format(FormatUUID)` on the path parameter. Routing
  // on the flag alone would 400 every poll the moment the flag was turned on — breaking the exact
  // flow the flag exists to fix. The shape is what makes the two sources distinguishable.
  it('accepts a campaign-service UUID job id', () => {
    expect(isCampaignServiceJobId('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);
    expect(isCampaignServiceJobId('3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe(true);
  });

  it('rejects the in-process job id shape so those polls keep their current source', () => {
    expect(isCampaignServiceJobId('job_1754812800000_a1b2c3')).toBe(false);
    expect(isCampaignServiceJobId('')).toBe(false);
    expect(isCampaignServiceJobId('3f2504e0-4f89-11d3-9a0c-0305e82c330')).toBe(false);
    expect(isCampaignServiceJobId('3f2504e0-4f89-11d3-9a0c-0305e82c3301-extra')).toBe(false);
  });
});

describe('CampaignServiceClient.getJobStatus', () => {
  beforeEach(() => {
    proxyRequest.mockReset();
  });

  // The SLUG goes on the wire, deliberately un-resolved. `create-brief` accepts a slug only
  // (`Pattern(^[a-z0-9]+(-[a-z0-9]+)*$)`, which a UUID fails) and stores exactly that string;
  // `GetJob` then scopes with an EXACT `b.project_id = $2`. Polling under the project's uid
  // would look more canonical and never find the job.
  // Was "scopes the request to the tlf slug". The slug is now the CALLER'S, because creation
  // through campaign-service makes UUID jobs real and a hardcoded 'tlf' would poll another
  // foundation's scope — `GetJob` joins `b.project_id` with an exact comparison, so it would
  // answer `not_found` for a running job, and `not_found` is terminal for the poller (LFXV2-3195).
  it("scopes the request to the CALLER's project slug, not a hardcoded one", async () => {
    proxyRequest.mockResolvedValue({ job_id: 'j1', status: 'queued' });

    await expect(new CampaignServiceClient().getJobStatus(req, 'j1', 'cncf')).resolves.toEqual({ status: 'running' });
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/cncf/jobs/j1', 'GET');
  });

  // Still a SLUG on the wire, never a resolved uid: campaign_briefs.project_id stores the exact
  // string the create was made with.
  it('sends the slug verbatim rather than resolving it', async () => {
    proxyRequest.mockResolvedValue({ job_id: 'j1', status: 'queued' });

    await new CampaignServiceClient().getJobStatus(req, 'j1', 'tlf');
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/jobs/j1', 'GET');
  });

  it('encodes both the job id and the slug into the path', async () => {
    proxyRequest.mockResolvedValue({ job_id: 'a/b', status: 'running' });

    await new CampaignServiceClient().getJobStatus(req, 'a/b', 'a/b');
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/a%2Fb/jobs/a%2Fb', 'GET');
  });

  // The flag-off path returns a `not_found` STATUS for an unknown job, and the poller has an
  // arm for it. A thrown 404 would take a different branch in the component, so the two sides
  // of the cutover would disagree on an outcome only the expired-job case reaches.
  it('translates campaign-service own typed 404 into the not_found status the in-process path returns', async () => {
    proxyRequest.mockRejectedValue(new MicroserviceError('not found', 404, 'NOT_FOUND', { errorBody: { code: '404', message: 'the resource was not found' } }));

    await expect(new CampaignServiceClient().getJobStatus(req, 'j1')).resolves.toEqual({
      status: 'not_found',
      error: JOB_LOST_MESSAGE,
    });
  });

  // The cutover's most likely first-deploy failure: the campaign-service route is absent or
  // misrouted and the GATEWAY answers 404. `not_found` is terminal for the poller, so accepting
  // that 404 would tell the user a running campaign was lost AND bury the misconfiguration.
  // Traefik's 404 is plain text, which `api-client.service.ts` leaves as a null `errorBody`.
  it.each([
    ['a plain-text gateway 404 (null body)', null],
    ['an untyped JSON 404', { error: 'not found' }],
    ['a 404 whose code is not the literal string', { code: 404, message: 'nope' }],
  ])('rethrows %s rather than reporting the job lost', async (_label, errorBody) => {
    proxyRequest.mockRejectedValue(new MicroserviceError('not found', 404, 'NOT_FOUND', { errorBody }));

    await expect(new CampaignServiceClient().getJobStatus(req, 'j1')).rejects.toMatchObject({ statusCode: 404 });
  });

  // Only 404. Anything else means the status is UNKNOWN, and reporting unknown as `not_found`
  // tells the user their campaign creation was lost when it may be running fine.
  it.each([401, 500, 503])('rethrows a %i rather than reporting the job lost', async (statusCode) => {
    proxyRequest.mockRejectedValue(new MicroserviceError('upstream', statusCode, 'ERR'));

    await expect(new CampaignServiceClient().getJobStatus(req, 'j1')).rejects.toMatchObject({ statusCode });
  });
});

describe('deriveEventSlug', () => {
  // `planning-tab.component.ts` synthesises event details when the scrape produced none, taking
  // the slug from the pasted URL's last path segment — which is `''` for a bare origin. Both
  // `find-brief` and `BriefInput` declare MinLength(1), so an unchecked empty slug is a 400
  // naming a field the user never filled in.
  it.each(['', '   ', '\t\n'])('rejects the empty slug the URL fallback can produce (%j)', (slug) => {
    expect(deriveEventSlug(briefWithSlug(slug))).toBeNull();
  });

  // Trimming DETECTS emptiness; it must not rewrite the value. The slug is the lookup key for
  // every later find, so normalising here and not wherever the next one is written would make
  // the two disagree about which brief belongs to this event.
  it('returns a padded slug unchanged rather than normalising the lookup key', () => {
    expect(deriveEventSlug(briefWithSlug(' kubecon-eu-2026 '))).toBe(' kubecon-eu-2026 ');
  });
});

describe('CampaignServiceClient.saveBrief', () => {
  beforeEach(() => {
    proxyRequestWithResponse.mockReset();
  });

  // The documented first-time case: `design/brief.go:302` calls a find-brief 404 "the ordinary
  // first-time-generation case — the caller then generates one and POSTs it to create-brief."
  it('creates the brief when campaign-service reports none for the slug', async () => {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"2"' }));

    // `allowEtagFallback` — these exercise the FALLBACK validator, which is now reached only by
    // explicit permission (the user saw a stale-brief warning and proceeded). Without the flag an
    // absent validator means "unknown" and the save is refused.
    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'tlf', 'b-1', null, true)).resolves.toEqual({
      enabled: true,
      briefId: 'b-1',
      // The APPROVAL's validator, not the create's: approve bumps `version`, so the create's
      // ETag is stale the moment it succeeds and would 412 the next write.
      etag: '"2"',
      created: true,
      approved: true,
    });

    expect(proxyRequestWithResponse).toHaveBeenNthCalledWith(1, req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/briefs', 'GET', {
      event_slug: 'kubecon-eu-2026',
    });
    expect(proxyRequestWithResponse.mock.calls[1]?.[3]).toBe('POST');
  });

  // A create-409 means another save of this event landed first. It is NOT retried as a replace.
  // The colliding request is whichever POST arrived second, and that is not necessarily the one
  // that STARTED second — so a retry would let a slow earlier save overwrite the newer brief that
  // already succeeded and already told its user "Brief saved." Nothing here can order the two, so
  // the conflict is reported. Concurrency within one session is removed in the component instead,
  // by running its saves one at a time.
  /**
   * The core of LFXV2-3200: a caller that cannot NAME the stored brief must not replace it.
   *
   * Two routes reach a save with no known id, and only one involves a slug mismatch — the other
   * is a reload or a second tab, where the slugs agree perfectly and the page simply never
   * loaded the brief. So this refuses on ownership rather than on any slug comparison, and
   * returns the blocking id so the caller can offer to load it instead of only failing.
   */
  it('does not hand back the id of a brief the caller was told it does not own', async () => {
    // The id was the whole attack. A caller could omit `brief_id`, read `existing.brief.id` out
    // of this refusal, then replay it with `etag_fallback=1` -- the ownership check accepts the
    // echoed id as proof and the fallback supplies a freshly read validator, overwriting content
    // the caller never opened. Withholding the id leaves the replay nothing to replay.
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'someone-elses', version: 3 }, { etag: '"3"' }));

    const result = await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf');

    expect(result.conflict).toBe('unowned-brief-exists');
    expect(result.briefId).toBe('');
    // Belt and braces: the id must not appear anywhere in the payload.
    expect(JSON.stringify(result)).not.toContain('someone-elses');
  });

  it('refuses to replace a stored brief the caller cannot prove it owns', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }));

    const result = await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', null);

    expect(result).toMatchObject({ conflict: 'unowned-brief-exists', briefId: '', created: false, approved: false });
    // One upstream call — the find. No PUT was attempted.
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
  });

  // A DIFFERENT id is the same refusal as none: holding some other event's brief id is not
  // ownership of this one, and treating it as such is how a stale page overwrites a fresh row.
  it('refuses when the caller names a different brief than the one stored', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }));

    const result = await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-999');

    expect(result).toMatchObject({ conflict: 'unowned-brief-exists', briefId: '' });
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
  });

  it('reports a create conflict rather than overwriting the brief that won the race', async () => {
    proxyRequestWithResponse.mockRejectedValueOnce(NOT_FOUND).mockRejectedValueOnce(new MicroserviceError('conflict', 409, 'CONFLICT'));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true)).rejects.toThrow('conflict');
    // The find and the POST, and nothing after: no re-find, no PUT.
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(2);
  });

  // The page is reachable by an ED of any foundation — `executiveDirectorGuard` gates on persona
  // and `projectQueryParamGuard` seeds the context from `?project=` — while campaign-service
  // scopes every brief on its project. A hard-coded `tlf` would file a CNCF ED's brief in TLF's
  // table, under a unique index that then collides it with unrelated TLF work for the same event.
  it("files the brief under the caller's foundation rather than a fixed slug", async () => {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"2"' }));

    await new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'cncf', 'b-1');

    expect(proxyRequestWithResponse.mock.calls.map((call: unknown[]) => call[2])).toEqual([
      '/projects/cncf/briefs',
      '/projects/cncf/briefs',
      '/projects/cncf/briefs/b-1/approve',
    ]);
  });

  // campaign-service writes every brief as `draft` and `replaceBriefQuery` resets an existing one
  // to `draft` on every PUT, while `create-campaigns` and `build-audience` both refuse anything
  // that is not `approved`. Without this call the durable record never reflects the approval the
  // user gave by proceeding to Implementation, and Phase 3 cannot create a campaign from it.
  it('approves the written brief with the validator the write returned', async () => {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"2"' }));

    await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true);

    const [, service, path, method, query, body, headers] = proxyRequestWithResponse.mock.calls[2] as unknown[];
    expect([service, path, method, query, body]).toEqual(['LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/briefs/b-1/approve', 'POST', undefined, undefined]);
    // `approve-brief` declares PreconditionRequired for a missing If-Match, and the only correct
    // value is the one the write just returned.
    expect(headers).toEqual({ 'If-Match': '"1"' });
  });

  // A failed approval is not a failed save. The brief is durable at this point, so reporting an
  // error would tell the user to regenerate a brief that is sitting in the database — and Phase 3
  // has to re-check approval at a version anyway, so it can re-approve.
  it('reports a saved-but-unapproved brief rather than failing the save', async () => {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      .mockRejectedValueOnce(new MicroserviceError('forbidden', 403, 'FORBIDDEN'));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true)).resolves.toEqual({
      enabled: true,
      briefId: 'b-1',
      // The write's own validator, still current — and a refusal is what makes that safe to say.
      // Nothing was committed, so no `version = version + 1` ran.
      etag: '"1"',
      created: true,
      approved: false,
    });
  });

  // 412 is a refusal too, but it is the one refusal that also reports the validator is wrong: the
  // approval sends `If-Match: writeEtag`, so a 412 IS the server saying that is not what it holds.
  // Returning it anyway would hand the caller a validator known to be stale, which is worse than
  // handing it none — the next write would 412 on a precondition this layer already knew had
  // failed, instead of re-reading.
  it('does not report "saved" when the brief was removed before approval', async () => {
    // A TYPED 404 -- campaign-service's own, carrying `code: '404'` -- means the row is gone,
    // deleted or archived between the write and the approval. Classified as an ordinary rejected
    // approval it returned the write ETag with NO conflict, so the component rendered
    // "Brief saved." for a brief that no longer exists.
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      .mockRejectedValueOnce(new MicroserviceError('gone', 404, 'NOT_FOUND', { errorBody: { code: '404', message: 'brief not found' } }));

    const result = await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf');

    expect(result.conflict).toBe('superseded-after-write');
    expect(result.approved).toBe(false);
    // No validator: the row it described is gone.
    expect(result.etag).toBeNull();
  });

  it('withholds the write ETag when the approval is refused as stale', async () => {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      .mockRejectedValueOnce(new MicroserviceError('stale', 412, 'PRECONDITION_FAILED'));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true)).resolves.toEqual({
      enabled: true,
      briefId: 'b-1',
      etag: null,
      created: true,
      approved: false,
      // Also a CONFLICT, not merely an unapproved save. The 412 says the row's version moved
      // between the write and the approval, so another writer replaced the brief after this save
      // committed — the write is durable but the row may no longer hold it. Without this the
      // component renders "Brief saved.", confirming durability for content that is gone.
      conflict: 'superseded-after-write',
    });
  });

  // The other half of the rule above. A 4xx is a refusal and proves the approval did not commit;
  // a lost response proves nothing. campaign-service may have committed the approve and bumped
  // the version before the connection died, in which case the write's ETag is one version stale —
  // returning it would hand back a validator that is wrong in exactly the case nobody can detect.
  it('reports no validator when the approval outcome is unknown, rather than a possibly stale one', async () => {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      // Not a MicroserviceError: the proxy only wraps a response it received. A socket hang-up
      // reaches this catch as the raw transport error.
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true)).resolves.toEqual({
      enabled: true,
      briefId: 'b-1',
      etag: null,
      created: true,
      approved: false,
    });
  });

  // A 5xx is a response, but it is not a refusal by the thing that would have done the work — a
  // gateway 502 can follow a commit whose reply was lost on the way back.
  it('treats a 5xx approval failure as unknown too, not as a refusal', async () => {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      .mockRejectedValueOnce(new MicroserviceError('bad gateway', 502, 'BAD_GATEWAY'));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true)).resolves.toMatchObject({
      etag: null,
      approved: false,
    });
  });

  // Same refusal to guess as the If-Match guard below: without a validator there is no safe
  // approve to issue, so the brief is left in draft and said to be.
  it('leaves a brief in draft when the write answered without an ETag, instead of guessing one', async () => {
    proxyRequestWithResponse.mockRejectedValueOnce(NOT_FOUND).mockResolvedValueOnce(apiResponse({ id: 'b-1' }));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true)).resolves.toEqual({
      enabled: true,
      briefId: 'b-1',
      etag: null,
      created: true,
      approved: false,
    });
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(2);
  });

  // Goa builds the body from the payload attributes it does not map elsewhere, and the design
  // declares `Attribute("brief", BriefInput)` with no `Body("brief")` override — so the wire
  // body is `{"brief": {…}}`. A bare brief object 400s on every required field at once, which
  // reads like a mapping bug rather than a missing wrapper.
  it('wraps the payload in the brief envelope the Goa design requires', async () => {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"2"' }));

    await new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'tlf', 'b-1', null, true);

    const body = proxyRequestWithResponse.mock.calls[1]?.[5];
    expect(Object.keys(body)).toEqual(['brief']);
    expect(body.brief).toMatchObject({ program_type: 'events', event_slug: 'kubecon-eu-2026', platforms: ['google-ads'] });
  });

  // `BriefInput` has no first-class field for the goal, budget, UTM or Drive folder. Dropping
  // them would make a reloaded brief quietly less complete than the one the user approved.
  it('round-trips the planning fields that BriefInput has no named home for', async () => {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"2"' }));

    await new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'tlf', 'b-1', null, true);

    expect(proxyRequestWithResponse.mock.calls[1]?.[5].brief.targeting).toEqual({
      campaignGoal: 'conversions',
      totalBudget: 5000,
      hsUtm: 'kubecon-eu-2026',
      driveFolderUrl: 'https://drive.google.com/drive/folders/abc',
    });
  });

  // The find is how a second save reaches `update-brief` at all — not a duplicate-row guard.
  // Migration 000003 puts a partial unique index on `(project_id, event_slug) WHERE status <>
  // 'archived'` and `CreateBrief` maps the violation to `ErrConflict`, so a blind create would
  // 409 rather than duplicate. Without the find, every save after the first would simply fail.
  //
  // This is also the regression test for the ETag being a HEADER: the find's fake answers with
  // an `etag` header and a body that has none, exactly like the real response. Read the body
  // instead and `existing.etag` is `undefined`, the guard below fires, and this test fails on
  // "no ETag" before it ever reaches the PUT.
  it('replaces the existing brief with the header-derived If-Match rather than creating a second one', async () => {
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 7 }, { etag: '"7"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 8 }, { etag: '"8"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 9 }, { etag: '"9"' }));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'tlf', 'b-1', null, true)).resolves.toEqual({
      enabled: true,
      briefId: 'b-1',
      etag: '"9"',
      created: false,
      approved: true,
    });

    const [, service, path, method, query, , headers] = proxyRequestWithResponse.mock.calls[1] as unknown[];
    expect([service, path, method, query]).toEqual(['LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/briefs/b-1', 'PUT', undefined]);
    expect(headers).toEqual({ 'If-Match': '"7"' });
  });

  it('recovers a REPLACE whose response was lost', async () => {
    // The same ambiguity as the create path, on the write that was left rethrowing. A timeout can
    // follow a replacement that committed; reporting "could not be saved" then leaves the client
    // holding a stale ETag, and its next attempt is deterministically refused as `stale-brief` --
    // telling the user someone else changed their brief when the someone else was them.
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 4 }, { etag: '"4"' })) // the find
      .mockRejectedValueOnce(new MicroserviceError('timeout', 408, 'TIMEOUT', {})) // the PUT
      .mockImplementationOnce(() => {
        const envelope = proxyRequestWithResponse.mock.calls[1][5] as { brief: Record<string, unknown> };
        return Promise.resolve(apiResponse({ id: 'b-1', version: 5, ...envelope.brief }, { etag: '"5"' }));
      })
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 6 }, { etag: '"6"' }));

    const result = await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', '"4"');
    expect(result.briefId).toBe('b-1');
    expect(result.created).toBe(false);
    expect(result.conflict).toBeUndefined();
  });

  it('recognises its own write when the payload omitted optional fields', async () => {
    // `toBriefInput` builds `url` and `event_details` as `undefined` when the brief omits them.
    // `JSON.stringify` drops those keys on the wire, so the stored row comes back with FEWER keys
    // than the in-memory payload — and a key-COUNT comparison then rejects this request's own
    // write, stranding the very row the reconciliation exists to recover.
    // `copy.structured` is the field that actually vanishes: `toBriefInput` sets it straight from
    // `brief.structuredCopy`, so an absent one leaves an undefined-valued key that JSON drops.
    // (`url` does not work as a probe — `storedBriefMatches` compares it at the top level with
    // `?? ''` and never reaches `deepEqual`.)
    const noStructured = { ...briefWithSlug('e'), structuredCopy: undefined } as unknown as CampaignBriefOutput;
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockRejectedValueOnce(new MicroserviceError('timeout', 408, 'TIMEOUT', {}))
      .mockImplementationOnce(() => {
        const envelope = proxyRequestWithResponse.mock.calls[1][5] as { brief: Record<string, unknown> };
        // Round-tripped through JSON exactly as the service would store and return it, so the
        // undefined-valued keys really are absent.
        const stored = JSON.parse(JSON.stringify(envelope.brief)) as Record<string, unknown>;
        return Promise.resolve(apiResponse({ id: 'b-1', version: 1, ...stored }, { etag: '"1"' }));
      })
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 2 }, { etag: '"2"' }));

    const result = await new CampaignServiceClient().saveBrief(req, noStructured, 'e', 'tlf');
    expect(result.briefId).toBe('b-1');
    expect(result.created).toBe(true);
  });

  it('does not accept the unchanged pre-PUT row as proof the replace landed', async () => {
    // A save with UNCHANGED content looks identical before and after the PUT, so a payload match
    // alone accepts the pre-PUT row. The code would then approve that old version while the real
    // PUT may still commit afterwards and reset it to `draft` -- having already reported
    // `approved: true`. A committed replace always bumps the version, so the recovered row must
    // be NEWER than the one the find observed.
    proxyRequestWithResponse
      .mockImplementationOnce(() => Promise.resolve(apiResponse({ id: 'b-1', version: 4 }, { etag: '"4"' }))) // the find
      .mockRejectedValueOnce(new MicroserviceError('timeout', 408, 'TIMEOUT', {})) // the PUT
      // Every recovery read returns the SAME version the find saw, with a matching payload.
      .mockImplementation(() => {
        const envelope = proxyRequestWithResponse.mock.calls[1][5] as { brief: Record<string, unknown> };
        return Promise.resolve(apiResponse({ id: 'b-1', version: 4, ...envelope.brief }, { etag: '"4"' }));
      });

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', '"4"')).rejects.toThrow('timeout');
  }, 20000);

  it('keeps reading when the first recovery read still shows the pre-PUT payload', async () => {
    // Where create and replace differ. A create has no row until it commits, so any 200 answers
    // the question. A REPLACE always has a row: the first read can return 200 carrying the OLD
    // payload while the timed-out PUT is still in flight. Breaking there rethrows the timeout
    // moments before the write lands, leaving the client holding a stale ETag for a row that
    // did change.
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 4 }, { etag: '"4"' })) // the find
      .mockRejectedValueOnce(new MicroserviceError('timeout', 408, 'TIMEOUT', {})) // the PUT
      // First recovery read: the row is still the PRE-PUT version.
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 4, program_type: 'events', event_slug: 'e' }, { etag: '"4"' }))
      // Second: the write has landed.
      .mockImplementationOnce(() => {
        const envelope = proxyRequestWithResponse.mock.calls[1][5] as { brief: Record<string, unknown> };
        return Promise.resolve(apiResponse({ id: 'b-1', version: 5, ...envelope.brief }, { etag: '"5"' }));
      })
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 6 }, { etag: '"6"' }));

    const result = await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', '"4"');
    expect(result.briefId).toBe('b-1');
    expect(result.conflict).toBeUndefined();
  }, 20000);

  it("does not claim a replace that landed on someone else's payload", async () => {
    // The row moved, but to content this request did not write. Adopting it would report another
    // writer's brief as this caller's save.
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 4 }, { etag: '"4"' }))
      .mockRejectedValueOnce(new MicroserviceError('timeout', 408, 'TIMEOUT', {}))
      .mockImplementationOnce(() => {
        const envelope = proxyRequestWithResponse.mock.calls[1][5] as { brief: Record<string, unknown> };
        return Promise.resolve(apiResponse({ id: 'b-1', version: 5, ...envelope.brief, copy: { structured: { headline: 'not ours' } } }, { etag: '"5"' }));
      });

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', '"4"')).rejects.toThrow('timeout');
  });

  it('does not reconcile a replace the server REFUSED', async () => {
    // A 4xx other than 412 is a refusal: nothing committed, so looking again can only find a row
    // this request did not write.
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 4 }, { etag: '"4"' }))
      .mockRejectedValueOnce(new MicroserviceError('bad', 400, 'BAD_REQUEST', {}));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', '"4"')).rejects.toThrow('bad');
    // find + PUT only: no reconciliation read.
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(2);
  });

  it('recovers the id of a create whose response was lost', async () => {
    // The POST commits, its response is lost. Without reconciliation the caller never learns the
    // id, and with no read path in this phase every later save finds that row unnameable and is
    // refused as unowned -- the user stranded behind a row they created seconds earlier.
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND) // the initial find: nothing there yet
      .mockRejectedValueOnce(new MicroserviceError('gateway', 502, 'BAD_GATEWAY', {}))
      // Built from the POST body the client actually sent — read off the recorded call rather
      // than hand-copied, so the fixture cannot drift from `toBriefInput`. A committed row echoes
      // what was written, blobs included, which is what makes it recognisable as ours.
      .mockImplementationOnce(() => {
        const envelope = proxyRequestWithResponse.mock.calls[1][5] as { brief: Record<string, unknown> };
        return Promise.resolve(apiResponse({ id: 'b-1', version: 1, ...envelope.brief }, { etag: '"1"' }));
      })
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 2 }, { etag: '"2"' }));

    const result = await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf');
    expect(result.briefId).toBe('b-1');
    expect(result.created).toBe(true);
  });

  it('does not adopt a row that has been written more than once', async () => {
    // `version === 1` is what stops this session claiming a row it did not create. A higher
    // version means the row carries edits this POST never made, so adopting it would hand the
    // caller ownership of someone else's work and let the next save replace it.
    //
    // This is the load-bearing guard on THIS branch: `CampaignServiceBrief` here declares only
    // the columns the write path reads, so the payload comparison can check program and slug but
    // not url or platforms. LFXV2-3108 widens the type and strengthens that half.
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockRejectedValueOnce(new MicroserviceError('gateway', 502, 'BAD_GATEWAY', {}))
      .mockResolvedValueOnce(apiResponse({ id: 'other', version: 4, program_type: 'events', event_slug: 'e' }, { etag: '"4"' }));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toThrow('gateway');
  });

  it("does not adopt another writer's row that differs only in payload", async () => {
    // The case the weaker comparison could not catch: same event and program, so it adopted the
    // row and handed this caller ownership of someone else's brief. `Brief` Reference()s
    // `BriefData` in design/brief.go, so url and platforms come back on the find and CAN be
    // compared -- the response type was under-declaring them, not the service withholding them.
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockRejectedValueOnce(new MicroserviceError('gateway', 502, 'BAD_GATEWAY', {}))
      .mockResolvedValueOnce(
        apiResponse(
          {
            id: 'other',
            version: 1,
            program_type: 'events',
            event_slug: 'e',
            url: 'https://events.linuxfoundation.org/kubecon-eu-2026/',
            platforms: ['reddit-ads'],
          },
          { etag: '"1"' }
        )
      );

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toThrow('gateway');
  });

  it('recovers a create that commits AFTER the reconciliation first looks', async () => {
    // Aborting our local fetch does not stop campaign-service. The write can still be in flight
    // upstream, so the first read legitimately 404s and the commit lands a moment later.
    // Returning on that 404 left the caller without the id and every later save refused as
    // unowned -- the stranding this function exists to prevent, in a narrower window.
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND) // the initial find: nothing there yet
      .mockRejectedValueOnce(new MicroserviceError('timeout', 408, 'TIMEOUT', {}))
      .mockRejectedValueOnce(NOT_FOUND) // first reconciliation read: the commit has not landed
      .mockImplementationOnce(() => {
        const envelope = proxyRequestWithResponse.mock.calls[1][5] as { brief: Record<string, unknown> };
        return Promise.resolve(apiResponse({ id: 'b-1', version: 1, ...envelope.brief }, { etag: '"1"' }));
      })
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 2 }, { etag: '"2"' }));

    const result = await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf');
    expect(result.briefId).toBe('b-1');
    expect(result.created).toBe(true);
  });

  it('does not start another read when the delay itself carries past the budget', async () => {
    // The gap the single pre-sleep check left: a read finishing at 4.5s passes it, then the 1s
    // delay wakes the loop at 5.5s -- past the 5s budget -- and it launched a fresh GET carrying
    // the proxy's own 30s timeout. The budget is now rechecked AFTER the sleep.
    //
    // 4.5s per read puts the second check on the far side of the budget while the first is on the
    // near side, which is the only window that distinguishes the two.
    let reads = 0;
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockRejectedValueOnce(new MicroserviceError('timeout', 408, 'TIMEOUT', {}))
      .mockImplementation(() => {
        reads++;
        return new Promise((_resolve, reject) => setTimeout(() => reject(NOT_FOUND), 4500));
      });

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toThrow('timeout');
    expect(reads).toBe(1);
  }, 20000);

  it('stops re-reading once a slow read has spent the budget', async () => {
    // `proxyRequestWithResponse` takes no timeout parameter, so every read here carries the
    // client's own 30s default. Counting only the sleeps -- as an earlier revision's "~2s"
    // claim did -- understated the worst case by an order of magnitude: three hung GETs plus
    // delays is ~92s of a serialised save queue blocked before the original failure surfaces.
    //
    // A read that overruns the budget must therefore stop the loop rather than be followed by
    // two more. This one takes longer than reconcileReadBudgetMs; exactly one reconciliation
    // read should be attempted.
    let reconcileReads = 0;
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockRejectedValueOnce(new MicroserviceError('timeout', 408, 'TIMEOUT', {}))
      .mockImplementation(() => {
        reconcileReads++;
        return new Promise((_resolve, reject) => setTimeout(() => reject(NOT_FOUND), 5100));
      });

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toThrow('timeout');
    expect(reconcileReads).toBe(1);
  }, 20000);

  it('gives up rather than guessing when the create never resolves', async () => {
    // Bounded: the request has already spent part of its own budget on the failed POST, so the
    // retry cannot chase a late commit indefinitely. When the attempts run out the ORIGINAL
    // failure is reported -- the honest answer, and one the user can retry from.
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockRejectedValueOnce(new MicroserviceError('timeout', 408, 'TIMEOUT', {}))
      .mockRejectedValue(NOT_FOUND);

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toThrow('timeout');
  });

  it("does not adopt another writer's row that differs only in the generated copy", async () => {
    // The case the first-class columns cannot catch, and the reason the opaque blobs are now
    // compared: two briefs for the SAME event normally share program, slug, url and platform
    // selection, differing only in what the generator produced. Without the blobs this row is
    // adopted, approved, and the caller's unsaved content reported as saved.
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockRejectedValueOnce(new MicroserviceError('gateway', 502, 'BAD_GATEWAY', {}))
      .mockImplementationOnce(() => {
        const envelope = proxyRequestWithResponse.mock.calls[1][5] as { brief: Record<string, unknown> };
        return Promise.resolve(
          apiResponse({ id: 'other', version: 1, ...envelope.brief, copy: { structured: { headline: 'someone else wrote this' } } }, { etag: '"1"' })
        );
      });

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toThrow('gateway');
  });

  it('adopts a row whose blobs differ only in key order', async () => {
    // JSONB normalises key order on storage, which is why the comparison is STRUCTURAL rather
    // than textual — and why my earlier objection to comparing the blobs at all was wrong. A row
    // that really is ours must still be recognised when the keys come back reordered.
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockRejectedValueOnce(new MicroserviceError('gateway', 502, 'BAD_GATEWAY', {}))
      .mockImplementationOnce(() => {
        const envelope = proxyRequestWithResponse.mock.calls[1][5] as { brief: Record<string, unknown> };
        const details = envelope.brief['event_details'] as Record<string, unknown>;
        const reordered = Object.fromEntries(Object.entries(details).reverse());
        return Promise.resolve(apiResponse({ id: 'b-1', version: 1, ...envelope.brief, event_details: reordered }, { etag: '"1"' }));
      })
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 2 }, { etag: '"2"' }));

    const result = await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf');
    expect(result.briefId).toBe('b-1');
  });

  it('does not adopt a row for a different event or program', async () => {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockRejectedValueOnce(new MicroserviceError('gateway', 502, 'BAD_GATEWAY', {}))
      .mockResolvedValueOnce(apiResponse({ id: 'other', version: 1, program_type: 'education', event_slug: 'e' }, { etag: '"1"' }));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toThrow('gateway');
  });

  it('does not reconcile a create the server REFUSED', async () => {
    // A 4xx is a refusal: nothing committed, so looking again can only find someone else's row.
    // The original error is the accurate answer, and the find must not even be attempted.
    proxyRequestWithResponse.mockRejectedValueOnce(NOT_FOUND).mockRejectedValueOnce(new MicroserviceError('bad', 400, 'BAD_REQUEST', {}));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toThrow('bad');
    // find + POST only: no reconciliation read.
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(2);
  });

  it('refuses a replace when the caller cannot say which version it last saw', async () => {
    // Two reasons produce a missing validator and they need opposite treatment. This is the
    // UNKNOWN one: the caller's previous write returned no ETag, or its approval outcome was
    // indeterminate, so nobody was warned and nothing was decided. Substituting the validator
    // this request reads itself would bypass the precondition and could overwrite an intervening
    // writer with no conflict ever shown.
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 9 }, { etag: '"9"' }));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1')).resolves.toEqual({
      enabled: true,
      briefId: 'b-1',
      etag: null,
      created: false,
      approved: false,
      conflict: 'unverified-validator',
    });
    // The find only: no PUT was attempted.
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
  });

  it('allows the fallback once the user has been warned and proceeded', async () => {
    // The EXPLICIT reason: a stale-brief conflict was shown, the user proceeded, and the client
    // dropped the rejected validator. Having none is the decision, so the freshly read one is
    // exactly what proceeding means.
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 9 }, { etag: '"9"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 10 }, { etag: '"10"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 11 }, { etag: '"11"' }));

    const result = await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true);
    expect(result.conflict).toBeUndefined();

    const [, , , , , , headers] = proxyRequestWithResponse.mock.calls[1] as unknown[];
    expect(headers).toEqual({ 'If-Match': '"9"' });
  });

  it("sends the CALLER's last-seen validator, not the one this save just read", async () => {
    // The point of the whole change. Using the find's ETag makes the If-Match ceremonial: that
    // find runs inside this very save, so its validator always matches and the 412 can never
    // fire. If another writer moved the row after this tab last saw it, the PUT would re-fetch
    // THEIR validator and silently overwrite their content.
    proxyRequestWithResponse
      // The find sees version 9 — someone else has written since this caller saw version 7.
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 9 }, { etag: '"9"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 10 }, { etag: '"10"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 11 }, { etag: '"11"' }));

    await new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'tlf', 'b-1', '"7"');

    const [, , , , , , headers] = proxyRequestWithResponse.mock.calls[1] as unknown[];
    // `"7"`, not `"9"`: the server must be the one to decide this is stale.
    expect(headers).toEqual({ 'If-Match': '"7"' });
  });

  it('reports a 412 on the replace as a stale-brief conflict, not an error', async () => {
    // Two writers: this caller owns the brief and named it, but another writer moved it since.
    // The save was REFUSED, not failed — nothing was overwritten, which is the outcome the
    // precondition exists to produce — so it surfaces as a conflict the UI can explain.
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 9 }, { etag: '"9"' }))
      .mockRejectedValueOnce(new MicroserviceError('Precondition Failed', 412, 'PRECONDITION_FAILED', {}));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'tlf', 'b-1', '"7"')).resolves.toEqual({
      enabled: true,
      briefId: 'b-1',
      etag: null,
      created: false,
      approved: false,
      conflict: 'stale-brief',
    });
  });

  // A brief body that happens to carry an `etag` key must not be mistaken for the validator.
  // campaign-service does not send one, but a gateway or a future field addition could, and
  // silently preferring it would reintroduce the original bug in a form no other test catches.
  it('takes the validator from the header even when the body carries an etag-shaped field', async () => {
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', etag: '"body-stale"' }, { etag: '"7"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"8"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"9"' }));

    await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true);

    expect(proxyRequestWithResponse.mock.calls[1]?.[6]).toEqual({ 'If-Match': '"7"' });
  });

  // The gateway 404 case. Read as "no brief yet", a routing outage would turn every save of an
  // already-saved event into a create — which the partial unique index then rejects as a 409.
  // The user is told their brief conflicts with itself, and the update they asked for is lost.
  it.each([
    ['a plain-text gateway 404 (null body)', null],
    ['an untyped JSON 404', { error: 'not found' }],
  ])('rethrows %s rather than treating it as a first-time generation', async (_label, errorBody) => {
    proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('not found', 404, 'NOT_FOUND', { errorBody }));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true)).rejects.toMatchObject({ statusCode: 404 });
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
  });

  // A response that reaches us without the header — a proxy that strips it, say. The version
  // number is not a substitute: the design says the ETag "mirrors" the version, which fixes the
  // correspondence but not the serialisation, so a synthesised value either 428s or matches the
  // wrong revision.
  it('refuses to replace a brief whose response carried no ETag header instead of synthesising one', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 7 }));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true)).rejects.toThrow(/no ETag/);
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
  });

  // A 412 means another writer replaced this brief between the find and the PUT. Re-reading and
  // overwriting would silently discard their work, so the failure is surfaced instead.
  it('does not retry a PreconditionFailed by re-reading and overwriting', async () => {
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"7"' }))
      .mockRejectedValueOnce(new MicroserviceError('stale', 412, 'PRECONDITION_FAILED'));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf', 'b-1', null, true)).rejects.toMatchObject({ statusCode: 412 });
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(2);
  });
});

/**
 * A stored brief as `find-brief` returns it, with the four `Any` fields overridable.
 *
 * Typed loosely on purpose: upstream declares `event_details`, `copy`, `keywords` and
 * `targeting` as `Any` and validates none of them, so a spec that could only express
 * well-formed values would be unable to describe the rows `fromBriefResponse` exists for.
 */
function storedBrief(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'b-1',
    project_id: 'tlf',
    program_type: 'events',
    event_slug: 'kubecon-eu-2026',
    status: 'draft',
    version: 1,
    platforms: ['google-ads'],
    event_details: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026' },
    copy: { structured: { headline: 'Register now' }, linkedIn: null, reddit: null, meta: null },
    keywords: [{ term: 'kubecon', matchType: 'Exact', intentLevel: 'High', notes: '' }],
    targeting: { campaignGoal: 'conversions', totalBudget: 5000, hsUtm: 'kubecon-eu-2026', driveFolderUrl: 'https://drive.google.com/drive/folders/abc' },
    ...overrides,
  };
}

describe('fromBriefResponse', () => {
  // The one property that matters most: what a save writes, a load must give back. Anything
  // this drops is work the user did in the Planning tab and would have to redo, without ever
  // being told it went missing — the save reported success.
  it('round-trips a brief written by the save path', async () => {
    proxyRequestWithResponse.mockReset();
    proxyRequestWithResponse.mockRejectedValueOnce(NOT_FOUND).mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }));
    const original = briefWithSlug('kubecon-eu-2026');

    await new CampaignServiceClient().saveBrief(req, original, 'kubecon-eu-2026', 'tlf', 'b-1');
    const written = proxyRequestWithResponse.mock.calls[1]?.[5].brief;

    // The stored row IS what was written — the service treats all four fields as opaque JSON.
    expect(fromBriefResponse(storedBrief(written))).toEqual(original);
  });

  // `eventDetails` is non-optional on `CampaignBriefOutput` and every tab reads off it, so a row
  // without a usable one is unopenable. This is the boundary between `unreadable` and a coerced
  // partial brief, and it is the only null a brief written by this UI can produce.
  it.each([
    ['a missing event_details', undefined],
    ['a non-object event_details', 'kubecon'],
    ['an array event_details', []],
  ])('gives up on %s rather than returning a brief nothing can render', (_label, eventDetails) => {
    expect(fromBriefResponse(storedBrief({ event_details: eventDetails }))).toBeNull();
  });

  // A blob carrying no identity of its own is NOT unreadable while the top-level `event_slug`
  // has one: that column is the required key the row was retrieved by, and `event_details` is
  // opaque JSON another client may fill differently. These two cases used to be in the table
  // above, which meant the identity check consulted only the blob and discarded briefs the
  // Implementation tab could name perfectly well.
  it.each([
    ['neither name nor slug', { city: 'Amsterdam' }],
    ['a blank name and slug', { name: '  ', slug: '' }],
  ])('reads a brief whose event_details has %s when the column carries the slug', (_label, eventDetails) => {
    const brief = fromBriefResponse(storedBrief({ event_slug: 'kubecon-eu-2026', event_details: eventDetails }));
    expect(brief).not.toBeNull();
    expect(brief?.eventDetails.slug).toBe('kubecon-eu-2026');
  });

  // Both empty is still unreadable: nothing can name the row at all.
  it.each([
    ['neither name nor slug', { city: 'Amsterdam' }],
    ['a blank name and slug', { name: '  ', slug: '' }],
  ])('gives up when event_details has %s AND the column is empty too', (_label, eventDetails) => {
    expect(fromBriefResponse(storedBrief({ event_slug: '', event_details: eventDetails }))).toBeNull();
  });

  // The service's enum has `membership`; `CampaignProgramType` does not. Rendering one as an
  // events brief would show the wrong labels, URL help and goal list for a brief this client
  // did not write. Unreachable from `toBriefInput` today, which is why it must not be assumed.
  it('gives up on a program_type outside the two this page is built around', () => {
    expect(fromBriefResponse(storedBrief({ program_type: 'membership' }))).toBeNull();
  });

  // A missing keyword list costs the user a section, not the brief — so it degrades rather than
  // failing the whole row. Same for every other field below.
  it.each([
    ['a non-array keywords', 'kubecon'],
    ['a null keywords', null],
  ])('degrades %s to an empty list rather than failing the row', (_label, keywords) => {
    expect(fromBriefResponse(storedBrief({ keywords }))?.keywords).toEqual([]);
  });

  // A term is the only part of a keyword that carries meaning; match type and intent have
  // defaults the Keywords tab already uses. Dropping the termless entries keeps the rest.
  it('drops termless keyword entries and defaults the two enums on the rest', () => {
    const keywords = [{ term: '  ' }, 'kubecon', { term: 'cloud native', matchType: 'Fuzzy', intentLevel: 'Urgent' }];

    expect(fromBriefResponse(storedBrief({ keywords }))?.keywords).toEqual([{ term: 'cloud native', matchType: 'Broad', intentLevel: 'Medium', notes: '' }]);
  });

  // An unknown platform id reaches a template that indexes icon and label maps by it and
  // renders blank — a checkbox with no name, which the user cannot act on or remove.
  it('drops platform ids the page cannot render', () => {
    expect(fromBriefResponse(storedBrief({ platforms: ['google-ads', 'tiktok-ads'] }))?.selectedPlatforms).toEqual(['google-ads']);
  });

  it('drops a targeting block whose values do not match their fields', () => {
    const targeting = { campaignGoal: 'world-domination', totalBudget: 'lots', hsUtm: 42, driveFolderUrl: null };

    expect(fromBriefResponse(storedBrief({ targeting }))).toMatchObject({
      campaignGoal: null,
      totalBudget: null,
      hsUtm: null,
      // '' not null: `driveFolderUrl` is a non-nullable string on `CampaignBriefOutput`, and the
      // Implementation tab binds it straight into an input.
      driveFolderUrl: '',
    });
  });

  // `Infinity` and `NaN` are `typeof 'number'` and survive a bare typeof check. A budget of
  // Infinity reaches a currency pipe and a create request.
  it.each([
    ['Infinity', Infinity],
    ['NaN', Number.NaN],
  ])('rejects a %s budget rather than passing it to the create request', (_label, totalBudget) => {
    expect(fromBriefResponse(storedBrief({ targeting: { totalBudget } }))?.totalBudget).toBeNull();
  });

  // The variant blocks are rendered by iterating `variants`. A block without one is not a
  // half-populated variant set; it is something else entirely, and the tab would throw on it.
  it.each([
    ['a variant block with no variants array', { headline: 'x' }],
    ['a null variant block', null],
    ['a string variant block', 'linkedIn copy'],
  ])('treats %s as absent rather than handing it to the template', (_label, linkedIn) => {
    expect(fromBriefResponse(storedBrief({ copy: { linkedIn } }))?.linkedInCopy).toBeUndefined();
  });

  it('keeps a variant block that has the array the template iterates', () => {
    // A COMPLETE LinkedIn variant: the template reads `variant.introText.length`
    // (implementation-tab.component.html:338), so a variant missing it is not renderable and is
    // dropped by the case below rather than kept.
    const linkedIn = { variants: [{ introText: 'Come along', headline: 'Join us' }] };

    const restored = fromBriefResponse(storedBrief({ copy: { linkedIn } }))?.linkedInCopy as { variants: unknown[] } | undefined;

    expect(restored?.variants).toEqual(linkedIn.variants);
  });

  it('hardens the structuredCopy blocks the Implementation tab actually restores from', () => {
    // This is the path this app's OWN round-trip takes. Planning's Proceed emits `structuredCopy`
    // and never sets `metaCopy`/`redditCopy`, and `populateFromBrief` reads
    // `structuredCopy['meta_ads']` FIRST — so the guards on the camelCase side sat on a branch
    // this app's briefs never reach. `v.primary_text` (implementation-tab.component.ts:578) then
    // threw on a null element.
    const structured = {
      meta_ads: { variants: [null, { primary_text: 'p', headline: 'h' }, { headline: 'no primary text' }] },
      reddit_promoted: { variants: [null, { headline: 'r' }] },
    };

    const restored = fromBriefResponse(storedBrief({ copy: { structured } }))?.structuredCopy as Record<string, { variants: unknown[] }>;

    expect(restored['meta_ads'].variants).toEqual([{ primary_text: 'p', headline: 'h' }]);
    expect(restored['reddit_promoted'].variants).toEqual([{ headline: 'r' }]);
  });

  it('leaves structuredCopy blocks it does not render untouched', () => {
    // The blob is opaque and another client may store blocks this build does not know. Dropping
    // them would lose content the next writer still owns.
    const structured = { future_platform: { anything: [null, 1] } };

    const restored = fromBriefResponse(storedBrief({ copy: { structured } }))?.structuredCopy;

    expect(restored).toEqual(structured);
  });

  it('coerces a non-array string list rather than letting for...of throw', () => {
    // `google_search.headlines` reaches a `for...of` in populateFromBrief
    // (implementation-tab.component.ts:527), so a stored `42` throws "is not iterable" — a
    // different failure from the variant case, and one the variant filter does not touch.
    const structured = { google_search: { headlines: 42, descriptions: ['keep', 7, null] } };

    const restored = fromBriefResponse(storedBrief({ copy: { structured } }))?.structuredCopy as Record<string, Record<string, unknown>>;

    expect(restored['google_search']['headlines']).toEqual([]);
    expect(restored['google_search']['descriptions']).toEqual(['keep']);
  });

  it('drops a LinkedIn variant missing the field the template dereferences', () => {
    // `headline` alone used to survive, and the template then threw on `introText.length`.
    // Required fields are now each variant interface's own string set, so this cannot drift.
    const linkedIn = { variants: [{ headline: 'Join us' }, { introText: 'Come along', headline: 'Join us' }] };

    const restored = fromBriefResponse(storedBrief({ copy: { linkedIn } }))?.linkedInCopy as { variants: unknown[] } | undefined;

    expect(restored?.variants).toEqual([{ introText: 'Come along', headline: 'Join us' }]);
  });

  /**
   * The array fields are COERCED, not merely passed through.
   *
   * `populateFromBrief` assigns `recommendedGeoTargets` straight into a signal typed
   * `LinkedInGeoTarget[]`, and `canSubmit` maps over it — so a stored block saved before that
   * field existed would write `undefined` and throw on Restore. Coercing to `[]` keeps the brief
   * readable and renders as "none selected", which is the truthful answer.
   */
  it('coerces missing array fields on a variant block so a restore cannot throw', () => {
    const linkedIn = { variants: [{ headline: 'Join us' }] };

    const restored = fromBriefResponse(storedBrief({ copy: { linkedIn } }))?.linkedInCopy as Record<string, unknown> | undefined;

    expect(restored?.['recommendedGeoTargets']).toEqual([]);
  });

  it('reads a brief whose identity is only in the top-level event_slug', () => {
    // event_details is opaque JSON another client may fill differently. The top-level column is
    // the REQUIRED key this row was retrieved by, so a blob with neither name nor slug is still
    // identifiable — checking the blob alone discarded a brief the Implementation tab can name.
    const brief = fromBriefResponse(storedBrief({ event_slug: 'event-a', event_details: { city: 'Paris' } }));
    expect(brief).not.toBeNull();
    expect(brief?.eventDetails.slug).toBe('event-a');
  });

  it('reports a brief whose every stored platform is unknown as unreadable', () => {
    // `populateFromBrief` applies the selection only when non-empty
    // (`if (brief.selectedPlatforms?.length)`), so an empty array leaves its `google-ads` default
    // standing — a Reddit-only brief would restore as a Google Ads campaign, the user's real
    // choice silently replaced by one they never made. Unreadable puts that in front of them.
    expect(fromBriefResponse(storedBrief({ platforms: ['tiktok-ads'] }))).toBeNull();
  });

  it('keeps a brief readable when it stores no platforms at all', () => {
    // A different case from the one above: nothing is being contradicted, so the consumer's
    // default is the ordinary one rather than a silent replacement.
    expect(fromBriefResponse(storedBrief({ platforms: [] }))).not.toBeNull();
  });

  it('keeps the platforms it recognises when only SOME are unknown', () => {
    const brief = fromBriefResponse(storedBrief({ platforms: ['tiktok-ads', 'linkedin-ads'] }));
    expect(brief?.selectedPlatforms).toEqual(['linkedin-ads']);
  });

  it('drops array elements the consumers would crash on', () => {
    // `Any` columns are unvalidated on the way in, so a stored row can hold `[null]`. The
    // Implementation tab dereferences elements directly — `v.primaryText.trim()`
    // (implementation-tab.component.ts:238) and `g.urn` (:243) — so one bad element crashes
    // Restore rather than degrading it.
    const meta = fromBriefResponse(storedBrief({ copy: { meta: { variants: [null, { primaryText: 'ok', headline: 'h' }, 'nope'] } } }))
      ?.metaCopy as unknown as Record<string, unknown>;
    expect(meta['variants']).toEqual([{ primaryText: 'ok', headline: 'h' }]);

    // An empty object is a plain object, so object-ness alone let it through — and canSubmit then
    // called v.primaryText.trim() on it. A Meta variant with headline but no primaryText survives
    // the shared-field filter, so assert canSubmit's own dereference is still safe.
    const bare = fromBriefResponse(storedBrief({ copy: { meta: { variants: [{}, { headline: 'h' }] } } }))?.metaCopy as unknown as Record<string, unknown>;
    expect(bare['variants']).toEqual([]);

    const linkedIn = fromBriefResponse(storedBrief({ copy: { linkedIn: { variants: [], recommendedGeoTargets: [null, { urn: 'urn:li:geo:1' }] } } }))
      ?.linkedInCopy as unknown as Record<string, unknown>;
    expect(linkedIn['recommendedGeoTargets']).toEqual([{ urn: 'urn:li:geo:1' }]);
  });

  it('keeps string elements in the recommendation fields, which are not object arrays', () => {
    // The element type differs BY FIELD, and getting it backwards is its own bug: filtering the
    // `string[]` fields for objects would silently empty every restored keyword and subreddit —
    // worse than the crash above, because it looks like success.
    const reddit = fromBriefResponse(
      storedBrief({ copy: { reddit: { variants: [], recommendedKeywords: ['kubernetes', null, 'cloud'], recommendedSubreddits: ['r/k8s'] } } })
    )?.redditCopy as unknown as Record<string, unknown>;

    expect(reddit['recommendedKeywords']).toEqual(['kubernetes', 'cloud']);
    expect(reddit['recommendedSubreddits']).toEqual(['r/k8s']);
  });

  /**
   * Completeness, not just correctness.
   *
   * The first version of `VARIANT_COPY_ARRAY_FIELDS` named four fields and missed four more,
   * each a `string[]` a consumer iterates — a partial list is worse than none, because it reads
   * as exhaustive. This drives every field the two brief-copy interfaces declare as an array,
   * so adding one to an interface without adding it to the coercion list fails here rather than
   * throwing on a user's Restore.
   */
  it('coerces every array field the platform copy blocks declare', () => {
    const arrayFields = [
      'recommendedGeoTargets',
      'recommendedJobFunctions',
      'recommendedSkills',
      'recommendedGroups',
      'recommendedSubreddits',
      'recommendedInterests',
      'recommendedKeywords',
      'recommendedGeos',
    ];

    const linkedIn = fromBriefResponse(storedBrief({ copy: { linkedIn: { variants: [] } } }))?.linkedInCopy as unknown as Record<string, unknown>;
    const reddit = fromBriefResponse(storedBrief({ copy: { reddit: { variants: [] } } }))?.redditCopy as unknown as Record<string, unknown>;

    for (const field of arrayFields) {
      expect(Array.isArray(linkedIn?.[field]), `linkedInCopy.${field} must be an array, not ${typeof linkedIn?.[field]}`).toBe(true);
      expect(Array.isArray(reddit?.[field]), `redditCopy.${field} must be an array, not ${typeof reddit?.[field]}`).toBe(true);
    }
  });

  // A non-array value in an array field is coerced too — a stored `null` or a string reaches the
  // same `.map()` and fails the same way an absent key does.
  it('coerces a non-array value in an array field', () => {
    const linkedIn = { variants: [{ headline: 'Join us' }], recommendedGeoTargets: null };

    const restored = fromBriefResponse(storedBrief({ copy: { linkedIn } }))?.linkedInCopy as Record<string, unknown> | undefined;

    expect(restored?.['recommendedGeoTargets']).toEqual([]);
  });
});

describe('CampaignServiceClient.loadBrief', () => {
  beforeEach(() => {
    proxyRequestWithResponse.mockReset();
  });

  it('reports the brief campaign-service holds for the slug', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief(), { etag: '"3"' }));

    const result = await new CampaignServiceClient().loadBrief(req, 'kubecon-eu-2026', 'tlf');

    expect(result.status).toBe('loaded');
    expect(result.briefId).toBe('b-1');
    expect(result.brief?.eventDetails.name).toBe('KubeCon EU 2026');
    expect(proxyRequestWithResponse).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/briefs', 'GET', { event_slug: 'kubecon-eu-2026' });
  });

  // campaign-service creates every brief as `draft` and approval is a SECOND call, so a save whose
  // approve step failed leaves a durable row that campaign creation and audience building both
  // refuse (they gate on `approved`). The restore path suppresses the next save, so nothing
  // retries -- the load has to say which it got or the UI strands the user silently.
  it('reports a stored draft as not approved', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief({ status: 'draft' }), { etag: '"3"' }));

    const result = await new CampaignServiceClient().loadBrief(req, 'e', 'tlf');

    expect(result.status).toBe('loaded');
    expect(result.approved).toBe(false);
  });

  it('reports a stored approved brief as approved', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief({ status: 'approved' }), { etag: '"3"' }));

    const result = await new CampaignServiceClient().loadBrief(req, 'e', 'tlf');

    expect(result.status).toBe('loaded');
    expect(result.approved).toBe(true);
  });

  // Only the exact token counts. An unrecognised status is NOT approval -- claiming approval we
  // cannot verify is the one answer that silently strands the brief downstream.
  it('treats an unrecognised stored status as not approved', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief({ status: 'APPROVED' }), { etag: '"3"' }));

    await expect(new CampaignServiceClient().loadBrief(req, 'e', 'tlf')).resolves.toMatchObject({ approved: false });
  });

  // campaign-service's own typed 404 — the documented first-time case.
  it('reports none when campaign-service says the slug has no brief', async () => {
    proxyRequestWithResponse.mockRejectedValueOnce(NOT_FOUND);

    await expect(new CampaignServiceClient().loadBrief(req, 'e', 'tlf')).resolves.toEqual({ status: 'none', briefId: null, brief: null, approved: false });
  });

  // `unreadable` must stay distinct from `none`, and this is the test that pins it. The save
  // path is find-then-UPDATE, so a row reported as "no brief" leads the user to generate a
  // replacement — whose save then silently overwrites the brief that was sitting there.
  it('reports unreadable, NOT none, for a row it cannot map back', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief({ event_details: null }), { etag: '"3"' }));

    await expect(new CampaignServiceClient().loadBrief(req, 'e', 'tlf')).resolves.toEqual({
      status: 'unreadable',
      briefId: 'b-1',
      brief: null,
      approved: false,
    });
  });

  // The read is scoped exactly like the write. `/foundation/campaigns` is reachable by an ED of
  // any foundation, and a brief lives in one foundation's table — a fixed `tlf` would 403 a CNCF
  // ED, or offer an LF staffer who also holds TLF access a TLF brief for a CNCF event.
  it("reads from the caller's foundation rather than a fixed slug", async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief(), { etag: '"3"' }));

    await new CampaignServiceClient().loadBrief(req, 'kubecon-eu-2026', 'cncf');

    expect(proxyRequestWithResponse.mock.calls[0]?.[2]).toBe('/projects/cncf/briefs');
  });

  // The gateway 404 again, and read-side it is the same hazard as write-side: reported as
  // "none", a routing outage invites the user to replace a brief that still exists.
  it.each([
    ['a plain-text gateway 404 (null body)', null],
    ['an untyped JSON 404', { error: 'not found' }],
  ])('rethrows %s rather than reporting none', async (_label, errorBody) => {
    proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('not found', 404, 'NOT_FOUND', { errorBody }));

    await expect(new CampaignServiceClient().loadBrief(req, 'e', 'tlf')).rejects.toMatchObject({ statusCode: 404 });
  });
});
