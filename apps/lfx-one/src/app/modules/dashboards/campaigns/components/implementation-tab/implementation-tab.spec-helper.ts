// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, EnvironmentProviders, input, output, Provider } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { beforeEach, vi } from 'vitest';
import { CreativeLibraryUploadComponent } from '../creative-library-upload/creative-library-upload.component';
import { ImplementationTabComponent } from './implementation-tab.component';

/**
 * The library upload reads the service's queue and the library quota as soon as a brief is saved.
 * Every implementation-tab suite mocks `CampaignService` for the tab's own calls only, so the child
 * is stubbed in every spec file; its own behaviour is covered by its spec.
 */
@Component({ selector: 'lfx-creative-library-upload', template: '' })
export class CreativeLibraryUploadStubComponent {
  public readonly projectSlug = input('');
  public readonly briefId = input('');
  public readonly available = input<boolean | null>(null);
  public readonly reloadToken = input(0);
  public readonly libraryChanged = output<number>();
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

/** Swaps the library upload child for a stub before each test; call once at the top of a spec file. */
export function stubCreativeLibraryUpload(): void {
  beforeEach(() => {
    TestBed.overrideComponent(ImplementationTabComponent, {
      remove: { imports: [CreativeLibraryUploadComponent] },
      add: { imports: [CreativeLibraryUploadStubComponent] },
    });
  });
}
