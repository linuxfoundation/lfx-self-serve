// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS } from '@lfx-one/shared/constants';
import type {
  CampaignBriefOutput,
  CampaignImplementationDraft,
  GoogleAdsConversionActionsResult,
  GoogleAdsUserListsResult,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import {
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
 * The Search campaign's display paths, second and third ads, and create-time negative keywords (#4991).
 */
describe('ImplementationTabComponent google search ads and negatives', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const query = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const SECOND_AD = { headlines: ['Register today'], descriptions: ['Join the community in Salt Lake City.'], path1: '', path2: '' };

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function seedSearchAds(patch: Record<string, unknown> = { includeSearch: true }): Record<string, any> {
    const c = seedChannel(fixture, patch);
    c['onGoogleSearchPath1Change']('kubecon');
    c['onGoogleSearchPath2Change']('na');
    c['onGoogleAdditionalSearchAdsChange']([SECOND_AD]);
    c['onGoogleNegativeKeywordsTextChange']('free tickets\njobs');
    c['onGoogleNegativeKeywordMatchTypeChange']('Phrase');
    fixture.detectChanges();
    return c;
  }

  it('submits the paths, the second ad and the negatives on Search, copied rather than shared', STATE_ONLY, async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedSearchAds();
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    const request = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(request['headlines']).toEqual(['Join us at KubeCon']);
    expect(request['path1']).toBe('kubecon');
    expect(request['path2']).toBe('na');
    expect(request['additionalSearchAds']).toEqual([SECOND_AD]);
    expect((request['additionalSearchAds'] as unknown[])[0]).not.toBe(c['googleAdditionalSearchAds']()[0]);
    expect(request['negativeKeywords']).toEqual([
      { text: 'free tickets', matchType: 'Phrase' },
      { text: 'jobs', matchType: 'Phrase' },
    ]);
  });

  it('sends none of the keys when nothing was set, so the one ad goes out as before', () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['googleSearchAdsPayload']()).toEqual({});
    expect(query('implementation-google-search-ads-panel')).not.toBeNull();
  });

  it.each([
    ['display', { includeDisplay: true }],
    ['performance-max', { includePerformanceMax: true }],
    ['demand-gen', { includeDemandGen: true }],
  ])('hides the panel and holds every key on %s', (_channel, patch) => {
    const c = seedSearchAds(patch);

    expect(query('implementation-google-search-ads-panel')).toBeNull();
    expect(c['googleSearchAdsPayload']()).toEqual({});
    // Held, not judged: nothing is sent, so nothing blocks Create.
    c['onGoogleSearchPath2Change']('a/b');
    expect(c['googleSearchPathsError']()).toBeNull();
    expect(c['googleAdditionalSearchAds']()).toEqual([SECOND_AD]);
  });

  it('withholds the panel and every key off the campaign-service road', () => {
    const c = seedSearchAds();
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    expect(c['googleSearchAdsPayload']()).toEqual({});
    expect(query('implementation-google-search-ads-panel')).toBeNull();
  });

  it.each([
    [
      'a path with a space',
      (c: Record<string, any>) => c['onGoogleSearchPath1Change']('kube con'),
      'googleSearchPathsError',
      'implementation-google-search-paths-error',
      'cannot hold spaces',
    ],
    [
      'path 2 alone',
      (c: Record<string, any>) => {
        c['onGoogleSearchPath1Change']('');
        c['onGoogleSearchPath2Change']('na');
      },
      'googleSearchPathsError',
      'implementation-google-search-paths-error',
      'without display path 1',
    ],
    [
      'an ad with no headline',
      (c: Record<string, any>) => c['onGoogleAdditionalSearchAdsChange']([{ ...SECOND_AD, headlines: [''] }]),
      'googleAdditionalSearchAdsError',
      'implementation-google-search-ads-error',
      'Add at least one headline to ad 2',
    ],
    [
      'a refused negative line',
      (c: Record<string, any>) => c['onGoogleNegativeKeywordsTextChange']('jobs\nfree!'),
      'googleNegativeKeywordsError',
      'implementation-google-search-negatives-error',
      'line 2',
    ],
    [
      'more than 60 negatives',
      (c: Record<string, any>) => c['onGoogleNegativeKeywordsTextChange'](Array.from({ length: 61 }, (_, i) => `term ${i}`).join('\n')),
      'googleNegativeKeywordsError',
      'implementation-google-search-negatives-error',
      'at most 60',
    ],
  ])('holds Create on %s and shows the shared refusal under its section', (_case, act, signalName, errorId, message) => {
    const c = seedSearchAds();
    act(c);
    fixture.detectChanges();

    expect(c[signalName]()).toContain(message);
    expect(c['canSubmit']()).toBe(false);
    expect(query(errorId)?.textContent).toContain(message);
  });

  it("seeds the negatives from the brief's suggestions, one per line, with Google's default match type", STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
      negativeKeywords: ['free tickets', 'jobs'],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
    // The brief switch restores the draft's channel selection; tick Search again.
    c['campaignForm'].patchValue({ includeSearch: true });
    fixture.detectChanges();

    expect(c['googleNegativeKeywordsText']()).toBe('free tickets\njobs');
    expect(c['googleSearchAdsPayload']()['negativeKeywords']).toEqual([
      { text: 'free tickets', matchType: 'Exact' },
      { text: 'jobs', matchType: 'Exact' },
    ]);
  });

  it('seeds only the suggestions the shared judge accepts, so an untouched create is not held', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
      negativeKeywords: ['free!', 'x'.repeat(81), 'Jobs', 'jobs', ...Array.from({ length: 61 }, (_, i) => `term ${i}`)],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
    c['campaignForm'].patchValue({ includeSearch: true });
    fixture.detectChanges();

    const lines = (c['googleNegativeKeywordsText']() as string).split('\n');
    expect(lines).toHaveLength(60);
    expect(lines).not.toContain('free!');
    expect(lines).not.toContain('jobs');
    expect(c['googleNegativeKeywordsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it("holds Create on a first-ad headline wider than Google's 30, counting CJK double, and says so under Headlines", () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].patchValue({ headlines: ['日'.repeat(16)] });
    fixture.detectChanges();

    expect(c['googleFirstAdHeadlinesError']()).toContain('A headline on ad 1');
    expect(c['googleAdditionalSearchAdsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(false);
    expect(query('implementation-headlines-width-error')?.textContent).toContain('A headline on ad 1');
    expect(query('implementation-google-search-ads-error')).toBeNull();
    expect(query('implementation-headline-0')?.getAttribute('aria-describedby')).toBe('implementation-headlines-width-error');
    expect(query('implementation-first-ad-copy-live')?.textContent).toContain('A headline on ad 1');
  });

  it('says a first-ad description over the width under Descriptions, and judges no row past the cap', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].patchValue({ descriptions: ['ｄ'.repeat(46)] });
    fixture.detectChanges();

    expect(c['googleFirstAdDescriptionsError']()).toContain('A description on ad 1');
    expect(query('implementation-descriptions-width-error')?.textContent).toContain('A description on ad 1');
    expect(query('implementation-description-0')?.getAttribute('aria-describedby')).toBe('implementation-descriptions-width-error');

    c['campaignForm'].patchValue({ descriptions: ['Register today for KubeCon EU 2026.'] });
    fixture.detectChanges();
    expect(c['googleFirstAdDescriptionsError']()).toBeNull();
    expect(query('implementation-description-0')?.getAttribute('aria-describedby')).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('says the Search settings are held, not sent, after a switch to a channel that takes none', () => {
    const c = seedSearchAds();
    c['onGoogleSearchPartnersChange'](true);
    fixture.detectChanges();
    expect(query('implementation-google-search-ads-withheld')).toBeNull();

    c['campaignForm'].patchValue({ includeSearch: false, includeDisplay: true });
    fixture.detectChanges();

    const held = 'Display campaigns do not take Search settings, so Search partners, the display path, 1 more ad and 2 negative keywords will not be sent.';
    expect(query('implementation-google-search-ads-withheld')?.textContent).toContain(held);
    expect(query('implementation-google-search-ads-withheld-live')?.textContent).toContain(held);
  });

  it('sends searchPartners only when ticked, and round-trips and resets it', STATE_ONLY, () => {
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    const c = seedChannel(fixture, { includeSearch: true });
    expect(c['googleSearchAdsPayload']()).not.toHaveProperty('searchPartners');

    c['onGoogleSearchPartnersChange'](true);
    expect(c['googleSearchAdsPayload']()['searchPartners']).toBe(true);
    expect(emitted?.googleSearchPartners).toBe(true);

    c['campaignForm'].patchValue({ includeSearch: false, includeDisplay: true });
    fixture.detectChanges();
    expect(c['googleSearchAdsPayload']()).toEqual({});

    c['resetGoogleFields']();
    expect(c['googleSearchPartners']()).toBe(false);
    restoreGoogleDraft(fixture, c, { googleSearchPartners: true });
    expect(c['googleSearchPartners']()).toBe(true);
  });

  it('round-trips everything through a draft and empties it for a new brief', STATE_ONLY, () => {
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    const c = seedSearchAds();

    expect(emitted?.googleSearchPath1).toBe('kubecon');
    expect(emitted?.googleSearchPath2).toBe('na');
    expect(emitted?.googleAdditionalSearchAds).toEqual([SECOND_AD]);
    expect(emitted?.googleNegativeKeywordsText).toBe('free tickets\njobs');
    expect(emitted?.googleNegativeKeywordMatchType).toBe('Phrase');

    c['resetGoogleFields']();
    expect(c['googleSearchPath1']()).toBe('');
    expect(c['googleAdditionalSearchAds']()).toEqual([]);
    expect(c['googleNegativeKeywordsText']()).toBe('');
    expect(c['googleNegativeKeywordMatchType']()).toBe('Exact');

    restoreGoogleDraft(fixture, c, {
      googleSearchPath1: 'agenda',
      googleSearchPath2: '',
      googleAdditionalSearchAds: [SECOND_AD, SECOND_AD],
      googleNegativeKeywordsText: 'jobs',
      googleNegativeKeywordMatchType: 'Broad',
    });

    expect(c['googleSearchPath1']()).toBe('agenda');
    expect(c['googleAdditionalSearchAds']()).toHaveLength(2);
    expect(c['googleNegativeKeywordsText']()).toBe('jobs');
    expect(c['googleNegativeKeywordMatchType']()).toBe('Broad');
  });
});

/**
 * The conversion-action picker (#4991): a list over the free-text value when the read succeeds, and
 * the free-text box alone, with the reason, whenever it cannot.
 */
describe('ImplementationTabComponent google conversion action picker', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const query = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const ACTIONS: GoogleAdsConversionActionsResult = {
    accountId: '1234567890',
    actions: [
      { id: '111', resourceName: 'customers/1234567890/conversionActions/111', name: 'Event Registrations', category: 'SIGNUP', primaryForGoal: true },
      { id: '222', resourceName: 'customers/1234567890/conversionActions/222', name: 'Lead form', category: 'SUBMIT_LEAD_FORM', primaryForGoal: false },
    ],
  };
  let read: ReturnType<typeof vi.fn>;

  async function setup(answer: () => unknown): Promise<void> {
    await configureGoogleTab();
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
    read = vi.fn(answer);
    vi.spyOn(TestBed.inject(CampaignService), 'getGoogleAdsConversionActions').mockImplementation(read as never);
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('reads nothing while the conversion section is not shown, its live region already mounted and empty', async () => {
    await setup(() => of(ACTIONS));
    const c = seedChannel(fixture, { includePerformanceMax: true });
    fixture.componentRef.setInput('googleConversionActionsEnabled', false);
    fixture.detectChanges();

    expect(read).not.toHaveBeenCalled();
    // Mounted before the section, so the refusal it gains when the section opens is announced.
    expect(query('implementation-google-conversion-action-picker-live')?.textContent?.trim()).toBe('');
    // The first ad's width region is mounted off Search too, empty.
    expect(query('implementation-first-ad-copy-live')?.textContent?.trim()).toBe('');

    c['campaignForm'].patchValue({ includePerformanceMax: false, includeSearch: true, googleBiddingStrategy: 'maximize-conversions' });
    fixture.detectChanges();
    expect(read).not.toHaveBeenCalled();
    expect(query('implementation-google-conversion-action-picker-live')?.textContent).toContain("Your account can't list");
  });

  it('shows the refusal with no request for a caller the BFF would refuse, and waits while that is unanswered', async () => {
    await setup(() => of(ACTIONS));
    seedChannel(fixture, { includeSearch: true, googleBiddingStrategy: 'maximize-conversions' });
    fixture.componentRef.setInput('googleConversionActionsEnabled', null);
    fixture.detectChanges();
    expect(read).not.toHaveBeenCalled();
    expect(query('implementation-google-conversion-action-picker-unavailable')).toBeNull();
    expect(query('implementation-google-conversion-actions')).not.toBeNull();

    fixture.componentRef.setInput('googleConversionActionsEnabled', false);
    fixture.detectChanges();
    expect(read).not.toHaveBeenCalled();
    expect(query('implementation-google-conversion-action-picker-unavailable')?.textContent).toContain("Your account can't list");
    expect(query('implementation-google-conversion-actions')).not.toBeNull();
  });

  it('offers the list on Search and writes picks into the free-text value, so the request is what typing would send', async () => {
    await setup(() => of(ACTIONS));
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedChannel(fixture, { includeSearch: true, googleBiddingStrategy: 'maximize-conversions', googleConversionActions: '999' });
    fixture.componentRef.setInput('googleConversionActionsEnabled', true);
    fixture.detectChanges();

    expect(read).toHaveBeenCalledWith('tlf');
    expect(c['googleConversionActionPicker']().actions[0].label).toBe('Event Registrations · Signup · Primary');
    expect(query('implementation-google-conversion-action-picker')).not.toBeNull();
    expect(query('implementation-google-conversion-actions')).not.toBeNull();
    expect(c['googlePickedConversionActions']()).toEqual([]);

    c['onGooglePickedConversionActionsChange'](['222', '111']);
    fixture.detectChanges();
    expect(c['campaignForm'].getRawValue().googleConversionActions).toBe('111\n222\n999');
    expect(c['googlePickedConversionActions']()).toEqual(['111', '222']);

    c['submit']();
    await fixture.whenStable();
    const request = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(request['conversionActions']).toEqual(['111', '222', '999']);
  });

  it('offers the list on Demand Gen and sends the picks', async () => {
    await setup(() => of(ACTIONS));
    const c = seedChannel(fixture, { includeDemandGen: true, googleBiddingStrategy: 'maximize-conversions' });
    fixture.componentRef.setInput('googleConversionActionsEnabled', true);
    fixture.detectChanges();

    expect(read).toHaveBeenCalledWith('tlf');
    expect(query('implementation-google-conversion-action-picker')).not.toBeNull();
    expect(query('implementation-google-conversion-actions')).not.toBeNull();

    c['onGooglePickedConversionActionsChange'](['111']);
    fixture.detectChanges();
    expect(c['googleBiddingPayload']()).toEqual({ biddingStrategy: 'maximize-conversions', conversionActions: ['111'] });
  });

  it.each([
    ['the gateway denying an allowed caller (403)', 403, "isn't available here yet"],
    ['a route off on this deployment (404)', 404, "isn't available here yet"],
    ['a campaign-service failure (503)', 503, "couldn't be read for this project's Google Ads account"],
  ])('falls back to the free-text box with the reason for %s', async (_label, status, reason) => {
    await setup(() => throwError(() => new HttpErrorResponse({ status })));
    const c = seedChannel(fixture, { includeSearch: true, googleBiddingStrategy: 'maximize-conversions' });
    fixture.componentRef.setInput('googleConversionActionsEnabled', true);
    fixture.detectChanges();

    expect(query('implementation-google-conversion-action-picker')).toBeNull();
    expect(query('implementation-google-conversion-action-picker-unavailable')?.textContent).toContain(reason);
    expect(query('implementation-google-conversion-action-picker-live')?.textContent).toContain(reason);
    expect(query('implementation-google-conversion-actions')).not.toBeNull();
    c['campaignForm'].patchValue({ googleConversionActions: '987654321' });
    expect(c['googleBiddingPayload']()['conversionActions']).toEqual(['987654321']);
  });

  describe('a read in flight', () => {
    let answers: Subject<GoogleAdsConversionActionsResult>[];

    async function setupInFlight(): Promise<Record<string, any>> {
      answers = [];
      await setup(() => {
        const answer = new Subject<GoogleAdsConversionActionsResult>();
        answers.push(answer);
        return answer;
      });
      const c = seedChannel(fixture, { includeSearch: true, googleBiddingStrategy: 'maximize-conversions' });
      fixture.componentRef.setInput('googleConversionActionsEnabled', true);
      fixture.detectChanges();
      return c;
    }

    it('says it is loading, on screen and in the live region', async () => {
      await setupInFlight();

      expect(answers).toHaveLength(1);
      expect(query('implementation-google-conversion-action-picker-loading')?.textContent).toContain("Loading this account's conversion actions");
      expect(query('implementation-google-conversion-action-picker-live')?.textContent).toContain("Loading this account's conversion actions");
    });

    it("drops the previous foundation's answer when the foundation changes mid-flight", STATE_ONLY, async () => {
      const c = await setupInFlight();
      TestBed.inject(ProjectContextService).setFoundation({ uid: 'uid-other', slug: 'other', name: 'other' } as ProjectContext, false);
      fixture.detectChanges();

      expect(read).toHaveBeenLastCalledWith('other');
      expect(answers[0].observed).toBe(false);
      answers[0].next(ACTIONS);
      fixture.detectChanges();
      expect(c['googleConversionActionPicker']().status).toBe('loading');

      answers[1].next({ accountId: '999', actions: [ACTIONS.actions[1]] });
      fixture.detectChanges();
      expect(c['googleConversionActionPicker']().actions.map((a: { id: string }) => a.id)).toEqual(['222']);
    });

    it('cancels the read when the section is hidden mid-flight', STATE_ONLY, async () => {
      const c = await setupInFlight();
      c['campaignForm'].patchValue({ includeSearch: false, includePerformanceMax: true });
      fixture.detectChanges();

      expect(answers[0].observed).toBe(false);
      expect(c['googleConversionActionPicker']().status).toBe('idle');
    });

    it('cancels the read and shows the refusal when the capability turns to no mid-flight', STATE_ONLY, async () => {
      const c = await setupInFlight();
      fixture.componentRef.setInput('googleConversionActionsEnabled', false);
      fixture.detectChanges();

      expect(answers[0].observed).toBe(false);
      expect(c['googleConversionActionPicker']().reason).toContain("Your account can't list");
    });

    it('cancels the read when the tab is destroyed mid-flight', STATE_ONLY, async () => {
      await setupInFlight();
      fixture.destroy();

      expect(answers[0].observed).toBe(false);
    });
  });

  it('says the account has no enabled actions when the list is empty', async () => {
    await setup(() => of({ accountId: '1234567890', actions: [] }));
    seedChannel(fixture, { includeSearch: true, googleBiddingStrategy: 'maximize-conversions' });
    fixture.componentRef.setInput('googleConversionActionsEnabled', true);
    fixture.detectChanges();

    expect(query('implementation-google-conversion-action-picker-empty')?.textContent).toContain('no enabled conversion actions');
    expect(query('implementation-google-conversion-action-picker-live')?.textContent).toContain('no enabled conversion actions');
  });

  it('says ids entered for Search are held, not sent, after a switch to a channel that takes none', async () => {
    await setup(() => of(ACTIONS));
    const c = seedChannel(fixture, { includeSearch: true, googleBiddingStrategy: 'maximize-conversions', googleConversionActions: '111\n\n 999 ' });
    fixture.componentRef.setInput('googleConversionActionsEnabled', true);
    fixture.detectChanges();
    expect(query('implementation-google-conversion-actions-withheld')).toBeNull();

    c['campaignForm'].patchValue({ includeSearch: false, includePerformanceMax: true });
    fixture.detectChanges();

    const held =
      "LFX One creates Performance Max campaigns on the Google Ads account's own conversion goals, so the 2 conversion actions you entered will not be sent.";
    expect(query('implementation-google-conversion-actions-withheld')?.textContent).toContain(held);
    expect(query('implementation-google-conversion-actions-withheld-live')?.textContent).toContain(held);
    expect(c['googleBiddingPayload']()).not.toHaveProperty('conversionActions');
  });
});

/**
 * The audience segment picker (#5244): a searchable list of the account's user lists inside Google
 * Audience Segments, which adds a picked list's resource name exactly as typing it would, and the
 * typed box alone, with the reason, whenever the list cannot be read.
 */
describe('ImplementationTabComponent google user list picker', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const query = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const LIST_A = 'customers/8666746580/userLists/111';
  const LIST_B = 'customers/8666746580/userLists/222';
  const LISTS: GoogleAdsUserListsResult = {
    accountId: '8666746580',
    userLists: [
      { resourceName: LIST_A, id: '111', name: 'KubeCon NA 2025 registrants', type: 'CRM_BASED', eligibleForSearch: true },
      { resourceName: LIST_B, id: '222', name: 'KubeCon site visitors', type: 'RULE_BASED', eligibleForSearch: false },
    ],
    truncated: false,
  };
  let read: ReturnType<typeof vi.fn>;

  async function setup(answer: () => unknown): Promise<void> {
    await configureGoogleTab();
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
    read = vi.fn(answer);
    vi.spyOn(TestBed.inject(CampaignService), 'getGoogleAdsUserLists').mockImplementation(read as never);
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** Search, with the per-caller audience segment capability. */
  function seedSearch(enabled: boolean | null = true): Record<string, any> {
    const c = seedChannel(fixture, { includeSearch: true });
    fixture.componentRef.setInput('googleAudienceSegmentsEnabled', enabled);
    fixture.detectChanges();
    return c;
  }

  it('reads nothing while the section is not shown, its live region already mounted and empty', async () => {
    await setup(() => of(LISTS));
    seedSearch(false);
    expect(read).not.toHaveBeenCalled();
    expect(query('implementation-google-user-list-picker-live')?.textContent?.trim()).toBe('');

    seedSearch(null);
    expect(read).not.toHaveBeenCalled();
  });

  it('offers the account lists by label and adds a pick exactly as typing would, then clears the field', async () => {
    await setup(() => of(LISTS));
    const c = seedSearch();

    expect(read).toHaveBeenCalledWith('tlf');
    expect(query('implementation-google-user-list-picker')).not.toBeNull();
    expect(c['googleUserListPickerOptions']().map((l: { label: string }) => l.label)).toEqual([
      'KubeCon NA 2025 registrants · Customer list',
      'KubeCon site visitors · Website visitors · not eligible for Search',
    ]);

    c['onGoogleUserListPicked'](LIST_B);
    fixture.detectChanges();
    expect(c['googleAudienceSegments']()).toEqual([LIST_B]);
    // A picked list is not offered again, and the typed box stays for one the picker does not show.
    expect(c['googleUserListPickerOptions']().map((l: { resourceName: string }) => l.resourceName)).toEqual([LIST_A]);
    expect(query('implementation-google-audience-segment-add')).not.toBeNull();
  });

  it('clears the combobox itself after a pick, so a list removed and picked again is added again', async () => {
    await setup(() => of(LISTS));
    const c = seedSearch();
    const combobox = (): UiComboboxComponent =>
      fixture.debugElement.query(By.css('[data-testid="implementation-google-user-list-picker"]')).componentInstance as UiComboboxComponent;
    // Picks through the combobox's own select path, which sets its model before emitting.
    const pick = (resourceName: string): void => {
      (combobox() as unknown as { select(option: { value: string; label: string }): void }).select({ value: resourceName, label: resourceName });
      fixture.detectChanges();
    };

    pick(LIST_B);
    expect(c['googleAudienceSegments']()).toEqual([LIST_B]);
    expect(combobox().value()).toBeNull();

    c['removeGoogleAudienceSegment'](0);
    fixture.detectChanges();
    pick(LIST_B);
    expect(c['googleAudienceSegments']()).toEqual([LIST_B]);
  });

  describe('focus when a pick hides the picker', () => {
    let focused: HTMLElement[];

    beforeEach(() => {
      focused = [];
      vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
        focused.push(this);
      });
    });

    const pickAndRender = async (c: Record<string, unknown>, resourceName: string): Promise<void> => {
      (c['onGoogleUserListPicked'] as (value: string) => void).call(c, resourceName);
      fixture.detectChanges();
      await fixture.whenStable();
    };

    it('moves focus to the typed box when the pick takes the last list on offer', async () => {
      await setup(() => of(LISTS));
      const c = seedSearch();

      await pickAndRender(c, LIST_A);
      expect(focused).toEqual([]);

      await pickAndRender(c, LIST_B);
      expect(query('implementation-google-user-list-picker')).toBeNull();
      expect(focused).toEqual([query('implementation-google-audience-segment-add')]);
    });

    it("moves focus to the newest chip's Remove button when the pick reaches the cap", async () => {
      await setup(() => of(LISTS));
      const c = seedSearch();
      c['googleAudienceSegments'].set(Array.from({ length: GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS - 1 }, (_, i) => `customers/1/userLists/${i + 1}`));
      fixture.detectChanges();

      await pickAndRender(c, LIST_A);
      expect(query('implementation-google-audience-segment-add')).toBeNull();
      expect(focused).toEqual([query(`implementation-google-audience-segment-remove-${GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS - 1}`)]);
    });
  });

  it('sends the same campaignAudienceSegments for a picked list as for the same list typed, and no audienceSegments', STATE_ONLY, async () => {
    await setup(() => of(LISTS));
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedSearch();

    c['onGoogleUserListPicked'](LIST_A);
    c['addGoogleAudienceSegment'](LIST_B);
    fixture.detectChanges();
    c['submit']();
    await fixture.whenStable();

    const request = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(request['campaignAudienceSegments']).toEqual([LIST_A, LIST_B]);
    expect(request).not.toHaveProperty('audienceSegments');
  });

  it('adds nothing for a cleared field', STATE_ONLY, async () => {
    await setup(() => of(LISTS));
    const c = seedSearch();

    c['onGoogleUserListPicked'](null);
    expect(c['googleAudienceSegments']()).toEqual([]);
  });

  /** #5493: a chip shows the list's name, as the Display pickers do, and its Remove button says which list it removes. */
  it("shows a picked list's chip by its name, and a list the read does not hold by its resource name", async () => {
    await setup(() => of(LISTS));
    const c = seedSearch();
    const OTHER = 'customers/8666746580/userLists/333';

    c['onGoogleUserListPicked'](LIST_A);
    c['addGoogleAudienceSegment'](OTHER);
    fixture.detectChanges();

    expect(query('implementation-google-audience-segment-0')?.textContent?.trim()).toBe('KubeCon NA 2025 registrants');
    expect(query('implementation-google-audience-segment-remove-0')?.getAttribute('aria-label')).toBe('Remove KubeCon NA 2025 registrants');
    expect(query('implementation-google-audience-segment-1')?.textContent?.trim()).toBe(OTHER);
    expect(query('implementation-google-audience-segment-remove-1')?.getAttribute('aria-label')).toBe(`Remove ${OTHER}`);
  });

  it('carries the name a list was added under in the draft, from the add itself', STATE_ONLY, async () => {
    await setup(() => of(LISTS));
    const c = seedSearch();
    let draft: Record<string, any> = {};
    fixture.componentInstance.draftChange.subscribe((d) => (draft = d as Record<string, any>));

    c['onGoogleUserListPicked'](LIST_B);
    expect(draft['googleAudienceSegments']).toEqual([LIST_B]);
    expect(draft['googleAudienceSegmentNames']).toEqual({ [LIST_B]: 'KubeCon site visitors' });

    // A typed list the read holds is named too: the name comes from the list, not from the picker's event.
    c['removeGoogleAudienceSegment'](0);
    c['addGoogleAudienceSegment'](LIST_A);
    expect(draft['googleAudienceSegmentNames']).toEqual({ [LIST_B]: 'KubeCon site visitors', [LIST_A]: 'KubeCon NA 2025 registrants' });
  });

  it('restores a segment by the name in the draft when the user list read is unavailable, keeping strings only', async () => {
    await setup(() => throwError(() => new HttpErrorResponse({ status: 503 })));
    const c = seedSearch();
    restoreGoogleDraft(fixture, c, {
      includeSearch: true,
      googleAudienceSegments: [LIST_A, LIST_B],
      googleAudienceSegmentNames: { [LIST_A]: 'KubeCon NA 2025 registrants', [LIST_B]: 7 },
    });

    expect([...c['googleAudienceSegmentAddedNames']().entries()]).toEqual([[LIST_A, 'KubeCon NA 2025 registrants']]);
    expect(query('implementation-google-audience-segment-0')?.textContent?.trim()).toBe('KubeCon NA 2025 registrants');
    expect(query('implementation-google-audience-segment-1')?.textContent?.trim()).toBe(LIST_B);
  });

  it("restores a segment by the read's name when the draft carries no name for it", async () => {
    await setup(() => of(LISTS));
    const c = seedSearch();
    restoreGoogleDraft(fixture, c, { includeSearch: true, googleAudienceSegments: [LIST_B] });

    expect(c['googleAudienceSegmentAddedNames']().size).toBe(0);
    expect(query('implementation-google-audience-segment-0')?.textContent?.trim()).toBe('KubeCon site visitors');
  });

  it('forgets the added names when the form resets for a new brief', STATE_ONLY, async () => {
    await setup(() => of(LISTS));
    const c = seedSearch();
    c['onGoogleUserListPicked'](LIST_A);
    expect(c['googleAudienceSegmentAddedNames']().size).toBe(1);

    // A new brief object re-runs the seed, which resets the Google fields first.
    seedSearch();
    expect(c['googleAudienceSegmentAddedNames']().size).toBe(0);
  });

  it('hides the picker at the cap, as it hides the typed box', async () => {
    await setup(() => of(LISTS));
    const c = seedSearch();
    c['googleAudienceSegments'].set(Array.from({ length: GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS }, (_, i) => `customers/1/userLists/${i + 1}`));
    fixture.detectChanges();

    expect(query('implementation-google-user-list-picker')).toBeNull();
  });

  it('says so when the account has no lists, and when it has more than were returned', async () => {
    await setup(() => of({ ...LISTS, userLists: [] }));
    seedSearch();
    expect(query('implementation-google-user-list-picker')).toBeNull();
    expect(query('implementation-google-user-list-picker-empty')?.textContent).toContain('no user lists to pick from');
    expect(query('implementation-google-user-list-picker-live')?.textContent).toContain('no user lists to pick from');

    fixture.destroy();
    TestBed.resetTestingModule();
    await setup(() => of({ ...LISTS, truncated: true }));
    seedSearch();
    expect(query('implementation-google-user-list-picker-truncated')?.textContent).toContain('more user lists than the picker shows');
    expect(query('implementation-google-user-list-picker-live')?.textContent).toContain('more user lists than the picker shows');
  });

  it.each([
    [403, "isn't available here"],
    [404, "isn't available here"],
    [503, "couldn't be read"],
    [0, "couldn't be read"],
  ])('falls back to the typed box with a reason when the read answers %s', async (status, reason) => {
    await setup(() => throwError(() => new HttpErrorResponse({ status })));
    seedSearch();

    expect(query('implementation-google-user-list-picker')).toBeNull();
    expect(query('implementation-google-user-list-picker-unavailable')?.textContent).toContain(reason);
    expect(query('implementation-google-user-list-picker-live')?.textContent).toContain(reason);
    expect(query('implementation-google-audience-segment-add')).not.toBeNull();
  });

  it('shows the loading line while the read is in flight, and drops it when the section closes', async () => {
    const pending = new Subject<GoogleAdsUserListsResult>();
    await setup(() => pending.asObservable());
    seedSearch();
    expect(query('implementation-google-user-list-picker-loading')).not.toBeNull();
    expect(query('implementation-google-user-list-picker-live')?.textContent).toContain('Loading');

    fixture.componentRef.setInput('googleAudienceSegmentsEnabled', false);
    fixture.detectChanges();
    expect(pending.observed).toBe(false);
    expect(query('implementation-google-user-list-picker-live')?.textContent?.trim()).toBe('');
  });
});
