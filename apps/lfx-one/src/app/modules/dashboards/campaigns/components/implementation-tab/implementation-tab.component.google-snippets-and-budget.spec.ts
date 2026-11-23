// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  DEFAULT_GOOGLE_DAILY_BUDGET_USD,
  GOOGLE_ADS_MAX_SNIPPET_HEADER_RUNES,
  GOOGLE_ADS_MAX_SNIPPET_VALUE_RUNES,
  GOOGLE_ADS_MAX_SNIPPET_VALUES,
  GOOGLE_ADS_MAX_STRUCTURED_SNIPPETS,
  GOOGLE_ADS_MIN_SNIPPET_VALUES,
} from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignImplementationDraft, CampaignStructuredSnippet } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of } from 'rxjs';
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
 * The structured-snippet sub-form: the form-side twin of the BFF guard, one case per branch of
 * upstream's `validateStructuredSnippets`, plus the accept-cases that keep the add button from
 * withholding a snippet Google would have taken.
 *
 * Snippets differ from callouts and sitelinks in one way worth stating: nothing GENERATES them.
 * There is no brief field and no carry in `campaigns.component.ts`, so the draft is the only thing
 * that moves a typed list between visits — which is why the draft tests below are not redundant
 * with the sitelink ones.
 */
describe('ImplementationTabComponent google structured snippets', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const VALUES = ['Alpha', 'Beta', 'Gamma'];

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it("trims the header and every value with Go's rules, and drops only the blank lines", STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    // 'alpha' is a case-folded repeat of 'Alpha' and is KEPT: upstream collapses repeats when it
    // counts, but the list it is sent must be the list this app judged.
    expect(c['addGoogleStructuredSnippet'](' Brands', [' Alpha ', '', 'Beta', 'Gamma', '  ', 'alpha'])).toBe(true);

    expect(c['googleStructuredSnippets']()).toEqual([{ header: 'Brands', values: ['Alpha', 'Beta', 'Gamma', 'alpha'] }]);
  });

  it.each([
    ['a blank header', '   ', VALUES],
    ['a header over the rune bound', 'A'.repeat(GOOGLE_ADS_MAX_SNIPPET_HEADER_RUNES + 1), VALUES],
    ['a value over the rune bound', 'Brands', ['Alpha', 'B'.repeat(GOOGLE_ADS_MAX_SNIPPET_VALUE_RUNES + 1), 'Gamma']],
    ['fewer than the minimum distinct values', 'Brands', Array.from({ length: GOOGLE_ADS_MIN_SNIPPET_VALUES - 1 }, (_, i) => `Value ${i + 1}`)],
    ['three values of which two are the same, which renders as two', 'Brands', ['Go', 'go', 'Rust']],
    ['more than the maximum distinct values', 'Brands', Array.from({ length: GOOGLE_ADS_MAX_SNIPPET_VALUES + 1 }, (_, i) => `Value ${i + 1}`)],
  ])('refuses %s and keeps the list empty', STATE_ONLY, (_label, header, values) => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['addGoogleStructuredSnippet'](header, values)).toBe(false);
    expect(c['googleStructuredSnippets']()).toHaveLength(0);
  });

  /**
   * The subtlety the de-duplication would otherwise hide: upstream's value loop checks the rune
   * bound BEFORE it collapses a case-folded repeat, so an over-long value that merely repeats an
   * earlier one still fails the create. Collapsing first here would send it.
   */
  it('refuses an over-long value that merely repeats an earlier one', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const long = 'B'.repeat(GOOGLE_ADS_MAX_SNIPPET_VALUE_RUNES + 1);

    expect(c['addGoogleStructuredSnippet']('Brands', ['Alpha', long, 'Gamma', long])).toBe(false);
  });

  it.each([
    ['exactly the minimum distinct values', 'Brands', Array.from({ length: GOOGLE_ADS_MIN_SNIPPET_VALUES }, (_, i) => `Value ${i + 1}`)],
    ['a header of 25 EMOJI, which is 50 UTF-16 units', '🎉'.repeat(GOOGLE_ADS_MAX_SNIPPET_HEADER_RUNES), VALUES],
    ['a non-English header, which Google publishes per locale', 'Marcas', VALUES],
    ['exactly the maximum distinct values', 'Brands', Array.from({ length: GOOGLE_ADS_MAX_SNIPPET_VALUES }, (_, i) => `Value ${i + 1}`)],
  ])('adds %s, because Google accepts it', STATE_ONLY, (_label, header, values) => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['addGoogleStructuredSnippet'](header, values)).toBe(true);
  });

  it.each([
    ['a trailing U+0085', 'Brands', 'brands'],
    ['final sigma', 'ΟΔΟΣ', 'οδοσ'],
  ])('refuses a repeated header hidden by %s, on the add and in the live warning', STATE_ONLY, (_label, first, repeat) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleStructuredSnippet'](first, VALUES);

    c['googleStructuredSnippetDraft'].set({ header: repeat, values: VALUES.join('\n') });
    expect(c['googleSnippetHeaderDuplicate']()).toBe(true);
    expect(c['addGoogleStructuredSnippet'](repeat, VALUES)).toBe(false);
    expect(c['googleStructuredSnippets']()).toHaveLength(1);
  });

  it('refuses an eleventh snippet once the campaign holds the maximum', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    for (let i = 0; i < GOOGLE_ADS_MAX_STRUCTURED_SNIPPETS; i++) c['addGoogleStructuredSnippet'](`Header ${i + 1}`, VALUES);

    expect(c['googleStructuredSnippetsFull']()).toBe(true);
    expect(c['addGoogleStructuredSnippet']('One more', VALUES)).toBe(false);
    expect(c['googleStructuredSnippets']()).toHaveLength(GOOGLE_ADS_MAX_STRUCTURED_SNIPPETS);
  });

  /**
   * "Unfilled is not yet a mistake", the rule the sitelink URL warning follows: an operator who has
   * typed a header and no values yet is mid-entry, not wrong. The add button withholds; the warning
   * only describes input that is present and unservable.
   */
  it('stays silent about too few values while the values box is empty, but disables the add', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    c['googleStructuredSnippetDraft'].set({ header: 'Brands', values: '   \n\n' });

    expect(c['googleSnippetTooFewValues']()).toBe(false);
    expect(c['googleSnippetValuesErrorId']()).toBeNull();
    expect(c['googleStructuredSnippetAddDisabled']()).toBe(true);
  });

  it('enables the add only once the draft is one Google would accept', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    c['googleStructuredSnippetDraft'].set({ header: 'Brands', values: 'Alpha\nBeta' });
    expect(c['googleStructuredSnippetAddDisabled']()).toBe(true);

    c['googleStructuredSnippetDraft'].set({ header: 'Brands', values: VALUES.join('\n') });
    expect(c['googleStructuredSnippetAddDisabled']()).toBe(false);
  });

  it.each([
    [
      'a header over the rune bound',
      { header: 'A'.repeat(GOOGLE_ADS_MAX_SNIPPET_HEADER_RUNES + 1), values: VALUES.join('\n') },
      'google-snippet-header-too-long',
      null,
    ],
    [
      'a value over the rune bound',
      { header: 'Brands', values: `Alpha\n${'B'.repeat(GOOGLE_ADS_MAX_SNIPPET_VALUE_RUNES + 1)}\nGamma` },
      null,
      'google-snippet-value-too-long',
    ],
    ['too few distinct values', { header: 'Brands', values: 'Go\ngo\nRust' }, null, 'google-snippet-too-few-values'],
    [
      'too many distinct values',
      { header: 'Brands', values: Array.from({ length: GOOGLE_ADS_MAX_SNIPPET_VALUES + 1 }, (_, i) => `Value ${i + 1}`).join('\n') },
      null,
      'google-snippet-too-many-values',
    ],
  ])('points the boxes at the message for %s, and renders it', (_label, draft, headerId, valuesId) => {
    const c = seedChannel(fixture, { includeSearch: true });
    const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

    c['googleStructuredSnippetDraft'].set(draft);
    fixture.detectChanges();

    expect(c['googleSnippetHeaderErrorId']()).toBe(headerId);
    expect(c['googleSnippetValuesErrorId']()).toBe(valuesId);
    // The id the computed names must be an element actually on the page, or `aria-describedby`
    // points at nothing and the screen reader says nothing.
    const rendered = headerId ?? valuesId;
    expect(fixture.nativeElement.querySelector(`#${rendered}`)).not.toBeNull();
    expect(find('implementation-google-snippet-header')?.getAttribute('aria-describedby')).toBe(headerId);
    expect(find('implementation-google-snippet-values')?.getAttribute('aria-describedby')).toBe(valuesId);
  });

  it('clears the sub-form only when the snippet was actually added', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    c['googleStructuredSnippetDraft'].set({ header: 'Brands', values: VALUES.join('\n') });
    c['onGoogleStructuredSnippetAdd']();
    expect(c['googleStructuredSnippetDraft']()).toEqual({ header: '', values: '' });

    // A refusal leaves every typed line in place, so the operator fixes the one thing named.
    c['googleStructuredSnippetDraft'].set({ header: 'brands', values: VALUES.join('\n') });
    c['onGoogleStructuredSnippetAdd']();
    expect(c['googleStructuredSnippetDraft']().header).toBe('brands');
    expect(c['googleStructuredSnippetDraft']().values).toBe(VALUES.join('\n'));
  });

  it('removes a snippet by index', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleStructuredSnippet']('First', VALUES);
    c['addGoogleStructuredSnippet']('Second', VALUES);

    c['removeGoogleStructuredSnippet'](0);

    expect(c['googleStructuredSnippets']().map((s: CampaignStructuredSnippet) => s.header)).toEqual(['Second']);
  });

  /**
   * The chip renders the values pre-joined by a computed, not by a `.join()` in the `@for`
   * (`docs/reviews/frontend-checklist.md`). This pins the rendered text to the live list, so the
   * indirection cannot drift from what was added or survive a removal.
   */
  it('renders each added snippet with its values joined, and drops the row on removal', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleStructuredSnippet']('Brands', VALUES);
    c['addGoogleStructuredSnippet']('Courses', ['Go', 'Rust', 'Zig']);
    fixture.detectChanges();

    const rows = (): string[] =>
      Array.from(fixture.nativeElement.querySelectorAll('[data-testid="implementation-google-structured-snippets-section"] .flex-col > span')).map(
        (el) => (el as HTMLElement).textContent?.trim() ?? ''
      );

    expect(rows()).toEqual(expect.arrayContaining(['Brands', VALUES.join(', '), 'Courses', 'Go, Rust, Zig']));

    c['removeGoogleStructuredSnippet'](0);
    fixture.detectChanges();

    expect(rows()).not.toContain(VALUES.join(', '));
    expect(rows()).toContain('Go, Rust, Zig');
  });

  /** Search only, and WITHHELD elsewhere rather than refused — exactly as the other two are. */
  it('offers snippets on Search and withholds them on a non-Search channel', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleStructuredSnippet']('Brands', VALUES);

    expect(c['googleStructuredSnippetsPayload']()).toEqual({ structuredSnippets: [{ header: 'Brands', values: VALUES }] });

    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
    fixture.detectChanges();

    expect(c['googleStructuredSnippetsPayload']()).toEqual({});
    expect(c['googleStructuredSnippets']()).toHaveLength(1);
  });

  it('omits the structuredSnippets key when nothing was added', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['googleStructuredSnippetsPayload']()).toEqual({});
  });

  /**
   * The payload copies `values` as its own array, not just the entry around it: a shallow spread of
   * the entry would hand the request the very array the chip list is still holding.
   */
  it('does not share the payload values array with the live list', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleStructuredSnippet']('Brands', VALUES);

    const sent = c['googleStructuredSnippetsPayload']() as { structuredSnippets: CampaignStructuredSnippet[] };
    sent.structuredSnippets[0].values.push('Delta');

    expect(c['googleStructuredSnippets']()[0].values).toEqual(VALUES);
  });

  it('says out loud that snippets are withheld after a switch away from Search, in the notice and its live region', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
    expect(find('implementation-google-structured-snippets-withheld-live')?.textContent?.trim()).toBe('');

    c['addGoogleStructuredSnippet']('Brands', VALUES);
    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
    fixture.detectChanges();

    const notice = find('implementation-google-structured-snippets-withheld')?.textContent ?? '';
    expect(notice).toContain('Demand Gen campaigns do not take structured snippets');
    expect(notice).toContain('the 1 you added');
    expect(find('implementation-google-structured-snippets-withheld-live')?.textContent?.trim()).toBe(c['googleStructuredSnippetsWithheldWarning']());
  });

  it('shows no snippets notice when none were added', () => {
    const c = seedChannel(fixture, { includeDemandGen: true });

    expect(c['googleStructuredSnippetsWithheldWarning']()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-structured-snippets-withheld"]')).toBeNull();
  });

  /** The capability block counts all three lists, so its sentence stays true for a snippet-only brief. */
  it('counts the snippets in the capability block when extensions cannot be sent', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleStructuredSnippet']('Brands', VALUES);
    fixture.componentRef.setInput('googleCreativeEnabled', false);
    fixture.detectChanges();

    const block = fixture.nativeElement.querySelector('[data-testid="implementation-google-extensions-capability-unsupported"]')?.textContent ?? '';
    expect(block).toContain('1 structured snippet');
    // Not "generated for this brief": snippets are typed by hand, and that clause would be false.
    expect(block).not.toContain('generated');
  });

  /** Through `submit()`, so deleting the payload spread fails here and not only in a helper test. */
  it.each([
    ['Search', { includeSearch: true }, [{ header: 'Brands', values: VALUES }]],
    ['Demand Gen, after a switch from Search', { includeDemandGen: true }, undefined],
  ])('sends the snippets on a submitted %s create only when the channel takes them', STATE_ONLY, async (_label, channel, expected) => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleStructuredSnippet']('Brands', VALUES);
    c['campaignForm'].patchValue({ includeSearch: false, ...channel });
    fixture.detectChanges();
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    expect(createCampaign).toHaveBeenCalled();
    expect((createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>)['structuredSnippets']).toEqual(expected);
  });

  /** The ONLY thing that carries a typed snippet list between visits — nothing generates one. */
  it('round-trips the snippets through a draft', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    c['addGoogleStructuredSnippet']('Brands', VALUES);

    expect(emitted?.googleStructuredSnippets).toEqual([{ header: 'Brands', values: VALUES }]);

    c['googleStructuredSnippets'].set([]);
    restoreGoogleDraft(fixture, c, { googleStructuredSnippets: [{ header: 'Brands', values: [...VALUES] }] });

    expect(c['googleStructuredSnippets']()).toEqual([{ header: 'Brands', values: VALUES }]);
  });

  /** `values` copied too, for the reason the entries are: it is an array INSIDE the entry. */
  it('does not share the restored entries or their values with the draft', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const saved = [{ header: 'Brands', values: [...VALUES] }];

    restoreGoogleDraft(fixture, c, { googleStructuredSnippets: saved });
    c['googleStructuredSnippets']()[0].header = 'Edited';
    c['googleStructuredSnippets']()[0].values.push('Delta');

    expect(saved[0].header).toBe('Brands');
    expect(saved[0].values).toEqual(VALUES);
  });

  it('leaves the list alone when the draft carries no snippets key', STATE_ONLY, () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleStructuredSnippet']('Brands', VALUES);

    restoreGoogleDraft(fixture, c, {});

    expect(c['googleStructuredSnippets']()).toHaveLength(1);
  });
});

/**
 * The Google budget is DAILY (#4847). campaign-service creates it with no period, which Google treats
 * as daily, so the brief's planning TOTAL is divided over the flight the tab opens with, and the
 * flight total the daily figure implies is shown beside it.
 */
describe('ImplementationTabComponent google daily budget', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  let c: Record<string, any>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(tabComponentUnderTest());
    fixture.detectChanges();
    await fixture.whenStable();
    c = fixture.componentInstance as unknown as Record<string, any>;
  });

  /** Mount a brief through the real `populateFromBrief` path, with no draft to restore over it. */
  function mountBrief(patch: Record<string, unknown>): void {
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      ...patch,
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
  }

  const text = (testId: string): string | null =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

  it('labels the field as a daily budget', () => {
    mountBrief({ totalBudget: 900 });

    const label = (fixture.nativeElement as HTMLElement).querySelector('label[for="implementation-budget"]');
    expect(label?.textContent?.trim()).toBe('Google Ads Daily Budget');
  });

  it("seeds the daily budget from the brief's total divided over the opening flight", () => {
    mountBrief({ totalBudget: 900 });

    // The tab opens on today to today + 30: 31 days with both ends counted, and 900 / 31 = 29.03 rounded down.
    expect(c['campaignForm'].controls.budgetUsd.value).toBe(29.03);
    expect(text('implementation-budget-hint')).toBe(
      "An average daily amount, in the ad account's currency. About 899.93 over 31 days, start and end days included. The brief plans 900 in total."
    );
  });

  it.each([[null], [undefined], [0], [-50]])('opens on the default daily budget when the brief total is %j', (totalBudget) => {
    mountBrief({ totalBudget });

    expect(c['campaignForm'].controls.budgetUsd.value).toBe(DEFAULT_GOOGLE_DAILY_BUDGET_USD);
    expect(c['googleBriefTotalBudget']()).toBeNull();
    expect(text('implementation-budget-hint')).not.toContain('The brief plans');
  });

  /**
   * Neither rounded up past the plan nor seeded under the minimum (PR #5387 review): 10 over the
   * 31-day flight is 0.32 a day, which opened Create blocked, so the flight is brought forward to the
   * 10 days the total funds at 1 a day.
   */
  it('brings the flight forward rather than seed a daily figure below one or round it up past the plan', () => {
    mountBrief({ totalBudget: 10 });

    expect(c['campaignForm'].controls.budgetUsd.value).toBe(1);
    const end = new Date(Date.parse(`${c['todayDate']}T00:00:00Z`) + 9 * 86_400_000).toISOString().slice(0, 10);
    expect(c['campaignForm'].controls.endDate.value).toBe(end);
    expect(text('implementation-budget-error')).toBeNull();
    expect(text('implementation-budget-hint')).toContain('About 10 over 10 days');
  });

  it('recomputes the flight total as the budget and dates change', () => {
    mountBrief({ totalBudget: 900 });

    c['campaignForm'].patchValue({ budgetUsd: 10, startDate: '2026-12-01', endDate: '2026-12-10' });
    fixture.detectChanges();
    expect(text('implementation-budget-hint')).toContain('About 100 over 10 days, start and end days included.');

    c['campaignForm'].patchValue({ endDate: '2026-12-01' });
    fixture.detectChanges();
    expect(text('implementation-budget-hint')).toContain('About 10 over 1 day, start and end days included.');
  });

  it.each([
    ['an emptied budget', { budgetUsd: null }],
    ['an end before the start', { startDate: '2026-12-10', endDate: '2026-12-01' }],
    ['an emptied date', { endDate: '' }],
  ])('drops the flight total for %s', (_label, patch) => {
    mountBrief({ totalBudget: 900 });

    c['campaignForm'].patchValue(patch);
    fixture.detectChanges();

    expect(c['googleBudgetFlight']()).toBeNull();
    expect(text('implementation-budget-hint')).not.toContain('About');
  });

  it.each([[null], [0], [0.5]])('names the minimum under the field for a daily budget of %j', (budgetUsd) => {
    mountBrief({ totalBudget: 900 });

    c['campaignForm'].patchValue({ budgetUsd });
    fixture.detectChanges();

    expect(text('implementation-budget-error')).toBe('Enter a daily budget of at least 1.');
  });

  it('shows no budget error at the minimum', () => {
    mountBrief({ totalBudget: 900 });

    c['campaignForm'].patchValue({ budgetUsd: 1 });
    fixture.detectChanges();

    expect(text('implementation-budget-error')).toBeNull();
  });

  it("drops the previous brief's planned total when a brief without one is handed over", () => {
    mountBrief({ totalBudget: 900 });
    expect(text('implementation-budget-hint')).toContain('The brief plans 900 in total.');

    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'OSS NA 2027', slug: 'oss-na-2027', registrationUrl: 'https://example.org', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.budgetUsd.value).toBe(DEFAULT_GOOGLE_DAILY_BUDGET_USD);
    expect(text('implementation-budget-hint')).not.toContain('The brief plans');
  });

  it('shows neither the field nor its error when Google is not selected', () => {
    // A daily figure below the minimum would show the error; the seed never sets one, so it is typed.
    mountBrief({ totalBudget: 10, selectedPlatforms: ['meta-ads'] });
    c['campaignForm'].patchValue({ budgetUsd: 0.32 });
    fixture.detectChanges();

    expect(c['campaignForm'].controls.budgetUsd.invalid).toBe(true);
    expect(text('implementation-budget-hint')).toBeNull();
    expect(text('implementation-budget-error')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-budget"]')).toBeNull();
  });

  it('sends the daily figure on screen, not the brief total', STATE_ONLY, () => {
    const seeded = seedChannel(fixture, { includeSearch: true });
    seeded['campaignForm'].patchValue({ budgetUsd: 29.03 });
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: '' }) as never);

    seeded['submit']();

    expect(createCampaign).toHaveBeenCalledTimes(1);
    expect(createCampaign.mock.calls[0][0]).toMatchObject({ budgetUsd: 29.03 });
  });

  /** The error is announced with the field, not only shown under it (#4848, review of #4852). */
  it('ties the budget error to the field only while it shows', () => {
    mountBrief({ totalBudget: 900 });
    const input = (): HTMLElement => (fixture.nativeElement as HTMLElement).querySelector('#implementation-budget') as HTMLElement;

    expect(input().getAttribute('aria-describedby')).toBe('implementation-budget-hint');
    expect(input().getAttribute('aria-invalid')).toBeNull();

    c['campaignForm'].patchValue({ budgetUsd: 0 });
    fixture.detectChanges();
    expect(input().getAttribute('aria-describedby')).toBe('implementation-budget-hint implementation-budget-error');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect((fixture.nativeElement as HTMLElement).querySelector('#implementation-budget-error')?.textContent?.trim()).toBe(
      'Enter a daily budget of at least 1.'
    );
  });
});
