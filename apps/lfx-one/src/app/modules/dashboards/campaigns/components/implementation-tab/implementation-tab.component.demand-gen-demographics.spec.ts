// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CampaignImplementationDraft, GoogleAdsAudiencesResult, ProjectContext } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import {
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
 * Demand Gen demographics (linuxfoundation/lfx-v2-campaign-service#498, #518): the single ad group's and
 * each named group's, built upstream into an Audience of their own. Pins what the create sends, that the
 * tab never offers an Audience and demographics together, that Create waits on the shared refusal, and
 * that retained demographics are held rather than dropped.
 */
describe('ImplementationTabComponent demand gen demographics', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const ACCOUNT = '1234567890';
  const AUDIENCE_A = `customers/${ACCOUNT}/audiences/111`;
  const AUDIENCES: GoogleAdsAudiencesResult = {
    accountId: ACCOUNT,
    audiences: [{ resourceName: AUDIENCE_A, id: '111', name: 'Example Summit - High Intent', description: null }],
    truncated: false,
  };
  const IMAGE_COMPLETE = {
    headlines: 'One headline',
    descriptions: 'A description',
    businessName: 'Acme',
    logoImages: 'https://example.com/logo.png',
    marketingImages: 'https://example.com/a.png',
  };
  const VIDEO_COMPLETE = {
    youtubeVideoIds: 'dQw4w9WgXcQ',
    headlines: 'Join us in Salt Lake City',
    longHeadlines: 'Four days of cloud native talks and labs',
    descriptions: 'Register today',
    businessName: 'Acme',
    callToAction: 'SIGN_UP',
    logoImages: 'https://example.com/logo.png',
  };
  /** The live KubeCon NA Demand Gen Audience's ages: 18-24, 55-64 and 65+ left out, Unknown kept. */
  const LIVE_AGES = { ageRanges: ['25-34', '35-44', '45-54', 'UNDETERMINED'] };

  beforeEach(async () => {
    await configureGoogleTab();
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: 'uid-tlf', slug: 'tlf', name: 'tlf' } as ProjectContext, false);
    vi.spyOn(TestBed.inject(CampaignService), 'getGoogleAdsAudiences').mockReturnValue(of(AUDIENCES) as never);
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function seedDemandGen(): Record<string, any> {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.componentRef.setInput('googleDemandGenAudienceEnabled', true);
    fixture.detectChanges();
    return c;
  }

  function split(c: Record<string, any>, names: string[]): void {
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
    c['onDemandGenAdGroupsSplitChange']();
    for (let i = 1; i < names.length; i++) c['addDemandGenAdGroup']();
    names.forEach((name, i) => {
      const controls = c['campaignForm'].controls.demandGenAdGroups.at(i).controls;
      controls.name.setValue(name);
      controls.creative.patchValue(IMAGE_COMPLETE);
    });
    fixture.detectChanges();
  }

  async function requestOf(c: Record<string, any>): Promise<Record<string, unknown>> {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    createCampaign.mockClear();
    fixture.detectChanges();
    expect(c['canSubmit']()).toBe(true);
    c['submit']();
    await fixture.whenStable();
    return createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
  }

  function tick(testId: string): void {
    (query(testId)?.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
  }

  it("sends the live campaign's ages for the single ad group, ticked through the boxes, with income and parental status left open", async () => {
    const c = seedDemandGen();
    expect(c['googleDemandGenDemographicsPayload']()).toEqual({});

    for (const age of ['25-34', '35-44', '45-54', 'UNDETERMINED']) tick(`implementation-demand-gen-demographics-single-ageRanges-${age}`);

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({ ageRanges: ['25-34', '35-44', '45-54', 'UNDETERMINED'] });
    const request = await requestOf(c);
    expect(request['demandGenDemographics']).toEqual(LIVE_AGES);
    expect(request['demandGenDemographics']).not.toBe(c['campaignForm'].controls.demandGenDemographics.value);
  });

  it('sends them beside a video ad as beside an image ad', STATE_ONLY, async () => {
    const c = seedDemandGen();
    c['campaignForm'].controls.demandGenAdFormat.setValue('video');
    c['campaignForm'].controls.demandGenVideoCreative.patchValue(VIDEO_COMPLETE);
    c['onDemandGenDemographicsChange'](null, { genders: ['FEMALE'] });

    expect((await requestOf(c))['demandGenDemographics']).toEqual({ genders: ['FEMALE'] });
  });

  it('notes a dimension left out because it names every value and Unknown', () => {
    const c = seedDemandGen();
    c['onDemandGenDemographicsChange'](null, { ageRanges: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'UNDETERMINED'], genders: ['MALE'] });
    fixture.detectChanges();

    expect(query('implementation-demand-gen-demographics-left-out-single')?.textContent).toContain(
      'Every age value is ticked, Unknown included, so it narrows nothing and Google Ads leaves it out of the Audience.'
    );
    expect(c['demandGenDemographicsError']()).toBeNull();
  });

  it.each([
    [{ genders: ['UNDETERMINED'] }, 'holds only Unknown'],
    [{ genders: ['MALE', 'FEMALE', 'UNDETERMINED'] }, 'restrict nobody'],
  ])('holds Create on %j with the shared refusal under the section', (demographics, message) => {
    const c = seedDemandGen();
    c['onDemandGenDemographicsChange'](null, demographics);
    fixture.detectChanges();

    expect(c['demandGenDemographicsError']()).toContain(message);
    expect(c['canSubmit']()).toBe(false);
    expect(query('implementation-demand-gen-demographics-error')?.textContent).toContain(message);
    expect(query('implementation-demand-gen-demographics-error-live')?.textContent).toContain(message);
  });

  it('holds the Audience picker back while demographics are set, and the demographics back while an Audience is picked', () => {
    const c = seedDemandGen();
    expect(query('implementation-demand-gen-audience-picker-single')).not.toBeNull();

    c['onDemandGenDemographicsChange'](null, { genders: ['FEMALE'] });
    fixture.detectChanges();
    expect(query('implementation-demand-gen-audience-picker-single')).toBeNull();
    expect(query('implementation-demand-gen-audience-held-by-demographics-single')).not.toBeNull();

    c['onDemandGenDemographicsChange'](null, { genders: [] });
    c['onDemandGenAudiencePicked'](null, AUDIENCE_A);
    fixture.detectChanges();
    expect(query('implementation-demand-gen-demographics-targeting-single')).toBeNull();
    expect(query('implementation-demand-gen-demographics-held-by-audience-single')?.textContent).toContain('one Audience per Demand Gen ad group');
  });

  it('keeps restored demographics beside a restored Audience on show, and holds Create until one goes', () => {
    const c = seedDemandGen();
    restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenAudience: AUDIENCE_A, demandGenDemographics: { genders: ['FEMALE', 7] } });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({ genders: ['FEMALE'] });
    expect(query('implementation-demand-gen-demographics-targeting-single')).not.toBeNull();
    expect(c['demandGenDemographicsError']()).toContain('cannot both be set');
    expect(c['canSubmit']()).toBe(false);

    c['removeDemandGenAudience'](null);
    fixture.detectChanges();
    expect(c['demandGenDemographicsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it("sends each named group's own demographics, none for a group with an Audience, and holds the single ad group's while split", async () => {
    const c = seedDemandGen();
    c['onDemandGenDemographicsChange'](null, { genders: ['MALE'] });
    split(c, ['Retargeting', 'Prospecting']);
    c['onDemandGenDemographicsChange'](0, LIVE_AGES);
    c['onDemandGenAudiencePicked'](1, AUDIENCE_A);
    fixture.detectChanges();

    expect(query('implementation-demand-gen-demographics-held')?.textContent).toContain('kept but not sent while the campaign is split');
    expect(query('implementation-demand-gen-demographics-targeting-0')).not.toBeNull();
    expect(query('implementation-demand-gen-demographics-held-by-audience-1')).not.toBeNull();
    const request = await requestOf(c);
    expect(request).not.toHaveProperty('demandGenDemographics');
    expect((request['demandGenAdGroups'] as Record<string, unknown>[]).map((group) => [group['name'], group['demographics'], group['audience']])).toEqual([
      ['Retargeting', LIVE_AGES, undefined],
      ['Prospecting', undefined, AUDIENCE_A],
    ]);
  });

  it("holds Create on a group's refusal, and names a group's demographics among what the split, turned off, keeps", STATE_ONLY, () => {
    const c = seedDemandGen();
    split(c, ['Retargeting']);
    c['onDemandGenDemographicsChange'](0, { parentalStatuses: ['UNDETERMINED'] });
    fixture.detectChanges();
    expect(c['demandGenDemographicsError']()).toContain('the demographics of Demand Gen ad group 1 holds only Unknown');
    expect(c['canSubmit']()).toBe(false);

    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.name.setValue('');
    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.creative.reset();
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(false);
    fixture.detectChanges();
    expect(c['demandGenDemographicsError']()).toBeNull();
    expect(c['demandGenAdGroupsHeldMessage']()).toContain('ad group you entered is kept but not sent');
  });

  it('holds Create naming the deployment while the cutover is dark, listing the held ad group with Clear', () => {
    const c = seedDemandGen();
    restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenDemographics: LIVE_AGES });
    fixture.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'brief-1', message: null, approved: true });
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    expect(c['googleDemandGenDemographicsPayload']()).toEqual({});
    expect(c['demandGenDemographicsBlock']()?.kind).toBe('unsupported');
    expect(query('implementation-demand-gen-demographics-block-unsupported')?.textContent).toContain('not available on this deployment');
    expect(query('implementation-demand-gen-demographics-block-list')?.textContent).toContain('Single ad group');
    expect(query('implementation-demand-gen-demographics-block-live')?.textContent?.trim()).toBe(c['demandGenDemographicsBlockMessage']());
    expect(c['canSubmit']()).toBe(false);

    (query('implementation-demand-gen-demographics-block-clear')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({});
    expect(c['demandGenDemographicsBlock']()).toBeNull();
  });

  it.each([
    ['pending', null, 'pending', 'brief-1'],
    ['unsaved', null, 'ready', null],
    ['failed', null, 'failed', 'brief-1'],
  ])('holds Create with the %s kind while the create path is unanswered', STATE_ONLY, (kind, creative, read, briefId) => {
    const c = seedDemandGen();
    split(c, ['Retargeting']);
    c['onDemandGenDemographicsChange'](0, LIVE_AGES);
    fixture.componentRef.setInput('briefPersistence', { status: briefId ? 'saved' : 'off', briefId, message: null, approved: !!briefId });
    fixture.componentRef.setInput('createCapabilityRead', read);
    fixture.componentRef.setInput('googleCreativeEnabled', creative);
    fixture.detectChanges();

    expect(c['demandGenDemographicsBlock']()?.kind).toBe(kind);
    expect(c['demandGenDemographicsRetained']()).toEqual(['Retargeting']);
    expect(c['canSubmit']()).toBe(false);
  });

  it('holds nothing once Demand Gen is no longer selected', STATE_ONLY, () => {
    const c = seedDemandGen();
    c['onDemandGenDemographicsChange'](null, LIVE_AGES);
    c['campaignForm'].patchValue({ includeDemandGen: false, includeDisplay: true });
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    expect(c['demandGenDemographicsBlock']()).toBeNull();
  });

  it('round-trips the single and per-group demographics through a draft, and empties them for a new brief', STATE_ONLY, () => {
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    const c = seedDemandGen();
    c['onDemandGenDemographicsChange'](null, { incomeRanges: ['INCOME_RANGE_90_UP'], genders: [] });
    split(c, ['Retargeting']);
    c['onDemandGenDemographicsChange'](0, LIVE_AGES);

    expect(emitted?.demandGenDemographics).toEqual({ incomeRanges: ['INCOME_RANGE_90_UP'] });
    expect(emitted?.demandGenAdGroups?.[0].demographics).toEqual(LIVE_AGES);

    c['resetGoogleFields']();
    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({});
    restoreGoogleDraft(fixture, c, {
      demandGenDemographics: { parentalStatuses: ['PARENT'] },
      demandGenAdGroups: [{ name: 'Retargeting', format: 'image', creative: {}, videoCreative: {}, demographics: 'junk' }],
    });

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({ parentalStatuses: ['PARENT'] });
    expect(c['campaignForm'].controls.demandGenAdGroups.at(0).controls.demographics.value).toEqual({});
  });

  /** PR #5390 review: the payload trims the Audience, so a blank one is none and holds nothing back. */
  it('reads a whitespace-only Audience as none, offering the picker and the demographics', () => {
    const c = seedDemandGen();
    restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenAudience: '   ' });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.detectChanges();

    expect(c['googleDemandGenAudiencePayload']()).toEqual({});
    expect(query('implementation-demand-gen-demographics-held-by-audience-single')).toBeNull();
    expect(query('implementation-demand-gen-demographics-targeting-single')).not.toBeNull();
    expect(query('implementation-demand-gen-audience-picked-single')).toBeNull();
    expect(query('implementation-demand-gen-audience-picker-single')).not.toBeNull();
  });

  /** PR #5390 review: a restored value no box offers cannot be unticked, so Clear is the way out of its refusal. */
  it('clears a restored value no box offers, releasing Create, and moves focus to the first box', async () => {
    const focused: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this);
    });
    const c = seedDemandGen();
    expect(query('implementation-demand-gen-demographics-clear-single')).toBeNull();
    restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenDemographics: { genders: ['NOPE'] } });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.detectChanges();
    expect(c['demandGenDemographicsError']()).toContain('cannot target the gender');
    expect(c['canSubmit']()).toBe(false);

    (query('implementation-demand-gen-demographics-clear-single')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({});
    expect(c['demandGenDemographicsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
    expect(query('implementation-demand-gen-demographics-clear-single')).toBeNull();
    expect(focused.at(-1)).toBe(query('implementation-demand-gen-demographics-targeting-single')?.querySelector('input'));
  });

  it("clears one named group's demographics alone, and moves focus to its Audience's Remove when one is picked", async () => {
    const focused: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this);
    });
    const c = seedDemandGen();
    split(c, ['Retargeting', 'Prospecting']);
    c['onDemandGenDemographicsChange'](0, { genders: ['NOPE'] });
    c['onDemandGenDemographicsChange'](1, { genders: ['FEMALE'] });
    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.audience.setValue(AUDIENCE_A);
    fixture.detectChanges();

    (query('implementation-demand-gen-demographics-clear-0')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(c['campaignForm'].controls.demandGenAdGroups.at(0).controls.demographics.value).toEqual({});
    expect(c['campaignForm'].controls.demandGenAdGroups.at(1).controls.demographics.value).toEqual({ genders: ['FEMALE'] });
    expect(query('implementation-demand-gen-demographics-held-by-audience-0')).not.toBeNull();
    expect(focused.at(-1)).toBe(fixture.nativeElement.querySelector('#demand-gen-audience-0-remove'));
  });

  /** PR #5390 review: upstream takes both spellings, but only one has a box, so a restore shows the box's. */
  it("restores each accepted spelling as its box's, single and per group, keeping an unknown value for the refusal", () => {
    const c = seedDemandGen();
    restoreGoogleDraft(fixture, c, {
      includeDemandGen: true,
      demandGenDemographics: { ageRanges: ['AGE_RANGE_25_34', '25-34', 'NOPE'], genders: ['female'] },
      demandGenAdGroups: [
        {
          name: 'Retargeting',
          format: 'image',
          creative: {},
          videoCreative: {},
          demographics: { incomeRanges: ['INCOME_RANGE_UNDETERMINED', 'income_range_90_up'] },
        },
      ],
    });

    expect(c['campaignForm'].controls.demandGenDemographics.value).toEqual({ ageRanges: ['25-34', 'NOPE'], genders: ['FEMALE'] });
    expect(c['campaignForm'].controls.demandGenAdGroups.at(0).controls.demographics.value).toEqual({ incomeRanges: ['UNDETERMINED', 'INCOME_RANGE_90_UP'] });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    fixture.detectChanges();
    expect((query('implementation-demand-gen-demographics-single-ageRanges-25-34')?.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(c['demandGenDemographicsError']()).toContain('NOPE');
  });

  it("restores Display's targeting and the demographic exclusions in their boxes' spellings too", STATE_ONLY, () => {
    const c = seedDemandGen();
    restoreGoogleDraft(fixture, c, {
      googleDisplayDemographics: { ageRanges: ['AGE_RANGE_18_24'], parentalStatuses: ['not_a_parent'] },
      googleExcludedAgeRanges: ['AGE_RANGE_65_UP', '65+'],
      googleExcludedGenders: ['male'],
      googleExcludedIncomeRanges: ['INCOME_RANGE_UNDETERMINED'],
      googleExcludedParentalStatuses: ['parent', 'NOPE'],
    });

    expect(c['googleDisplayDemographics']()).toEqual({ ageRanges: ['18-24'], parentalStatuses: ['NOT_A_PARENT'] });
    expect(c['googleExcludedAgeRanges']()).toEqual(['65+']);
    expect(c['googleExcludedGenders']()).toEqual(['MALE']);
    expect(c['googleExcludedIncomeRanges']()).toEqual(['UNDETERMINED']);
    expect(c['googleExcludedParentalStatuses']()).toEqual(['PARENT', 'NOPE']);
  });

  /** The #5393 fix round's Demand Gen audience gate, for the demographics: `demandGenEnabled` null hides the checkbox. */
  describe.each([['pending'], ['failed']] as const)('with the Demand Gen capability unanswered (read %s)', (read) => {
    function holdDemographics(): Record<string, any> {
      const c = seedDemandGen();
      restoreGoogleDraft(fixture, c, { includeDemandGen: true, demandGenDemographics: LIVE_AGES });
      fixture.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'brief-1', message: null, approved: true });
      fixture.componentRef.setInput('createCapabilityRead', read);
      fixture.componentRef.setInput('googleCreativeEnabled', null);
      fixture.componentRef.setInput('demandGenEnabled', null);
      fixture.detectChanges();
      return c;
    }

    it('keeps the block with its Retry and Clear, and Create held, though selectedGoogleChannels drops Demand Gen', () => {
      const retried = vi.fn();
      fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);
      const c = holdDemographics();

      expect(c['selectedGoogleChannels']()).not.toContain('demand-gen');
      expect(query('implementation-include-demand-gen')).toBeNull();
      expect(c['demandGenDemographicsBlock']()?.kind).toBe(read);
      expect(c['canSubmit']()).toBe(false);
      expect(query('implementation-demand-gen-demographics-block-clear')).not.toBeNull();
      expect(query('implementation-demand-gen-demographics-block-retry') !== null).toBe(read === 'failed');
      if (read === 'failed') {
        (query('implementation-demand-gen-demographics-block-retry')?.querySelector('button') as HTMLButtonElement).click();
        expect(retried).toHaveBeenCalledTimes(1);
      }
    });

    it('falls back to the Search checkbox on Clear, the Demand Gen checkbox being hidden and Create disabled', async () => {
      const focused: HTMLElement[] = [];
      vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
        focused.push(this);
      });
      const c = holdDemographics();

      (query('implementation-demand-gen-demographics-block-clear')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(c['demandGenDemographicsBlock']()).toBeNull();
      expect(focused.at(-1)).toBe(query('implementation-include-search'));
    });

    it('clears the block only once the Demand Gen capability is answered no', () => {
      const c = holdDemographics();
      expect(c['demandGenDemographicsBlock']()?.kind).toBe(read);

      fixture.componentRef.setInput('demandGenEnabled', false);
      fixture.detectChanges();
      expect(c['demandGenDemographicsBlock']()).toBeNull();
    });
  });
});
