// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import {
  DISPLAY_COMPLETE,
  SEED_KEYWORD,
  configureGoogleTab,
  restoreGoogleDraft,
  seedChannel,
  stubCreativeLibraryUpload,
  STATE_ONLY,
  tabComponentUnderTest,
  trackStateOnlyTests,
} from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * The Google audience segment chips.
 *
 * Every branch of upstream's `validateAudienceSegments` is mirrored on the add path, which a typed
 * resource name and a picked one (#5244) both go through — and each test below is one of those
 * branches, plus the accept-cases that keep the guards from refusing what upstream takes.
 */
describe('ImplementationTabComponent google audience segments', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const LIST_A = 'customers/1234567890/userLists/111';
  const LIST_B = 'customers/1234567890/userLists/222';

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  /** `seedChannel`, plus the per-caller capability a ROOT caller is answered with. */
  function seedAudience(patch: Record<string, unknown>, enabled: boolean | null = true): Record<string, any> {
    const c = seedChannel(fixture, patch);
    fixture.componentRef.setInput('googleAudienceSegmentsEnabled', enabled);
    fixture.detectChanges();
    return c;
  }

  it('trims an added user list and declines a repeat or a blank', STATE_ONLY, () => {
    const c = seedAudience({ includeSearch: true });

    expect(c['addGoogleAudienceSegment'](`  ${LIST_A}\u00a0`)).toBe(true);
    // Upstream collapses a repeat rather than refusing it, so a second chip would claim a segment
    // the request does not carry twice.
    expect(c['addGoogleAudienceSegment'](LIST_A)).toBe(false);
    expect(c['addGoogleAudienceSegment']('   ')).toBe(false);

    expect(c['googleAudienceSegments']()).toEqual([LIST_A]);
  });

  it.each([
    ['a custom audience, which upstream refuses on Search', 'customers/1234567890/customAudiences/5', 'custom'],
    ['a customer id written with dashes', 'customers/123-456-7890/userLists/111', 'shape'],
    ['a bare user list id', '111', 'shape'],
    ['a trailing path segment', `${LIST_A}/extra`, 'shape'],
    ['an interest category', 'customers/1234567890/userInterests/80', 'shape'],
    ['a list id with a leading zero, which the campaign-level field refuses', 'customers/1234567890/userLists/0111', 'id'],
  ])('refuses %s and says why while the text is still in the box', (_label, text, kind) => {
    const c = seedAudience({ includeSearch: true });

    expect(c['addGoogleAudienceSegment'](text)).toBe(false);
    c['googleAudienceSegmentDraft'].set(text);
    fixture.detectChanges();

    expect(c['googleAudienceSegments']()).toEqual([]);
    expect(c['googleAudienceSegmentDraftError']()).toBe(kind);
    const line = fixture.nativeElement.querySelector(`[data-testid="implementation-google-audience-segment-${kind}"]`);
    expect(line).not.toBeNull();
    if (kind === 'custom') expect(line.textContent).toContain('A Search campaign cannot target a custom audience, only a user list.');
    const input = fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segment-add"]');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(line.id);
  });

  it('keeps refused text in the box and clears it on a successful add', () => {
    seedAudience({ includeSearch: true });
    const c = fixture.componentInstance as unknown as Record<string, any>;
    const input = fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segment-add"]') as HTMLInputElement;

    input.value = 'not-a-list';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(input.value).toBe('not-a-list');

    input.value = LIST_A;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(input.value).toBe('');
    expect(c['googleAudienceSegments']()).toEqual([LIST_A]);
  });

  it('refuses an add at the cap and swaps the box for the full notice', () => {
    const c = seedAudience({ includeSearch: true });
    c['googleAudienceSegments'].set(Array.from({ length: GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS }, (_, i) => `customers/1/userLists/${i + 1}`));
    fixture.detectChanges();

    expect(c['addGoogleAudienceSegment'](LIST_A)).toBe(false);
    expect(c['googleAudienceSegments']()).toHaveLength(GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS);
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segments-full"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segment-add"]')).toBeNull();
  });

  it('removes a chip by index', () => {
    const c = seedAudience({ includeSearch: true });
    c['addGoogleAudienceSegment'](LIST_A);
    c['addGoogleAudienceSegment'](LIST_B);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segment-remove-0"]') as HTMLButtonElement).click();

    expect(c['googleAudienceSegments']()).toEqual([LIST_B]);
  });

  it('sends the entered segments as campaignAudienceSegments on Search', STATE_ONLY, () => {
    const c = seedAudience({ includeSearch: true });
    c['addGoogleAudienceSegment'](LIST_A);
    c['addGoogleAudienceSegment'](LIST_B);

    expect(c['googleAudienceSegmentsPayload']()).toEqual({ campaignAudienceSegments: [LIST_A, LIST_B] });
  });

  it('says the lists apply to the whole campaign', () => {
    seedAudience({ includeSearch: true });

    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segments-scope"]')?.textContent).toContain(
      'These lists apply to the whole campaign, including any ad group added later.'
    );
  });

  /**
   * A draft saved while the lists went out as `audienceSegments` restores under the same key and is
   * sent at the campaign level; one holding a list id the campaign-level field refuses holds Create
   * with a visible reason rather than sending a refused request.
   */
  it('sends a draft saved before the change as campaignAudienceSegments', () => {
    const c = seedAudience({ includeSearch: true });
    restoreGoogleDraft(fixture, c, { includeSearch: true, googleAudienceSegments: [LIST_A, LIST_B] });
    fixture.detectChanges();

    expect(c['googleAudienceSegmentsPayload']()).toEqual({ campaignAudienceSegments: [LIST_A, LIST_B] });
    expect(c['googleAudienceSegmentsInvalidPosition']()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segments-invalid"]')).toBeNull();
  });

  it('holds Create for a restored list id the campaign-level field refuses, and releases it on Remove', () => {
    const c = seedAudience({ includeSearch: true });
    restoreGoogleDraft(fixture, c, { includeSearch: true, googleAudienceSegments: [LIST_A, 'customers/1234567890/userLists/0222'] });
    fixture.detectChanges();
    const notice = () => fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segments-invalid"]');

    expect(c['googleAudienceSegmentsInvalidPosition']()).toBe(2);
    expect(notice()?.textContent).toContain('Audience segment 2 cannot be sent');
    expect(c['canSubmit']()).toBe(false);

    c['removeGoogleAudienceSegment'](1);
    fixture.detectChanges();
    expect(notice()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('does not hold Create for a refused restored list the request does not carry', STATE_ONLY, () => {
    const c = seedAudience({ includeDemandGen: true });
    restoreGoogleDraft(fixture, c, { includeDemandGen: true, googleAudienceSegments: ['customers/1234567890/userLists/0222'] });
    fixture.detectChanges();

    expect(c['googleAudienceSegmentsInvalidPosition']()).toBeNull();
  });

  /** An absent key, not `[]`: the absent-key route every caller predating the field takes. */
  it('sends nothing when no segment was entered', STATE_ONLY, () => {
    const c = seedAudience({ includeSearch: true });

    expect(c['googleAudienceSegmentsPayload']()).toEqual({});
  });

  it.each([
    ['demand-gen', { includeDemandGen: true }],
    ['performance-max', { includePerformanceMax: true }],
    ['display', { includeDisplay: true }],
  ])('closes the section on %s, where upstream refuses audience segments', (_channel, patch) => {
    const c = seedAudience(patch);
    fixture.detectChanges();

    expect(c['googleAudienceSegmentsAvailable']()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segments-section"]')).toBeNull();
  });

  /**
   * Held, not cleared, and not silent: the chips survive a switch so switching back restores them,
   * the payload carries nothing a non-Search create would be refused for, and a notice says so.
   */
  it('withholds a list entered under Search once the channel moves, and says so', () => {
    const c = seedAudience({ includeSearch: true });
    c['addGoogleAudienceSegment'](LIST_A);
    const notice = () => fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segments-withheld"]');
    // Always mounted, so a screen reader hears the sentence when the channel switch gives it text.
    const live = () => fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segments-withheld-live"]') as HTMLElement;
    fixture.detectChanges();
    expect(notice()).toBeNull();
    expect(live().getAttribute('aria-live')).toBe('polite');
    expect(live().textContent?.trim()).toBe('');

    c['campaignForm'].patchValue({ includeSearch: false, includePerformanceMax: true });
    fixture.detectChanges();
    expect(c['googleAudienceSegments']()).toEqual([LIST_A]);
    expect(c['googleAudienceSegmentsPayload']()).toEqual({});
    expect(notice()?.textContent).toContain('Performance Max campaigns do not take audience segments');
    expect(live().textContent?.trim()).toBe(c['googleAudienceSegmentsWithheldWarning']());
    // The visible notice carries no role of its own, or the sentence would be announced twice.
    expect(notice()?.getAttribute('role')).toBeNull();

    c['campaignForm'].patchValue({ includeSearch: true, includePerformanceMax: false });
    fixture.detectChanges();
    expect(notice()).toBeNull();
    expect(live().textContent?.trim()).toBe('');
    expect(c['googleAudienceSegmentsPayload']()).toEqual({ campaignAudienceSegments: [LIST_A] });
  });

  /** The legacy road reads nothing on `googleAdsConfig`, so a segment there would be dropped. */
  it.each([[null], [false]])('withholds the section and the payload while googleCreativeEnabled is %s', (capability) => {
    const c = seedAudience({ includeSearch: true });
    c['addGoogleAudienceSegment'](LIST_A);
    fixture.componentRef.setInput('googleCreativeEnabled', capability);
    fixture.detectChanges();

    expect(c['googleAudienceSegmentsPayload']()).toEqual({});
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-audience-segments-section"]')).toBeNull();
    expect(c['googleAudienceSegments']()).toEqual([LIST_A]);
  });

  it('round-trips the chips through a draft without sharing the array', STATE_ONLY, () => {
    const c = seedAudience({ includeSearch: true });
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    c['addGoogleAudienceSegment'](LIST_A);

    expect(emitted?.googleAudienceSegments).toEqual([LIST_A]);

    const saved = [LIST_B];
    c['googleAudienceSegments'].set([]);
    restoreGoogleDraft(fixture, c, { googleAudienceSegments: saved });
    expect(c['googleAudienceSegments']()).toEqual([LIST_B]);

    c['addGoogleAudienceSegment'](LIST_A);
    expect(saved).toEqual([LIST_B]);
  });

  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  /** A Search draft holding one segment, then the per-caller answer and the read set as given. */
  function holdSegment(enabled: boolean | null, read: 'pending' | 'ready' | 'failed' | 'unknown', briefId: string | null = 'brief-1'): Record<string, any> {
    const c = seedAudience({ includeSearch: true });
    c['addGoogleAudienceSegment'](LIST_A);
    fixture.componentRef.setInput('briefPersistence', { status: briefId ? 'saved' : 'off', briefId, message: null, approved: !!briefId });
    fixture.componentRef.setInput('createCapabilityRead', read);
    fixture.componentRef.setInput('googleAudienceSegmentsEnabled', enabled);
    fixture.detectChanges();
    return c;
  }

  /**
   * LF MARKETING ONLY (`global_marketing_ops` on the project). Any other caller, a foundation ED or a
   * ROOT writer without the relation, is answered `false`: the section hides, nothing is sent, and a
   * draft that still holds segments HOLDS Create with a way out rather than dropping them.
   */
  it('hides the section and holds Create for a caller without global_marketing_ops whose draft still has segments', () => {
    const c = holdSegment(false, 'ready');

    expect(find('implementation-google-audience-segments-section')).toBeNull();
    expect(c['googleAudienceSegmentsPayload']()).toEqual({});
    expect(c['googleAudienceSegmentsBlock']()?.kind).toBe('restricted');
    expect(find('implementation-google-audience-segments-block-restricted')?.textContent).toContain(
      'Only the LF marketing team can add Google audience segments'
    );
    expect(find('implementation-google-audience-segments-block-restricted')?.textContent).toContain('ask the LF marketing team to add them');
    expect(find('implementation-google-audience-segments-block-live')?.textContent?.trim()).toBe(c['googleAudienceSegmentsBlockMessage']());
    expect(c['canSubmit']()).toBe(false);
    expect(find('implementation-google-audience-segments-block-retry')).toBeNull();

    (find('implementation-google-audience-segments-block-remove')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(c['googleAudienceSegments']()).toEqual([]);
    expect(c['googleAudienceSegmentsBlock']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('hides the section for a caller without global_marketing_ops with no segments, and holds nothing', () => {
    const c = seedAudience({ includeSearch: true }, false);

    expect(find('implementation-google-audience-segments-section')).toBeNull();
    expect(c['googleAudienceSegmentsBlock']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('holds Create while the per-caller answer is still being read', () => {
    const c = holdSegment(null, 'pending');

    expect(c['googleAudienceSegmentsBlock']()?.kind).toBe('pending');
    expect(find('implementation-google-audience-segments-block-pending')?.textContent).toContain('1 audience segment');
    expect(c['canSubmit']()).toBe(false);
  });

  it.each([['failed'], ['unknown']])('offers a Retry when the read is %s', (read) => {
    const retried = vi.fn();
    fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);
    const c = holdSegment(null, read as 'failed' | 'unknown');

    expect(c['googleAudienceSegmentsBlock']()?.kind).toBe('failed');
    (find('implementation-google-audience-segments-block-retry')?.querySelector('button') as HTMLButtonElement).click();
    expect(retried).toHaveBeenCalledTimes(1);
  });

  /** The list answers `null` when the access check could not be made: unverified, not denied. */
  it('offers a Retry, not the restricted block, when the read succeeded but access could not be verified', () => {
    const retried = vi.fn();
    fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);
    const c = holdSegment(null, 'ready');

    expect(c['googleAudienceSegmentsBlock']()?.kind).toBe('failed');
    expect(c['canSubmit']()).toBe(false);
    (find('implementation-google-audience-segments-block-retry')?.querySelector('button') as HTMLButtonElement).click();
    expect(retried).toHaveBeenCalledTimes(1);
  });

  it('asks for the brief to be saved when there is no brief to check against', STATE_ONLY, () => {
    const c = holdSegment(null, 'unknown', null);

    expect(c['googleAudienceSegmentsBlock']()?.kind).toBe('unsaved');
  });

  it('names the deployment, not the caller, when the create path does not serve', STATE_ONLY, () => {
    const c = holdSegment(false, 'ready');
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    expect(c['googleAudienceSegmentsBlock']()?.kind).toBe('unsupported');
  });

  it('clears the block once a global_marketing_ops holder is answered yes', () => {
    const c = holdSegment(null, 'pending');
    fixture.componentRef.setInput('createCapabilityRead', 'ready');
    fixture.componentRef.setInput('googleAudienceSegmentsEnabled', true);
    fixture.detectChanges();

    expect(c['googleAudienceSegmentsBlock']()).toBeNull();
    expect(c['googleAudienceSegmentsPayload']()).toEqual({ campaignAudienceSegments: [LIST_A] });
    expect(find('implementation-google-audience-segments-block-live')?.textContent?.trim()).toBe('');
  });

  it('leaves a non-search channel to the channel warning, whatever the capability answers', STATE_ONLY, () => {
    const c = holdSegment(false, 'ready');
    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
    fixture.detectChanges();

    expect(c['googleAudienceSegmentsWithheldWarning']()).toContain('Demand Gen campaigns do not take audience segments');
    expect(c['googleAudienceSegmentsBlock']()).toBeNull();
  });

  /** A draft saved before this section shipped carries no key, and must not clear the chips. */
  it('leaves the chips alone when the draft carries no segment key', STATE_ONLY, () => {
    const c = seedAudience({ includeSearch: true });
    c['addGoogleAudienceSegment'](LIST_A);

    restoreGoogleDraft(fixture, c, {});

    expect(c['googleAudienceSegments']()).toEqual([LIST_A]);
  });
});

/**
 * #5262 W1a opened Demand Gen bidding, languages, ad schedules and devices. A create that touches
 * none of them must send exactly the request it sent before, on Demand Gen and on every other
 * channel this screen can create. The literal was captured from the tab at the base commit and
 * matched byte for byte after the change.
 */
describe('ImplementationTabComponent google request with no targeting touched', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it.each([
    ['search', { includeSearch: true }],
    ['display', { includeDisplay: true }],
    ['performance-max', { includePerformanceMax: true }],
    ['demand-gen', { includeDemandGen: true }],
  ])('sends the same %s request it sent before', STATE_ONLY, async (channel, patch) => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedChannel(fixture, patch);
    fixture.detectChanges();

    c['submit']();
    await fixture.whenStable();

    expect(JSON.stringify(createCampaign.mock.calls[0][0])).toBe(
      JSON.stringify({
        eventName: 'KubeCon EU 2026',
        eventSlug: 'kubecon-eu-2026',
        countryCode: 'US',
        registrationUrl: 'https://example.com',
        campaignTypes: [channel],
        budgetUsd: 500,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        keywords: [{ term: 'cloud native conference', matchType: 'Phrase', intentLevel: 'High', notes: '' }],
        headlines: ['Join us at KubeCon'],
        descriptions: ['Register today for KubeCon EU 2026.'],
        geoTargets: ['US'],
        platforms: ['google-ads'],
      })
    );
  });
});

describe('ImplementationTabComponent google flight and keywords', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const text = (testId: string): string | null =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

  /** #4848: Google refuses an end before the start, and the operator saw only the generic failure. */
  it('names an end date before the start and holds Create', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    expect(c['canSubmit']()).toBe(true);

    c['campaignForm'].patchValue({ startDate: '2026-12-10', endDate: '2026-12-09' });
    fixture.detectChanges();

    expect(text('implementation-google-flight-error')).toBe('Google needs the end date (2026-12-09) on or after the start date (2026-12-10).');
    expect(c['canSubmit']()).toBe(false);
    const end = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-end-date"]') as HTMLElement;
    expect(end.getAttribute('aria-describedby')).toBe('implementation-google-flight-error');
    expect(end.getAttribute('aria-invalid')).toBe('true');
  });

  /** Google accepts a same-day flight, so it is not refused here. */
  it('accepts a same-day flight', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].patchValue({ startDate: '2026-12-10', endDate: '2026-12-10' });
    fixture.detectChanges();

    expect(c['googleFlightError']()).toBeNull();
    expect(text('implementation-google-flight-error')).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  /** The Google rule only: the other platforms judge the window by their own rules. */
  it('says nothing about the flight when Google is not selected', () => {
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['meta-ads'],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['campaignForm'].patchValue({ startDate: '2026-12-10', endDate: '2026-12-09' });
    fixture.detectChanges();

    expect(c['googleFlightError']()).toBeNull();
    expect(text('implementation-google-flight-error')).toBeNull();
  });

  /** #4848: zero keywords creates a Search campaign that can never serve. */
  it.each([
    ['no keywords', []],
    [
      'only blank keywords',
      [
        { ...SEED_KEYWORD, term: '   ' },
        { ...SEED_KEYWORD, term: '' },
      ],
    ],
  ])('holds a Search create whose brief has %s, and says why', (_label, keywords) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['briefKeywords'].set(keywords);
    fixture.detectChanges();

    expect(text('implementation-google-search-keywords-error')).toBe(
      'Search needs at least one keyword to serve, and this brief has none filled in. Choose another campaign type, or give the brief keywords first.'
    );
    expect(c['canSubmit']()).toBe(false);
  });

  /** Only Search carries keywords upstream, so another type is not held for having none. */
  it('does not hold a non-Search create for having no keywords', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['briefKeywords'].set([]);
    c['campaignForm'].controls.displayCreative.patchValue(DISPLAY_COMPLETE);
    fixture.detectChanges();

    expect(c['googleSearchKeywordsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  /** A blank term is dropped from the request rather than refused upstream with the generic failure. */
  it('sends only the keywords with a term', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['briefKeywords'].set([{ ...SEED_KEYWORD, term: ' ' }, SEED_KEYWORD]);
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: '' }) as never);

    c['submit']();

    expect(createCampaign).toHaveBeenCalledTimes(1);
    expect(createCampaign.mock.calls[0][0]).toMatchObject({ keywords: [SEED_KEYWORD] });
  });
});

/**
 * #1614 (F4, F5, F9). The flight the brief seed opens with ends on the event's first day when the brief
 * names one after today, and the Google daily budget is divided over that same flight; a Google result
 * row links into the Google Ads UI; and the coverage grid is told which Google groups the tab never sends.
 */
describe('ImplementationTabComponent Google flight, result link and coverage groups', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function component(): Record<string, any> {
    return fixture.componentInstance as unknown as Record<string, any>;
  }

  function seed(dates: string | undefined, totalBudget = 1000, selectedPlatforms: string[] = ['google-ads']): void {
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU', slug: 'kubecon-eu', registrationUrl: 'https://events.example.com/kubecon', countryCode: 'US', dates },
      selectedPlatforms,
      totalBudget,
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
  }

  /** Inclusive days between two ISO dates, counted on UTC day numbers as the shared helper counts them. */
  function days(start: string, end: string): number {
    return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  /** An ISO day `n` days after the tab's today, and the same day as the brief's free text writes it. */
  function daysOut(n: number): { iso: string; text: string } {
    const iso = new Date(Date.parse(`${component()['todayDate']}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const date = new Date(`${iso}T00:00:00Z`);
    const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    return { iso, text: `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}` };
  }

  it("ends the flight on the event's first day and divides the total over it", () => {
    const event = daysOut(60);
    seed(event.text);

    const form = component()['campaignForm'].getRawValue();
    expect(form.endDate).toBe(event.iso);
    expect(form.budgetUsd).toBe(Math.floor(100000 / days(component()['todayDate'], event.iso)) / 100);
  });

  it('brings the end forward rather than seed a daily budget under the minimum (PR #5387 review)', () => {
    // 1000 over the run-up to 2099 is cents a day; 1000 days at 1 a day is what the total funds.
    seed('March 15-17, 2099');

    const form = component()['campaignForm'].getRawValue();
    expect(form.budgetUsd).toBe(1);
    expect(form.endDate).toBe(daysOut(999).iso);
    expect(component()['campaignForm'].controls.budgetUsd.valid).toBe(true);
  });

  // PR #5389 review: the end date is one control every platform's create reads, so the Google floor may
  // move it only when Google is the brief's only platform.
  it.each([
    ['a Meta-only brief', ['meta-ads']],
    ['a Google and Meta brief', ['google-ads', 'meta-ads']],
  ])('keeps the event end date for %s, seeding the Google floor instead of shortening', STATE_ONLY, (_label, platforms) => {
    seed('March 15-17, 2099', 1000, platforms);

    const form = component()['campaignForm'].getRawValue();
    expect(form.endDate).toBe('2099-03-15');
    expect(form.budgetUsd).toBe(1);
    expect(component()['googleBudgetOverPlan']()).toBe(true);
  });

  it('says the flight spends more than the brief plans beside the Google budget', () => {
    seed('March 15-17, 2099', 1000, ['google-ads', 'meta-ads']);
    fixture.detectChanges();

    const warning = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-budget-over-plan"]');
    expect(warning?.textContent).toContain('spends more than the brief plans');
  });

  it('does not warn when the flight stays within the plan', () => {
    seed('Self-paced');
    fixture.detectChanges();

    expect(component()['googleBudgetOverPlan']()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-budget-over-plan"]')).toBeNull();
  });

  it('keeps the 30-day default, and its budget, when the brief names no date it can read', STATE_ONLY, () => {
    seed('Self-paced');

    const form = component()['campaignForm'].getRawValue();
    expect(form.endDate).toBe(component()['defaultEndDate']);
    expect(form.budgetUsd).toBe(Math.floor(100000 / days(component()['todayDate'], component()['defaultEndDate'])) / 100);
  });

  it('keeps the default for an event already past', STATE_ONLY, () => {
    seed('March 15, 2020');

    expect(component()['campaignForm'].getRawValue().endDate).toBe(component()['defaultEndDate']);
  });

  it('links a Google result row, created or orphaned, into the Google Ads UI, and no other row', STATE_ONLY, () => {
    component()['platformResults'].set([
      { platform: 'google-ads', ok: true, campaignId: '24447438160' },
      { platform: 'google-ads', ok: false, campaignId: '24447438161', error: 'recording failed' },
      { platform: 'google-ads', ok: false, error: 'campaign creation failed' },
      { platform: 'reddit-ads', ok: true, campaignId: 't2_abc' },
    ]);

    const outcomes = component()['platformOutcomes']();
    expect(outcomes.map((row: { platformUrl: string }) => row.platformUrl)).toEqual([
      'https://ads.google.com/aw/campaigns?campaignId=24447438160',
      'https://ads.google.com/aw/campaigns?campaignId=24447438161',
      '',
      '',
    ]);
  });

  it('renders the link on the results step', () => {
    component()['platformResults'].set([{ platform: 'google-ads', ok: true, campaignId: '24447438160' }]);
    component()['step'].set('results');
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-platform-result-link"]') as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toBe('https://ads.google.com/aw/campaigns?campaignId=24447438160');
    expect(link?.textContent).toContain('Open in Google Ads');
  });

  it('tells the coverage grid the tab sends no Video images, and every creative channel it does, Search included (#5262)', STATE_ONLY, () => {
    expect(component()['googleSlotGroupsNotSent']).toEqual(['google-ads/VIDEO']);
  });
});
