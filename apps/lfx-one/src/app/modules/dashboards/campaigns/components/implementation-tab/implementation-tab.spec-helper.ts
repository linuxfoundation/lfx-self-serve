// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, EnvironmentProviders, Provider, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { NEVER } from 'rxjs';
import { beforeEach, vi } from 'vitest';
import { CreativeLibraryUploadComponent } from '../creative-library-upload/creative-library-upload.component';
import { ImplementationTabComponent } from './implementation-tab.component';

/**
 * The real tab with no DOM, for state-only tests (#5980).
 *
 * It is the same class, so every input, form, service, signal, computed and effect runs exactly as
 * it does on the full template, and `fixture.detectChanges()` still drives the same change-detection
 * and effect cycles. Only the template is gone, so a test here must assert on state (form validity,
 * computed signals, payloads, draft and persistence), never on the DOM.
 *
 * A subclass with its own `@Component`, not `TestBed.overrideTemplate` on the tab: an override is
 * dropped after every test and forces the whole tab to recompile each time (about 250 ms per test),
 * while this empty template compiles once. `@Component` metadata is not inherited, so the tab's own
 * component-scoped `DialogService` is declared again.
 *
 * Keep DOM tests on `ImplementationTabComponent`. With no DOM, an "is absent" or "is null" query is
 * trivially true, so a test that asserts something is NOT rendered must stay on the full template.
 */
@Component({
  selector: 'lfx-implementation-tab-state-only',
  template: '',
  providers: [DialogService],
})
export class StateOnlyImplementationTab extends ImplementationTabComponent {}

/**
 * Test option that mounts {@link StateOnlyImplementationTab} for that test: `it('…', STATE_ONLY, () => …)`.
 *
 * Marked per test rather than per describe so a converted test keeps its place, its name and its
 * setup. Only a test that asserts on state belongs here: no `nativeElement`, `debugElement`, query,
 * text or aria check, directly or through a helper, and no "is absent" check on the DOM.
 */
export const STATE_ONLY = { meta: { stateOnlyTab: true } } as const;

let stateOnlyTest = false;

/**
 * Records whether the running test is marked {@link STATE_ONLY}; call once at the top of a spec file
 * that marks any. A root `beforeEach` runs before every `describe`'s own, so the suites' setup can
 * call {@link tabComponentUnderTest} without being handed the test.
 */
export function trackStateOnlyTests(): void {
  beforeEach(({ task }) => {
    stateOnlyTest = task.meta.stateOnlyTab === true;
  });
}

/**
 * The tab class the running test mounts: the empty-template subclass under {@link STATE_ONLY}, otherwise the real tab.
 * Component-level overrides (`overrideComponent(..., { set: { providers } })`) must target this class, not
 * `ImplementationTabComponent`: the subclass declares its own providers, so an override on the real tab leaves it with
 * the real service and a test can pass without reaching the fake.
 */
export function tabComponentUnderTest(): Type<ImplementationTabComponent> {
  return stateOnlyTest ? StateOnlyImplementationTab : ImplementationTabComponent;
}

declare module 'vitest' {
  interface TaskMeta {
    /** Set by {@link STATE_ONLY}. */
    stateOnlyTab?: boolean;
  }
}

/** One usable keyword, so a Search create is not held for having none (#4848). */
export const SEED_KEYWORD = { term: 'cloud native conference', matchType: 'Phrase', intentLevel: 'High', notes: '' };

/**
 * The Google creative, geo and bidding sections, which are the three blocks this tab grew for the
 * non-Search channels. One harness for all of them: every one is gated on a Google channel being
 * selected, and a channel is only selectable once its capability has resolved true.
 */
export function configureGoogleTab(extraProviders: (Provider | EnvironmentProviders)[] = []): Promise<void> {
  return TestBed.configureTestingModule({
    imports: [ImplementationTabComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      ProjectContextService,
      { provide: MessageService, useValue: { add: vi.fn() } },
      ...extraProviders,
    ],
  })
    .compileComponents()
    .then(() => undefined);
}

/**
 * A submittable Google form with ONE channel ticked.
 *
 * The draft route, not a bare `patchValue`: `canSubmit` also returns false on `campaignForm.invalid`,
 * so a form missing budget, dates or copy would make every negative assertion below pass without
 * the guard under test existing. The capability inputs go in LAST, matching the ordering the
 * capability-gate block above explains.
 */
export const GOOGLE_BASE_DRAFT: Record<string, unknown> = {
  eventSlug: 'kubecon-eu-2026',
  eventName: 'KubeCon EU 2026',
  registrationUrl: 'https://example.com',
  countryCode: 'US',
  includeSearch: false,
  includeDemandGen: false,
  includePerformanceMax: false,
  includeVideo: false,
  includeDisplay: false,
  budgetUsd: 500,
  startDate: '2026-09-01',
  endDate: '2026-09-30',
  headlines: ['Join us at KubeCon'],
  descriptions: ['Register today for KubeCon EU 2026.'],
};

export function seedChannel(fixture: ComponentFixture<ImplementationTabComponent>, patch: Record<string, unknown>): Record<string, any> {
  fixture.componentRef.setInput('draft', { ...GOOGLE_BASE_DRAFT } as unknown as CampaignImplementationDraft);
  fixture.componentRef.setInput('briefData', {
    eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
    selectedPlatforms: ['google-ads'],
    // One keyword, so a Search create is not held for having none (#4848).
    keywords: [SEED_KEYWORD],
  } as unknown as CampaignBriefOutput);
  fixture.detectChanges();

  const c = fixture.componentInstance as unknown as Record<string, any>;
  c['campaignForm'].patchValue({
    includeSearch: false,
    includeDemandGen: false,
    includePerformanceMax: false,
    includeVideo: false,
    includeDisplay: false,
    ...patch,
  });
  fixture.componentRef.setInput('demandGenEnabled', true);
  fixture.componentRef.setInput('googleChannelsEnabled', true);
  // Creative is withheld until the cutover owns the create — see `googleCreativeEnabled`. It is a
  // capability of its own rather than a reading of `googleChannelsEnabled`, so it has to be set.
  fixture.componentRef.setInput('googleCreativeEnabled', true);
  fixture.detectChanges();
  return c;
}

/**
 * Replay a saved draft through the REAL restore path.
 *
 * `applyDraft` takes no argument — it reads the `draft` input — so a test that passes an object to
 * it silently re-applies whatever is already mounted and proves nothing. The draft also has to
 * carry `eventSlug`, because `applyDraft` returns early unless it matches the form's, and the
 * copy arrays, because `replaceCopyArray` is called on both unconditionally.
 */
export function restoreGoogleDraft(fixture: ComponentFixture<ImplementationTabComponent>, c: Record<string, any>, extra: Record<string, unknown>): void {
  fixture.componentRef.setInput('draft', { ...GOOGLE_BASE_DRAFT, ...extra } as unknown as CampaignImplementationDraft);
  c['applyDraft']();
  fixture.detectChanges();
}

/** Everything Display needs to clear its minimums, so one field at a time is the variable. */
export const DISPLAY_COMPLETE = {
  headlines: 'One headline',
  longHeadline: 'A long headline',
  descriptions: 'A description',
  businessName: 'Acme',
  marketingImages: 'https://example.com/a.png',
  squareMarketingImages: 'https://example.com/square.png',
};

/**
 * Stubs the library upload child before each test; call once at the top of a spec file.
 *
 * The library upload reads the service's upload queue and the library as soon as a brief is saved, and
 * every implementation-tab suite mocks `CampaignService` for the tab's own calls only. So the child gets an
 * empty template and its own `CampaignService` stub; its behaviour is covered by its own spec.
 *
 * The CHILD is overridden, never `ImplementationTabComponent`: TestBed drops overrides after each test, and
 * overriding the tab would recompile its whole template on every test (about 250 ms each, #5980).
 */
export function stubCreativeLibraryUpload(): void {
  beforeEach(() => {
    TestBed.overrideComponent(CreativeLibraryUploadComponent, {
      set: {
        template: '',
        imports: [],
        providers: [
          { provide: CampaignService, useValue: { creativeAssetUploadQueue: () => [], listCreativeAssets: () => NEVER, creativeVideoDeleting: () => null } },
        ],
      },
    });
  });
}
