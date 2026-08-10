// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape as access-check.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into
// this app's vitest config, so runtime collaborators are mocked. This file's own imports from
// `@lfx-one/shared/interfaces` are type-only, so esbuild elides them.
const { proxyRequest } = vi.hoisted(() => ({ proxyRequest: vi.fn() }));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));

import type { Request } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
import { JOB_LOST_MESSAGE } from './campaign-proxy.service';
import { adaptJobPollResponse, CampaignServiceClient, isCampaignServiceJobId } from './campaign-service.service';

const req = {} as unknown as Request;

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

  // The mirror-image failure: `succeeded` forwarded raw is not `'running'` either, so it would
  // never terminate the poll and the page would spin to the 300s cap on a job that is finished.
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
  it('translates an upstream 404 into the not_found status the in-process path returns', async () => {
    proxyRequest.mockRejectedValue(new MicroserviceError('not found', 404, 'NOT_FOUND'));

    await expect(new CampaignServiceClient().getJobStatus(req, 'j1')).resolves.toEqual({
      status: 'not_found',
      error: JOB_LOST_MESSAGE,
    });
  });

  // Only 404. Anything else means the status is UNKNOWN, and reporting unknown as `not_found`
  // tells the user their campaign creation was lost when it may be running fine.
  it.each([401, 500, 503])('rethrows a %i rather than reporting the job lost', async (statusCode) => {
    proxyRequest.mockRejectedValue(new MicroserviceError('upstream', statusCode, 'ERR'));

    await expect(new CampaignServiceClient().getJobStatus(req, 'j1')).rejects.toMatchObject({ statusCode });
  });
});
