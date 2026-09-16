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

import { AudienceBuilderProxyService } from './audience-builder-proxy.service';

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

  it('omits detail rather than carrying an empty string', async () => {
    proxyRequest.mockResolvedValue({ hubspot_configured: true, detail: '   ' });

    const caps = await service.getCapabilities(req, 'tlf');

    expect(caps.detail, 'a blank detail would render an empty banner line').toBeUndefined();
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
});
