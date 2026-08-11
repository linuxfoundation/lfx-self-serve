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
import { adaptJobPollResponse, CampaignServiceClient, deriveEventSlug, isCampaignServiceJobId } from './campaign-service.service';

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
  it('scopes the request to the tlf slug, not to a resolved uid', async () => {
    proxyRequest.mockResolvedValue({ job_id: 'j1', status: 'queued' });

    await expect(new CampaignServiceClient().getJobStatus(req, 'j1')).resolves.toEqual({ status: 'running' });
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/jobs/j1', 'GET');
  });

  it('encodes the job id into the path', async () => {
    proxyRequest.mockResolvedValue({ job_id: 'a/b', status: 'running' });

    await new CampaignServiceClient().getJobStatus(req, 'a/b');
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/jobs/a%2Fb', 'GET');
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

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'tlf')).resolves.toEqual({
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
  it('reports a create conflict rather than overwriting the brief that won the race', async () => {
    proxyRequestWithResponse.mockRejectedValueOnce(NOT_FOUND).mockRejectedValueOnce(new MicroserviceError('conflict', 409, 'CONFLICT'));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toThrow('conflict');
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

    await new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'cncf');

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

    await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf');

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

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).resolves.toEqual({
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
  it('withholds the write ETag when the approval is refused as stale', async () => {
    proxyRequestWithResponse
      .mockRejectedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"1"' }))
      .mockRejectedValueOnce(new MicroserviceError('stale', 412, 'PRECONDITION_FAILED'));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).resolves.toEqual({
      enabled: true,
      briefId: 'b-1',
      etag: null,
      created: true,
      approved: false,
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

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).resolves.toEqual({
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

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).resolves.toMatchObject({ etag: null, approved: false });
  });

  // Same refusal to guess as the If-Match guard below: without a validator there is no safe
  // approve to issue, so the brief is left in draft and said to be.
  it('leaves a brief in draft when the write answered without an ETag, instead of guessing one', async () => {
    proxyRequestWithResponse.mockRejectedValueOnce(NOT_FOUND).mockResolvedValueOnce(apiResponse({ id: 'b-1' }));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).resolves.toEqual({
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

    await new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'tlf');

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

    await new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'tlf');

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

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('kubecon-eu-2026'), 'kubecon-eu-2026', 'tlf')).resolves.toEqual({
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

  // A brief body that happens to carry an `etag` key must not be mistaken for the validator.
  // campaign-service does not send one, but a gateway or a future field addition could, and
  // silently preferring it would reintroduce the original bug in a form no other test catches.
  it('takes the validator from the header even when the body carries an etag-shaped field', async () => {
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse({ id: 'b-1', etag: '"body-stale"' }, { etag: '"7"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"8"' }))
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"9"' }));

    await new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf');

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

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toMatchObject({ statusCode: 404 });
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
  });

  // A response that reaches us without the header — a proxy that strips it, say. The version
  // number is not a substitute: the design says the ETag "mirrors" the version, which fixes the
  // correspondence but not the serialisation, so a synthesised value either 428s or matches the
  // wrong revision.
  it('refuses to replace a brief whose response carried no ETag header instead of synthesising one', async () => {
    proxyRequestWithResponse.mockResolvedValueOnce(apiResponse({ id: 'b-1', version: 7 }));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toThrow(/no ETag/);
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
  });

  // A 412 means another writer replaced this brief between the find and the PUT. Re-reading and
  // overwriting would silently discard their work, so the failure is surfaced instead.
  it('does not retry a PreconditionFailed by re-reading and overwriting', async () => {
    proxyRequestWithResponse
      .mockResolvedValueOnce(apiResponse({ id: 'b-1' }, { etag: '"7"' }))
      .mockRejectedValueOnce(new MicroserviceError('stale', 412, 'PRECONDITION_FAILED'));

    await expect(new CampaignServiceClient().saveBrief(req, briefWithSlug('e'), 'e', 'tlf')).rejects.toMatchObject({ statusCode: 412 });
    expect(proxyRequestWithResponse).toHaveBeenCalledTimes(2);
  });
});
