// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

// Mirrors meta-ads.service.spec.ts: the `@lfx-one/shared/*` aliases are not wired into this app's
// vitest config with Angular-free resolution, so they are stubbed here. This spec exercises a pure
// URL builder and needs nothing from them.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', () => ({}));

import { buildRedditUtmUrl } from './reddit-ads.service';

describe('buildRedditUtmUrl — utm_campaign omission', () => {
  const config = {
    registrationUrl: 'https://events.linuxfoundation.org/kubecon-na-2026/',
    eventSlug: 'kubecon-na-2026',
    eventName: 'KubeCon NA 2026',
  } as Parameters<typeof buildRedditUtmUrl>[0];

  it('OMITS utm_campaign when HubSpot issued no token', () => {
    // Copilot: the omission landed on the Google Ads builder only, so attribution varied BY
    // PLATFORM for the same tokenless campaign -- honestly untagged on Google, falsely tagged on
    // Reddit. `hsToken || slug` minted a plausible-looking token HubSpot never issued, which is
    // indistinguishable downstream from a real one and attributes traffic to a campaign HubSpot
    // cannot report on. An absent parameter is visibly absent.
    const url = new URL(buildRedditUtmUrl({ ...config, hsToken: undefined }, 0));

    expect(url.searchParams.has('utm_campaign'), 'fabricated a utm_campaign from the event slug').toBe(false);
    // One parameter, not a refusal to tag: the rest still travels.
    expect(url.searchParams.get('utm_source')).toBe('reddit');
    expect(url.searchParams.get('utm_medium')).toBe('paid-social');
  });

  it('carries a real token through', () => {
    // The other direction, so the assertion above cannot be satisfied by dropping it always.
    const url = new URL(buildRedditUtmUrl({ ...config, hsToken: 'hs-real-token' }, 0));
    expect(url.searchParams.get('utm_campaign')).toBe('hs-real-token');
  });
});
