// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { PersonaApiResponse } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PersonaService } from './persona.service';

const mockResponse = (overrides: Partial<PersonaApiResponse>): PersonaApiResponse => ({
  personas: [],
  personaProjects: {},
  projects: [],
  organizations: [],
  error: null,
  isRootWriter: false,
  isLFStaff: false,
  isMarketingAuditor: false,
  isCampaignManager: false,
  ...overrides,
});

/**
 * LFXV2-2235 follow-up (PR #1835 review): `refreshEnrichedPersonas` used to gate the grant-signal
 * write behind a single global "most recently issued call wins" counter. That let an unrelated
 * probe for a *different* foundation silently discard the write for the foundation actually being
 * navigated to — a route guard could correctly admit a user based on its own response while the
 * shared `isMarketingAuditor`/`isCampaignManager` signals the destination page reads stayed stale,
 * because a same-tick sidebar-nav probe for another slug had been issued a moment later. Scoping
 * the "latest wins" check per project slug (root vs. each foundation) fixes this: only a probe for
 * the *same* scope can supersede another's write.
 */
describe('PersonaService — per-scope grant probe ordering', () => {
  let service: PersonaService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PersonaService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PersonaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it("does not let a later-issued probe for a different foundation block an earlier probe's own-scope write", () => {
    service.refreshEnrichedPersonas(true, 'foundation-a').subscribe();
    service.refreshEnrichedPersonas(true, 'foundation-b').subscribe();

    // Foundation B's probe (issued second) resolves first — as it legitimately may over the network.
    http.expectOne((req) => req.url.includes('project=foundation-b')).flush(mockResponse({ isCampaignManager: false }));
    // Foundation A's probe resolves after — under the old single global counter this write would
    // have been discarded because a "later" probe (B) already existed, even though B is unrelated.
    http.expectOne((req) => req.url.includes('project=foundation-a')).flush(mockResponse({ isCampaignManager: true }));

    expect(service.isCampaignManager()).toBe(true);
  });

  it('still lets a later-issued probe for the SAME foundation supersede an earlier one for that foundation', () => {
    service.refreshEnrichedPersonas(true, 'foundation-a').subscribe();
    service.refreshEnrichedPersonas(true, 'foundation-a').subscribe();

    const [first, second] = http.match((req) => req.url.includes('project=foundation-a'));
    // The earlier-issued call for the SAME scope resolves last but must not win.
    second.flush(mockResponse({ isCampaignManager: false }));
    first.flush(mockResponse({ isCampaignManager: true }));

    expect(service.isCampaignManager()).toBe(false);
  });

  it('does not let an older, already-superseded probe for foundation A overwrite marketingGrantSlug after a newer probe for foundation B has already resolved (Copilot finding, PR #1835)', () => {
    // ProjectContextService treats marketingGrantSlug as the single most recently *verified*
    // foundation (a global-recency concept), unlike isMarketingAuditor/isCampaignManager which
    // are correctly scoped per foundation. A's probe is issued first, B's second; B resolves
    // first (legitimately, over the network), then A's stale response resolves after — it must
    // not clobber the slug B already set.
    service.refreshEnrichedPersonas(true, 'foundation-a').subscribe();
    service.refreshEnrichedPersonas(true, 'foundation-b').subscribe();

    http.expectOne((req) => req.url.includes('project=foundation-b')).flush(mockResponse({ isCampaignManager: true }));
    http.expectOne((req) => req.url.includes('project=foundation-a')).flush(mockResponse({ isCampaignManager: true }));

    expect(service.marketingGrantSlug()).toBe('foundation-b');
  });
});
