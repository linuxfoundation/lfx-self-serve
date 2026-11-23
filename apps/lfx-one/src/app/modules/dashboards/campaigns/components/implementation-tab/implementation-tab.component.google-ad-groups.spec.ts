// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  GOOGLE_DEMAND_GEN_AD_GROUPS_EMPTY,
  GOOGLE_DEMAND_GEN_MAX_AD_GROUPS,
  GOOGLE_DEMAND_GEN_MAX_ADS_PER_GROUP,
  GOOGLE_DISPLAY_AD_GROUPS_EMPTY,
  GOOGLE_DISPLAY_MAX_AD_GROUPS,
} from '@lfx-one/shared/constants';
import type { CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
 * Demand Gen's video ad (#5226): a second creative for the same channel, picked by an ad-format
 * choice. Only the chosen format renders and is sent; the other keeps what was typed and says so.
 */
describe('ImplementationTabComponent demand gen video ad', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  /** A video ad campaign-service accepts, as the form holds it: one entry per line. */
  const VIDEO_COMPLETE = {
    youtubeVideoIds: 'dQw4w9WgXcQ',
    headlines: 'Join us in Salt Lake City',
    longHeadlines: 'Four days of cloud native talks and labs',
    descriptions: 'Register today',
    businessName: 'Acme',
    callToAction: 'SIGN_UP',
    logoImages: 'https://example.com/logo.png',
  };

  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders the image ad by default, and the video ad in its place once Video is chosen', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    expect(c['googleCreativeSections']().map((s: { groupName: string }) => s.groupName)).toEqual(['demandGenCreative']);
    expect(find('implementation-creative-demand-gen-format')).not.toBeNull();

    c['campaignForm'].controls.demandGenAdFormat.setValue('video');
    fixture.detectChanges();

    const sections = c['googleCreativeSections']();
    expect(sections.map((s: { groupName: string; format: string }) => [s.groupName, s.format])).toEqual([['demandGenVideoCreative', 'video']]);
    expect(c['campaignForm'].controls.demandGenVideoCreative.enabled).toBe(true);
    expect(c['campaignForm'].controls.demandGenCreative.enabled).toBe(false);
    expect(find('implementation-creative-demand-gen-youtubeVideoIds')).not.toBeNull();
    expect(find('implementation-creative-demand-gen-marketingImages')).toBeNull();
    // The call to action is a closed list, so an lfx-select with "None" first, bound to the video group.
    const cta = fixture.debugElement.query(By.css('[data-testid="implementation-creative-demand-gen-callToAction"]'));
    expect(cta?.name).toBe('lfx-select');
    const select = cta.componentInstance as { options: () => { value: string; label: string }[]; control: () => string; form: () => unknown };
    expect(select.options()[0]).toEqual({ value: '', label: 'None' });
    expect(
      select
        .options()
        .slice(1)
        .map((o) => o.value)
    ).toEqual(['SIGN_UP', 'LEARN_MORE', 'BOOK_NOW', 'VISIT_SITE', 'WATCH_NOW', 'APPLY_NOW', 'CONTACT_US', 'DOWNLOAD', 'GET_QUOTE', 'SUBSCRIBE', 'SHOP_NOW']);
    expect(select.control()).toBe('callToAction');
    expect(select.form()).toBe(c['campaignForm'].controls.demandGenVideoCreative);
  });

  it('keeps the format choice mounted, and its focus, when the format changes', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    fixture.detectChanges();
    const before = find('implementation-creative-demand-gen-format-video');
    const input = before?.querySelector('input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    input?.focus();
    expect(document.activeElement).toBe(input);

    c['campaignForm'].controls.demandGenAdFormat.setValue('video');
    fixture.detectChanges();

    // The same element, not a rebuilt one, so keyboard focus and arrow-key movement survive.
    expect(find('implementation-creative-demand-gen-format-video')).toBe(before);
    expect(document.activeElement).toBe(input);
    // The fields below did re-mount on the new group.
    expect(find('implementation-creative-demand-gen-youtubeVideoIds')).not.toBeNull();
  });

  it('offers the two ad formats as lfx-radio-buttons on the demandGenAdFormat control', () => {
    seedChannel(fixture, { includeDemandGen: true });
    fixture.detectChanges();
    for (const [format, testId] of [
      ['image', 'implementation-creative-demand-gen-format-image'],
      ['video', 'implementation-creative-demand-gen-format-video'],
    ] as const) {
      const radio = fixture.debugElement.query(By.css(`[data-testid="${testId}"]`));
      expect(radio?.name).toBe('lfx-radio-button');
      const instance = radio.componentInstance as { control: () => string; value: () => string; name: () => string };
      expect([instance.control(), instance.name(), instance.value()]).toEqual(['demandGenAdFormat', 'demandGenAdFormat', format]);
    }
  });

  it('sends only the video ad, keeps the image ad typed, and says it is not sent', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenCreative.patchValue({ headlines: 'An image headline' });
    c['campaignForm'].controls.demandGenAdFormat.setValue('video');
    c['campaignForm'].controls.demandGenVideoCreative.patchValue(VIDEO_COMPLETE);
    fixture.detectChanges();

    expect(c['googleCreativePayload']()).toEqual({
      demandGenVideoCreative: {
        youtubeVideoIds: ['dQw4w9WgXcQ'],
        headlines: ['Join us in Salt Lake City'],
        longHeadlines: ['Four days of cloud native talks and labs'],
        descriptions: ['Register today'],
        businessName: 'Acme',
        callToAction: 'SIGN_UP',
        logoImages: ['https://example.com/logo.png'],
      },
    });
    expect(c['googleCreativeError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
    expect(c['campaignForm'].controls.demandGenCreative.controls.headlines.value).toBe('An image headline');
    expect(c['demandGenFormatHeldMessage']()).toContain('The image ad is kept but not sent');
    expect(find('implementation-demand-gen-format-held')?.textContent).toContain('kept but not sent');
    expect(find('implementation-demand-gen-format-held-live')?.textContent).toContain('kept but not sent');
    expect(find('implementation-creative-demand-gen-format')?.getAttribute('aria-describedby')).toBe('implementation-demand-gen-format-held');
  });

  it('holds Create on the shared judge the BFF refuses on, and releases it once the ad is valid', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenAdFormat.setValue('video');
    c['campaignForm'].controls.demandGenVideoCreative.patchValue({ ...VIDEO_COMPLETE, youtubeVideoIds: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });

    expect(c['googleCreativeError']()).toContain('is a link, not a video ID');
    expect(c['canSubmit']()).toBe(false);

    c['campaignForm'].controls.demandGenVideoCreative.patchValue({ youtubeVideoIds: 'dQw4w9WgXcQ', headlines: 'h'.repeat(41) });
    expect(c['googleCreativeError']()).toContain('longer than the 40 characters');

    c['campaignForm'].controls.demandGenVideoCreative.patchValue({ headlines: 'h'.repeat(40) });
    expect(c['googleCreativeError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('blocks nothing for a wholly empty video ad, the shell campaign-service accepts', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenAdFormat.setValue('video');

    expect(c['googleCreativePayload']()).toEqual({});
    expect(c['googleCreativeError']()).toBeNull();
    expect(c['demandGenFormatHeldMessage']()).toBe('');
  });

  it('carries the format and both creatives through the draft, and restores the format', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    let captured: CampaignImplementationDraft | null = null;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    c['campaignForm'].controls.demandGenAdFormat.setValue('video');
    c['campaignForm'].controls.demandGenVideoCreative.patchValue({ youtubeVideoIds: 'dQw4w9WgXcQ' });
    c['emitDraft']();

    const draft = captured as unknown as CampaignImplementationDraft;
    expect(draft.demandGenAdFormat).toBe('video');
    expect(draft.googleCreatives?.['demandGenVideoCreative']?.['youtubeVideoIds']).toBe('dQw4w9WgXcQ');

    c['campaignForm'].controls.demandGenAdFormat.setValue('image');
    // Read once on the image format, so the section memo is warm before the restore lands.
    expect(c['googleCreativeSections']().map((s: { groupName: string }) => s.groupName)).toEqual(['demandGenCreative']);
    restoreGoogleDraft(fixture, c, {
      includeDemandGen: true,
      demandGenAdFormat: 'video',
      googleCreatives: { demandGenVideoCreative: { youtubeVideoIds: 'abc123' } },
    });
    expect(c['campaignForm'].controls.demandGenAdFormat.value).toBe('video');
    expect(c['campaignForm'].controls.demandGenVideoCreative.controls.youtubeVideoIds.value).toBe('abc123');
    // The restored format must reach the rendered section straight away, not on the next edit.
    expect(c['googleCreativeSections']().map((s: { groupName: string }) => s.groupName)).toEqual(['demandGenVideoCreative']);
    fixture.detectChanges();
    expect(find('implementation-creative-demand-gen-youtubeVideoIds')).not.toBeNull();
  });

  it('withdraws both Demand Gen formats and the held note when the channel moves away', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenAdFormat.setValue('video');
    c['campaignForm'].controls.demandGenCreative.patchValue({ headlines: 'An image headline' });
    c['campaignForm'].patchValue({ includeDemandGen: false, includeDisplay: true });
    fixture.detectChanges();

    expect(c['googleCreativeSections']().map((s: { groupName: string }) => s.groupName)).toEqual(['displayCreative']);
    expect(c['campaignForm'].controls.demandGenVideoCreative.enabled).toBe(false);
    expect(c['googleCreativePayload']()).not.toHaveProperty('demandGenVideoCreative');
    expect(c['demandGenFormatHeldMessage']()).toBe('');
  });
});

/**
 * Demand Gen split into named ad groups (#5226): each group a name and its own image or video ad, sent
 * as `demandGenAdGroups` in place of the single ad, and held on the rules campaign-service refuses.
 */
describe('ImplementationTabComponent demand gen ad groups', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

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
    logoImages: 'https://example.com/logo.png',
  };

  const find = (f: ComponentFixture<ImplementationTabComponent>, testId: string): HTMLElement | null =>
    f.nativeElement.querySelector(`[data-testid="${testId}"]`);

  /** Turn the split on through its checkbox handler, as a click does, and fill the groups. */
  const split = (c: Record<string, any>, groups: { name: string; format?: 'image' | 'video'; creative?: Record<string, string> }[]): void => {
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
    c['onDemandGenAdGroupsSplitChange']();
    for (let i = 1; i < groups.length; i++) c['addDemandGenAdGroup']();
    groups.forEach((group, i) => {
      const controls = c['campaignForm'].controls.demandGenAdGroups.at(i).controls;
      controls.name.setValue(group.name);
      controls.format.setValue(group.format ?? 'image');
      controls[group.format === 'video' ? 'videoCreative' : 'creative'].patchValue(group.creative ?? IMAGE_COMPLETE);
    });
  };

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('offers the split on Demand Gen alone, and the first group once it is on', () => {
    const display = seedChannel(fixture, { includeDisplay: true });
    fixture.detectChanges();
    expect(find(fixture, 'implementation-demand-gen-ad-groups-split')).toBeNull();
    expect(display['demandGenAdGroupsActive']()).toBe(false);

    const c = seedChannel(fixture, { includeDemandGen: true });
    fixture.detectChanges();
    expect(find(fixture, 'implementation-demand-gen-ad-groups-split')).not.toBeNull();
    expect(find(fixture, 'implementation-demand-gen-ad-groups')).toBeNull();

    split(c, [{ name: 'Retargeting' }]);
    fixture.detectChanges();
    expect(find(fixture, 'implementation-demand-gen-ad-group-0')).not.toBeNull();
    expect(find(fixture, 'implementation-demand-gen-ad-group-name-0')).not.toBeNull();
    expect(find(fixture, 'implementation-demand-gen-ad-group-0-marketingImages')).not.toBeNull();
    // The single ad's format choice and fields give way to the groups, and neither of its creatives
    // is one the request could carry.
    expect(c['googleCreativeGroupsInReach']().has('demandGenCreative')).toBe(false);
    expect(find(fixture, 'implementation-creative-demand-gen-format')).toBeNull();
    expect(find(fixture, 'implementation-creative-demand-gen-headlines')).toBeNull();
  });

  it('adds groups up to five, and removes one', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    split(c, [{ name: 'a' }]);
    for (let i = 0; i < 6; i++) c['addDemandGenAdGroup']();
    fixture.detectChanges();
    expect(c['campaignForm'].controls.demandGenAdGroups.length).toBe(GOOGLE_DEMAND_GEN_MAX_AD_GROUPS);
    expect(find(fixture, 'implementation-demand-gen-ad-group-add')).toBeNull();

    c['removeDemandGenAdGroup'](0);
    fixture.detectChanges();
    expect(c['campaignForm'].controls.demandGenAdGroups.length).toBe(GOOGLE_DEMAND_GEN_MAX_AD_GROUPS - 1);
    expect(find(fixture, 'implementation-demand-gen-ad-group-add')).not.toBeNull();
  });

  it('sends the groups, each with its chosen format, and no campaign-level creative', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenCreative.patchValue(IMAGE_COMPLETE);
    split(c, [
      { name: ' Retargeting ', format: 'video', creative: VIDEO_COMPLETE },
      { name: 'Prospecting', creative: IMAGE_COMPLETE },
    ]);
    // Typed into the second group's other format: kept, not sent.
    c['campaignForm'].controls.demandGenAdGroups.at(1).controls.videoCreative.patchValue({ headlines: 'Not sent' });

    expect(c['googleCreativePayload']()).toEqual({});
    expect(c['googleDemandGenAdGroupsPayload']()).toEqual({
      demandGenAdGroups: [
        {
          name: 'Retargeting',
          videoCreative: {
            youtubeVideoIds: ['dQw4w9WgXcQ'],
            headlines: ['Join us in Salt Lake City'],
            longHeadlines: ['Four days of cloud native talks and labs'],
            descriptions: ['Register today'],
            businessName: 'Acme',
            logoImages: ['https://example.com/logo.png'],
          },
        },
        {
          name: 'Prospecting',
          creative: {
            headlines: ['One headline'],
            descriptions: ['A description'],
            businessName: 'Acme',
            logoImages: ['https://example.com/logo.png'],
            marketingImages: ['https://example.com/a.png'],
          },
        },
      ],
    });
    expect(c['demandGenAdGroupsError']()).toBeNull();
    expect(c['googleCreativeEmptyWarning']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it.each([
    ['a group with no ad', [{ name: 'a', creative: {} }], 'ad group 1 has no ad'],
    ['an image ad below its minimums', [{ name: 'a', creative: { headlines: 'One headline' } }], 'ad group 1: the image ad needs'],
    ['a video ad that fails its rules', [{ name: 'a', format: 'video' as const, creative: { ...VIDEO_COMPLETE, logoImages: '' } }], 'exactly one logo'],
  ])('holds Create on %s, saying why and announcing it', (_label, groups, fragment) => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    split(c, groups);
    fixture.detectChanges();

    expect(c['demandGenAdGroupsError']()).toContain(fragment);
    expect(c['canSubmit']()).toBe(false);
    expect(find(fixture, 'implementation-demand-gen-ad-groups-error')?.textContent).toContain(fragment);
    expect(find(fixture, 'implementation-demand-gen-ad-groups-error-live')?.textContent).toContain(fragment);
  });

  it('keeps what was entered either way, and says what is not sent', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenCreative.patchValue({ headlines: 'A single headline' });
    c['campaignForm'].controls.demandGenVideoCreative.patchValue({ headlines: 'A video headline' });
    split(c, [{ name: 'Retargeting' }]);
    fixture.detectChanges();
    // The format's own note gives way: its choice is not on screen while split.
    expect(c['demandGenFormatHeldMessage']()).toBe('');
    expect(c['demandGenAdGroupsHeldMessage']()).toContain('The single Demand Gen ad is kept but not sent');
    expect(find(fixture, 'implementation-demand-gen-ad-groups-held-live')?.textContent).toContain('kept but not sent');
    expect(find(fixture, 'implementation-demand-gen-ad-groups-split')?.querySelector('input')?.getAttribute('aria-describedby')).toBe(
      'implementation-demand-gen-ad-groups-held'
    );

    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(false);
    fixture.detectChanges();
    expect(c['campaignForm'].controls.demandGenCreative.controls.headlines.value).toBe('A single headline');
    expect(c['campaignForm'].controls.demandGenAdGroups.at(0).controls.name.value).toBe('Retargeting');
    expect(c['demandGenAdGroupsHeldMessage']()).toBe(
      'The ad group you entered is kept but not sent while the campaign is not split. Turn the split on to send it instead.'
    );
    expect(c['googleDemandGenAdGroupsPayload']()).toEqual({});
    expect(c['demandGenAdGroupsError']()).toBeNull();
    expect(find(fixture, 'implementation-demand-gen-ad-groups-held')?.textContent).toContain('kept but not sent');
  });

  it('says nothing is held when the split is turned on and off with nothing entered', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
    c['onDemandGenAdGroupsSplitChange']();
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(false);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.demandGenAdGroups.length).toBe(1);
    expect(c['demandGenAdGroupsHeldMessage']()).toBe('');
    expect(find(fixture, 'implementation-demand-gen-ad-groups-held')).toBeNull();
  });

  it("counts text typed only inside a group's ad as entered", STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
    c['onDemandGenAdGroupsSplitChange']();
    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.videoCreative.patchValue({ headlines: 'A video headline' });
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(false);
    fixture.detectChanges();

    expect(c['demandGenAdGroupsHeldMessage']()).toBe(
      'The ad group you entered is kept but not sent while the campaign is not split. Turn the split on to send it instead.'
    );
  });

  it('holds Create when the split is on with every ad group removed', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    split(c, [{ name: 'Retargeting' }]);
    c['removeDemandGenAdGroup'](0);
    fixture.detectChanges();

    expect(c['googleDemandGenAdGroupsPayload']()).toEqual({ demandGenAdGroups: [] });
    expect(c['demandGenAdGroupsError']()).toBe(GOOGLE_DEMAND_GEN_AD_GROUPS_EMPTY);
    expect(c['canSubmit']()).toBe(false);
  });

  it('adds the first ad group when the split checkbox itself is ticked', () => {
    seedChannel(fixture, { includeDemandGen: true });
    const c = fixture.componentInstance as unknown as Record<string, any>;
    const box = find(fixture, 'implementation-demand-gen-ad-groups-split')?.querySelector('input') as HTMLInputElement;
    box.click();
    fixture.detectChanges();

    expect(c['campaignForm'].controls.demandGenAdGroupsSplit.value).toBe(true);
    expect(c['campaignForm'].controls.demandGenAdGroups.length).toBe(1);
    expect(find(fixture, 'implementation-demand-gen-ad-group-name-0')).not.toBeNull();
  });

  it('does not hold Create on a value left in a group the create does not send', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    split(c, [{ name: 'a', creative: { ...IMAGE_COMPLETE, headlines: 'h'.repeat(31) } }]);
    expect(c['campaignForm'].invalid).toBe(true);

    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(false);
    // The enabling effect runs on the next change detection, as it does on screen.
    fixture.detectChanges();
    expect(c['campaignForm'].invalid).toBe(false);
    expect(c['canSubmit']()).toBe(true);

    // And the other way: the single ad, not sent while split, cannot hold Create either.
    c['campaignForm'].controls.demandGenCreative.patchValue({ headlines: 'h'.repeat(31) });
    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.creative.patchValue(IMAGE_COMPLETE);
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
    fixture.detectChanges();
    expect(c['campaignForm'].invalid).toBe(false);
    expect(c['canSubmit']()).toBe(true);
  });

  /** Off is byte-identical: the request a create makes with groups typed but the split off is the one it made before they existed. */
  it.each([
    ['an image ad', 'demandGenCreative', IMAGE_COMPLETE],
    ['a video ad', 'demandGenVideoCreative', VIDEO_COMPLETE],
    ['no ad', null, {}],
  ] as const)('sends the same request with the split off, carrying %s', STATE_ONLY, async (_label, key, creative) => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const requestFrom = async (f: ComponentFixture<ImplementationTabComponent>, withGroups: boolean): Promise<string> => {
      const c = seedChannel(f, { includeDemandGen: true });
      if (key === 'demandGenVideoCreative') c['campaignForm'].controls.demandGenAdFormat.setValue('video');
      if (key !== null) c['campaignForm'].controls[key].patchValue(creative);
      if (withGroups) {
        split(c, [{ name: 'Retargeting' }, { name: 'Prospecting', format: 'video', creative: VIDEO_COMPLETE }]);
        c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(false);
      }
      f.detectChanges();
      expect(c['canSubmit']()).toBe(true);
      createCampaign.mockClear();
      c['submit']();
      await f.whenStable();
      return JSON.stringify(createCampaign.mock.calls[0][0]);
    };

    const before = await requestFrom(fixture, false);
    const other = TestBed.createComponent(tabComponentUnderTest());
    other.detectChanges();
    await other.whenStable();
    const after = await requestFrom(other, true);

    expect(after).toBe(before);
    expect(after).not.toContain('demandGenAdGroups');
  });

  it('carries the split and the groups through the draft, and restores them', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    let captured: CampaignImplementationDraft | null = null;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    split(c, [{ name: 'Retargeting', format: 'video', creative: VIDEO_COMPLETE }]);
    c['emitDraft']();

    const draft = captured as unknown as CampaignImplementationDraft;
    expect(draft.demandGenAdGroupsSplit).toBe(true);
    expect(draft.demandGenAdGroups?.[0]).toMatchObject({ name: 'Retargeting', format: 'video', videoCreative: { youtubeVideoIds: 'dQw4w9WgXcQ' } });

    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(false);
    c['campaignForm'].controls.demandGenAdGroups.clear();
    restoreGoogleDraft(fixture, c, {
      includeDemandGen: true,
      demandGenAdGroupsSplit: true,
      demandGenAdGroups: [
        { name: 'Retargeting', format: 'video', creative: {}, videoCreative: { youtubeVideoIds: 'abc123', gone: 'x' } },
        { name: 'Prospecting', format: 'image', creative: { headlines: 'Join us' }, videoCreative: {} },
      ],
    });

    const groups = c['campaignForm'].controls.demandGenAdGroups;
    expect(c['campaignForm'].controls.demandGenAdGroupsSplit.value).toBe(true);
    expect(groups.length).toBe(2);
    expect(groups.at(0).controls.format.value).toBe('video');
    expect(groups.at(0).controls.videoCreative.controls['youtubeVideoIds'].value).toBe('abc123');
    expect(groups.at(1).controls.creative.controls['headlines'].value).toBe('Join us');
    expect(c['demandGenAdGroupsActive']()).toBe(true);
    fixture.detectChanges();
    expect(find(fixture, 'implementation-demand-gen-ad-group-1')).not.toBeNull();
  });

  it('restores a saved name that is not a string as a blank name the judge then names', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    restoreGoogleDraft(fixture, c, {
      includeDemandGen: true,
      demandGenAdGroupsSplit: true,
      demandGenAdGroups: [{ name: 7, format: 'image', creative: { headlines: 'Join us' }, videoCreative: {} }] as never,
    });
    fixture.detectChanges();

    expect(c['campaignForm'].controls.demandGenAdGroups.at(0).controls.name.value).toBe('');
    expect(c['demandGenAdGroupsError']()).toContain('ad group 1 needs a name');
  });

  describe('focus after adding or removing an ad group', () => {
    const focused = (): string | null => {
      const active = document.activeElement as HTMLElement | null;
      return active?.id || active?.closest('[data-testid]')?.getAttribute('data-testid') || null;
    };
    const settle = async (): Promise<void> => {
      fixture.detectChanges();
      await fixture.whenStable();
    };

    beforeEach(() => document.body.appendChild(fixture.nativeElement));
    afterEach(() => fixture.nativeElement.remove());

    it("moves focus to a new group's name, and on removal to the group in its place, the last, or Add", async () => {
      const c = seedChannel(fixture, { includeDemandGen: true });
      split(c, [{ name: 'Retargeting' }]);
      await settle();

      c['addDemandGenAdGroup']();
      await settle();
      expect(focused()).toBe('demand-gen-ad-group-1-name');

      c['removeDemandGenAdGroup'](0);
      await settle();
      expect(focused()).toBe('demand-gen-ad-group-0-name');

      c['removeDemandGenAdGroup'](0);
      await settle();
      expect(focused()).toBe('implementation-demand-gen-ad-group-add');
    });
  });
});

describe('ImplementationTabComponent several demand gen ads', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

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
    logoImages: 'https://example.com/logo.png',
  };
  const VIDEO_WIRE = {
    youtubeVideoIds: ['dQw4w9WgXcQ'],
    headlines: ['Join us in Salt Lake City'],
    longHeadlines: ['Four days of cloud native talks and labs'],
    descriptions: ['Register today'],
    businessName: 'Acme',
    logoImages: ['https://example.com/logo.png'],
  };

  const find = (f: ComponentFixture<ImplementationTabComponent>, testId: string): HTMLElement | null =>
    f.nativeElement.querySelector(`[data-testid="${testId}"]`);

  /** The single ad group with a video ad 1 named `first`, then `ads` added after it. */
  const several = (c: Record<string, any>, first: string, ads: { name: string; format?: 'image' | 'video'; creative?: Record<string, string> }[]): void => {
    c['campaignForm'].controls.demandGenAdFormat.setValue('video');
    c['campaignForm'].controls.demandGenVideoCreative.patchValue(VIDEO_COMPLETE);
    c['campaignForm'].controls.demandGenAdName.setValue(first);
    ads.forEach((ad, i) => {
      c['addDemandGenAd'](null);
      const controls = c['campaignForm'].controls.demandGenAds.at(i).controls;
      controls.name.setValue(ad.name);
      controls.format.setValue(ad.format ?? 'video');
      controls[ad.format === 'image' ? 'creative' : 'videoCreative'].patchValue(ad.creative ?? VIDEO_COMPLETE);
    });
  };

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('turns the single ad into ad 1 of demandGenAds once another is added, up to five', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    fixture.detectChanges();
    expect(find(fixture, 'implementation-demand-gen-ad-add')).not.toBeNull();
    expect(find(fixture, 'implementation-demand-gen-ad-1-name')).toBeNull();

    several(c, ' Teaser ', [{ name: 'Recap' }]);
    fixture.detectChanges();
    expect(find(fixture, 'implementation-demand-gen-ad-1-name')).not.toBeNull();
    expect(find(fixture, 'implementation-demand-gen-ad-2-name')).not.toBeNull();
    expect(find(fixture, 'implementation-demand-gen-ad-2-youtubeVideoIds')).not.toBeNull();
    const payload = c['googleCreativeWirePayload']();
    expect(payload).not.toHaveProperty('demandGenVideoCreative');
    expect(payload).not.toHaveProperty('demandGenCreative');
    expect(payload['demandGenAds']).toEqual([
      { name: 'Teaser', videoCreative: VIDEO_WIRE },
      { name: 'Recap', videoCreative: VIDEO_WIRE },
    ]);
    expect(c['demandGenAdsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);

    for (let i = 0; i < 5; i++) c['addDemandGenAd'](null);
    fixture.detectChanges();
    expect(c['campaignForm'].controls.demandGenAds.length).toBe(GOOGLE_DEMAND_GEN_MAX_ADS_PER_GROUP - 1);
    expect(find(fixture, 'implementation-demand-gen-ad-add')).toBeNull();
  });

  it.each([
    ['an empty ad', 'Teaser', [{ name: 'Recap', creative: {} }], 'Ad 2 of the Demand Gen ad group has no creative'],
    [
      'an image ad below its minimums',
      'Teaser',
      [{ name: 'Recap', format: 'image' as const, creative: { headlines: 'One' } }],
      'Ad 2 of the Demand Gen ad group: the image ad needs',
    ],
  ])('holds Create on %s, saying why and announcing it', (_label, first, ads, fragment) => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    several(c, first, ads);
    fixture.detectChanges();

    expect(c['demandGenAdsError']()).toContain(fragment);
    expect(c['canSubmit']()).toBe(false);
    expect(find(fixture, 'implementation-demand-gen-ads-error')?.textContent).toContain(fragment);
    expect(find(fixture, 'implementation-demand-gen-ads-error-live')?.textContent).toContain(fragment);
  });

  it('holds a video ad name to 255 counting the ad group name, the event name then " - Display"', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.eventName.setValue('E'.repeat(255 - ' - Display - ab'.length));
    several(c, 'ab', [{ name: 'Recap', format: 'image', creative: IMAGE_COMPLETE }]);
    expect(c['demandGenAdsError']()).toBeNull();

    c['campaignForm'].controls.demandGenAdName.setValue('abc');
    expect(c['demandGenAdsError']()).toContain(
      'Ad 1 of the Demand Gen ad group is a video ad, named after the ad group, then " - " and its name, which makes 256 characters'
    );
  });

  it('holds Create on an empty first ad instead of warning about it', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    several(c, 'Teaser', [{ name: 'Recap' }]);
    c['campaignForm'].controls.demandGenVideoCreative.reset();
    fixture.detectChanges();

    expect(c['demandGenAdsError']()).toContain('Ad 1 of the Demand Gen ad group has no creative');
    expect(c['googleCreativeEmptyWarning']()).toBeNull();
  });

  it('does not hold Create on a value left in an ad the create does not send', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    several(c, 'Teaser', [{ name: 'Recap', format: 'image', creative: { ...IMAGE_COMPLETE, headlines: 'h'.repeat(31) } }]);
    fixture.detectChanges();
    expect(c['campaignForm'].invalid).toBe(true);

    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
    c['onDemandGenAdGroupsSplitChange']();
    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.name.setValue('Retargeting');
    c['campaignForm'].controls.demandGenAdGroups.at(0).controls.creative.patchValue(IMAGE_COMPLETE);
    fixture.detectChanges();
    expect(c['campaignForm'].invalid).toBe(false);
    expect(c['canSubmit']()).toBe(true);
  });

  it("sends a named group's ads in place of its own ad once another is added", () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
    c['onDemandGenAdGroupsSplitChange']();
    const group = c['campaignForm'].controls.demandGenAdGroups.at(0);
    group.controls.name.setValue('Retargeting');
    group.controls.format.setValue('video');
    group.controls.videoCreative.patchValue(VIDEO_COMPLETE);
    c['addDemandGenAd'](0);
    group.controls.adName.setValue('Teaser');
    group.controls.ads.at(0).controls.name.setValue('Recap');
    group.controls.ads.at(0).controls.format.setValue('video');
    group.controls.ads.at(0).controls.videoCreative.patchValue(VIDEO_COMPLETE);
    fixture.detectChanges();

    expect(find(fixture, 'implementation-demand-gen-ad-group-0-ad-1-name')).not.toBeNull();
    expect(find(fixture, 'implementation-demand-gen-ad-group-0-ad-2-name')).not.toBeNull();
    expect(c['googleDemandGenAdGroupsPayload']()).toEqual({
      demandGenAdGroups: [
        {
          name: 'Retargeting',
          ads: [
            { name: 'Teaser', videoCreative: VIDEO_WIRE },
            { name: 'Recap', videoCreative: VIDEO_WIRE },
          ],
        },
      ],
    });
    expect(c['demandGenAdGroupsError']()).toBeNull();

    group.controls.ads.at(0).controls.name.setValue('teaser');
    fixture.detectChanges();
    expect(c['demandGenAdGroupsError']()).toContain('Ad 2 of Demand Gen ad group 1 has the same name as ad 1');
    expect(c['canSubmit']()).toBe(false);
  });

  /** One ad is byte-identical: a create whose extra ads were all removed sends the request it made before they existed. */
  it.each([
    ['the single ad group', false],
    ['a named group', true],
  ])('sends the same request with one ad in %s', STATE_ONLY, async (_label, splitOn) => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const requestFrom = async (f: ComponentFixture<ImplementationTabComponent>, addAndRemove: boolean): Promise<string> => {
      const c = seedChannel(f, { includeDemandGen: true });
      c['campaignForm'].controls.demandGenAdFormat.setValue('video');
      c['campaignForm'].controls.demandGenVideoCreative.patchValue(VIDEO_COMPLETE);
      if (splitOn) {
        c['campaignForm'].controls.demandGenAdGroupsSplit.setValue(true);
        c['onDemandGenAdGroupsSplitChange']();
        const group = c['campaignForm'].controls.demandGenAdGroups.at(0);
        group.controls.name.setValue('Retargeting');
        group.controls.creative.patchValue(IMAGE_COMPLETE);
      }
      if (addAndRemove) {
        const owner = splitOn ? 0 : null;
        c['addDemandGenAd'](owner);
        c['demandGenAdList'](owner).at(0).controls.name.setValue('Recap');
        c['removeDemandGenAd'](owner, 0);
      }
      f.detectChanges();
      expect(c['canSubmit']()).toBe(true);
      createCampaign.mockClear();
      c['submit']();
      await f.whenStable();
      return JSON.stringify(createCampaign.mock.calls[0][0]);
    };

    const before = await requestFrom(fixture, false);
    const other = TestBed.createComponent(tabComponentUnderTest());
    other.detectChanges();
    await other.whenStable();
    const after = await requestFrom(other, true);

    expect(after).toBe(before);
    expect(after).not.toContain('demandGenAds');
    expect(after).not.toContain('"ads"');
  });

  it('carries the ads through the draft, and restores them defensively', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDemandGen: true });
    let captured: CampaignImplementationDraft | null = null;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    several(c, 'Teaser', [{ name: 'Recap' }]);
    c['emitDraft']();
    const draft = captured as unknown as CampaignImplementationDraft;
    expect(draft.demandGenAdName).toBe('Teaser');
    expect(draft.demandGenAds?.[0]).toMatchObject({ name: 'Recap', format: 'video', videoCreative: { youtubeVideoIds: 'dQw4w9WgXcQ' } });

    c['campaignForm'].controls.demandGenAds.clear();
    restoreGoogleDraft(fixture, c, {
      includeDemandGen: true,
      demandGenAdName: 'Teaser',
      demandGenAds: [
        { name: 7, format: 'carousel', creative: { headlines: 'Join us', gone: 'x', businessName: 9 }, videoCreative: {} },
        ...Array.from({ length: 6 }, (_v, i) => ({ name: `a${i}`, format: 'video', creative: {}, videoCreative: {} })),
      ] as never,
      demandGenAdGroupsSplit: false,
      demandGenAdGroups: [
        {
          name: 'G',
          format: 'image',
          creative: {},
          videoCreative: {},
          adName: 'One',
          ads: [{ name: 'Two', format: 'video', creative: {}, videoCreative: {} }],
        },
      ],
    });

    const ads = c['campaignForm'].controls.demandGenAds;
    expect(ads.length).toBe(GOOGLE_DEMAND_GEN_MAX_ADS_PER_GROUP - 1);
    expect(ads.at(0).controls.name.value).toBe('');
    expect(ads.at(0).controls.format.value).toBe('image');
    expect(ads.at(0).controls.creative.controls['headlines'].value).toBe('Join us');
    expect(ads.at(0).controls.creative.controls['businessName'].value).toBe('');
    expect(c['campaignForm'].controls.demandGenAdName.value).toBe('Teaser');
    const group = c['campaignForm'].controls.demandGenAdGroups.at(0);
    expect(group.controls.adName.value).toBe('One');
    expect(group.controls.ads.at(0).controls.name.value).toBe('Two');
    expect(group.controls.ads.at(0).controls.format.value).toBe('video');
  });

  describe('focus after adding or removing an ad', () => {
    const focused = (): string | null => {
      const active = document.activeElement as HTMLElement | null;
      return active?.id || active?.closest('[data-testid]')?.getAttribute('data-testid') || null;
    };
    const settle = async (): Promise<void> => {
      fixture.detectChanges();
      await fixture.whenStable();
    };

    beforeEach(() => document.body.appendChild(fixture.nativeElement));
    afterEach(() => fixture.nativeElement.remove());

    it("moves focus to a new ad's name, and on removal to the ad in its place, the last, or Add another ad", async () => {
      const c = seedChannel(fixture, { includeDemandGen: true });
      await settle();

      c['addDemandGenAd'](null);
      await settle();
      expect(focused()).toBe('demand-gen-ad-2-name');
      c['addDemandGenAd'](null);
      await settle();
      expect(focused()).toBe('demand-gen-ad-3-name');

      c['removeDemandGenAd'](null, 0);
      await settle();
      expect(focused()).toBe('demand-gen-ad-2-name');

      c['removeDemandGenAd'](null, 0);
      await settle();
      expect(focused()).toBe('implementation-demand-gen-ad-add');
    });
  });
});

/** Named Display ad groups (campaign-service v1.0.31, #475), on the Demand Gen split's terms. */
describe('ImplementationTabComponent display ad groups', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const AD = {
    headlines: 'One headline',
    longHeadline: 'A long headline',
    descriptions: 'A description',
    businessName: 'Acme',
    marketingImages: 'https://example.com/a.png',
    squareMarketingImages: 'https://example.com/b.png',
  };
  const AD_SENT = {
    headlines: ['One headline'],
    longHeadline: 'A long headline',
    descriptions: ['A description'],
    businessName: 'Acme',
    marketingImages: ['https://example.com/a.png'],
    squareMarketingImages: ['https://example.com/b.png'],
  };
  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  /** Turn the split on through its checkbox handler, as a click does, and fill the groups. */
  const split = (c: Record<string, any>, groups: { name: string; creative?: Record<string, string> }[]): void => {
    c['campaignForm'].controls.displayAdGroupsSplit.setValue(true);
    c['onDisplayAdGroupsSplitChange']();
    for (let i = 1; i < groups.length; i++) c['addDisplayAdGroup']();
    groups.forEach((group, i) => {
      const controls = c['campaignForm'].controls.displayAdGroups.at(i).controls;
      controls.name.setValue(group.name);
      controls.creative.patchValue(group.creative ?? AD);
    });
  };

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('offers the split on Display alone, and the first group once its checkbox is ticked', () => {
    seedChannel(fixture, { includeDemandGen: true });
    fixture.detectChanges();
    expect(find('implementation-display-ad-groups-split')).toBeNull();

    const c = seedChannel(fixture, { includeDisplay: true });
    fixture.detectChanges();
    (find('implementation-display-ad-groups-split')?.querySelector('input') as HTMLInputElement).click();
    fixture.detectChanges();

    expect(c['campaignForm'].controls.displayAdGroups.length).toBe(1);
    expect(find('implementation-display-ad-group-name-0')).not.toBeNull();
    expect(find('implementation-display-ad-group-0-marketingImages')).not.toBeNull();
    expect(c['googleCreativeGroupsInReach']().has('displayCreative')).toBe(false);
    expect(find('implementation-creative-display-headlines')).toBeNull();
  });

  it('adds groups up to five, and removes one', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    split(c, [{ name: 'a' }]);
    for (let i = 0; i < 6; i++) c['addDisplayAdGroup']();
    fixture.detectChanges();
    expect(c['campaignForm'].controls.displayAdGroups.length).toBe(GOOGLE_DISPLAY_MAX_AD_GROUPS);
    expect(find('implementation-display-ad-group-add')).toBeNull();

    c['removeDisplayAdGroup'](0);
    fixture.detectChanges();
    expect(find('implementation-display-ad-group-add')).not.toBeNull();
  });

  it('sends the groups and no campaign-level Display ad', STATE_ONLY, async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue(AD);
    split(c, [{ name: ' Retargeting ' }, { name: 'Prospecting' }]);
    fixture.detectChanges();
    expect(c['displayAdGroupsError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    const request = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(request).not.toHaveProperty('displayCreative');
    expect(request['displayAdGroups']).toEqual([
      { name: 'Retargeting', creative: AD_SENT },
      { name: 'Prospecting', creative: AD_SENT },
    ]);
  });

  it.each([
    ['a group with no ad', [{ name: 'a', creative: {} }], 'ad group 1 has no ad'],
    ['an ad below its minimums', [{ name: 'a', creative: { headlines: 'One headline' } }], 'Display ad group 1: the ad needs'],
  ])('holds Create on %s, saying why and announcing it', (_label, groups, fragment) => {
    const c = seedChannel(fixture, { includeDisplay: true });
    split(c, groups);
    fixture.detectChanges();

    expect(c['displayAdGroupsError']()).toContain(fragment);
    expect(c['canSubmit']()).toBe(false);
    expect(find('implementation-display-ad-groups-error')?.textContent).toContain(fragment);
    expect(find('implementation-display-ad-groups-error-live')?.textContent).toContain(fragment);
  });

  it('holds Create when the split is on with every ad group removed', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    split(c, [{ name: 'Retargeting' }]);
    c['removeDisplayAdGroup'](0);
    fixture.detectChanges();

    expect(c['googleDisplayAdGroupsPayload']()).toEqual({ displayAdGroups: [] });
    expect(c['displayAdGroupsError']()).toBe(GOOGLE_DISPLAY_AD_GROUPS_EMPTY);
    expect(c['canSubmit']()).toBe(false);
  });

  it('keeps what was entered either way, and says what is not sent', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'A single headline' });
    split(c, [{ name: 'Retargeting' }]);
    fixture.detectChanges();
    expect(c['displayAdGroupsHeldMessage']()).toContain('The single Display ad is kept but not sent');
    expect(find('implementation-display-ad-groups-held-live')?.textContent).toContain('kept but not sent');
    expect(find('implementation-display-ad-groups-split')?.querySelector('input')?.getAttribute('aria-describedby')).toBe(
      'implementation-display-ad-groups-held'
    );

    c['campaignForm'].controls.displayAdGroupsSplit.setValue(false);
    fixture.detectChanges();
    expect(c['campaignForm'].controls.displayCreative.controls.headlines.value).toBe('A single headline');
    expect(c['displayAdGroupsHeldMessage']()).toBe(
      'The Display ad group you entered is kept but not sent while the campaign is not split. Turn the split on to send it instead.'
    );
    expect(c['googleDisplayAdGroupsPayload']()).toEqual({});
    expect(c['displayAdGroupsError']()).toBeNull();
    expect(find('implementation-display-ad-groups-held')?.textContent).toContain('kept but not sent');
  });

  it('says nothing is held when the split is turned on and off with nothing entered', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayAdGroupsSplit.setValue(true);
    c['onDisplayAdGroupsSplitChange']();
    c['campaignForm'].controls.displayAdGroupsSplit.setValue(false);
    fixture.detectChanges();

    expect(c['displayAdGroupsHeldMessage']()).toBe('');
    expect(find('implementation-display-ad-groups-held')).toBeNull();
  });

  it('does not hold Create on a value left in a group the create does not send, nor in the single ad while split', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    split(c, [{ name: 'a', creative: { ...AD, headlines: 'h'.repeat(31) } }]);
    expect(c['campaignForm'].invalid).toBe(true);

    c['campaignForm'].controls.displayAdGroupsSplit.setValue(false);
    fixture.detectChanges();
    expect(c['campaignForm'].invalid).toBe(false);

    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'h'.repeat(31) });
    c['campaignForm'].controls.displayAdGroups.at(0).controls.creative.patchValue(AD);
    c['campaignForm'].controls.displayAdGroupsSplit.setValue(true);
    fixture.detectChanges();
    expect(c['campaignForm'].invalid).toBe(false);
    expect(c['canSubmit']()).toBe(true);
  });

  /** Off is byte-identical: groups typed with the split off send the request made before they existed. */
  it.each([
    ['a Display ad', AD],
    ['no ad', {}],
  ])('sends the same request with the split off, carrying %s', STATE_ONLY, async (_label, creative) => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const requestFrom = async (f: ComponentFixture<ImplementationTabComponent>, withGroups: boolean): Promise<string> => {
      const c = seedChannel(f, { includeDisplay: true });
      c['campaignForm'].controls.displayCreative.patchValue(creative);
      if (withGroups) {
        split(c, [{ name: 'Retargeting' }, { name: 'Prospecting' }]);
        c['campaignForm'].controls.displayAdGroupsSplit.setValue(false);
      }
      f.detectChanges();
      expect(c['canSubmit']()).toBe(true);
      createCampaign.mockClear();
      c['submit']();
      await f.whenStable();
      return JSON.stringify(createCampaign.mock.calls[0][0]);
    };

    const before = await requestFrom(fixture, false);
    const other = TestBed.createComponent(tabComponentUnderTest());
    other.detectChanges();
    await other.whenStable();
    expect(await requestFrom(other, true)).toBe(before);
    expect(before).not.toContain('displayAdGroups');
  });

  it('carries the split and the groups through the draft, restores them defensively, and clears them for a new brief', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    let captured: CampaignImplementationDraft | null = null;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    split(c, [{ name: 'Retargeting' }]);
    c['emitDraft']();
    const draft = captured as unknown as CampaignImplementationDraft;
    expect(draft.displayAdGroupsSplit).toBe(true);
    expect(draft.displayAdGroups?.[0]).toMatchObject({ name: 'Retargeting', creative: { headlines: 'One headline' } });

    c['resetGoogleFields']();
    expect(c['campaignForm'].controls.displayAdGroupsSplit.value).toBe(false);
    expect(c['campaignForm'].controls.displayAdGroups.length).toBe(0);

    restoreGoogleDraft(fixture, c, {
      displayAdGroupsSplit: true,
      displayAdGroups: [...Array.from({ length: 6 }, (_v, i) => ({ name: `g${i}`, creative: { headlines: 'H', unknownField: 'x', businessName: 7 } })), null],
    });
    expect(c['campaignForm'].controls.displayAdGroupsSplit.value).toBe(true);
    expect(c['campaignForm'].controls.displayAdGroups.length).toBe(GOOGLE_DISPLAY_MAX_AD_GROUPS);
    expect(c['campaignForm'].controls.displayAdGroups.at(0).controls.creative.getRawValue()).toMatchObject({ headlines: 'H', businessName: '' });
  });

  describe('focus after adding or removing an ad group', () => {
    const focused = (): string | null => {
      const active = document.activeElement as HTMLElement | null;
      return active?.id || active?.closest('[data-testid]')?.getAttribute('data-testid') || null;
    };
    const settle = async (): Promise<void> => {
      fixture.detectChanges();
      await fixture.whenStable();
    };

    beforeEach(() => document.body.appendChild(fixture.nativeElement));
    afterEach(() => fixture.nativeElement.remove());

    it("moves focus to a new group's name, and on removal to the group in its place, the last, or Add", async () => {
      const c = seedChannel(fixture, { includeDisplay: true });
      split(c, [{ name: 'Retargeting' }]);
      await settle();

      c['addDisplayAdGroup']();
      await settle();
      expect(focused()).toBe('display-ad-group-1-name');

      c['removeDisplayAdGroup'](0);
      await settle();
      expect(focused()).toBe('display-ad-group-0-name');

      c['removeDisplayAdGroup'](0);
      await settle();
      expect(focused()).toBe('implementation-display-ad-group-add');
    });
  });
});
