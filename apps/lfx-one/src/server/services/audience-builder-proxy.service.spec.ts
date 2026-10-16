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
import { logger } from './logger.service';

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

  // A 2xx compose means the master EXISTS, so an unusable reply is a do-not-retry partial, never a
  // plain error: the client lets an operator retry a plain error, and a retry composes a second
  // master list (the orphaned duplicates of the blank-portal-id incident).
  it('turns a compose reply missing its master into a partial, never a retryable error', async () => {
    // `{ master: {} }` rendered "Master list created" with no list id the operator could act on.
    proxyRequest.mockResolvedValue({ master: {}, source_list_ids: [] });

    const error = await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [], name: 'Requested' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AudienceComposePartialError);
    expect((error as AudienceComposePartialError).masterName, 'the requested name is the one to search by').toBe('Requested');
    expect((error as AudienceComposePartialError).master).toBeUndefined();
  });

  it('turns a compose whose master id is blank into a partial carrying the name to search by', async () => {
    // A blank string passes every null check and then reaches "Master list created" as a list
    // with nothing to open or search — the same unusable create, through a narrower door.
    proxyRequest.mockResolvedValue({ master: { list_id: '  ', name: 'M', hubspot_url: 'https://app.hubspot.com/l/1' }, source_list_ids: [] });

    const error = await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AudienceComposePartialError);
    expect((error as AudienceComposePartialError).masterName).toBe('M');
    expect((error as AudienceComposePartialError).master, 'an unconfirmed master is never passed as a list').toBeUndefined();
  });

  it('turns a compose whose SUPPRESSION name is blank into a partial that keeps the master and orphans nothing', async () => {
    // The suppression object was passed through unchecked beside a validated master, so a
    // create with a blank suppression name still rendered as confirmed and actionable. On a 2xx
    // the suppression is the master's own exclusion list: it must never reach the ORPHAN banner,
    // which tells the operator to delete it.
    proxyRequest.mockResolvedValue({
      master: { list_id: '900', name: 'Master', hubspot_url: 'https://app.hubspot.com/l/1' },
      suppression: { list_id: '901', name: '', hubspot_url: 'https://app.hubspot.com/l/1' },
      source_list_ids: [],
    });

    const error = await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AudienceComposePartialError);
    const partial = error as AudienceComposePartialError;
    expect(partial.master?.listId).toBe('900');
    expect(partial.masterName, 'never beside a confirmed master').toBeUndefined();
    expect(partial.suppression, "the master's suppression is not an orphan").toBeUndefined();
    expect(partial.suppressionName).toBeUndefined();
  });

  it('never passes a confirmed master without a name', async () => {
    proxyRequest.mockResolvedValue({ master: { list_id: '900', name: ' ', hubspot_url: '' }, source_list_ids: null });

    const named = await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [], name: 'Requested' }).catch((e: unknown) => e);
    expect((named as AudienceComposePartialError).master?.name, 'the requested name').toBe('Requested');

    const unnamed = await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] }).catch((e: unknown) => e);
    expect((unnamed as AudienceComposePartialError).master?.name, 'the id when nothing else names it').toBe('list 900');
  });

  it('logs which field made a compose reply unusable', async () => {
    proxyRequest.mockResolvedValue({ master: { list_id: '900', name: 'Master', hubspot_url: '' } });

    await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] }).catch(() => undefined);

    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'audience_compose_master',
      expect.any(String),
      expect.objectContaining({ reason: expect.stringContaining('source_list_ids'), master_list_id: '900' })
    );
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

    // The master exists, so this is a do-not-retry partial, never a retryable error. Upstream
    // reported the attach, so no list is passed: the client must not call it "unattached".
    const error = await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [], briefId: 'brief-1' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AudienceComposePartialError);
    expect((error as AudienceComposePartialError).master).toBeUndefined();
    expect((error as AudienceComposePartialError).masterName).toBeUndefined();
    expect((error as AudienceComposePartialError).message).toContain('Refresh the campaign');
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

  // The link is not an identifying field: the list is found by its id and name. Upstream returns a
  // blank hubspot_url when the portal id is unknown, and failing on it reported a created master
  // as an error and invited the retry that orphaned a duplicate.
  it.each([
    ['blank', ''],
    ['non-http', 'javascript:void(0)'],
  ])('reports a created master with a %s link as created, without the link', async (_label, url) => {
    proxyRequest.mockResolvedValue({ master: { list_id: '900', name: 'Master', hubspot_url: url }, source_list_ids: [] });

    const result = await service.composeMaster(req, 'tlf', { listIds: ['1'], excludeListIds: [] });

    expect(result.master).toEqual({ listId: '900', name: 'Master', hubspotUrl: '', size: undefined });
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

describe('AudienceBuilderProxyService custom audiences', () => {
  let service: AudienceBuilderProxyService;

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new AudienceBuilderProxyService();
  });

  const criteria = {
    cities: ['Seoul'],
    countries: [],
    contactLocation: true,
    eventRegistered: false,
    educationEnrolled: false,
    registeredFor: [],
    gateEventHistory: false,
    gateListId: '26716',
    propertyFilters: [{ property: 'industry', operator: 'is_any_of' as const, values: ['X'] }],
    speakers: { scope: 'current' as const, eventNames: ['OSS Korea 2026'] },
    ambassadors: false,
    educationTopics: ['Kubernetes'],
    pageViewUrls: [],
  };

  it('sends snake_case criteria and omits blank optional ids', async () => {
    proxyRequest.mockResolvedValue({ name: 'n', criteria: {}, branch_count: 3, warnings: [] });

    await service.previewCustom(req, 'tlf', { criteria });

    const [, , path, method, , body] = proxyRequest.mock.calls[0];
    expect(path).toBe('/projects/tlf/audience-builder/custom/preview');
    expect(method).toBe('POST');
    expect(body.custom.criteria).toMatchObject({
      contact_location: true,
      gate_list_id: '26716',
      property_filters: [{ property: 'industry', operator: 'is_any_of', values: ['X'] }],
    });
    expect(body.custom.criteria.speakers).toEqual({ scope: 'current', event_names: ['OSS Korea 2026'] });
    expect(body.custom).not.toHaveProperty('name');
    expect(body.custom.criteria.education_topics).toEqual(['Kubernetes']);
    expect(body.custom.criteria, 'no topic property is sent unless the operator picked one').not.toHaveProperty('education_topic_property');
  });

  it('maps similar lists, dropping one with no id and an unknown recommendation', async () => {
    proxyRequest.mockResolvedValue({
      criteria: {},
      questions: [],
      notes: [],
      similar: [
        {
          list: { list_id: '411', name: '25Q3 - Seoul - Mailable Contacts', hubspot_url: 'https://app.hubspot.com/x/411' },
          recommendation: 'update',
          reason: 'older',
        },
        { list: { list_id: '', name: 'blank' }, recommendation: 'reuse' },
        { list: { list_id: '412', name: 'Seoul Meetup', hubspot_url: 'https://app.hubspot.com/x/412' }, recommendation: 'maybe' },
      ],
    });

    const out = await service.interpretCustom(req, 'tlf', { request: 'Seoul' });

    expect(out.similar.map((s) => s.list.listId)).toEqual(['411', '412']);
    expect(out.similar[0].recommendation).toBe('update');
    expect(out.similar[1].recommendation).toBeUndefined();
  });

  it('maps an interpretation, defaulting every array', async () => {
    proxyRequest.mockResolvedValue({
      criteria: { cities: ['Seoul'], contact_location: true, gate_list_id: '26716' },
      brand_short: 'LF',
      gate: { list_id: '26716', name: 'LF Master-list', hubspot_url: 'javascript:alert(1)' },
      questions: [{ id: 'mailability', question: 'Gate?', options: ['a', 'b'] }],
      notes: [],
    });

    const out = await service.interpretCustom(req, 'tlf', { request: 'Seoul', answers: [{ answer: 'a' }] });

    expect(proxyRequest.mock.calls[0][5]).toEqual({ request: 'Seoul', answers: [{ answer: 'a' }] });
    expect(out.criteria.countries).toEqual([]);
    expect(out.criteria.propertyFilters).toEqual([]);
    expect(out.criteria.eventRegistered).toBe(false);
    expect(out.gate?.hubspotUrl, 'a non-http link is dropped').toBe('');
    expect(out.questions[0].why).toBeUndefined();
  });

  // Upstream answered 2xx, so the list exists: an unusable reply is a do-not-retry partial, never a
  // plain error the client would let the operator retry into a second list.
  it.each([['no id', { list_id: '', name: 'Seoul', hubspot_url: 'https://app.hubspot.com/x' }]])(
    'turns a created list with %s into a partial carrying its name',
    async (_label, wire) => {
      proxyRequest.mockResolvedValue(wire);

      const error = await service.createCustom(req, 'tlf', { criteria }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AudienceComposePartialError);
      expect((error as AudienceComposePartialError).masterName).toBe('Seoul');
    }
  );

  it('reports a created custom list with a non-http link as created, without the link', async () => {
    proxyRequest.mockResolvedValue({ list_id: '7', name: 'Seoul', hubspot_url: 'javascript:alert(1)' });

    const list = await service.createCustom(req, 'tlf', { criteria });

    expect(list).toEqual({ listId: '7', name: 'Seoul', hubspotUrl: '', size: undefined });
  });

  it('names a malformed create by the requested name when the reply carries none', async () => {
    proxyRequest.mockResolvedValue(null);

    const error = await service.createCustom(req, 'tlf', { criteria, name: 'My list' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AudienceComposePartialError);
    expect((error as AudienceComposePartialError).masterName).toBe('My list');
  });

  // A dropped filter or scope would widen the audience the operator then creates, so an unknown
  // criteria enum fails the reply instead.
  it.each([
    ['operator', { property_filters: [{ property: 'jobtitle', operator: 'is_like', values: ['x'] }] }, /property_filters.operator/],
    ['speaker scope', { speakers: { scope: 'future', event_names: [] } }, /speakers.scope/],
  ])('refuses an unknown upstream %s rather than dropping it', async (_label, criteria, field) => {
    proxyRequest.mockResolvedValue({ criteria, questions: [], notes: [] });

    await expect(service.interpretCustom(req, 'tlf', { request: 'x' })).rejects.toThrow(field);
  });

  it('drops a planned event with no name and malformed questions', async () => {
    proxyRequest.mockResolvedValue({
      criteria: {},
      questions: [{ id: 'ok', question: 'Gate?', options: ['a', 2] }, { question: 'no id' }, { id: 'bad', question: 'x', options: 'nope' }, null],
      notes: [],
      event: { brand_short: 'X', event_dates: 'not-an-array' },
    });

    const out = await service.interpretCustom(req, 'tlf', { request: 'x' });

    expect(out.event, 'the tab reads the event name; one without it is no event').toBeUndefined();
    expect(out.questions).toEqual([{ id: 'ok', question: 'Gate?', why: undefined, options: ['a'] }]);
  });

  it('turns an unconfirmed create into a partial carrying the name', async () => {
    proxyRequest.mockRejectedValue(
      new MicroserviceError('boom', 500, 'UPSTREAM', { errorBody: { code: '500', message: 'unconfirmed', master_name: 'Seoul test' } })
    );

    const error = await service.createCustom(req, 'tlf', { criteria }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AudienceComposePartialError);
    expect((error as AudienceComposePartialError).masterName).toBe('Seoul test');
  });

  it('forwards the event name to QA and keeps the current-registrants check when it ran', async () => {
    const check = { verdict: 'PASS', findings: [] };
    proxyRequest.mockResolvedValue({
      needs_disambiguation: false,
      list_id: '1',
      name: 'm',
      checks: {
        signal_mapping: check,
        suppression: { ...check, applied_gdpr: true, applied_opt_out: true },
        exclusion_completeness: { ...check, exclusion_count: 1 },
        current_registrants: { verdict: 'FAIL', findings: [] },
      },
      overall: 'FAIL',
    });

    const out = await service.runQa(req, 'tlf', { listRef: '1', eventName: 'KubeCon Japan 2026' });

    expect(proxyRequest.mock.calls[0][5]).toMatchObject({ event_name: 'KubeCon Japan 2026' });
    expect(out.needsDisambiguation === false && out.checks.currentRegistrants?.verdict).toBe('FAIL');
  });
});

describe('AudienceBuilderProxyService end-to-end test fields', () => {
  let service: AudienceBuilderProxyService;

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new AudienceBuilderProxyService();
  });

  it("maps the hidden count, and each prior send's subject and match reason", async () => {
    proxyRequest.mockResolvedValueOnce({ event: { event_name: 'E' }, lists: [], missing_signals: [], hidden: 5 });
    const discovered = await service.discover(req, 'tlf', 'https://events.example.org/e');
    expect(discovered.result.hidden).toBe(5);

    proxyRequest.mockResolvedValueOnce({
      emails: [
        {
          email_id: '1',
          email_name: 'N',
          hubspot_url: 'https://app.hubspot.com/x',
          included_lists: [],
          suppression_lists: [],
          subject: 'S',
          match_reason: 'brand_only',
        },
      ],
    });
    const sent = await service.getLastSent(req, 'tlf', 'E', '', 3);
    expect(sent[0]).toMatchObject({ subject: 'S', matchReason: 'brand_only' });
  });

  it('maps the event an event audience was planned from', async () => {
    proxyRequest.mockResolvedValue({
      criteria: {},
      questions: [],
      notes: [],
      similar: [],
      event: { event_name: 'E', brand_short: 'AAIF', event_dates: ['2026-09-10'] },
    });

    const out = await service.interpretCustom(req, 'tlf', { request: 'x', eventUrl: 'https://events.example.org/e' });

    expect(out.event).toEqual({ eventName: 'E', brandShort: 'AAIF', eventDates: ['2026-09-10'] });
  });
});
