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
 * LFXV2-2235 follow-up (PR #1835 review): `refreshEnrichedPersonas` guards `isMarketingAuditor`,
 * `isCampaignManager`, and `marketingGrantSlug` against out-of-order responses using a single
 * global "most recently issued call wins" counter. A response only writes these signals if its
 * probe is the latest one issued across every scope — a slower response for a foundation the
 * user has already navigated away from can never clobber a newer, faster-resolving probe's
 * write for the current foundation.
 *
 * An earlier version of this guard scoped the check per project slug instead of globally, on the
 * theory that a route guard's own response should never be blocked by an unrelated probe for a
 * different foundation (e.g. a sidebar-nav pre-check). That theory doesn't hold: the guards
 * (`campaign-access.guard.ts`, `marketing-impact-access.guard.ts`) decide access from each call's
 * own `response`, not from these shared signals — see those guards' spec files for the tests
 * proving a discarded signal write never causes a false denial. Per-scope scoping only reopened a
 * different, worse bug: a stale, differently-scoped response could resolve *after* a newer probe
 * for the active foundation and overwrite its correct value, because the per-scope check only
 * compares a response against others in its own scope and has no way to see that a different
 * scope was issued more recently (Cursor Bugbot finding, PR #1835). Global ordering closes that.
 */
describe('PersonaService — grant probe recency ordering', () => {
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

  it('does not let a stale, already-superseded probe for foundation A overwrite isCampaignManager/isMarketingAuditor after a newer probe for foundation B has already resolved (Cursor Bugbot finding, PR #1835)', () => {
    // A's probe is issued first, B's second; B resolves first (legitimately, over the network),
    // then A's stale response resolves after — it must not clobber the values B already wrote,
    // even though A's own write would otherwise look valid in isolation.
    service.refreshEnrichedPersonas(true, 'foundation-a').subscribe();
    service.refreshEnrichedPersonas(true, 'foundation-b').subscribe();

    http.expectOne((req) => req.url.includes('project=foundation-b')).flush(mockResponse({ isCampaignManager: true, isMarketingAuditor: true }));
    http.expectOne((req) => req.url.includes('project=foundation-a')).flush(mockResponse({ isCampaignManager: false, isMarketingAuditor: false }));

    expect(service.isCampaignManager()).toBe(true);
    expect(service.isMarketingAuditor()).toBe(true);
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
    // foundation — the same global-recency guard as the booleans above, so all three signals
    // always move together off the same most-recently-issued response.
    service.refreshEnrichedPersonas(true, 'foundation-a').subscribe();
    service.refreshEnrichedPersonas(true, 'foundation-b').subscribe();

    http.expectOne((req) => req.url.includes('project=foundation-b')).flush(mockResponse({ isCampaignManager: true }));
    http.expectOne((req) => req.url.includes('project=foundation-a')).flush(mockResponse({ isCampaignManager: true }));

    expect(service.marketingGrantSlug()).toBe('foundation-b');
  });

  it('does not let a later-issued probe that never itself writes (errors out) block an earlier, still-in-flight probe from applying its legitimate response (Cursor Bugbot finding, PR #1835: "Global probe gate drops grant slug")', () => {
    // foundation-a's probe is issued first; a second, unrelated probe (e.g. a background
    // sidebar-nav pre-check for foundation-b) is issued after it but errors before resolving.
    // The mere issuance of that second probe must not permanently prevent foundation-a's
    // still-in-flight, legitimately successful response from ever writing.
    service.refreshEnrichedPersonas(true, 'foundation-a').subscribe();
    service.refreshEnrichedPersonas(true, 'foundation-b').subscribe();

    http.expectOne((req) => req.url.includes('project=foundation-b')).error(new ProgressEvent('network error'));
    http.expectOne((req) => req.url.includes('project=foundation-a')).flush(mockResponse({ isCampaignManager: true, isMarketingAuditor: true }));

    expect(service.isCampaignManager()).toBe(true);
    expect(service.isMarketingAuditor()).toBe(true);
    expect(service.marketingGrantSlug()).toBe('foundation-a');
  });

  /**
   * LFXV2-2235 follow-up (PR #1835, Copilot finding on `confirmActiveGrant`): a guard force-applies
   * its own response so it can never be denied by a *cross-scope* probe winning the global recency
   * race (see the suite above). But that same bypass previously had no way to tell a cross-scope
   * race apart from a genuine *same-scope* race — a case where a newer probe for the guard's own
   * scope had already resolved and applied a more current, different answer. Force-applying the
   * older response in that case reintroduced the exact clobber the recency gate exists to prevent,
   * just through `confirmActiveGrant`'s door instead of `applyPersonaResponse`'s.
   */
  describe('confirmActiveGrant — same-scope vs cross-scope recency', () => {
    it('does not let a guard force-apply its own response once a later-issued probe for the SAME scope has already applied a different answer', () => {
      const first$ = service.refreshEnrichedPersonas(true, 'foundation-a');
      let firstResponse: PersonaApiResponse | null = null;
      first$.subscribe((response) => (firstResponse = response));

      // A second probe for the SAME scope is issued after the first.
      service.refreshEnrichedPersonas(true, 'foundation-a').subscribe();

      const [firstReq, secondReq] = http.match((req) => req.url.includes('project=foundation-a'));
      // The newer, same-scope probe resolves first and legitimately applies `false`.
      secondReq.flush(mockResponse({ isCampaignManager: false }));
      // The older probe resolves after — its own response is genuinely stale now, not just a
      // victim of the global/cross-scope gate.
      firstReq.flush(mockResponse({ isCampaignManager: true }));

      expect(service.isCampaignManager()).toBe(false);

      // The guard that issued the first probe still calls confirmActiveGrant with its own
      // (stale) response — it must be a no-op, not a force-restore of the stale `true`.
      service.confirmActiveGrant(firstResponse!, 'foundation-a');

      expect(service.isCampaignManager()).toBe(false);
    });

    it('still lets a guard force-apply its own response when a differently-scoped probe won the global recency race, even though a same-scope check alone would have to allow it', () => {
      const a$ = service.refreshEnrichedPersonas(true, 'foundation-a');
      let aResponse: PersonaApiResponse | null = null;
      a$.subscribe((response) => (aResponse = response));

      // A probe for a DIFFERENT scope is issued after foundation-a's and resolves first,
      // winning the global recency race and blocking foundation-a's write.
      service.refreshEnrichedPersonas(true, 'foundation-b').subscribe();

      http.expectOne((req) => req.url.includes('project=foundation-b')).flush(mockResponse({ isCampaignManager: true }));
      http.expectOne((req) => req.url.includes('project=foundation-a')).flush(mockResponse({ isCampaignManager: true }));

      expect(service.isCampaignManager()).toBe(true); // written by foundation-b's probe, not foundation-a's

      // foundation-a's guard still has its own authoritative response — no newer probe was
      // issued for foundation-a's own scope, so this must force-apply, not defer.
      service.confirmActiveGrant(aResponse!, 'foundation-a');

      expect(service.isCampaignManager()).toBe(true);
    });
  });
});
