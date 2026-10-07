// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same pattern as access-check.service.spec.ts: the `@lfx-one/shared/*` alias is not wired into
// this app's vitest config, so runtime collaborators are mocked.
const { proxyRequest } = vi.hoisted(() => ({ proxyRequest: vi.fn() }));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    sanitize: (v: unknown) => v,
  },
}));

import type { Request } from 'express';

import { MicroserviceError } from '../errors/microservice.error';

import { AUDIENCE_BUILDER_REQUEST_TIMEOUT_MS } from '@lfx-one/shared/constants';

import { AudienceBuilderProxyService, AudienceComposePartialError } from './audience-builder-proxy.service';

const req = {} as unknown as Request;

/**
 * These pin the ADAPTER, which the component specs cannot: they mock the service, so a field
 * dropped here is invisible to them. Every case below is a field that upstream sends and this
 * mapping silently discarded — each one turned an unknown into a confident-looking answer.
 */
describe('AudienceBuilderProxyService wire mapping', () => {
  let service: AudienceBuilderProxyService;

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new AudienceBuilderProxyService();
  });

  it("keeps upstream's reason a connection is unusable", async () => {
    // `hubspot_configured: false` covers BOTH "no credentials" and "a connection exists but
    // cannot produce a client". Dropping `detail` made the UI state the first for both, sending
    // an administrator to configure credentials that are already there.
    proxyRequest.mockResolvedValue({ hubspot_configured: false, detail: 'The HubSpot connection for this project is inactive.' });

    const caps = await service.getCapabilities(req, 'tlf');

    expect(caps.hubspotConfigured).toBe(false);
    expect(caps.detail, "upstream's remediation detail was dropped").toBe('The HubSpot connection for this project is inactive.');
  });

  // A hung upstream holds a socket and a request for the whole ceiling, and the page fires several
  // reads at once. `capabilities` answers one boolean about whether a connection row exists, so it
  // opts down. Everything else walks the HubSpot Marketing API -- `last-sent` was measured at 32s
  // at the limit the panel asks for -- and keeps the long ceiling, which is why that ceiling
  // exists: at 30s the call aborted mid-flight while upstream went on to answer 200.
  it('reads configuration on a shorter ceiling than a portal walk', async () => {
    proxyRequest.mockResolvedValue({ hubspot_configured: true });

    await service.getCapabilities(req, 'tlf');

    expect(proxyRequest.mock.calls.at(-1)?.at(7), 'a config read could hold a socket for two minutes').toEqual({ timeoutMs: 30_000 });
  });

  it('keeps the long ceiling on a call that walks the portal', async () => {
    proxyRequest.mockResolvedValue({ emails: [] });

    await service.getLastSent(req, 'tlf', 'Synthetic Summit', 'LF', 3);

    expect(proxyRequest.mock.calls.at(-1)?.at(7), 'a measured 32s read was put back on a 30s ceiling').toEqual({
      timeoutMs: AUDIENCE_BUILDER_REQUEST_TIMEOUT_MS,
    });
  });

  it('omits detail rather than carrying an empty string', async () => {
    proxyRequest.mockResolvedValue({ hubspot_configured: true, detail: '   ' });

    const caps = await service.getCapabilities(req, 'tlf');

    expect(caps.detail, 'a blank detail would render an empty banner line').toBeUndefined();
  });

  it('fails a malformed 2xx instead of reporting it as a verified empty result', async () => {
    // `lists ?? []` turned an unverifiable suppression read into a verified empty set, which
    // clears `suppressionFailed` and enables Compose without the exclusions the UI never
    // managed to confirm — the exact unsafe state the failure arm exists to prevent.
    proxyRequest.mockResolvedValue({});

    await expect(service.getSuppressionLists(req, 'tlf', 'LF', 'Synthetic Summit')).rejects.toThrow(/lists/);
  });

  it('fails a compose whose response is missing the master it claims to have created', async () => {
    // A non-idempotent create reported as success over unusable data: `{ master: {} }` rendered
    // "Master list created" with no list id the operator could act on.
    proxyRequest.mockResolvedValue({ master: {}, source_list_ids: [] });

    await expect(service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] })).rejects.toThrow(/master/);
  });

  it('fails a compose whose master id is blank, not just missing', async () => {
    // A blank string passes every null check and then reaches "Master list created" as a list
    // with nothing to open or search — the same unusable create, through a narrower door.
    proxyRequest.mockResolvedValue({ master: { list_id: '  ', name: 'M', hubspot_url: 'https://app.hubspot.com/l/1' }, source_list_ids: [] });

    await expect(service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] })).rejects.toThrow(/blank/);
  });

  it('fails a compose whose SUPPRESSION list is blank, not just the master', async () => {
    // The suppression object was passed through unchecked beside a validated master, so a
    // create with a blank suppression name still rendered as confirmed and actionable.
    proxyRequest.mockResolvedValue({
      master: { list_id: '900', name: 'Master', hubspot_url: 'https://app.hubspot.com/l/1' },
      suppression: { list_id: '901', name: '', hubspot_url: 'https://app.hubspot.com/l/1' },
      source_list_ids: [],
    });

    await expect(service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] })).rejects.toThrow(/suppression\.name/);
  });

  it('does NOT apply that strictness to the partial path', async () => {
    // The partial path runs inside a catch: throwing there would replace the orphan banner with
    // a generic error and destroy the one record of a list that already exists in the portal.
    // A blank name must be tolerated so the operator still gets the id and link.
    const err = new MicroserviceError('compose failed', 500, 'UPSTREAM', {
      errorBody: { suppression: { list_id: '901', name: '', hubspot_url: 'https://app.hubspot.com/l/1' } },
    });
    proxyRequest.mockRejectedValue(err);

    await expect(service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] })).rejects.toThrow(AudienceComposePartialError);
  });

  it('forwards brief_id only when the caller supplied one', async () => {
    // A present-but-empty `brief_id` is a DIFFERENT request upstream: it reads it as an attach,
    // fails the brief lookup and 404s — refusing to create anything for an exploratory compose
    // that never asked to be attached to anything.
    proxyRequest.mockResolvedValue({ master: { list_id: '900', name: 'Master', hubspot_url: 'https://app.hubspot.com/l/1' }, source_list_ids: [] });

    await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] });
    const [, , , , , withoutBrief] = proxyRequest.mock.calls[0];
    expect(withoutBrief.compose, 'an absent brief id must not become an empty one').not.toHaveProperty('brief_id');

    proxyRequest.mockClear();
    await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [], briefId: 'brief-1' });
    const [, , , , , withBrief] = proxyRequest.mock.calls[0];
    expect(withBrief.compose.brief_id).toBe('brief-1');
  });

  it('reports a compose as unattached when upstream never mentions recording', async () => {
    // THE OLD-UPSTREAM CASE, and the reason `recorded` is read rather than inferred from
    // `audience`. Goa ignores unknown body fields, so a campaign-service deployed before this
    // feature accepts `brief_id`, composes normally and answers without either field. Defaulting
    // to attached there would tell the operator a send is wired up to a list nothing points at.
    proxyRequest.mockResolvedValue({ master: { list_id: '900', name: 'Master', hubspot_url: 'https://app.hubspot.com/l/1' }, source_list_ids: ['1'] });

    const result = await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [], briefId: 'brief-1' });

    expect(result.recorded).toBe(false);
    expect(result.audience).toBeUndefined();
  });

  it('maps the recorded audience onto the row the UI gates staging on', async () => {
    proxyRequest.mockResolvedValue({
      master: { list_id: '900', name: 'Master', hubspot_url: 'https://app.hubspot.com/l/1' },
      source_list_ids: ['1'],
      recorded: true,
      audience: { id: 'aud-1', status: 'built', version: 3, platform_master_list_id: '900' },
    });

    const result = await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [], briefId: 'brief-1' });

    expect(result.recorded).toBe(true);
    // `briefId` comes from the REQUEST, not the response: upstream's recorded-audience object is
    // deliberately slim and carries no brief id, and the id sent is the one it attached to.
    expect(result.audience).toEqual({ id: 'aud-1', briefId: 'brief-1', platform: 'hubspot', platformMasterListId: '900', status: 'built', version: 3 });
  });

  it('refuses a recorded compose whose audience object is unusable', async () => {
    // `recorded: true` beside a rewritten `audience: {}` is the one combination that would render
    // "Audience attached" over a row with no id — an attachment the operator cannot verify or
    // undo, on a create that cannot be retried.
    proxyRequest.mockResolvedValue({
      master: { list_id: '900', name: 'Master', hubspot_url: 'https://app.hubspot.com/l/1' },
      source_list_ids: ['1'],
      recorded: true,
      audience: {},
    });

    await expect(service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [], briefId: 'brief-1' })).rejects.toThrow(/audience/);
  });

  it('coerces an unrecognised recorded status to failed rather than trusting it', async () => {
    // `canStageEmail` admits only `built`. A status upstream never declared must not be able to
    // reach that gate by arriving as a string nobody checked.
    proxyRequest.mockResolvedValue({
      master: { list_id: '900', name: 'Master', hubspot_url: 'https://app.hubspot.com/l/1' },
      source_list_ids: ['1'],
      recorded: true,
      audience: { id: 'aud-1', status: 'enqueued', version: 1, platform_master_list_id: '900' },
    });

    const result = await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [], briefId: 'brief-1' });

    expect(result.audience?.status).toBe('failed');
  });

  it('carries a CONFIRMED master through the partial path', async () => {
    // The fifth shape: both lists exist and only the attach failed. Before it was recognised this
    // body fell through to a generic error, losing the link to a master list that is real and
    // usable — on the one partial where the operator's route out is that exact list.
    const err = new MicroserviceError('compose failed', 500, 'UPSTREAM', {
      errorBody: { master: { list_id: '900', name: 'Master', hubspot_url: 'https://app.hubspot.com/l/1' }, message: 'Lists created but not attached.' },
    });
    proxyRequest.mockRejectedValue(err);

    await expect(service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [], briefId: 'brief-1' })).rejects.toMatchObject({
      master: { listId: '900', name: 'Master' },
    });
  });

  it('drops a partial master whose id is blank rather than linking to it', async () => {
    // Same rule the suppression arm follows, and it matters more here: this shape's whole message
    // is "the master EXISTS, attach it by hand", so a blank id sends the operator hunting for a
    // list that was never confirmed to exist.
    const err = new MicroserviceError('compose failed', 500, 'UPSTREAM', {
      errorBody: { master: { list_id: '  ', name: 'Master', hubspot_url: 'https://app.hubspot.com/l/1' }, master_name: 'Master' },
    });
    proxyRequest.mockRejectedValue(err);

    await expect(service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] })).rejects.toMatchObject({ master: undefined });
  });

  it('carries lists_unavailable so an unread selection is not an empty one', async () => {
    // Both list arrays arrive empty whether the send targeted nobody or the read failed. Without
    // this flag the UI renders "None recorded." for an outage — an unknown audience presented as
    // verified precedent for the operator's next send.
    proxyRequest.mockResolvedValue({
      emails: [
        {
          email_id: '55',
          email_name: 'Synthetic Summit Invite',
          hubspot_url: 'https://app.hubspot.com/x/55',
          included_lists: [],
          suppression_lists: [],
          lists_unavailable: true,
        },
      ],
    });

    const [email] = await service.getLastSent(req, 'tlf', 'Synthetic Summit', 'LF', 5);

    expect(email.listsUnavailable, 'a failed selection read was reported as an empty selection').toBe(true);
    expect(email.includedLists).toEqual([]);
  });

  it('leaves listsUnavailable unset for a send that genuinely targeted nothing', async () => {
    proxyRequest.mockResolvedValue({
      emails: [
        {
          email_id: '56',
          email_name: 'Synthetic Summit Recap',
          hubspot_url: 'https://app.hubspot.com/x/56',
          included_lists: [],
          suppression_lists: [],
        },
      ],
    });

    const [email] = await service.getLastSent(req, 'tlf', 'Synthetic Summit', 'LF', 5);

    expect(email.listsUnavailable, 'a genuinely empty selection was marked unreadable').toBeUndefined();
  });

  it('drops a hubspot_url that is not http(s) so it can never reach an [href]', async () => {
    proxyRequest.mockResolvedValue({
      emails: [
        {
          email_id: '57',
          email_name: 'Synthetic Summit Reminder',
          hubspot_url: 'javascript:alert(1)',
          included_lists: [{ list_id: '1', name: 'L', missing: false, hubspot_url: 'data:text/html,x' }],
          suppression_lists: [],
        },
      ],
    });

    const [email] = await service.getLastSent(req, 'tlf', 'Synthetic Summit', 'LF', 5);

    expect(email.hubspotUrl, 'a javascript: url survived the mapper').toBe('');
    expect(email.includedLists[0]?.hubspotUrl, 'a data: url survived the mapper').toBeUndefined();
  });

  it('fails a created list whose hubspot_url is not http(s), the same as a blank one', async () => {
    proxyRequest.mockResolvedValue({ master: { list_id: '900', name: 'Master', hubspot_url: 'javascript:void(0)' }, source_list_ids: [] });

    await expect(service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] })).rejects.toThrow('master.hubspot_url');
  });

  it('posts an attach with the wire field names and maps the recorded audience', async () => {
    const req = {} as Request;
    proxyRequest.mockResolvedValue({
      master: { list_id: '501', name: 'Prospects', hubspot_url: 'https://app.hubspot.com/l/1' },
      suppression_list_ids: ['201'],
      audience: { id: 'aud-2', status: 'built', version: 1, platform_master_list_id: '501' },
    });

    const result = await service.attachExisting(req, 'tlf', { briefId: 'brief-1', masterListId: '501', suppressionListIds: ['201'] });

    const [, , path, method, , body] = proxyRequest.mock.calls[0];
    expect(path).toContain('/audience-builder/attach-existing');
    expect(method).toBe('POST');
    expect(body).toEqual({ attach: { brief_id: 'brief-1', master_list_id: '501', suppression_list_ids: ['201'] } });
    expect(result.audience.briefId).toBe('brief-1');
    expect(result.suppressionListIds).toEqual(['201']);
  });

  it('posts several include lists and maps them back onto the audience', async () => {
    const req = {} as Request;
    proxyRequest.mockResolvedValue({
      master: { list_id: '101', name: 'Registrants', hubspot_url: 'https://app.hubspot.com/l/1' },
      suppression_list_ids: ['201'],
      include_list_ids: ['101', '102'],
      audience: { id: 'aud-3', status: 'built', version: 1, platform_master_list_id: '101', include_list_ids: ['101', '102'] },
    });

    const result = await service.attachExisting(req, 'tlf', { briefId: 'brief-1', includeListIds: ['101', '102'], suppressionListIds: ['201'] });

    const [, , , , , body] = proxyRequest.mock.calls[0];
    expect(body).toEqual({ attach: { brief_id: 'brief-1', include_list_ids: ['101', '102'], suppression_list_ids: ['201'] } });
    expect(result.audience.includeListIds).toEqual(['101', '102']);
    expect(result.audience.platformMasterListId).toBe('101');
  });

  it('maps a list brief HubSpot link when upstream sends one', async () => {
    const req = {} as Request;
    proxyRequest.mockResolvedValue({
      emails: [
        {
          email_id: 'e1',
          email_name: 'Send',
          sent_at: '2026-01-01T00:00:00Z',
          hubspot_url: 'https://app.hubspot.com/l/2',
          included_lists: [{ list_id: '1', name: 'L', missing: false, hubspot_url: 'https://app.hubspot.com/contacts/1/objectLists/1/filters' }],
          suppression_lists: [],
        },
      ],
    });

    const [sent] = await service.getLastSent(req, 'tlf', 'Synthetic Summit', 'LF', 5);

    expect(sent?.includedLists[0]?.hubspotUrl).toContain('/objectLists/1/');
  });
});
