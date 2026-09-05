// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape as access-check.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into
// this app's vitest config, so runtime collaborators are mocked. This file's own imports from
// `@lfx-one/shared/interfaces` are type-only, so esbuild elides them.
const { proxyRequest, proxyRequestWithResponse, logger, isServerFeatureEnabled } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  proxyRequestWithResponse: vi.fn(),
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn(), startOperation: vi.fn(() => 0) },
  // Typed as taking the flag, matching the real isServerFeatureEnabled(flag). Declared as
  // `vi.fn(() => false)` the mock accepted NO argument, so a per-flag mockImplementation
  // could not typecheck against it -- and only `yarn build` caught that, since check-types
  // skips spec files. The type is declared on the mock rather than as a named parameter so
  // there is no unused binding for no-unused-vars to reject.
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => false),
}));

vi.mock('../helpers/server-feature-flag.helper', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isServerFeatureEnabled,
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
import { readFileSync } from 'node:fs';

import type { Request } from 'express';

import type { CampaignBriefOutput } from '@lfx-one/shared/interfaces';

import { MicroserviceError } from '../errors/microservice.error';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
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

    await expect(new CampaignServiceClient().getJobStatus(req, 'j1', 'tlf')).resolves.toEqual({
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

    await expect(new CampaignServiceClient().getJobStatus(req, 'j1', 'tlf')).rejects.toMatchObject({ statusCode: 404 });
  });

  // Only 404. Anything else means the status is UNKNOWN, and reporting unknown as `not_found`
  // tells the user their campaign creation was lost when it may be running fine.
  it.each([401, 500, 503])('rethrows a %i rather than reporting the job lost', async (statusCode) => {
    proxyRequest.mockRejectedValue(new MicroserviceError('upstream', statusCode, 'ERR'));

    await expect(new CampaignServiceClient().getJobStatus(req, 'j1', 'tlf')).rejects.toMatchObject({ statusCode });
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

    // The find sends the FULL key. Upstream keys a brief on (project, event_slug, delivery_type,
    // stage), so a lookup naming only the slug would match an arbitrary member of the event's
    // brief set — the paid plan or any send in its email series.
    expect(proxyRequestWithResponse).toHaveBeenNthCalledWith(1, req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/briefs', 'GET', {
      event_slug: 'kubecon-eu-2026',
      delivery_type: 'paid-marketing',
      stage: '',
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

  // The page is reachable by an ED of any foundation — `campaignAccessGuard` gates on persona
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

  // The recovery read has to name the SAME brief the lost write targeted, which under 000030 means
  // all four parts of the key. Sending only `event_slug` let campaign-service apply its defaults
  // (`paid-marketing`, `''`), so a timed-out EMAIL write reconciled against the PAID brief -- and
  // a 200 for that row could satisfy the version check and hand back another brief's id and ETag.
  it('reconciles against the same delivery type and stage the write used', async () => {
    const emailBrief = { ...briefWithSlug('e'), deliveryType: 'email' as const, emailStage: 'Final Countdown' as const };

    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND) // the pre-save lookup: no brief yet
      .mockRejectedValueOnce(new MicroserviceError('timeout', 408, 'TIMEOUT', {})) // the POST times out
      // Echoed from the POST body actually sent, as the reconciliation tests above do, so the
      // committed row is recognisable as ours and the loop stops rather than exhausting its
      // attempts on a payload mismatch unrelated to what this test is about.
      .mockImplementation(() => {
        const envelope = proxyRequestWithResponse.mock.calls[1][5] as { brief: Record<string, unknown> };
        return Promise.resolve(apiResponse({ id: 'brief-9', version: 1, ...envelope.brief }, { etag: '"1"' }));
      });

    await new CampaignServiceClient().saveBrief(req, emailBrief, 'e', 'tlf');

    // Asserting on the recovery GET's QUERY, not merely that a read happened: a read of the WRONG
    // row also happens, and that is precisely the bug. The reconciliation read is the GET issued
    // after the POST, so take the last GET rather than the last call.
    const gets = proxyRequestWithResponse.mock.calls.filter((c) => c[3] === 'GET') as unknown as [unknown, unknown, unknown, string, Record<string, string>][];
    expect(gets.length, 'no reconciliation GET was issued').toBeGreaterThan(0);
    expect(gets.at(-1)?.[4]).toMatchObject({ event_slug: 'e', delivery_type: 'email', stage: 'Final Countdown' });
  }, 20000);

  // A SIBLING STAGE must not be accepted as this request's committed write. Two sends in one
  // event's series carry identical base payloads before either is edited, so a content-only
  // comparison cannot tell them apart — and a stale or rolling upstream that ignores the `stage`
  // parameter answers the recovery GET with whichever row it finds. Adopting it would hand back
  // the wrong send's id and ETag, and every later save would target that row.
  it('does not adopt a sibling stage as the lost write', async () => {
    const emailBrief = { ...briefWithSlug('e'), deliveryType: 'email' as const, emailStage: 'Final Countdown' as const };

    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND) // pre-save lookup: nothing yet
      .mockRejectedValueOnce(new MicroserviceError('timeout', 408, 'TIMEOUT', {})) // the POST times out
      // The recovery read answers with a DIFFERENT stage of the same event, echoing the sent
      // payload otherwise — exactly what a stage-blind upstream returns.
      .mockImplementation(() => {
        const envelope = proxyRequestWithResponse.mock.calls[1][5] as { brief: Record<string, unknown> };
        return Promise.resolve(apiResponse({ id: 'brief-sibling', version: 1, ...envelope.brief, stage: 'CFP Launch' }, { etag: '"1"' }));
      });

    await expect(new CampaignServiceClient().saveBrief(req, emailBrief, 'e', 'tlf')).rejects.toThrow('timeout');
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

  it('does not reconcile a save whose request NEVER LEFT this process', async () => {
    // The transport twin of the 4xx case above, and the one `requestNeverLeft` guards inside
    // `reconcileLostWrite`. A connect-time failure means the POST never reached the service, so
    // there is no lost write to find — spending reconciliation reads on it can only surface
    // someone else's row, and the delay between attempts makes the user wait to be told nothing.
    //
    // Every other transport test drives `createCampaigns`, which returns early at its own
    // `requestNeverLeft` guard and never reaches `reconcileLostWrite`, so this arm was
    // unexercised: deleting its `return null;` left the suite green.
    proxyRequestWithResponse.mockRejectedValueOnce(NOT_FOUND).mockRejectedValueOnce(new MicroserviceError('connect ECONNREFUSED', 500, 'ECONNREFUSED', {}));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toThrow('ECONNREFUSED');
    // find + POST only: no reconciliation read, exactly as for the 4xx refusal.
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

    // The stored row IS what was written. `delivery_type` and `stage` are carried across explicitly
    // because they are COLUMNS rather than part of the opaque JSON: the save sends them as
    // top-level wire fields and the read takes them from there, so a round-trip that dropped them
    // would pass while the identity the storage key depends on was silently lost.
    expect(fromBriefResponse(storedBrief({ ...written, delivery_type: written.delivery_type, stage: written.stage }))).toEqual({
      ...original,
      deliveryType: 'paid-marketing',
      emailStage: undefined,
    });
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
    // this app's briefs never reach. `v.primary_text` (implementation-tab.component.ts) then
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
    // (implementation-tab.component.ts), so a stored `42` throws "is not iterable" — a
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
    // (implementation-tab.component.ts) and `g.urn` (:243) — so one bad element crashes
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
    expect(proxyRequestWithResponse).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/briefs', 'GET', {
      event_slug: 'kubecon-eu-2026',
      delivery_type: 'paid-marketing',
      stage: '',
    });
  });

  // The capability the schema half exists for: one event carries a paid brief AND an email series
  // at once, and each stage is its own brief. Asserts on the KEY SENT rather than the row returned,
  // because the defect this prevents is addressing the wrong member of that set — which a
  // returned-a-brief check cannot see.
  it('addresses each brief in an event by its full identity, so a series is reachable', async () => {
    const asked: Record<string, unknown>[] = [];
    proxyRequestWithResponse.mockImplementation((_r: unknown, _s: unknown, _p: unknown, _m: unknown, query: Record<string, unknown>) => {
      asked.push(query);
      return Promise.resolve(apiResponse(storedBrief({ delivery_type: query['delivery_type'], stage: query['stage'] }), { etag: '"3"' }));
    });
    const client = new CampaignServiceClient();

    await client.loadBrief(req, 'kubecon-eu-2026', 'tlf', 'paid-marketing', '');
    await client.loadBrief(req, 'kubecon-eu-2026', 'tlf', 'email', 'CFP Launch');
    await client.loadBrief(req, 'kubecon-eu-2026', 'tlf', 'email', 'Final Countdown');

    expect(asked).toEqual([
      { event_slug: 'kubecon-eu-2026', delivery_type: 'paid-marketing', stage: '' },
      { event_slug: 'kubecon-eu-2026', delivery_type: 'email', stage: 'CFP Launch' },
      { event_slug: 'kubecon-eu-2026', delivery_type: 'email', stage: 'Final Countdown' },
    ]);
  });

  // Delivery scoping. Storage WAS keyed `(project_id, event_slug)` with no delivery dimension
  // (`uq_campaign_briefs_project_event`), so ONE event had ONE row however many surfaces planned
  // it. Handing that row to whichever surface asked is what kept the email restore path disabled:
  // a paid brief restored into an email plan carries RSA headlines, a keyword list and a platform
  // selection that mean nothing there.
  //
  // LFXV2-3198 replaced that index with `uq_campaign_briefs_project_event_delivery_stage`, so the
  // surfaces are separate ROWS now and cannot collide. These four still pin the contract in both
  // directions: the scoping is defence in depth against a stale upstream mid-rollout, which is
  // exactly when a mismatched row would arrive.
  it('reports a paid brief as absent when an email caller asks for it', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief({ delivery_type: 'paid-marketing' }), { etag: '"3"' }));

    const result = await new CampaignServiceClient().loadBrief(req, 'kubecon-eu-2026', 'tlf', 'email');

    // `none`, NOT `unreadable`: parsing succeeded. `unreadable` promises a row that exists and
    // could not be opened, which would send the UI down a "your brief is corrupted" path for a
    // brief that is merely someone else's surface.
    expect(result.status).toBe('none');
    expect(result.briefId).toBeNull();
    expect(result.brief).toBeNull();
  });

  it('reports an email brief as absent when a paid caller asks for it', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief({ delivery_type: 'email' }), { etag: '"3"' }));

    await expect(new CampaignServiceClient().loadBrief(req, 'kubecon-eu-2026', 'tlf', 'paid-marketing')).resolves.toMatchObject({
      status: 'none',
      briefId: null,
    });
  });

  // The STAGE half of the same scoping. A mixed rollout is exactly when an upstream that ignores
  // the `stage` parameter answers with a sibling send — and its copy behind THIS stage's Restore
  // offer is the same wrong-content hazard the delivery-type check above prevents, one dimension
  // over. Reported as `none` for the same reason: the row is not this send's to open.
  it('reports a sibling stage as absent when an email caller asks for a different one', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief({ delivery_type: 'email', stage: 'CFP Launch' }), { etag: '"3"' }));

    const result = await new CampaignServiceClient().loadBrief(req, 'kubecon-eu-2026', 'tlf', 'email', 'Final Countdown');

    expect(result.status).toBe('none');
    expect(result.briefId).toBeNull();
    expect(result.brief).toBeNull();
  });

  it('returns the brief when BOTH the delivery type and the stage match', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief({ delivery_type: 'email', stage: 'Final Countdown' }), { etag: '"3"' }));

    const result = await new CampaignServiceClient().loadBrief(req, 'kubecon-eu-2026', 'tlf', 'email', 'Final Countdown');

    expect(result.status).toBe('loaded');
    expect(result.brief).not.toBeNull();
  });

  it('returns the brief when the stored delivery type matches the caller', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief({ delivery_type: 'email' }), { etag: '"3"' }));

    await expect(new CampaignServiceClient().loadBrief(req, 'kubecon-eu-2026', 'tlf', 'email')).resolves.toMatchObject({
      status: 'loaded',
      briefId: 'b-1',
    });
  });

  // Backward compatibility, and the reason absence means paid rather than "matches everything":
  // a paid caller keeps restoring its existing briefs untouched, and an email caller sees that no
  // email brief exists yet rather than adopting a paid one it cannot use.
  //
  // The behaviour is deliberate; the historical justification it once carried was false. Pre-field
  // EMAIL briefs exist too — the email flow persisted them before the field did — and after the
  // backfill they carry this same paid/empty identity and cannot be told apart. Tracked in
  // linuxfoundation/lfx-self-serve#2214; this expectation is unaffected either way.
  it('treats a brief stored without a delivery type as paid', async () => {
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse(storedBrief(), { etag: '"3"' }))
      .mockResolvedValueOnce(apiResponse(storedBrief(), { etag: '"3"' }));

    await expect(new CampaignServiceClient().loadBrief(req, 'e', 'tlf', 'paid-marketing')).resolves.toMatchObject({ status: 'loaded' });
    await expect(new CampaignServiceClient().loadBrief(req, 'e', 'tlf', 'email')).resolves.toMatchObject({ status: 'none' });
  });

  // LFXV2-3204. The read has to HAND BACK the validator it observed, because `replaceBrief`
  // prefers a caller-supplied ETag over the one its own find reads — and only a carried,
  // load-time validator can produce a 412 when another writer moved the row in between. An
  // earlier revision dropped it here, which made the precondition ceremonial: the find inside
  // the save always matched itself, so a concurrent editor was overwritten rather than refused.
  it('carries the ETag it observed, so a save can send it as If-Match', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief(), { etag: 'W/"7"' }));

    await expect(new CampaignServiceClient().loadBrief(req, 'e', 'tlf')).resolves.toMatchObject({ status: 'loaded', etag: 'W/"7"' });
  });

  // A read that produced no validator still yields a restorable brief. `null` here is an ABSENT
  // validator, not permission to overwrite — what an absent one licenses is decided by the
  // `absence` the caller records alongside it, never by the null itself.
  it('reports a null ETag rather than inventing one when the response carried none', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(storedBrief(), {}));

    await expect(new CampaignServiceClient().loadBrief(req, 'e', 'tlf')).resolves.toMatchObject({ status: 'loaded', etag: null });
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

    await expect(new CampaignServiceClient().loadBrief(req, 'e', 'tlf')).resolves.toEqual({
      status: 'none',
      briefId: null,
      brief: null,
      etag: null,
      approved: false,
    });
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
      etag: '"3"',
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

/**
 * The create path's CONTRACT with campaign-service, which nothing else in this repo checks.
 *
 * Both defects these tests pin shipped in a branch whose build, lint and full server suite were
 * green: an envelope passed in the wrong argument position sends no request body at all, and a
 * flag pair that is half-set answers `enabled: true` on a path the controller may not fall
 * through. Neither is visible to a type checker — `proxyRequestWithResponse` takes `any` for both
 * `query` and `data` — so an assertion on the call shape is the only thing that can catch them.
 */
describe('CampaignServiceClient.createCampaigns', () => {
  const bothFlagsOn = () => isServerFeatureEnabled.mockReturnValue(true);

  /**
   * Cutover flags ON but the Demand Gen capability flag OFF — the state a deployment is in
   * when campaign-service predates LFXV2-3257 and does not understand
   * `googleAdsConfig.channel`.
   */
  const demandGenUnsupported = () => isServerFeatureEnabled.mockImplementation((flag: unknown) => flag !== ServerFeatureFlag.CampaignServiceDemandGen);

  beforeEach(() => {
    vi.clearAllMocks();
    isServerFeatureEnabled.mockReturnValue(false);
  });

  it('is dark when the create flag is off', async () => {
    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['google-ads'], { googleAdsConfig: { budget: 100 } });

    expect(res).toEqual({ enabled: false, jobId: null, error: null });
    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
  });

  it('is dark when CREATE is on but its JOBS prerequisite is off', async () => {
    // Creation mints a UUID job id, and only the JOBS flag routes UUIDs to campaign-service.
    // With JOBS off the poll takes the in-process branch, which holds no such job — the user is
    // told the campaign is lost while it is running and spending. Strictly worse than not
    // cutting over, and the id-shape backstop cannot help: it tells a UUID from a `job_...` id,
    // it cannot conjure the flag.
    isServerFeatureEnabled.mockImplementation((...args: unknown[]) => args[0] !== 'LFX_CUTOVER_CAMPAIGN_SERVICE_JOBS');

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['google-ads'], { googleAdsConfig: { budget: 100 } });

    expect(res).toEqual({ enabled: false, jobId: null, error: null });
    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
  });

  it('is dark when CREATE is on but its BRIEFS prerequisite is off', async () => {
    // Not merely "one flag of two": creation posts to /briefs/{id}/campaigns, and only BRIEFS
    // stores a brief to post against. Reporting `enabled: true` here would refuse every request
    // on a branch the controller must NOT fall through, so creation would stop working rather
    // than staying quietly on the legacy path.
    // Only BRIEFS off, so this fails for the brief-id reason and not incidentally via JOBS.
    isServerFeatureEnabled.mockImplementation((...args: unknown[]) => args[0] !== 'LFX_CUTOVER_CAMPAIGN_SERVICE_BRIEFS');

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['google-ads'], { googleAdsConfig: { budget: 100 } });

    expect(res).toEqual({ enabled: false, jobId: null, error: null });
    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
  });

  it('sends the envelope as the request BODY, not as query parameters', async () => {
    // `proxyRequestWithResponse(req, service, path, method, query, data)`. Passing the envelope
    // fifth serialises it into the query string and sends no body, which campaign-service
    // rejects — every create would fail before a job existed.
    bothFlagsOn();
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { job_id: 'a3f1c2d4-0000-4000-8000-000000000001' } });

    const config = { googleAdsConfig: { budget: 600 } };
    await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['google-ads'], config);

    const call = proxyRequestWithResponse.mock.calls[0];
    expect(call[2]).toBe('/projects/tlf/briefs/b-1/campaigns');
    expect(call[3]).toBe('POST');
    expect(call[4]).toBeUndefined();
    expect(call[5]).toEqual({ input: { platforms: ['google-ads'], config } });
  });

  it('reports the job id from a 202', async () => {
    bothFlagsOn();
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { job_id: 'a3f1c2d4-0000-4000-8000-000000000001' } });

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['meta-ads'], { metaConfig: { budgetUsd: 50 } });

    expect(res).toEqual({ enabled: true, jobId: 'a3f1c2d4-0000-4000-8000-000000000001', error: null });
  });

  it('refuses rather than posting when the brief id or project slug is missing', async () => {
    // An empty segment makes `/projects//briefs//campaigns`, a different route that 404s at the
    // gateway — which is not campaign-service saying "no such brief".
    bothFlagsOn();

    const noBrief = await new CampaignServiceClient().createCampaigns(req, '', 'tlf', ['google-ads'], {});
    const noSlug = await new CampaignServiceClient().createCampaigns(req, 'b-1', '', ['google-ads'], {});

    expect(noBrief.enabled).toBe(true);
    expect(noBrief.jobId).toBeNull();
    expect(noBrief.error).toBeTruthy();
    expect(noSlug.jobId).toBeNull();
    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
  });

  /**
   * The retry wording is safety-critical, not cosmetic.
   *
   * This endpoint answers 202 and dispatches work the request does not wait for, and declares no
   * idempotency key — so on an INDETERMINATE failure the POST may already have committed and real
   * ad spend may already be running. "Please try again" there is an instruction to double-spend.
   * A definite 4xx is different: campaign-service decided, nothing committed, retrying is safe.
   */
  it('tells the user to retry only when the failure is a definite refusal', async () => {
    bothFlagsOn();
    proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('rejected', 400, 'campaign_service'));

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['google-ads'], { googleAdsConfig: { budget: 100 } });

    expect(res.jobId).toBeNull();
    expect(res.error).toContain('nothing was created');
    expect(res.error).toContain('try again');
  });

  it('does NOT tell the user to retry after an indeterminate failure', async () => {
    bothFlagsOn();
    proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('upstream exploded', 502, 'campaign_service'));

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['google-ads'], { googleAdsConfig: { budget: 100 } });

    expect(res.jobId).toBeNull();
    expect(res.error).toContain('check the ad platforms');
    // The whole point: no bare retry instruction on a request that may already be spending.
    expect(res.error).not.toContain('Please try again');
  });

  it('treats a client-side timeout as indeterminate, not as a refusal', async () => {
    // The api client synthesises `MicroserviceError(408, 'TIMEOUT')` for a timeout. It is a 4xx by
    // status but tells us NOTHING about whether the POST committed — the same carve-out
    // `reconcileLostWrite` makes. Reading it as a definite refusal would restore the retry advice
    // on the single most likely double-spend path.
    bothFlagsOn();
    proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('TIMEOUT', 408, 'campaign_service'));

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['google-ads'], { googleAdsConfig: { budget: 100 } });

    expect(res.error).toContain('check the ad platforms');
    expect(res.error).not.toContain('Please try again');
  });

  it('treats a non-HTTP throw as indeterminate', async () => {
    // A connection reset never becomes a MicroserviceError at all. It must not fall into the
    // "definitely rejected" branch by default.
    bothFlagsOn();
    proxyRequestWithResponse.mockRejectedValueOnce(new Error('socket hang up'));

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['google-ads'], { googleAdsConfig: { budget: 100 } });

    expect(res.error).toContain('check the ad platforms');
  });

  /**
   * A selected platform with no config in the envelope is refused before dispatch.
   *
   * Not a harmless omission upstream: `unmarshalPlatformConfig` in campaign-service returns nil
   * for an absent key ("no per-platform config supplied; zero value is fine"), so the dispatcher
   * proceeds with a ZERO-VALUE config and calls Google Ads with budget 0 and no headlines.
   *
   * This lives at the SERVICE layer, not the controller, so it is gated by the cutover flags —
   * an earlier revision put it in the controller where it ran with the flags off and broke
   * demand-gen-only Google creation on the legacy path, which needs no envelope at all.
   */
  it('refuses to post when a selected platform has no config in the envelope', async () => {
    bothFlagsOn();

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['google-ads'], {});

    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    // `enabled: true` with an error, so the controller does NOT fall through to the legacy path —
    // a refusal must not become a duplicate create.
    expect(res.enabled).toBe(true);
    expect(res.jobId).toBeNull();
    expect(res.error).toContain('google-ads');
  });

  it('refuses the whole create when only one platform of several is unconfigured', async () => {
    // A silent partial success is the bug this cutover exists to prevent: the user asked for
    // Google and LinkedIn, and would get LinkedIn only with nothing saying so.
    bothFlagsOn();

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['google-ads', 'linkedin-ads'], {
      linkedInConfig: { budgetUsd: 100 },
    });

    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    expect(res.error).toContain('google-ads');
    expect(res.error).not.toContain('linkedin-ads');
  });

  it('posts when every selected platform is configured', async () => {
    // The contrast. Without it the two tests above would pass on a client that refused everything.
    bothFlagsOn();
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { job_id: 'a3f1c2d4-0000-4000-8000-000000000009' } });

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['linkedin-ads'], { linkedInConfig: { budgetUsd: 100 } });

    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    expect(res.jobId).toBe('a3f1c2d4-0000-4000-8000-000000000009');
  });

  /**
   * A transport failure means the bytes never left this process, so nothing upstream can have
   * started — as definite as a 4xx, and safer to retry than one.
   *
   * Observed 2026-08-13 with campaign-service stopped: the create answered "could not be
   * confirmed — check the ad platforms before retrying" for a request that was never sent. The
   * `definitelyRejected` predicate could not catch it, because a connection failure is not a
   * `MicroserviceError` at all — the proxy only wraps errors carrying `.status` and `.code`.
   *
   * Asserts the message does NOT tell the user to go check the ad platforms. Asserting only that
   * some error came back would pass on the old wording.
   */
  it.each([['ECONNREFUSED'], ['ENOTFOUND'], ['EAI_AGAIN'], ['EHOSTUNREACH'], ['ENETUNREACH']])(
    'reports a %s create as definitely-not-created rather than unconfirmed',
    async (code) => {
      bothFlagsOn();
      // The PRODUCTION shape, not a raw Error: `ApiClientService.executeRequest` wraps a Node
      // fetch failure as `MicroserviceError(500, cause.code)` before this service sees it
      // (`api-client.service.ts`). An earlier revision of this test rejected with a raw
      // `Error` carrying a top-level `code` — a shape this client never throws — so it passed
      // against a `requestNeverLeft` that returned false for every MicroserviceError and fixed
      // nothing in production.
      // transportFailure, as ApiClientService now sets it. The guard keys on that DECLARED flag
      // rather than inferring from originalError, because seven non-transport sites set
      // originalError too -- so a fixture omitting it no longer simulates a real transport error.
      const transportError = new MicroserviceError('Request failed: fetch failed', 500, code, {
        operation: 'api_client_network_error',
        service: 'api_client_service',
        transportFailure: true,
      });
      proxyRequestWithResponse.mockRejectedValueOnce(transportError);

      const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['linkedin-ads'], { linkedInConfig: { budgetUsd: 100 } });

      expect(res.enabled).toBe(true);
      expect(res.jobId).toBeNull();
      expect(res.error).toContain('nothing was created');
      expect(res.error).not.toContain('may have started');
      expect(res.error).not.toContain('check the ad platforms');
    }
  );

  /**
   * `ECONNRESET` must stay INDETERMINATE, even though it is a transport error. Node reports it
   * for a reset at any point, and nothing here distinguishes a connect-time reset from one that
   * arrives after the request was sent and processed — where the create may have landed and only
   * the reply was lost.
   *
   * This is the direction that costs money: on a path with no idempotency key, telling the user
   * "nothing was created" invites the retry that duplicates a paid campaign. An earlier revision
   * of this fix had ECONNRESET in the definite set; the sibling approve-path test caught it.
   */
  it('keeps an ECONNRESET create unconfirmed, because the reset may have followed a commit', async () => {
    bothFlagsOn();
    proxyRequestWithResponse.mockRejectedValueOnce(
      new MicroserviceError('Request failed: socket hang up', 500, 'ECONNRESET', { service: 'api_client_service' })
    );

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['linkedin-ads'], { linkedInConfig: { budgetUsd: 100 } });

    expect(res.error).toContain('could not be confirmed');
    expect(res.error).not.toContain('nothing was created');
  });

  /**
   * The contrast, and the load-bearing half: a 5xx IS genuinely indeterminate — the request
   * reached campaign-service and the outcome is unknown — so it must keep the "may have started"
   * wording. Without this test the fix above could be satisfied by making every failure read as
   * definite, which is the dangerous direction: it would invite exactly the duplicate-create
   * retry the cutover exists to prevent.
   */
  it('still reports a 5xx create as unconfirmed, because the request did reach the service', async () => {
    bothFlagsOn();
    proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('upstream boom', 502, 'INTERNAL_ERROR', { operation: 'create' }));

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['linkedin-ads'], { linkedInConfig: { budgetUsd: 100 } });

    expect(res.error).toContain('could not be confirmed');
  });

  /**
   * LFXV2-3256 — the mapping that unblocks the email channel. Before it, `hubspot` fell to
   * `requiredKey[platform] === undefined` and was refused here, so an email campaign could never
   * reach the dispatcher no matter what the envelope carried.
   *
   * Both directions, because the guard's value is that it fails LOUDLY: mapping `hubspot` without
   * a config builder would be the regression it exists to catch, and dropping the mapping would
   * restore the block this ticket removed. One test alone cannot tell those apart.
   */
  it('dispatches an email campaign once hubspotConfig is present', async () => {
    bothFlagsOn();
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { job_id: 'a3f1c2d4-0000-4000-8000-00000000000e' } });

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['hubspot'], {
      hubspotConfig: { sourceEmailId: 'email-123' },
    });

    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    expect(res.jobId).toBe('a3f1c2d4-0000-4000-8000-00000000000e');
    expect(res.error).toBeNull();
  });

  it('still refuses an email campaign whose hubspotConfig is missing', async () => {
    // The envelope is non-empty but carries the WRONG key, which is the shape a half-built config
    // builder produces. `unmarshalPlatformConfig` would read the absent `hubspotConfig` as a zero
    // value and dispatch a clone of email id "" — so this must never reach the wire.
    bothFlagsOn();

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['hubspot'], { hsToken: 'tok' });

    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    expect(res.enabled).toBe(true);
    expect(res.jobId).toBeNull();
    expect(res.error).toContain('hubspot');
  });

  /**
   * LFXV2-3312, the Microsoft equivalent of the pair above and added for the same reason: nothing
   * else pins this map entry. The CONTROLLER specs mock `createCampaigns` and inspect the envelope
   * it was handed, so they never execute `hasPlatformConfig` — deleting or misspelling
   * `'microsoft-ads': 'microsoftConfig'` would leave every one of them green while every real
   * Microsoft create was refused as unconfigured.
   *
   * Run with the cutover flags ON, which is the only state in which this guard executes at all.
   */
  it('dispatches a Microsoft campaign once microsoftConfig is present', async () => {
    bothFlagsOn();
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { job_id: 'a3f1c2d4-0000-4000-8000-00000000000f' } });

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['microsoft-ads'], {
      microsoftConfig: { budget: 300, keywords: [{ text: 'kubernetes', matchType: 'Exact' }], geoTargets: ['US'] },
    });

    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    expect(res.jobId).toBe('a3f1c2d4-0000-4000-8000-00000000000f');
    expect(res.error).toBeNull();
  });

  it('still refuses a Microsoft campaign whose microsoftConfig is missing', async () => {
    // A non-empty envelope carrying the WRONG key — the shape a half-built builder produces.
    // `unmarshalPlatformConfig` reads the absent `microsoftConfig` as a ZERO VALUE, which would
    // dispatch a campaign with no budget, no keywords and no geo targeting: unservable, and
    // serving everywhere the moment anyone enabled it.
    bothFlagsOn();

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['microsoft-ads'], { hsToken: 'tok' });

    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    expect(res.enabled).toBe(true);
    expect(res.jobId).toBeNull();
    expect(res.error).toContain('microsoft-ads');
  });

  /**
   * campaign-service DOES have a Demand Gen path as of #130, and the slot key is
   * `(brief_id, platform, variant)` — so a brief can hold a Search row and a Demand Gen row at
   * once and the database does not forbid the pair. What is refused here is a MIXED selection,
   * and the reason is this BFF: `buildGoogleAdsConfig` emits one config with one channel.
   *
   * The mixed selection is the dangerous one because it looks like success: the config carries
   * only the SEARCH budget share, so the create would succeed having silently dropped half the
   * request and half the budget.
   */
  it('refuses a mixed search + demand-gen create rather than silently dropping the demand-gen half', async () => {
    bothFlagsOn();

    const res = await new CampaignServiceClient().createCampaigns(
      req,
      'b-1',
      'tlf',
      ['google-ads'],
      { googleAdsConfig: { budget: 600 } },
      { campaignTypes: ['search', 'demand-gen'] }
    );

    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    expect(res.jobId).toBeNull();
    expect(res.error).toContain('Demand Gen');
  });

  /**
   * The half this refusal must NOT cover, since LFXV2-3257 ported Demand Gen into
   * campaign-service. Demand-gen-only is now servable — one channel, one campaign row, which the
   * `(brief_id, platform, variant)` slot key holds fine (#130 widened it from the two-column
   * form; a demand-gen retry on a brief that already has Search needs that third column). Only
   * the PAIR is refused, and by THIS service's one-config envelope rather than by the schema.
   *
   * Without this test the guard could be widened back to `includes('demand-gen')` and every
   * sibling would stay green, silently re-blocking the capability this work added.
   */
  it('dispatches a demand-gen-only create rather than refusing it', async () => {
    bothFlagsOn();
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { job_id: 'a3f1c2d4-0000-4000-8000-00000000000d' } });

    const res = await new CampaignServiceClient().createCampaigns(
      req,
      'b-1',
      'tlf',
      ['google-ads'],
      { googleAdsConfig: { budget: 600, channel: 'demand-gen' } },
      { campaignTypes: ['demand-gen'] }
    );

    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    expect(res.jobId).toBe('a3f1c2d4-0000-4000-8000-00000000000d');
    expect(res.error).toBeNull();
  });

  it('does not refuse a non-Google create that happens to carry demand-gen', async () => {
    // `campaignTypes` is a GOOGLE concept, but the Implementation tab sends it unconditionally
    // and nothing clears it when Google is deselected. The form defaults `includeDemandGen` to
    // false now, so the way it arrives set is RETAINED state — ticked and then Google deselected,
    // or restored from a draft saved under the old default. So a LinkedIn-only create still
    // arrives carrying `demand-gen`, and refusing on the type alone gave a Google error for a
    // request Google was never part of.
    bothFlagsOn();
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { job_id: 'a3f1c2d4-0000-4000-8000-00000000000c' } });

    const res = await new CampaignServiceClient().createCampaigns(
      req,
      'b-1',
      'tlf',
      ['linkedin-ads'],
      { linkedInConfig: { budgetUsd: 100 } },
      { campaignTypes: ['search', 'demand-gen'] }
    );

    expect(res.jobId).toBe('a3f1c2d4-0000-4000-8000-00000000000c');
  });

  /**
   * The silent-Search hazard, and the reason this guard exists rather than a comment.
   *
   * Go's JSON decoder ignores unknown keys, so a campaign-service that predates LFXV2-3257
   * DROPS `googleAdsConfig.channel` and builds its default SEARCH campaign: real budget, no
   * keywords, and per its own docs it "can never serve". Nothing errors — the job reports
   * success and the wrong campaign is found later in Google Ads.
   *
   * Refusing costs one create. The alternative costs money.
   */
  it('refuses a demand-gen create when the deployed service cannot understand the channel', async () => {
    demandGenUnsupported();

    const res = await new CampaignServiceClient().createCampaigns(
      req,
      'b-1',
      'tlf',
      ['google-ads'],
      { googleAdsConfig: { budget: 600, channel: 'demand-gen' } },
      { campaignTypes: ['demand-gen'] }
    );

    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    expect(res.jobId).toBeNull();
    expect(res.error).toContain('Demand Gen');
  });

  /**
   * The guard must be scoped to the request that is actually at risk. A Search-only create
   * carries no `channel` an older service could drop, so gating it on the same flag would
   * refuse the platform's most common create for no reason.
   */
  it('still allows a search-only create when demand gen is unsupported', async () => {
    demandGenUnsupported();
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { job_id: 'a3f1c2d4-0000-4000-8000-00000000000f' } });

    const res = await new CampaignServiceClient().createCampaigns(
      req,
      'b-1',
      'tlf',
      ['google-ads'],
      { googleAdsConfig: { budget: 600 } },
      { campaignTypes: ['search'] }
    );

    expect(res.jobId).toBe('a3f1c2d4-0000-4000-8000-00000000000f');
    expect(res.error).toBeNull();
  });

  /**
   * And a non-Google create must not be caught by it: `campaignTypes` is a Google concept the
   * Implementation tab sends unconditionally, so a LinkedIn-only create arrives carrying
   * `demand-gen` with no Google campaign in it at all.
   */
  it('does not refuse a non-google create when demand gen is unsupported', async () => {
    demandGenUnsupported();
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { job_id: 'a3f1c2d4-0000-4000-8000-000000000010' } });

    const res = await new CampaignServiceClient().createCampaigns(
      req,
      'b-1',
      'tlf',
      ['linkedin-ads'],
      { linkedInConfig: { budgetUsd: 100 } },
      { campaignTypes: ['demand-gen'] }
    );

    expect(res.jobId).toBe('a3f1c2d4-0000-4000-8000-000000000010');
  });

  it('still creates a search-only google campaign', async () => {
    // The contrast: without it the test above would pass on a client that refused every Google
    // create outright.
    bothFlagsOn();
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { job_id: 'a3f1c2d4-0000-4000-8000-00000000000b' } });

    const res = await new CampaignServiceClient().createCampaigns(
      req,
      'b-1',
      'tlf',
      ['google-ads'],
      { googleAdsConfig: { budget: 600 } },
      { campaignTypes: ['search'] }
    );

    expect(res.jobId).toBe('a3f1c2d4-0000-4000-8000-00000000000b');
  });

  it('refuses a platform it has no config mapping for', async () => {
    // An earlier revision waved unmapped platforms through, reasoning this should not police the
    // list. Wrong for the same reason the LinkedIn-strategy guard was: `twitter-ads` is
    // `disabled: true` in the UI constants, but that is a CLIENT guarantee, and the upstream
    // contract accepts twitter/microsoft/hubspot. This service builds no config for any of them,
    // so waving them through queued a job whose dispatcher reads an absent key as a zero value.
    bothFlagsOn();

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['twitter-ads'], {});

    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    expect(res.jobId).toBeNull();
    expect(res.error).toContain('twitter-ads');
  });

  it('treats a 202 carrying no job id as unusable rather than a success', async () => {
    bothFlagsOn();
    proxyRequestWithResponse.mockResolvedValueOnce({ data: {} });

    const res = await new CampaignServiceClient().createCampaigns(req, 'b-1', 'tlf', ['google-ads'], { googleAdsConfig: { budget: 100 } });

    expect(res.jobId).toBeNull();
    expect(res.error).toBeTruthy();
  });
});

/**
 * The HubSpot template search, which is what makes the email channel usable at all:
 * `hubspotConfig.sourceEmailId` is required with no default, so a user who cannot pick a template
 * cannot stage an email.
 *
 * The argument-position assertions are the point. `proxyRequestWithResponse` takes `query` fifth
 * and `data` sixth, both typed `any`, so passing the query sixth compiles fine and sends it as a
 * body — which a GET discards, silently returning the UNFILTERED list. That failure looks like a
 * working search that ignores what the user typed, and no type checker can catch it.
 */
describe('CampaignServiceClient brief country mapping', () => {
  beforeEach(() => {
    proxyRequestWithResponse.mockReset();
    isServerFeatureEnabled.mockReturnValue(true);
  });

  /** The `event_details` actually sent upstream on the create call. */
  async function persistedDetails(countryCode: string): Promise<Record<string, unknown>> {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"2"' }));
    const base = briefWithSlug('mcp-dev-summit-nairobi');
    const brief = { ...base, eventDetails: { ...base.eventDetails, countryCode } };
    await new CampaignServiceClient().saveBrief(req, brief, 'mcp-dev-summit-nairobi', 'tlf', null, null, true);
    // The body is an ENVELOPE -- `{ brief: {...} }` -- so `event_details` sits one level deeper.
    const create = proxyRequestWithResponse.mock.calls.find((c) => c[3] === 'POST');
    const envelope = (create?.[5] ?? {}) as { brief?: Record<string, unknown> };
    return (envelope.brief?.['event_details'] ?? {}) as Record<string, unknown>;
  }

  it('sends the country NAME, which is what the audience builder reads', async () => {
    const details = await persistedDetails('KE');

    // campaign-service reads `json:"country"` and matches it against a HubSpot country property.
    // Sending only `countryCode` failed every audience build with "has no country in its details"
    // -- observed end to end against a live local campaign-service.
    expect(details['country']).toBe('Kenya');
    // The code is still carried: other consumers (geo targeting) key on it.
    expect(details['countryCode']).toBe('KE');
  });

  it('sends the field names campaign-service actually decodes', async () => {
    const details = await persistedDetails('KE');

    // `email_copy.go` REQUIRES eventName and 400s without it; both consumers read `location`.
    // The UI persists `name` and `city`, so without these aliases copy generation fails with
    // "provide at least eventName" -- observed end to end against a live campaign-service.
    // LITERALS, not `toBe(details['name'])`: a self-referential assertion passes when BOTH sides
    // are undefined, so dropping the alias and its source together would be invisible here.
    expect(details['eventName']).toBe('KubeCon EU 2026');
    expect(details['location']).toBe('Amsterdam');
  });

  it('keeps the UI field names alongside the aliases', async () => {
    const details = await persistedDetails('KE');

    // ADDED, not renamed: the wire shape is shared with the paid path, whose consumers read the
    // UI's names. Renaming would fix email and silently break paid.
    expect(details['name']).toBe('KubeCon EU 2026');
    // The VALUE, not merely the key: `toBeDefined()` passes against the very regression the
    // aliases exist to prevent -- a UI name that survived in name only.
    expect(details['city']).toBe('Amsterdam');
  });

  it('sends an empty country rather than the raw code when it is unrecognised', async () => {
    const details = await persistedDetails('ZZ');

    // Upstream fails loudly on an empty country and would build an EMPTY inclusion list for an
    // unmatched one. On a list that decides who receives an email, the loud failure is better.
    expect(details['country']).toBe('');
  });
});

describe('CampaignServiceClient.buildAudience', () => {
  const audience = {
    id: 'aud-1',
    project_id: 'p-1',
    brief_id: 'b-1',
    platform: 'hubspot',
    platform_master_list_id: 'list-9',
    suppression_list_ids: ['sup-1'],
    inclusion_summary: '1,234 contacts',
    status: 'built',
    version: 1,
  };

  beforeEach(() => {
    proxyRequestWithResponse.mockReset();
    isServerFeatureEnabled.mockReturnValue(true);
  });

  it('answers enabled:false without calling upstream when the flag is off', async () => {
    isServerFeatureEnabled.mockReturnValue(false);

    await expect(new CampaignServiceClient().buildAudience(req, 'tlf', 'b-1')).resolves.toEqual({ enabled: false });
    // The flag being dark is an ordinary deployment state, so it must not spend an upstream call.
    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
  });

  it('takes the etag off the ETag HEADER, not the body', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(audience, { etag: '"7"' }));

    const result = await new CampaignServiceClient().buildAudience(req, 'tlf', 'b-1');

    // `design/audience.go` maps it as `Header("etag:ETag")` on the 202, so a body read would be
    // `undefined` forever -- the same trap the brief wire-type comment records.
    expect(result.audience?.etag).toBe('"7"');
    expect(result.audience?.status).toBe('built');
  });

  it('does not let an unrecognised status masquerade as usable', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ ...audience, status: 'queued' }));

    const result = await new CampaignServiceClient().buildAudience(req, 'tlf', 'b-1');

    // `canStageEmail` admits only `built`, so an unknown wire value must not pass through as one.
    // `failed` is the honest landing spot -- it is the arm that offers the operator a rebuild.
    expect(result.audience?.status).toBe('failed');
  });

  it('passes through the statuses upstream actually declares', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ ...audience, status: 'building' }));

    const result = await new CampaignServiceClient().buildAudience(req, 'tlf', 'b-1');

    // Narrowing must not collapse the legitimate in-flight state into a failure.
    expect(result.audience?.status).toBe('building');
  });

  it('keeps a controlled upstream message instead of saying "try again"', async () => {
    proxyRequestWithResponse.mockRejectedValueOnce(
      new MicroserviceError('AI model is not configured; email copy generation is unavailable', 503, 'UNAVAILABLE')
    );

    const result = await new CampaignServiceClient().generateEmailCopy(req, 'tlf', 'b-1');

    // A 503 for an unconfigured model never succeeds on a retry, so "Try again" sends the
    // operator round a loop that cannot end. The upstream message names the actual remedy.
    expect(result.error).toContain('not configured');
  });

  it('does not surface raw transport text as an upstream message', async () => {
    // Transport failures used to be 500, so the 5xx rule caught them. They are now 503 — a lost
    // connection is an unconfirmed outcome, not proof nothing happened — which would otherwise
    // make them "controlled" and put a BFF-raised transport message where an operator-facing
    // remedy belongs. The BFF marks its own transport errors by setting `originalError`.
    // ECONNRESET, not NETWORK_ERROR: executeRequest emits `cause.code || 'NETWORK_ERROR'`, so a
    // real fetch failure carries the OS code and the fallback string almost never appears. A
    // spec built on the fallback passed while production still leaked.
    proxyRequestWithResponse.mockRejectedValueOnce(
      new MicroserviceError('Request failed: fetch failed', 503, 'ECONNRESET', { originalError: new Error('fetch failed'), transportFailure: true })
    );

    const result = await new CampaignServiceClient().generateEmailCopy(req, 'tlf', 'b-1');

    expect(result.error).not.toContain('fetch failed');
    expect(result.error).toContain('Try again');
  });

  it('falls back to the generic message for an unexpected server error', async () => {
    proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('panic: nil map read at 0x4f2a', 500, 'INTERNAL'));

    const result = await new CampaignServiceClient().generateEmailCopy(req, 'tlf', 'b-1');

    // An unexpected 500 can carry stack or infrastructure detail that is not the operator's to
    // read, and "try again" is honest advice for it.
    expect(result.error).not.toContain('panic');
    expect(result.error).toContain('Try again');
  });

  it('reports an error result rather than throwing when upstream fails', async () => {
    proxyRequestWithResponse.mockRejectedValueOnce(new Error('boom'));

    const result = await new CampaignServiceClient().buildAudience(req, 'tlf', 'b-1');

    // A graceful degradation: the caller renders the message instead of the panel exploding.
    expect(result.enabled).toBe(true);
    expect(result.error).toBeTruthy();
    expect(result.audience).toBeUndefined();
  });

  it('rejects a response with no audience id', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ ...audience, id: '' }));

    const result = await new CampaignServiceClient().buildAudience(req, 'tlf', 'b-1');

    expect(result.error).toBeTruthy();
    expect(result.audience).toBeUndefined();
  });
});

describe('CampaignServiceClient.generateEmailCopy', () => {
  const copy = { subject: 'Join us in Nairobi', preheader: 'Two days of MCP', body: '<p>Hello</p>', cta: 'Register' };

  beforeEach(() => {
    proxyRequestWithResponse.mockReset();
    isServerFeatureEnabled.mockReturnValue(true);
  });

  it('sends the stage as a QUERY param, not a body', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ subject: 's', preheader: 'p', body: '<p>b</p>', cta: 'c' }));

    await new CampaignServiceClient().generateEmailCopy(req, 'tlf', 'b-1', 'Post-Event');

    // `proxyRequestWithResponse(req, service, path, method, query, data)` -- query is 5th, data
    // 6th, and BOTH are optional and loosely typed, so a swap is silent. Upstream reads `stage`
    // off the query string; sent as a body it would be ignored and the caller would get
    // default-stage copy while believing it asked for another.
    const call = proxyRequestWithResponse.mock.calls[0];
    expect(call[4]).toEqual({ stage: 'Post-Event' });
    expect(call[5]).toBeUndefined();
  });

  it('sends no stage param at all when the caller names none', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ subject: 's', preheader: 'p', body: '<p>b</p>', cta: 'c' }));

    await new CampaignServiceClient().generateEmailCopy(req, 'tlf', 'b-1');

    // Absence is meaningful upstream: no stage resolves to the default. Sending an empty string
    // would fail its enum instead.
    expect(proxyRequestWithResponse.mock.calls[0][4]).toBeUndefined();
  });

  it('answers enabled:false without calling upstream when the flag is off', async () => {
    isServerFeatureEnabled.mockReturnValue(false);

    await expect(new CampaignServiceClient().generateEmailCopy(req, 'tlf', 'b-1')).resolves.toEqual({ enabled: false });
    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
  });

  it('returns the generated copy', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse(copy));

    const result = await new CampaignServiceClient().generateEmailCopy(req, 'tlf', 'b-1');

    expect(result.copy?.subject).toBe('Join us in Nairobi');
    expect(result.copy?.body).toBe('<p>Hello</p>');
  });

  it('treats a response with no subject as a failure', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ ...copy, subject: '' }));

    const result = await new CampaignServiceClient().generateEmailCopy(req, 'tlf', 'b-1');

    // Staging would otherwise apply an empty subject over the template's own.
    expect(result.error).toBeTruthy();
    expect(result.copy).toBeUndefined();
  });

  it('reports an error result rather than throwing when upstream fails', async () => {
    proxyRequestWithResponse.mockRejectedValueOnce(new Error('boom'));

    const result = await new CampaignServiceClient().generateEmailCopy(req, 'tlf', 'b-1');

    expect(result.enabled).toBe(true);
    expect(result.error).toBeTruthy();
  });
});

describe('CampaignServiceClient.searchHubSpotEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the query as a query PARAM, not a body', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { emails: [] } });

    await new CampaignServiceClient().searchHubSpotEmails(req, 'tlf', 'kubecon');

    const call = proxyRequestWithResponse.mock.calls[0];
    expect(call[2]).toBe('/projects/tlf/connection-hubspot/emails');
    expect(call[3]).toBe('GET');
    expect(call[4]).toEqual({ q: 'kubecon' });
  });

  it('omits the query entirely when it is empty, rather than sending q=""', async () => {
    // An empty `q` is not the same request as no `q`: the service treats absent as "list the most
    // recent", which is the useful default before a user knows what to search for.
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { emails: [] } });

    await new CampaignServiceClient().searchHubSpotEmails(req, 'tlf', '');

    const call = proxyRequestWithResponse.mock.calls[0];
    // Both positions, because the failure this guards against is the param moving rather than
    // vanishing: `undefined` fifth with `{ q: '' }` sixth would send it as a discarded body.
    expect(call[4]).toBeUndefined();
    expect(call[5]).toBeUndefined();
  });

  it('maps the wire shape onto the shared interface', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce({
      data: { emails: [{ id: '112233', name: 'KubeCon promo', subject: 'Join us', state: 'PUBLISHED', updated_at: '2026-08-01T00:00:00Z' }] },
    });

    const result = await new CampaignServiceClient().searchHubSpotEmails(req, 'tlf', '');

    expect(result.enabled).toBe(true);
    // snake_case on the wire, camelCase in the app.
    expect(result.emails[0]).toEqual({
      id: '112233',
      name: 'KubeCon promo',
      subject: 'Join us',
      state: 'PUBLISHED',
      updatedAt: '2026-08-01T00:00:00Z',
    });
  });

  it('reports a project with no HubSpot connection as disabled, not as an error', async () => {
    // The steady state everywhere the channel is not set up. Rendering it as a failure would put
    // an error in front of every project that has simply not connected HubSpot yet.
    // campaign-service's OWN typed not-found: "no HubSpot connection configured for this
    // project". The body is what distinguishes it from a gateway 404 — see the test below.
    proxyRequestWithResponse.mockRejectedValueOnce(
      new MicroserviceError('not found', 404, 'NOT_FOUND', { errorBody: { code: '404', message: 'no HubSpot connection configured for this project' } })
    );

    const result = await new CampaignServiceClient().searchHubSpotEmails(req, 'tlf', '');

    expect(result).toEqual({ enabled: false, emails: [], error: null, possiblyTruncated: false });
  });

  it('refuses a missing project rather than requesting an empty path segment', async () => {
    // `/projects//connection-hubspot/emails` is a DIFFERENT route that 404s at the gateway, and a
    // gateway 404 is not the service saying "no such project".
    const result = await new CampaignServiceClient().searchHubSpotEmails(req, '', 'kubecon');

    expect(result.enabled).toBe(true);
    expect(result.error).toBeTruthy();
    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
  });

  it('treats a BARE 404 as a failure, not as an unconfigured channel', async () => {
    // A gateway 404 is not the service's 404. An empty path segment, a routing change or an
    // ingress miss all produce one, and reporting those as "no connection" would tell the user to
    // connect something already connected while hiding a real outage. campaign-service's own
    // not-found carries a typed body; this one does not.
    proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('not found', 404, 'NOT_FOUND', { errorBody: { nope: true } }));

    const result = await new CampaignServiceClient().searchHubSpotEmails(req, 'tlf', '');

    expect(result.enabled).toBe(true);
    expect(result.error).toBeTruthy();
  });

  it('flags a capped first screen so a picker cannot present it as the whole portal', async () => {
    // The wire cannot express this: campaign-service returns no pagination field, so a capped 500
    // and a complete 500 are the same bytes. Only an EMPTY query is capped.
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { emails: Array.from({ length: 500 }, (_, i) => ({ id: String(i) })) } });

    const capped = await new CampaignServiceClient().searchHubSpotEmails(req, 'tlf', '');
    expect(capped.possiblyTruncated).toBe(true);

    // A FILTERED search is exempt from the 500-row cap and is COMPLETE-OR-ERROR within its
    // 200-page bound — it either matched across every page or it failed, never a partial list. So
    // it is never truncated, and flagging it would tell the user to narrow a search that already
    // returned everything matching. (Not "unbounded": the walk does stop, it just fails loudly
    // rather than answering with a subset.)
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { emails: Array.from({ length: 500 }, (_, i) => ({ id: String(i) })) } });
    const filtered = await new CampaignServiceClient().searchHubSpotEmails(req, 'tlf', 'kubecon');
    expect(filtered.possiblyTruncated).toBe(false);
  });

  /**
   * Truncation is a property of what campaign-service SENT, not of what survived our id filter.
   *
   * A genuinely capped 500 carrying one id-less row filters to 499 rows, and a post-filter
   * comparison (`499 >= 500`) reports a truncated listing as complete — the precise falsehood the
   * flag exists to prevent, and the case that makes it worth reading the wire count.
   */
  /**
   * A 200 with no `emails` ARRAY is malformed, not an empty portal — and reporting it as
   * `enabled: true` with zero templates is indistinguishable from a portal that genuinely has
   * none. That false absence is the exact failure this whole search is built to avoid.
   *
   * campaign-service draws the same line one layer up: `SearchEmails` treats a nil results array
   * as a decode error, because a genuinely empty portal returns `[]` rather than nothing.
   */
  it('reports a 2xx with no emails array as a failure, not as an empty portal', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce({ data: {} });

    const result = await new CampaignServiceClient().searchHubSpotEmails(req, 'tlf', '');

    expect(result.enabled).toBe(true);
    expect(result.emails).toEqual([]);
    // The error is what separates it from a genuinely empty portal, which returns a null error.
    expect(result.error).toBeTruthy();
  });

  it('flags a capped screen even when a row is dropped for having no id', async () => {
    const wire = Array.from({ length: 500 }, (_, i) => ({ id: String(i) }));
    wire[0] = { id: '' } as (typeof wire)[number];
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { emails: wire } });

    const result = await new CampaignServiceClient().searchHubSpotEmails(req, 'tlf', '');

    expect(result.emails).toHaveLength(499);
    expect(result.possiblyTruncated).toBe(true);
  });

  it('drops a row with no id rather than offering an unselectable template', async () => {
    // `id` is what `hubspotConfig.sourceEmailId` takes, and that field is required — so a row
    // without one is a choice the user cannot make. Rendering it would offer a template that
    // fails on submit.
    proxyRequestWithResponse.mockResolvedValueOnce({ data: { emails: [{ name: 'No id here' }, { id: '99', name: 'Real' }] } });

    const result = await new CampaignServiceClient().searchHubSpotEmails(req, 'tlf', '');

    expect(result.emails).toHaveLength(1);
    expect(result.emails[0].id).toBe('99');
  });

  it('reports an upstream failure without claiming the channel is unconfigured', async () => {
    proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('boom', 503, 'UNAVAILABLE', {}));

    const result = await new CampaignServiceClient().searchHubSpotEmails(req, 'tlf', '');

    // `enabled` stays true: HubSpot IS connected, the read just failed. Reporting `false` would
    // tell the user to connect something they already connected.
    expect(result.enabled).toBe(true);
    expect(result.emails).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

/**
 * The controller's own spec mocks this whole client, so nothing there can catch a regression in
 * what actually goes on the wire. These tests are the only place the argument POSITIONS, the enum
 * casing and the If-Match header are checked against `proxyRequestWithResponse`'s real signature.
 */
describe('CampaignServiceClient.toggleCampaignStatus', () => {
  const args = { projectSlug: 'tlf', briefId: 'b-1', campaignId: 'c-1', status: 'PAUSED' as const, etag: '3' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PATCHes the nested campaign path with the status as the BODY, not a query', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'c-1', status: 'paused' }));

    await new CampaignServiceClient().toggleCampaignStatus(req, args);

    const call = proxyRequestWithResponse.mock.calls[0];
    expect(call[2]).toBe('/projects/tlf/briefs/b-1/campaigns/c-1/status');
    expect(call[3]).toBe('PATCH');
    // Both positions asserted, because the failure mode is the body SHIFTING rather than
    // vanishing: `{ status }` in the fifth slot is sent as a query string with no body at all and
    // no type error, and upstream then reports a missing required `status`.
    expect(call[4]).toBeUndefined();
    expect(call[5]).toEqual({ status: 'paused' });
  });

  // Upstream declares Enum("active", "paused"); the shared client type is uppercase. A mismatch is
  // a 400 from the design's own decoder, not a dispatch that quietly does nothing.
  it.each([
    ['PAUSED', 'paused'],
    ['ACTIVE', 'active'],
  ])('lowercases %s to %s on the wire', async (input, wire) => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'c-1' }));

    await new CampaignServiceClient().toggleCampaignStatus(req, { ...args, status: input as 'ACTIVE' | 'PAUSED' });

    expect(proxyRequestWithResponse.mock.calls[0][5]).toEqual({ status: wire });
  });

  // Upstream answers a missing If-Match with 428, so sending it is not optional hardening.
  it('sends the etag as If-Match', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'c-1' }));

    await new CampaignServiceClient().toggleCampaignStatus(req, args);

    expect(proxyRequestWithResponse.mock.calls[0][6]).toEqual({ 'If-Match': '3' });
  });

  it('encodes every path segment so an id cannot escape its position', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'x' }));

    await new CampaignServiceClient().toggleCampaignStatus(req, { ...args, projectSlug: 'a/b', briefId: 'c d', campaignId: 'e?f' });

    expect(proxyRequestWithResponse.mock.calls[0][2]).toBe('/projects/a%2Fb/briefs/c%20d/campaigns/e%3Ff/status');
  });

  it('returns the campaign row the service answered with', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'c-1', status: 'paused', version: 4, etag: '4' }));

    const result = await new CampaignServiceClient().toggleCampaignStatus(req, args);

    expect(result).toEqual({ id: 'c-1', status: 'paused', version: 4, etag: '4' });
  });
});

describe('CampaignServiceClient.toggleCampaignStatus etag propagation', () => {
  const args = { projectSlug: 'tlf', briefId: 'b-1', campaignId: 'c-1', status: 'PAUSED' as const, etag: '3' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Pause-then-resume is the interaction this feature exists for, and the second call needs a
  // FRESH validator: after a successful toggle the caller's etag is stale, and a stale If-Match is
  // answered upstream with 412. The header is what the response contract guarantees — `etag` is
  // not in the upstream `Campaign` type's Required list, so the body may carry none.
  it('carries the ETag header forward so a follow-up toggle has a fresh validator', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'c-1', status: 'paused', version: 4 }, { etag: '4' }));

    const result = await new CampaignServiceClient().toggleCampaignStatus(req, args);

    expect(result.etag).toBe('4');
  });

  it('prefers the header over a body etag when both are present', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'c-1', etag: 'stale' }, { etag: '9' }));

    const result = await new CampaignServiceClient().toggleCampaignStatus(req, args);

    expect(result.etag).toBe('9');
  });

  it('falls back to the body etag when the response carried no header', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'c-1', etag: '7' }));

    const result = await new CampaignServiceClient().toggleCampaignStatus(req, args);

    expect(result.etag).toBe('7');
  });
});

/**
 * The list read is the only place a campaign becomes addressable after its creating session ends,
 * so what it returns decides whether a later pause or metrics call can name anything at all. The
 * assertions below are about the two ways it could lie: scoping past the brief, and reporting a
 * not-yet-indexed list as an empty one.
 */
describe('CampaignServiceClient.listBriefCampaigns', () => {
  const doc = (over: Record<string, unknown> = {}) => ({
    id: 'c-1',
    project_id: 'tlf',
    brief_id: 'b-1',
    platform: 'google-ads',
    campaign_name: 'KubeCon',
    status: 'created',
    version: 1,
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes by project PARENT and brief FILTER, which are not interchangeable', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [{ data: doc() }] });

    await new CampaignServiceClient().listBriefCampaigns(req, 'tlf', 'b-1');

    const call = proxyRequest.mock.calls[0];
    expect(call[2]).toBe('/query/resources');
    // `parent` is the FGA boundary the platform authorizes against; `filters` narrows to the
    // brief. There is no `brief:<id>` parent ref, so the brief cannot travel as a parent.
    expect(call[4]).toEqual(expect.objectContaining({ type: 'campaign', parent: 'project:tlf', filters: ['brief_id:b-1'] }));
  });

  // The ticket's one unverified assumption: whether `data.brief_id` is a term field or an analysed
  // one. Analysed, it matches on token overlap and returns another brief's campaigns — putting one
  // brief's spend under another. The re-check is what makes that a dropped row instead of a lie.
  it('drops rows belonging to another brief rather than trusting the filter', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [{ data: doc() }, { data: doc({ id: 'c-2', brief_id: 'b-2-other' }) }],
    });

    const result = await new CampaignServiceClient().listBriefCampaigns(req, 'tlf', 'b-1');

    expect(result.campaigns.map((c) => c.id)).toEqual(['c-1']);
    expect(logger.warning).toHaveBeenCalledWith(
      expect.anything(),
      'list_brief_campaigns',
      expect.stringContaining('another brief'),
      expect.objectContaining({ returned: 2, kept: 1 })
    );
  });

  /**
   * The all-foreign case, which the mixed test above does not reach: `possiblyStale` is derived
   * from `campaigns.length`, NOT `docs.length`, and only a read where every row is dropped tells
   * the two apart.
   *
   * Both expressions agree on an empty upstream result and on the mixed case, so without this the
   * mutation `possiblyStale: docs.length === 0` survives the whole suite. It matters because the
   * false value renders the flat "No campaigns to show." — asserting a brief has no campaigns on
   * a read that in fact found nothing it could trust.
   */
  it('marks a result possiblyStale when the brief re-check drops every row', async () => {
    isServerFeatureEnabled.mockImplementation(() => false);
    proxyRequest.mockResolvedValueOnce({
      resources: [{ data: doc({ id: 'c-2', brief_id: 'b-2-other' }) }],
    });

    const result = await new CampaignServiceClient().listBriefCampaigns(req, 'tlf', 'b-1');

    expect(result.campaigns).toEqual([]);
    expect(result.possiblyStale).toBe(true);
  });

  // Indexing is asynchronous, so "not indexed yet" and "none exist" are the same answer here.
  // A caller that read absence as proof would tell a user their campaigns do not exist.
  it('marks an empty result possiblyStale rather than asserting emptiness', async () => {
    // Pinned rather than inherited: `vi.clearAllMocks()` does not reset IMPLEMENTATIONS, so this
    // exact-equality assertion would otherwise depend on whichever flag state an earlier test in
    // the file happened to leave behind. The claim under test is about `possiblyStale`.
    isServerFeatureEnabled.mockImplementation(() => false);
    proxyRequest.mockResolvedValueOnce({ resources: [] });

    const result = await new CampaignServiceClient().listBriefCampaigns(req, 'tlf', 'b-1');

    expect(result).toEqual({ campaigns: [], possiblyStale: true, statusToggleEnabled: false, demandGenEnabled: true });
  });

  // The index stores `version`; a write needs `If-Match`. campaign-service's ETag is exactly
  // `"<version>"` WITH quotes (briefETag), and a caller that quoted it differently would get a 412
  // and read it as someone else's concurrent edit rather than as a format bug.
  it('derives the quoted etag from the indexed version', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [{ data: doc({ version: 7 }) }] });

    const result = await new CampaignServiceClient().listBriefCampaigns(req, 'tlf', 'b-1');

    expect(result.campaigns[0].etag).toBe('"7"');
  });

  it('does not mark a populated result stale', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [{ data: doc() }] });

    const result = await new CampaignServiceClient().listBriefCampaigns(req, 'tlf', 'b-1');

    expect(result.possiblyStale).toBe(false);
  });

  // The list read is UNGATED while the toggle route refuses every UUID with the flag off, so the
  // client cannot infer this. The chart ships the flag on, but an override or un-rolled pod still
  // answers off, and that deployment would render controls that can only 400.
  // Asserted in BOTH directions: a field hardcoded to either constant would pass one of these.
  it.each([
    [true, true],
    [false, false],
  ])('reports the deployment status-toggle capability as %s with the list', async (flagOn, expected) => {
    isServerFeatureEnabled.mockImplementation((flag: unknown) => flag === ServerFeatureFlag.CampaignServiceStatusToggle && flagOn);
    proxyRequest.mockResolvedValueOnce({ resources: [{ data: doc() }] });

    try {
      const result = await new CampaignServiceClient().listBriefCampaigns(req, 'tlf', 'b-1');

      expect(result.statusToggleEnabled).toBe(expected);
    } finally {
      // `vi.clearAllMocks()` in this file's beforeEach clears CALLS but not IMPLEMENTATIONS, so a
      // stray mockImplementation here would silently re-answer every later flag question in the
      // suite. Restored to the file's default rather than left for the next test to discover.
      isServerFeatureEnabled.mockImplementation(() => false);
    }
  });

  /**
   * The capability is NOT the raw `CampaignServiceDemandGen` flag.
   *
   * While the create cutover is dark the controller falls through to the legacy creator, which
   * creates demand-gen campaigns perfectly well — so reporting the raw flag would hide a working
   * option for the whole of the staged CREATE-off rollout this chart prescribes.
   *
   * The staged-rollout row is the one that matters and the one a naive implementation fails: all
   * three create prerequisites on is NOT the same as CREATE alone, and demand-gen off only bites
   * once campaign-service actually owns creation.
   */
  it.each([
    // cutover fully on + capability on  -> campaign-service can serve it
    [{ create: true, briefs: true, jobs: true, demandGen: true }, true],
    // cutover fully on + capability off -> the one case that is genuinely unavailable
    [{ create: true, briefs: true, jobs: true, demandGen: false }, false],
    // the staged CREATE-off rollout: legacy owns creation and supports demand gen
    [{ create: false, briefs: true, jobs: true, demandGen: false }, true],
    // a PARTIAL flag set is equivalent to "cutover off" in createCampaigns; it must match here
    [{ create: true, briefs: false, jobs: true, demandGen: false }, true],
    [{ create: true, briefs: true, jobs: false, demandGen: false }, true],
  ])('reports the demand-gen capability from the create path that will actually run (%o)', async (flags, expected) => {
    isServerFeatureEnabled.mockImplementation((flag: unknown) => {
      if (flag === ServerFeatureFlag.CampaignServiceCreate) return flags.create;
      if (flag === ServerFeatureFlag.CampaignServiceBriefs) return flags.briefs;
      if (flag === ServerFeatureFlag.CampaignServiceJobs) return flags.jobs;
      if (flag === ServerFeatureFlag.CampaignServiceDemandGen) return flags.demandGen;
      return false;
    });
    proxyRequest.mockResolvedValueOnce({ resources: [{ data: doc() }] });

    try {
      const result = await new CampaignServiceClient().listBriefCampaigns(req, 'tlf', 'b-1');

      expect(result.demandGenEnabled).toBe(expected);
    } finally {
      isServerFeatureEnabled.mockImplementation(() => false);
    }
  });

  // A TRUNCATED list is worse than an error, which is what failOnPartial buys. The caller cannot
  // tell a short list from a complete one, and the campaigns missing from it are live and
  // spending — so a page-two failure must propagate rather than quietly return page one.
  it('throws rather than returning a truncated list when a later page fails', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [{ data: doc() }], page_token: 'p2' }).mockRejectedValue(new Error('query service unavailable'));

    await expect(new CampaignServiceClient().listBriefCampaigns(req, 'tlf', 'b-1')).rejects.toThrow();
  });

  // Refused rather than defaulted: a query missing either scope either fails authorization or
  // widens past the brief the caller asked about.
  it.each([
    ['no project', '', 'b-1'],
    ['no brief id', 'tlf', ''],
  ])('refuses a request with %s without calling the query service', async (_label, slug, brief) => {
    isServerFeatureEnabled.mockImplementation(() => false);

    const result = await new CampaignServiceClient().listBriefCampaigns(req, slug, brief);

    expect(proxyRequest).not.toHaveBeenCalled();
    // possiblyStale TRUE on a refusal: nothing was queried, so the empty list must not assert
    // that the brief has no campaigns.
    expect(result).toEqual({ campaigns: [], possiblyStale: true, statusToggleEnabled: false, demandGenEnabled: true });
  });
});

describe('CampaignServiceClient.getBriefMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The window is the proxy's FIFTH argument, which is `query`. The SIXTH is the request body.
   * Passing it in the body position sends NO query string and raises no type error — both
   * parameters are optional and loosely typed — so campaign-service would apply per-platform
   * defaults while the caller believed it had asked for a window.
   *
   * Asserted positionally rather than with `objectContaining`, because the defect this pins is
   * entirely about WHICH position the value lands in.
   */
  it('sends the window as a query parameter, not a body', async () => {
    proxyRequest.mockResolvedValue({ brief_id: 'b-1', window: 'last_7_days', rows: [], ok_count: 0, action_items: [] });

    await new CampaignServiceClient().getBriefMetrics(req, 'cncf', 'b-1', 'last_7_days');

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/cncf/briefs/b-1/metrics', 'GET', { window: 'last_7_days' });
    // The body position must be EMPTY. Without this the previous assertion still passes when a
    // future edit adds a body, and the query would keep working while the body silently shipped.
    expect(proxyRequest.mock.calls[0]).toHaveLength(5);
  });

  /**
   * Omitted, not defaulted to `last_30_days`. campaign-service resolves the default PER ROW —
   * `last_7_days` for X Ads, `last_30_days` elsewhere — and an explicit window overrides that for
   * every row, so defaulting here would DISCARD the fallback and turn a servable X row into an
   * `unsupported` one rather than failing outright.
   */
  it('sends no window at all when the caller specifies none', async () => {
    proxyRequest.mockResolvedValue({ brief_id: 'b-1', window: 'last_30_days', rows: [], ok_count: 0, action_items: [] });

    await new CampaignServiceClient().getBriefMetrics(req, 'cncf', 'b-1');

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/cncf/briefs/b-1/metrics', 'GET', undefined);
  });

  /** Both segments are encoded: an unencoded slug would silently change the path. */
  it('encodes both path segments', async () => {
    proxyRequest.mockResolvedValue({ brief_id: 'b/1', window: 'last_30_days', rows: [], ok_count: 0, action_items: [] });

    await new CampaignServiceClient().getBriefMetrics(req, 'a b', 'b/1');

    expect(proxyRequest.mock.calls[0][2]).toBe('/projects/a%20b/briefs/b%2F1/metrics');
  });

  /**
   * An empty segment makes `/projects//briefs//metrics` — a DIFFERENT route that 404s at the
   * gateway. A caller cannot tell that from campaign-service answering "no such brief", so the
   * request is refused before it is sent rather than after.
   */
  it.each([
    ['no project', '', 'b-1'],
    ['no brief id', 'cncf', ''],
  ])('refuses a request with %s without calling the proxy', async (_label, slug, brief) => {
    await expect(new CampaignServiceClient().getBriefMetrics(req, slug, brief)).rejects.toThrow(/requires both the project and the brief/);

    expect(proxyRequest).not.toHaveBeenCalled();
  });

  /**
   * `conversions` and the `no_conversions` rule are part of the contract and must survive the
   * round trip. Both were MISSING from the first version of these types: the fidelity check that
   * approved them compared against a campaign-service worktree parked on an older feature branch
   * rather than against `origin/main`, so it confirmed an outdated contract.
   *
   * `conversions` is FRACTIONAL and OPTIONAL, and those two properties are the whole point.
   * Absent means "this channel does not report it" — Meta, X, Reddit and email never do — which
   * is not a measured 0, so a consumer must not default it. And 0.4 of a conversion is real under
   * data-driven attribution, so it must not be rounded or floored to zero.
   */
  it('preserves a fractional conversions value and the no_conversions rule', async () => {
    proxyRequest.mockResolvedValue({
      brief_id: 'b-1',
      window: 'last_30_days',
      rows: [
        {
          campaign_id: 'c-1',
          platform: 'google-ads',
          status: 'ok',
          metrics: {
            campaign_id: 'c-1',
            platform_campaign_id: 'p-1',
            window: 'last_30_days',
            impressions: 1840,
            clicks: 212,
            cost_micros: 1284000,
            ctr: 0.1152,
            conversions: 0.4,
          },
          pacing: { pct: 94.2, label: 'normal' },
        },
        // Reddit never reports a campaign-level conversion count, so the field is ABSENT here —
        // not zero. The two rows together are what make the distinction assertable.
        {
          campaign_id: 'c-2',
          platform: 'reddit-ads',
          status: 'ok',
          metrics: { campaign_id: 'c-2', platform_campaign_id: 'p-2', window: 'last_30_days', impressions: 10, clicks: 1, cost_micros: 0, ctr: 0.1 },
          pacing: { label: 'unknown' },
        },
      ],
      ok_count: 2,
      action_items: [
        {
          rule: 'no_conversions',
          priority: 'MED',
          campaign_id: 'c-1',
          platform: 'google-ads',
          issue: 'No conversions recorded',
          action: 'Check conversion tracking',
        },
      ],
    });

    const result = await new CampaignServiceClient().getBriefMetrics(req, 'cncf', 'b-1');

    // Neither rounded nor floored to 0 — 0.4 of a conversion is a real value.
    expect(result.rows[0].metrics?.conversions).toBe(0.4);
    // ABSENT stays absent. Defaulting it to 0 would claim Reddit measured zero conversions.
    expect(result.rows[1].metrics?.conversions).toBeUndefined();
    expect(result.action_items[0].rule).toBe('no_conversions');
  });

  /**
   * Pins the two fields against the SHARED TYPES rather than against this file's own fixture.
   *
   * The test above cannot do that job: server specs are typechecked by nothing — `tsconfig.spec.json`
   * includes only `src/app/**` — and `proxyRequest` is an untyped `vi.fn()`, so deleting
   * `conversions` and `no_conversions` from the interfaces leaves it green. That is precisely how
   * both fields went missing in the first place, and a test that cannot detect their removal is
   * not coverage.
   *
   * So this reads the declarations as TEXT. Crude, but it is the only assertion here that fails
   * when the type loses the field, and the failure names what to restore.
   */
  it('keeps conversions and the no_conversions rule declared in the shared types', () => {
    const declarations = readFileSync(new URL('../../../../../packages/shared/src/interfaces/campaign.interface.ts', import.meta.url), 'utf8');

    // Optional, because ABSENT means "this channel does not report it" and is not a measured 0.
    expect(declarations).toContain('conversions?: number;');
    // The fifth rule. campaign-service can return it, so an exhaustive consumer that has never
    // heard of it would drop or mishandle a real action item.
    expect(declarations).toMatch(/rule: .*'no_conversions'/);
  });

  /**
   * The row shape is returned VERBATIM. A failed row carries no `metrics`, and this client must
   * not zero-fill it on the way through — that substitution is what turns an outage into a
   * measured zero, and it is the whole reason the row carries a status.
   */
  it('passes a failed row through without inventing metrics for it', async () => {
    proxyRequest.mockResolvedValue({
      brief_id: 'b-1',
      window: 'last_30_days',
      rows: [
        {
          campaign_id: 'c-1',
          platform: 'linkedin-ads',
          status: 'ok',
          metrics: {
            campaign_id: 'c-1',
            platform_campaign_id: 'p-1',
            window: 'last_30_days',
            impressions: 1840,
            clicks: 212,
            cost_micros: 1284000,
            ctr: 0.1152,
          },
          pacing: { pct: 94.2, label: 'normal' },
        },
        { campaign_id: 'c-2', platform: 'reddit-ads', status: 'failed', reason: 'the platform read failed' },
      ],
      ok_count: 1,
      action_items: [],
    });

    const result = await new CampaignServiceClient().getBriefMetrics(req, 'cncf', 'b-1');

    expect(result.rows[1].metrics).toBeUndefined();
    expect(result.rows[1].status).toBe('failed');
    // ok_count must survive too: it is what tells a consumer that an empty action_items list
    // covers only 1 of the 2 campaigns.
    expect(result.ok_count).toBe(1);
    expect(result.rows).toHaveLength(2);
  });
});

/**
 * Wire-shape coverage for the two insight reads.
 *
 * The controller's tests mock these methods wholesale, so nothing there can see what actually
 * reaches the proxy. A path typo, a dropped `encodeURIComponent`, or `window` sliding from the
 * fifth argument (query) to the sixth (body) would leave that suite entirely green while the
 * request went somewhere else — or went out with no window at all, and campaign-service quietly
 * applied its own default instead of the one the caller asked for. Neither raises a type error:
 * both parameters are optional and loosely typed.
 */
describe('CampaignServiceClient google ads insight reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const keywordsResult = { window: 'last_30_days', rows: [], row_count: 0, truncated: false };
  const audienceResult = { window: 'last_30_days', buckets: [], bucket_count: 0 };

  describe('HubSpot UTM transport', () => {
    // These two are the ONE place in this service where argument POSITION carries meaning that
    // typechecking cannot: `q` must be the fifth argument (query) and `{ name }` the sixth
    // (body). A swap compiles cleanly, and the controller specs mock this layer -- so a POST
    // carrying its payload in the query position would send no body at all and reach upstream
    // as a request naming no campaign, with nothing failing until a live call.
    it('sends the search term as a QUERY parameter, not a body', async () => {
      proxyRequest.mockResolvedValue({ campaigns: [] });

      await new CampaignServiceClient().searchHubSpotCampaigns(req, 'cncf', 'KubeCon NA 2026');

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/cncf/connection-hubspot/campaigns', 'GET', {
        q: 'KubeCon NA 2026',
      });
      // Arity pins the position: a sixth argument here would be a body on a GET.
      expect(proxyRequest.mock.calls[0]).toHaveLength(5);
    });

    it.each([
      ['an empty object', {}],
      ['a missing id', { name: 'KubeCon NA 2026' }],
      ['a blank id', { id: '', name: 'KubeCon NA 2026' }],
      ['a missing name', { id: 'c-1' }],
    ])('refuses %s rather than reporting a fabricated create', async (_label, body) => {
      // toUtmCreateResult hard-codes `created: true`, so an unvalidated 2xx would report a campaign
      // that may not exist -- and the UI then blocks Create for it, telling the operator it worked
      // while leaving them unable to retry. A non-idempotent create must not be inferred from a
      // status code alone.
      proxyRequest.mockResolvedValue(body);

      await expect(new CampaignServiceClient().createHubSpotCampaign(req, 'cncf', 'KubeCon NA 2026')).rejects.toThrow(/no usable campaign/i);
    });

    it.each([
      ['a whitespace-only id', { id: '   ', name: 'KubeCon NA 2026' }],
      ['a whitespace-only name', { id: 'c-1', name: '  ' }],
    ])('refuses %s rather than reporting a create', async (_label, created) => {
      // Copilot: the guard tested `id === ''` and only type-checked `name`, so a whitespace-only
      // value passed and a malformed 2xx became `created: true` -- permanently suppressing another
      // create while displaying a blank campaign name. Upstream's contract is non-whitespace.
      proxyRequest.mockResolvedValue(created);

      await expect(new CampaignServiceClient().createHubSpotCampaign(req, 'cncf', 'KubeCon NA 2026')).rejects.toThrow(/no usable campaign/i);
    });

    it('accepts a well-formed create response', async () => {
      proxyRequest.mockResolvedValue({ id: 'c-1', name: 'KubeCon NA 2026', utm: 'tok' });

      await expect(new CampaignServiceClient().createHubSpotCampaign(req, 'cncf', 'KubeCon NA 2026')).resolves.toMatchObject({ id: 'c-1' });
    });

    it('sends the campaign name as a BODY, not a query parameter', async () => {
      // A COMPLETE response: the create path now validates id and name, so a fixture missing
      // either would fail for a reason unrelated to argument placement.
      proxyRequest.mockResolvedValue({ id: 'c-1', name: 'KubeCon NA 2026' });

      await new CampaignServiceClient().createHubSpotCampaign(req, 'cncf', 'KubeCon NA 2026');

      const call = proxyRequest.mock.calls[0];
      expect(call[3]).toBe('POST');
      // Fifth is the QUERY and must be empty; sixth is the BODY and must carry the name.
      expect(call[4]).toBeUndefined();
      expect(call[5]).toEqual({ name: 'KubeCon NA 2026' });
    });
  });

  describe('getGoogleAdsKeywords', () => {
    it('sends the window as a query parameter, not a body', async () => {
      proxyRequest.mockResolvedValue(keywordsResult);

      await new CampaignServiceClient().getGoogleAdsKeywords(req, 'cncf', 'last_7_days');

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/cncf/google-ads/keywords', 'GET', { window: 'last_7_days' });
      // The body position must be EMPTY. Without this the assertion above still passes when a
      // future edit adds a body, and the query would keep working while the body silently shipped.
      expect(proxyRequest.mock.calls[0]).toHaveLength(5);
    });

    /**
     * Omitted rather than defaulted here, so campaign-service applies its own documented default
     * (`last_30_days`). Defaulting in this client would hard-code a value the service is free to
     * change, and the two would drift apart silently.
     */
    it('sends no window at all when the caller specifies none', async () => {
      proxyRequest.mockResolvedValue(keywordsResult);

      await new CampaignServiceClient().getGoogleAdsKeywords(req, 'cncf');

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/cncf/google-ads/keywords', 'GET', undefined);
    });

    /** An unencoded slug would silently change the path rather than fail. */
    it('encodes the project segment', async () => {
      proxyRequest.mockResolvedValue(keywordsResult);

      await new CampaignServiceClient().getGoogleAdsKeywords(req, 'a b/c');

      expect(proxyRequest.mock.calls[0][2]).toBe('/projects/a%20b%2Fc/google-ads/keywords');
    });

    /**
     * An empty segment makes `/projects//google-ads/keywords` — a DIFFERENT route that 404s at
     * the gateway, which a caller cannot tell apart from campaign-service saying the project has
     * no keywords. Refused before it is sent rather than after.
     */
    it('refuses an empty project without calling the proxy', async () => {
      await expect(new CampaignServiceClient().getGoogleAdsKeywords(req, '')).rejects.toThrow(/requires the project/);

      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });

  describe('getGoogleAdsAudience', () => {
    it('sends the window as a query parameter, not a body', async () => {
      proxyRequest.mockResolvedValue(audienceResult);

      await new CampaignServiceClient().getGoogleAdsAudience(req, 'cncf', 'last_14_days');

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/cncf/google-ads/audience', 'GET', { window: 'last_14_days' });
      expect(proxyRequest.mock.calls[0]).toHaveLength(5);
    });

    it('sends no window at all when the caller specifies none', async () => {
      proxyRequest.mockResolvedValue(audienceResult);

      await new CampaignServiceClient().getGoogleAdsAudience(req, 'cncf');

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/cncf/google-ads/audience', 'GET', undefined);
    });

    it('encodes the project segment', async () => {
      proxyRequest.mockResolvedValue(audienceResult);

      await new CampaignServiceClient().getGoogleAdsAudience(req, 'a b/c');

      expect(proxyRequest.mock.calls[0][2]).toBe('/projects/a%20b%2Fc/google-ads/audience');
    });

    it('refuses an empty project without calling the proxy', async () => {
      await expect(new CampaignServiceClient().getGoogleAdsAudience(req, '')).rejects.toThrow(/requires the project/);

      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });
});

/**
 * Wire-shape coverage for the campaign-ref lookup and the keyword-action mutation.
 *
 * Same reasoning as the insight reads above, and the same blind spot: the controller suite
 * mocks both methods wholesale, so a wrong path, an unencoded segment, or an argument in the
 * wrong position stays green there. It matters more here than on the reads — one of these
 * MUTATES live campaigns, and `REMOVE` is irreversible.
 *
 * The query/body distinction is the trap in both directions. For a GET, a value in the body
 * position (sixth) sends no query string at all; for a POST, a payload in the query position
 * (fifth) sends no body — and neither raises a type error, because both parameters are optional
 * and loosely typed.
 */
describe('CampaignServiceClient campaign-ref and keyword actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveGoogleAdsCampaign', () => {
    const resolution = { platform_campaign_id: '24183781329', matches: [], match_count: 0 };

    it('sends the platform campaign id as a query parameter on the campaign-ref path', async () => {
      proxyRequest.mockResolvedValue(resolution);

      await new CampaignServiceClient().resolveGoogleAdsCampaign(req, 'cncf', '24183781329');

      expect(proxyRequest).toHaveBeenCalledWith(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        '/projects/cncf/google-ads/campaign-ref',
        'GET',
        {
          platform_campaign_id: '24183781329',
        },
        undefined,
        undefined,
        // No caller budget in this test -- the fan-out supplies one; everything else takes the
        // client default.
        undefined
      );
      // The body position must stay empty, for the reason the read methods document. Eight args
      // now: headers and options trail it so a caller can bound the call.
      expect(proxyRequest.mock.calls[0]).toHaveLength(8);
    });

    it('encodes the project segment', async () => {
      proxyRequest.mockResolvedValue(resolution);

      await new CampaignServiceClient().resolveGoogleAdsCampaign(req, 'a b/c', '555');

      expect(proxyRequest.mock.calls[0][2]).toBe('/projects/a%20b%2Fc/google-ads/campaign-ref');
    });

    it.each([
      ['no project', '', '555'],
      ['no platform campaign id', 'cncf', ''],
    ])('refuses a lookup with %s without calling the proxy', async (_label, slug, id) => {
      await expect(new CampaignServiceClient().resolveGoogleAdsCampaign(req, slug, id)).rejects.toThrow(
        /requires both the project and the platform campaign id/
      );

      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });

  describe('applyKeywordActions', () => {
    const actions = [{ ad_group_id: '176216228', criterion_id: '305729261', action: 'PAUSE' as const }];
    const applied = { campaign_id: 'c-1', results: [], applied_count: 1 };

    it('POSTs the actions in the BODY position, not the query', async () => {
      proxyRequest.mockResolvedValue(applied);

      await new CampaignServiceClient().applyKeywordActions(req, 'cncf', 'b-1', 'c-1', actions);

      expect(proxyRequest).toHaveBeenCalledWith(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        '/projects/cncf/briefs/b-1/campaigns/c-1/keyword-actions',
        'POST',
        undefined,
        {
          actions,
        },
        // Seventh and eighth: no custom headers, and no caller-supplied timeout in this test --
        // the fan-out passes its remaining budget here, everything else takes the client default.
        undefined,
        undefined
      );
      // Sixth argument present and fifth empty: swapping them would send the payload as a query
      // string with no body, which upstream reads as a request carrying no actions. Eight args
      // now -- headers and options trail the body so the fan-out can pass its remaining budget.
      expect(proxyRequest.mock.calls[0]).toHaveLength(8);
      expect(proxyRequest.mock.calls[0][4]).toBeUndefined();
    });

    it('encodes every path segment', async () => {
      proxyRequest.mockResolvedValue(applied);

      await new CampaignServiceClient().applyKeywordActions(req, 'a b', 'b/1', 'c 1', actions);

      expect(proxyRequest.mock.calls[0][2]).toBe('/projects/a%20b/briefs/b%2F1/campaigns/c%201/keyword-actions');
    });

    it.each([
      ['no project', '', 'b-1', 'c-1'],
      ['no brief', 'cncf', '', 'c-1'],
      ['no campaign', 'cncf', 'b-1', ''],
    ])('refuses a mutation with %s without calling the proxy', async (_label, slug, brief, campaign) => {
      await expect(new CampaignServiceClient().applyKeywordActions(req, slug, brief, campaign, actions)).rejects.toThrow(
        /requires the project, brief and campaign/
      );

      expect(proxyRequest).not.toHaveBeenCalled();
    });

    /**
     * Upstream declares MinLength(1), so an empty batch is a 400 round-trip. Refusing locally
     * matters beyond saving the call: answering an empty request as a success would tell a
     * caller their keywords were paused when no request was ever made.
     */
    it('refuses an empty action batch without calling the proxy', async () => {
      await expect(new CampaignServiceClient().applyKeywordActions(req, 'cncf', 'b-1', 'c-1', [])).rejects.toThrow(/at least one action/);

      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });
});
