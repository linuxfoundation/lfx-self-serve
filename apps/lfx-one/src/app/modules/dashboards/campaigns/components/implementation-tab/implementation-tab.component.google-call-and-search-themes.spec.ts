// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  GOOGLE_ADS_MAX_CALL_EXTENSIONS,
  GOOGLE_ADS_MAX_PRICE_OFFERINGS,
  GOOGLE_ADS_MIN_PRICE_OFFERINGS,
  GOOGLE_PERFORMANCE_MAX_SEARCH_THEMES_NEED_CREATIVE_REFUSAL,
} from '@lfx-one/shared/constants';
import type { CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
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
 * The call, promotion and price extensions. Each add is judged by `campaign-google-assets.utils`,
 * which carries the branch-by-branch tests; these cover what the component adds around it — the
 * normalisation it stores, the sub-forms, the Search gate and its two warnings, the payload's exact
 * wire shape, and the draft round-trip.
 */
describe('ImplementationTabComponent google call, promotion and price extensions', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const URL = 'https://events.example.org/register';
  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  /** The focusable `<input>` an `lfx-input-text` wrapper renders, found through the wrapper's test id. */
  const field = (testId: string): HTMLInputElement | null => find(testId)?.querySelector('input') ?? null;
  const type = (testId: string, value: string): void => {
    const el = field(testId) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  function promotionDraft(c: Record<string, any>, overrides: Record<string, string> = {}): Record<string, string> {
    return { ...c['emptyGooglePromotionDraft'](), promotionTarget: 'Conference passes', discount: '25', finalUrl: URL, ...overrides };
  }

  function priceDraft(_c: Record<string, any>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const row = (header: string) => ({ header, description: 'Two days', amount: '499', unit: '', finalUrl: URL });
    return {
      type: 'EVENTS',
      priceQualifier: '',
      languageCode: 'en',
      currencyCode: 'usd',
      offerings: [row('Standard'), row('Student'), row('Virtual')],
      ...overrides,
    };
  }

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('stores a call extension trimmed and with its country upper-cased, as upstream normalises it', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['addGoogleCallExtension']({ countryCode: ' us ', phoneNumber: ' +1 (415) 555-0100 ' })).toBe(true);

    expect(c['googleCallExtensions']()).toEqual([{ countryCode: 'US', phoneNumber: '+1 (415) 555-0100' }]);
  });

  it.each([
    ['a vanity number', { countryCode: 'US', phoneNumber: '1-800-FLOWERS' }],
    ['a three-letter country', { countryCode: 'USA', phoneNumber: '4155550100' }],
    ['the same digits punctuated differently', { countryCode: 'us', phoneNumber: '14155550100' }],
  ])('refuses %s and keeps the list as it was', STATE_ONLY, (_label, draft) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleCallExtension']({ countryCode: 'US', phoneNumber: '+1 (415) 555-0100' });

    expect(c['addGoogleCallExtension'](draft)).toBe(false);
    expect(c['googleCallExtensions']()).toHaveLength(1);
  });

  it('refuses a call extension past the cap', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    for (let i = 0; i < GOOGLE_ADS_MAX_CALL_EXTENSIONS; i++)
      c['addGoogleCallExtension']({ countryCode: 'US', phoneNumber: `415 555 01${String(i).padStart(2, '0')}` });

    expect(c['googleCallExtensionsFull']()).toBe(true);
    expect(c['addGoogleCallExtension']({ countryCode: 'US', phoneNumber: '415 555 0199' })).toBe(false);
  });

  it('names the refusal under the call sub-form while the entry is still editable, and keeps the text on a refused add', () => {
    seedChannel(fixture, { includeSearch: true });
    type('implementation-google-call-country', 'US');
    type('implementation-google-call-number', '1-800-FLOWERS');

    expect(find('implementation-google-call-extension-error')?.textContent).toContain('vanity');
    expect((find('implementation-google-call-extension-add') as HTMLButtonElement).disabled).toBe(true);

    type('implementation-google-call-number', '+1 415 555 0100');
    expect(find('implementation-google-call-extension-error')).toBeNull();
    (find('implementation-google-call-extension-add') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(find('implementation-google-call-extensions-section')?.textContent).toContain('+1 415 555 0100 (US)');
    expect(field('implementation-google-call-number')?.value).toBe('');
  });

  it('stores only the discount and condition arms the promotion form selected, with no empty optional fields', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    // Text left in the minimum-order box is NOT sent once the condition is switched to a code, and
    // a currency typed for a percentage discount is not sent either — upstream reads it only for money.
    const draft = promotionDraft(c, { eligibilityKind: 'code', promotionCode: ' SPRING ', ordersOverAmount: '100', currencyCode: 'usd', languageCode: 'en' });
    expect(c['addGooglePromotion'](draft)).toBe(true);

    expect(c['googlePromotions']()).toEqual([
      { promotionTarget: 'Conference passes', discountPercent: 25, promotionCode: 'SPRING', languageCode: 'en', finalUrl: URL },
    ]);
  });

  it('carries the currency, upper-cased, when a money field uses it', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(
      c['addGooglePromotion'](
        promotionDraft(c, { discountKind: 'amount', discount: '50', eligibilityKind: 'ordersOver', ordersOverAmount: '200', currencyCode: 'eur' })
      )
    ).toBe(true);

    expect(c['googlePromotions']()[0]).toEqual({
      promotionTarget: 'Conference passes',
      discountAmount: 50,
      ordersOverAmount: 200,
      currencyCode: 'EUR',
      finalUrl: URL,
    });
  });

  it.each([
    ['a money discount with no currency', { discountKind: 'amount', discount: '50' }, 'no currency code'],
    ['a percentage over 100', { discount: '150' }, 'at most 100'],
    ['a discount that is not a number', { discount: 'ten' }, 'greater than 0'],
    ['a serving window ending before it starts', { startDate: '2026-11-10', endDate: '2026-11-01' }, 'serving end date'],
  ])('refuses %s, and names it under the sub-form', (_label, overrides, expected) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googlePromotionForm'].setValue(promotionDraft(c, overrides));
    fixture.detectChanges();

    expect(c['addGooglePromotion'](c['googlePromotionDraft']())).toBe(false);
    expect(find('implementation-google-promotion-error')?.textContent).toContain(expected);
    expect(c['googlePromotionAddDisabled']()).toBe(true);
  });

  /**
   * A SELECTED condition must be filled. Upstream treats both conditions as optional, so an empty code
   * or a zero minimum order would pass by being dropped, and the ad would advertise an unconditional
   * offer while the select still names a condition.
   */
  it.each([
    ['a promotion code selected with no code', { eligibilityKind: 'code', promotionCode: '  ' }, 'Enter the promotion code'],
    ['a minimum order selected with no amount', { eligibilityKind: 'ordersOver', ordersOverAmount: '' }, 'Enter a minimum order amount'],
    ['a minimum order of zero', { eligibilityKind: 'ordersOver', ordersOverAmount: '0', currencyCode: 'USD' }, 'greater than 0'],
  ])('refuses %s rather than dropping the condition', (_label, overrides, expected) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googlePromotionForm'].setValue(promotionDraft(c, overrides));
    fixture.detectChanges();

    expect(c['googlePromotionAddDisabled']()).toBe(true);
    expect(c['addGooglePromotion'](c['googlePromotionDraft']())).toBe(false);
    expect(c['googlePromotions']()).toHaveLength(0);
    expect(find('implementation-google-promotion-error')?.textContent).toContain(expected);
  });

  it('points the condition and currency boxes at the error line, and labels each date picker visibly', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googlePromotionForm'].setValue(promotionDraft(c, { discountKind: 'amount', discount: '50', eligibilityKind: 'code', promotionCode: 'C'.repeat(21) }));
    fixture.detectChanges();

    for (const testId of ['implementation-google-promotion-code', 'implementation-google-promotion-currency']) {
      expect(field(testId)?.getAttribute('aria-describedby')).toBe('google-promotion-error');
      expect(field(testId)?.getAttribute('aria-invalid')).toBe('true');
    }
    for (const name of ['occasion', 'language', 'start', 'end', 'redemption-start', 'redemption-end']) {
      expect(field(`implementation-google-promotion-${name}`)?.getAttribute('aria-describedby')).toBe('google-promotion-error');
    }
    expect(find('implementation-google-promotion-start')?.closest('label')?.textContent).toContain('Shows from');
    expect(find('implementation-google-promotion-redemption-end')?.closest('label')?.textContent).toContain('Redeemable until');
  });

  it('says nothing about a promotion until what is on sale, the discount and the destination are filled', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googlePromotionForm'].setValue(promotionDraft(c, { finalUrl: '', discount: '150' }));
    fixture.detectChanges();

    expect(c['googlePromotionDraftError']()).toBeNull();
    expect(c['googlePromotionAddDisabled']()).toBe(true);
  });

  it("stores a price table with the table's currency on every row, as the wire carries it", () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['addGooglePrice'](priceDraft(c, { priceQualifier: 'FROM' }))).toBe(true);

    expect(c['googlePrices']()).toEqual([
      {
        type: 'EVENTS',
        priceQualifier: 'FROM',
        languageCode: 'en',
        offerings: ['Standard', 'Student', 'Virtual'].map((header) => ({ header, description: 'Two days', amount: 499, currencyCode: 'USD', finalUrl: URL })),
      },
    ]);
  });

  it('refuses a price table repeating a row header, and names the row', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const draft = priceDraft(c);
    (draft['offerings'] as { header: string }[])[2].header = 'standard';
    c['googlePriceForm'].setValue(draft);
    fixture.detectChanges();

    expect(c['addGooglePrice'](draft)).toBe(false);
    expect(find('implementation-google-price-error')?.textContent).toContain('Row 3 repeats the header');
  });

  it('points every price box at the error line while the table is refused', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googlePriceForm'].setValue(priceDraft(c, { currencyCode: 'DOLLARS' }));
    fixture.detectChanges();

    expect(c['googlePriceDraftError']()).toContain('three-letter ISO');
    // The type, qualifier and unit are `lfx-select`s offering only Google's own enum names, so no
    // refusal can name them; every typed box points at the error line.
    for (const testId of [
      'implementation-google-price-language',
      'implementation-google-price-currency',
      'implementation-google-price-row-header-0',
      'implementation-google-price-row-amount-0',
    ]) {
      expect(field(testId)?.getAttribute('aria-describedby')).toBe('google-price-error');
      expect(field(testId)?.getAttribute('aria-invalid')).toBe('true');
    }
  });

  it("keeps the price form between Google's three and eight rows", () => {
    const c = seedChannel(fixture, { includeSearch: true });
    expect(c['googlePriceDraft']().offerings).toHaveLength(GOOGLE_ADS_MIN_PRICE_OFFERINGS);
    expect(find('implementation-google-price-row-remove-0')).toBeNull();

    c['removeGooglePriceRow'](0);
    expect(c['googlePriceDraft']().offerings).toHaveLength(GOOGLE_ADS_MIN_PRICE_OFFERINGS);

    for (let i = 0; i < 10; i++) c['addGooglePriceRow']();
    fixture.detectChanges();
    expect(c['googlePriceDraft']().offerings).toHaveLength(GOOGLE_ADS_MAX_PRICE_OFFERINGS);
    expect(find('implementation-google-price-row-add')).toBeNull();
    expect(find('implementation-google-price-row-remove-0')).not.toBeNull();
  });

  it('offers the decimal keypad on every amount box', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googlePromotionForm'].controls.eligibilityKind.setValue('ordersOver');
    fixture.detectChanges();

    for (const testId of [
      'implementation-google-promotion-discount',
      'implementation-google-promotion-orders-over',
      'implementation-google-price-row-amount-0',
    ]) {
      expect(field(testId)?.getAttribute('inputmode')).toBe('decimal');
    }
    expect(field('implementation-google-promotion-target')?.hasAttribute('inputmode')).toBe(false);
  });

  it('builds a price table through the sub-form, row by row', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['googlePriceForm'].controls.type.setValue('SERVICES');
    type('implementation-google-price-language', 'en');
    type('implementation-google-price-currency', 'USD');
    ['Standard', 'Student', 'Virtual'].forEach((header, r) => {
      type(`implementation-google-price-row-header-${r}`, header);
      type(`implementation-google-price-row-description-${r}`, 'Two days');
      type(`implementation-google-price-row-amount-${r}`, '99');
      type(`implementation-google-price-row-url-${r}`, URL);
    });
    c['googlePriceForm'].controls.offerings.at(1).controls.unit.setValue('PER_DAY');

    (find('implementation-google-price-add') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(c['googlePrices']()).toHaveLength(1);
    expect(c['googlePrices']()[0].type).toBe('SERVICES');
    expect(c['googlePrices']()[0].offerings[1].unit).toBe('PER_DAY');
    // Cleared on success, back to three empty rows.
    expect(c['googlePriceDraft']().offerings.every((row: { header: string }) => row.header === '')).toBe(true);
  });

  function seedAll(c: Record<string, any>): void {
    c['addGoogleCallExtension']({ countryCode: 'US', phoneNumber: '+1 415 555 0100' });
    c['addGooglePromotion'](promotionDraft(c));
    c['addGooglePrice'](priceDraft(c));
  }

  /** Search only, and WITHHELD elsewhere rather than refused — exactly as the other three are. */
  it('offers all three on Search and withholds them, with a notice each, on a non-Search channel', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    seedAll(c);
    expect(Object.keys(c['googleAssetExtensionsPayload']())).toEqual(['callExtensions', 'promotions', 'prices']);
    expect(find('implementation-google-prices-section')).not.toBeNull();

    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
    fixture.detectChanges();

    expect(c['googleAssetExtensionsPayload']()).toEqual({});
    expect(find('implementation-google-prices-section')).toBeNull();
    expect(find('implementation-google-call-extensions-withheld')?.textContent).toContain(
      'Demand Gen campaigns do not take call extensions, so the 1 you added'
    );
    expect(find('implementation-google-promotions-withheld')?.textContent).toContain('do not take promotions');
    expect(find('implementation-google-prices-withheld')?.textContent).toContain('do not take price extensions');
    expect(find('implementation-google-prices-withheld-live')?.textContent?.trim()).toBe(c['googlePricesWithheldWarning']());
    expect(c['googlePrices']()).toHaveLength(1);
  });

  it('counts all three in the capability block when extensions cannot be sent', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    seedAll(c);
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    expect(c['googleAssetExtensionsPayload']()).toEqual({});
    expect(find('implementation-google-extensions-capability-unsupported')?.textContent).toContain('1 call extension, 1 promotion and 1 price extension');
  });

  /** Through `submit()`, so deleting the payload spread fails here and not only in a helper test. */
  it("sends all three on a submitted Search create, in campaign-service's wire shape", async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedChannel(fixture, { includeSearch: true });
    seedAll(c);
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    const request = createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(request['callExtensions']).toEqual([{ countryCode: 'US', phoneNumber: '+1 415 555 0100' }]);
    expect(request['promotions']).toEqual([{ promotionTarget: 'Conference passes', discountPercent: 25, finalUrl: URL }]);
    expect(request['prices']).toEqual([
      {
        type: 'EVENTS',
        languageCode: 'en',
        offerings: ['Standard', 'Student', 'Virtual'].map((header) => ({ header, description: 'Two days', amount: 499, currencyCode: 'USD', finalUrl: URL })),
      },
    ]);
  });

  it('round-trips all three through a draft, without sharing a price row with it', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    seedAll(c);

    expect(emitted?.googleCallExtensions).toEqual(c['googleCallExtensions']());
    expect(emitted?.googlePromotions).toEqual(c['googlePromotions']());
    expect(emitted?.googlePrices).toEqual(c['googlePrices']());

    const saved = emitted as CampaignImplementationDraft;
    c['googleCallExtensions'].set([]);
    c['googlePromotions'].set([]);
    c['googlePrices'].set([]);
    restoreGoogleDraft(fixture, c, {
      googleCallExtensions: saved.googleCallExtensions,
      googlePromotions: saved.googlePromotions,
      googlePrices: saved.googlePrices,
    });

    expect(c['googleCallExtensions']()).toHaveLength(1);
    expect(c['googlePromotions']()).toHaveLength(1);
    c['googlePrices']()[0].offerings[0].header = 'Edited';
    expect(saved.googlePrices?.[0].offerings[0].header).toBe('Standard');
  });

  it('leaves the lists alone when the draft carries none of the three keys', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    seedAll(c);

    restoreGoogleDraft(fixture, c, {});

    expect(c['googleCallExtensions']()).toHaveLength(1);
    expect(c['googlePromotions']()).toHaveLength(1);
    expect(c['googlePrices']()).toHaveLength(1);
  });
});

/**
 * Performance Max search themes (#5262): campaign-service v1.0.31 takes `performanceMaxSearchThemes`
 * on the asset group (`validatePerformanceMaxSignals`, linuxfoundation/lfx-v2-campaign-service#461), Performance Max only, and only beside a
 * creative that creates the asset group.
 */
describe('ImplementationTabComponent google performance max search themes', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const PMAX_COMPLETE = {
    headlines: 'One headline\nTwo headline\nThree headline',
    longHeadlines: 'A long headline',
    descriptions: 'A short description\nAnother short description',
    businessName: 'Acme',
    marketingImages: 'https://example.com/a.png',
    squareMarketingImages: 'https://example.com/square.png',
    logoImages: 'https://example.com/logo.png',
  };
  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const seedPmax = (themes: string): Record<string, any> => {
    const c = seedChannel(fixture, { includePerformanceMax: true });
    c['campaignForm'].controls.performanceMaxCreative.patchValue(PMAX_COMPLETE);
    c['campaignForm'].controls.googlePerformanceMaxSearchThemes.setValue(themes);
    fixture.detectChanges();
    return c;
  };

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it.each([
    ['Performance Max', { includePerformanceMax: true }, true],
    ['Search', { includeSearch: true }, false],
    ['Demand Gen', { includeDemandGen: true }, false],
    ['Display', { includeDisplay: true }, false],
  ])('shows the search themes box on %s only when the channel takes them', (_label, channel, shown) => {
    const c = seedChannel(fixture, channel);

    expect(c['googleSearchThemesAvailable']()).toBe(shown);
    expect(find('implementation-google-search-themes-section') !== null).toBe(shown);
  });

  it('labels the box, points it at its hint, and counts the themes against the cap', () => {
    seedPmax('kubernetes\n\n  cloud native  \n');
    const box = fixture.nativeElement.querySelector('#google-search-themes-input') as HTMLTextAreaElement;

    expect(fixture.nativeElement.querySelector('label[for="google-search-themes-input"]')?.textContent).toContain('Google Search Themes (2/50)');
    expect(box.getAttribute('aria-describedby')).toBe('google-search-themes-hint');
    expect(box.getAttribute('aria-invalid')).not.toBe('true');
  });

  it("sends the themes one per line, trimmed with Go's rules and blanks dropped, on a submitted Performance Max create", STATE_ONLY, async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedPmax(' kubernetes conference \n\n cloud native\u0085\n');

    expect(c['canSubmit']()).toBe(true);
    c['submit']();
    await fixture.whenStable();

    expect((createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>)['performanceMaxSearchThemes']).toEqual([
      'kubernetes conference',
      'cloud native',
    ]);
  });

  /** A Performance Max request with the box left alone is byte-identical to one built before it existed. */
  it('builds a byte-identical Performance Max request when no theme is entered', STATE_ONLY, async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedPmax('');
    c['submit']();
    await fixture.whenStable();
    const request = JSON.stringify(createCampaign.mock.calls[0][0]);

    expect(request).not.toContain('performanceMaxSearchThemes');
    c['campaignForm'].controls.googlePerformanceMaxSearchThemes.setValue('  \n \n');
    fixture.detectChanges();
    c['submit']();
    await fixture.whenStable();
    expect(JSON.stringify(createCampaign.mock.calls[1][0])).toBe(request);
  });

  it.each([
    ['Search', { includeSearch: true }],
    ['Demand Gen', { includeDemandGen: true }],
    ['Display', { includeDisplay: true }],
  ])('holds the themes after a switch to %s: not sent, kept, and said in the notice and its live region', (label, channel) => {
    const c = seedPmax('kubernetes\ncloud native');
    expect(find('implementation-google-search-themes-withheld-live')?.textContent?.trim()).toBe('');

    c['campaignForm'].patchValue({ includePerformanceMax: false, ...channel });
    fixture.detectChanges();

    expect(c['googleSearchThemesPayload']()).toEqual({});
    expect(c['googleSearchThemesError']()).toBeNull();
    expect(c['campaignForm'].controls.googlePerformanceMaxSearchThemes.value).toBe('kubernetes\ncloud native');
    const notice = find('implementation-google-search-themes-withheld')?.textContent ?? '';
    expect(notice).toContain(`${label} campaigns do not take search themes, so the 2 you added will not be sent`);
    expect(find('implementation-google-search-themes-withheld-live')?.textContent?.trim()).toBe(c['googleSearchThemesWithheldWarning']());
  });

  it.each([
    ['a theme over 80 characters', `ok\n${'x'.repeat(81)}`, 'has 81'],
    ['a repeat in a different case', 'Cloud Native\ncloud native', 'more than once'],
    ['51 themes', Array.from({ length: 51 }, (_, i) => `theme ${i}`).join('\n'), 'at most 50 search themes'],
  ])('holds Create on %s, with the reason under the box and in its live region', (_label, themes, expected) => {
    const c = seedPmax(themes);

    expect(c['googleSearchThemesError']()).toContain(expected);
    expect(c['canSubmit']()).toBe(false);
    expect(find('implementation-google-search-themes-error')?.textContent).toContain(expected);
    expect(find('implementation-google-search-themes-error-live')?.textContent?.trim()).toBe(c['googleSearchThemesError']());
    const box = fixture.nativeElement.querySelector('#google-search-themes-input') as HTMLTextAreaElement;
    expect(box.getAttribute('aria-describedby')).toContain('google-search-themes-error');
    expect(box.getAttribute('aria-invalid')).toBe('true');
  });

  it('holds Create on themes with no Performance Max creative, which creates no asset group for them', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includePerformanceMax: true });
    c['campaignForm'].controls.googlePerformanceMaxSearchThemes.setValue('kubernetes');
    fixture.detectChanges();

    expect(c['googleSearchThemesError']()).toBe(GOOGLE_PERFORMANCE_MAX_SEARCH_THEMES_NEED_CREATIVE_REFUSAL);
    expect(c['canSubmit']()).toBe(false);

    c['campaignForm'].controls.googlePerformanceMaxSearchThemes.setValue('');
    fixture.detectChanges();
    expect(c['googleSearchThemesError']()).toBeNull();
  });

  it('accepts exactly 50 themes of 80 characters', STATE_ONLY, () => {
    const c = seedPmax(Array.from({ length: 50 }, (_, i) => `${String(i).padStart(2, '0')}${'x'.repeat(78)}`).join('\n'));

    expect(c['googleSearchThemesError']()).toBeNull();
    expect(c['canSubmit']()).toBe(true);
  });

  it('carries the box through the draft as typed, restores it under any channel, and clears it on reset', () => {
    const c = seedPmax('kubernetes\n cloud native ');
    let captured: CampaignImplementationDraft | null = null;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    c['emitDraft']();

    expect((captured as unknown as CampaignImplementationDraft).googlePerformanceMaxSearchThemes).toBe('kubernetes\n cloud native ');

    c['campaignForm'].controls.googlePerformanceMaxSearchThemes.setValue('');
    restoreGoogleDraft(fixture, c, { includeSearch: true, googlePerformanceMaxSearchThemes: 'restored theme' });
    expect(c['campaignForm'].controls.googlePerformanceMaxSearchThemes.value).toBe('restored theme');

    // A draft that predates the field leaves the box alone.
    restoreGoogleDraft(fixture, c, { includeSearch: true });
    expect(c['campaignForm'].controls.googlePerformanceMaxSearchThemes.value).toBe('restored theme');

    c['resetGoogleFields']();
    expect(c['campaignForm'].controls.googlePerformanceMaxSearchThemes.value).toBe('');
  });

  /**
   * The BFF decodes each theme as Go does (`googleAdsDecodedText`: a lone surrogate becomes U+FFFD)
   * before the shared judge, so two lines only a lone surrogate apart are one theme there. The tab
   * normalises the same way, so it holds Create with the BFF's own sentence instead of letting the
   * server refuse after dispatch.
   */
  it('holds Create on two themes a lone surrogate apart, which the BFF decodes into one', () => {
    const c = seedPmax('cloud\uD800\ncloud\uD801');

    expect(c['googleSearchThemesError']()).toBe(
      'Google Ads refuses a Performance Max asset group that lists the search theme cloud\ufffd more than once. Remove the repeat and create again.'
    );
    expect(c['canSubmit']()).toBe(false);
    expect(find('implementation-google-search-themes-error')?.textContent).toContain('more than once');
  });

  it('sends a lone surrogate as U+FFFD, the string the BFF judges and forwards', STATE_ONLY, () => {
    const c = seedPmax(' cloud\uD800 \nkubernetes');

    expect(c['googleSearchThemesPayload']()).toEqual({ performanceMaxSearchThemes: ['cloud\ufffd', 'kubernetes'] });
  });

  /**
   * Restored themes on Performance Max while the create capability is not an explicit yes: the box
   * hides and the payload withholds them (`googleSearchThemesAvailable` reads `googleBiddingChannel`),
   * so the capability notice counts them as it counts the extensions, with Retry where a read could
   * succeed. Never dropped in silence; Create is not held, as for the extensions on the same notice.
   */
  function seedPmaxCapability(capability: boolean | null, read: 'pending' | 'failed' | 'ready', themes: string): Record<string, any> {
    const c = seedPmax(themes);
    fixture.componentRef.setInput('briefPersistence', { status: 'saved', briefId: 'brief-1', message: null, approved: true });
    fixture.componentRef.setInput('createCapabilityRead', read);
    fixture.componentRef.setInput('googleCreativeEnabled', capability);
    fixture.detectChanges();
    return c;
  }

  it('names retained themes in the capability notice while the check is pending', () => {
    const c = seedPmaxCapability(null, 'pending', 'kubernetes\ncloud native');

    expect(c['googleSearchThemesPayload']()).toEqual({});
    expect(c['googleSearchThemesWithheldWarning']()).toBeNull();
    expect(c['googleExtensionsCapabilityBlock']()?.kind).toBe('pending');
    const notice = find('implementation-google-extensions-capability-pending')?.textContent ?? '';
    expect(notice).toContain('Checking whether Google search themes can be sent');
    expect(notice).toContain('sends it without the 2 search themes on this brief');
    expect(find('implementation-google-extensions-capability-live')?.textContent?.trim()).toBe(c['googleExtensionsCapabilityMessage']());
    expect(find('implementation-google-extensions-capability-retry')).toBeNull();
  });

  it('names retained themes, singular in the support noun, while the brief is unsaved', STATE_ONLY, () => {
    const c = seedPmaxCapability(null, 'ready', 'kubernetes');
    fixture.componentRef.setInput('briefPersistence', { status: 'unsaved', briefId: null, message: null, approved: false });
    fixture.detectChanges();

    expect(c['googleExtensionsCapabilityBlock']()?.kind).toBe('unsaved');
    expect(c['googleExtensionsCapabilityMessage']()).toMatch(/^Google search theme support can't be checked until this brief is saved/);

    c['googleCallouts'].set(['Free shipping']);
    fixture.detectChanges();
    expect(c['googleExtensionsCapabilityMessage']()).toMatch(/^Google ad extension and search theme support can't be checked/);
  });

  it('names retained themes in the capability notice, with Retry, when the check failed', () => {
    const retried = vi.fn();
    fixture.componentRef.instance.retryCreateCapabilities.subscribe(retried);
    const c = seedPmaxCapability(null, 'failed', 'kubernetes');

    expect(c['googleSearchThemesPayload']()).toEqual({});
    expect(c['googleExtensionsCapabilityBlock']()?.kind).toBe('failed');
    const notice = find('implementation-google-extensions-capability-failed')?.textContent ?? '';
    expect(notice).toContain('Could not confirm that Google search themes can be sent, so the 1 search theme on this brief will not be sent');
    (find('implementation-google-extensions-capability-retry')?.querySelector('button') as HTMLButtonElement).click();
    expect(retried).toHaveBeenCalledTimes(1);
  });

  it('names themes beside the extensions they are held with, and goes quiet once the capability answers yes', STATE_ONLY, () => {
    const c = seedPmaxCapability(false, 'ready', 'kubernetes');
    c['addGoogleCallout']('Hands-On Labs');
    fixture.detectChanges();

    expect(c['googleExtensionsCapabilityBlock']()?.message).toBe(
      'Google ad extensions and search themes are not available on this deployment, so the 1 callout and 1 search theme on this brief will not be sent. The campaign is created without them.'
    );

    fixture.componentRef.setInput('googleCreativeEnabled', true);
    fixture.detectChanges();
    expect(c['googleExtensionsCapabilityBlock']()).toBeNull();
    expect(c['googleSearchThemesPayload']()).toEqual({ performanceMaxSearchThemes: ['kubernetes'] });
  });
});
