// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CampaignNegativeKeywordMatchType, CampaignSearchAd } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CampaignGoogleSearchAdsPanelComponent } from './campaign-google-search-ads-panel.component';

describe('CampaignGoogleSearchAdsPanelComponent', () => {
  let fixture: ComponentFixture<CampaignGoogleSearchAdsPanelComponent>;
  let ads: CampaignSearchAd[][];
  let paths: string[];
  let negatives: string[];

  const AD: CampaignSearchAd = { headlines: ['Register today'], descriptions: ['Join us.'], path1: '', path2: '' };

  function query<T extends HTMLElement = HTMLElement>(testId: string): T | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function click(testId: string): void {
    (query(testId)?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  function type(testId: string, text: string, tag: 'input' | 'textarea' = 'input'): void {
    const box = query(testId)?.querySelector(tag) as HTMLInputElement;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function render(inputs: {
    additionalAds?: CampaignSearchAd[];
    negativeKeywordsText?: string;
    matchType?: CampaignNegativeKeywordMatchType;
    searchPartners?: boolean;
    pathsError?: string | null;
    adsError?: string | null;
    negativeKeywordsError?: string | null;
  }): void {
    fixture.componentRef.setInput('path1', '');
    fixture.componentRef.setInput('path2', '');
    fixture.componentRef.setInput('additionalAds', inputs.additionalAds ?? []);
    fixture.componentRef.setInput('negativeKeywordsText', inputs.negativeKeywordsText ?? '');
    fixture.componentRef.setInput('negativeKeywordMatchType', inputs.matchType ?? 'Exact');
    fixture.componentRef.setInput('searchPartners', inputs.searchPartners ?? false);
    fixture.componentRef.setInput('pathsError', inputs.pathsError ?? null);
    fixture.componentRef.setInput('adsError', inputs.adsError ?? null);
    fixture.componentRef.setInput('negativeKeywordsError', inputs.negativeKeywordsError ?? null);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CampaignGoogleSearchAdsPanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(CampaignGoogleSearchAdsPanelComponent);
    document.body.appendChild(fixture.nativeElement);
    ads = [];
    paths = [];
    negatives = [];
    fixture.componentInstance.additionalAds.subscribe((list) => ads.push(list));
    fixture.componentInstance.path1.subscribe((path) => paths.push(path));
    fixture.componentInstance.negativeKeywordsText.subscribe((text) => negatives.push(text));
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('offers Search partners as a labelled checkbox, ticked from its value, and writes a tick back', () => {
    const partners: boolean[] = [];
    fixture.componentInstance.searchPartners.subscribe((value) => partners.push(value));
    render({ searchPartners: false });
    const box = query('implementation-google-search-partners')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(query('implementation-google-search-partners')?.textContent).toContain('Include Google search partners');

    box.click();
    fixture.detectChanges();
    expect(partners.at(-1)).toBe(true);

    render({ searchPartners: true });
    expect((query('implementation-google-search-partners')?.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });

  it('writes a typed display path back', () => {
    render({});
    type('implementation-google-search-path1', 'kubecon');

    expect(paths.at(-1)).toBe('kubecon');
  });

  it('adds an empty ad, and stops offering Add once the group holds three ads', () => {
    render({});
    click('implementation-google-search-add-ad');
    expect(ads.at(-1)).toEqual([{ headlines: [''], descriptions: [''], path1: '', path2: '' }]);

    render({ additionalAds: [AD, AD] });
    expect(query('implementation-google-search-add-ad')?.querySelector('button')?.disabled).toBe(true);
    expect(query('implementation-google-search-ads')?.textContent).toContain('More ads (3/3)');
  });

  it("edits, adds and removes an ad's lines, and removes the ad", () => {
    render({ additionalAds: [AD] });

    type('implementation-google-search-ad-2-headline-0', 'Save the date');
    expect(ads.at(-1)?.[0].headlines).toEqual(['Save the date']);

    render({ additionalAds: [AD] });
    click('implementation-google-search-ad-2-add-description');
    expect(ads.at(-1)?.[0].descriptions).toEqual(['Join us.', '']);

    render({ additionalAds: [AD] });
    click('implementation-google-search-ad-2-remove');
    expect(ads.at(-1)).toEqual([]);
  });

  it('stops offering another headline at fifteen', () => {
    render({ additionalAds: [{ ...AD, headlines: Array.from({ length: 15 }, (_, i) => `H${i}`) }] });

    expect(query('implementation-google-search-ad-2-add-headline')?.querySelector('button')?.disabled).toBe(true);
  });

  it('writes the negatives text back and counts only the keywords it would send', () => {
    render({ negativeKeywordsText: 'free tickets\n\njobs\nbad!' });
    expect(query('implementation-google-search-negatives')?.textContent).toContain('Negative keywords (2/60)');

    type('implementation-google-search-negatives-text', 'jobs', 'textarea');
    expect(negatives.at(-1)).toBe('jobs');
  });

  it('shows each error under its section, linked by aria-describedby and announced', () => {
    render({ pathsError: 'Path problem', adsError: 'Ad problem', negativeKeywordsError: 'Negative problem' });

    expect(query('implementation-google-search-paths-error')?.textContent).toContain('Path problem');
    expect(query('implementation-google-search-paths')?.getAttribute('aria-describedby')).toBe('google-search-paths-hint google-search-paths-error');
    expect(query('implementation-google-search-ads-error')?.textContent).toContain('Ad problem');
    expect(query('implementation-google-search-negatives-error')?.textContent).toContain('Negative problem');
    expect(query('implementation-google-search-ads-live')?.textContent).toContain('Negative problem');
  });
});
