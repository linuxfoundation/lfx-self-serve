// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  GOOGLE_ADS_MAX_SITELINK_DESCRIPTION_RUNES,
  GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES,
  GOOGLE_ADS_MAX_SITELINKS,
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_REQUEST_KEYS,
  GOOGLE_TYPED_IMAGE_PROBE_TIMEOUT_MS,
  GOOGLE_CREATIVE_SECTION_TITLES,
} from '@lfx-one/shared/constants';
import type { CampaignImplementationDraft, CampaignSitelink } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { configureGoogleTab, restoreGoogleDraft, seedChannel, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * The sitelink extensions.
 *
 * Every bound and refusal here mirrors `validateSitelinks`
 * (`internal/platform/googleads/assets.go`), one test per branch. The guard runs inside
 * `validateAssetPlan`, inside `preflightCampaignKind`, BEFORE the budget mutate — so each of these
 * costs the whole campaign upstream rather than just the sitelink.
 */
describe('ImplementationTabComponent google sitelinks', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const sitelink = (text: string, overrides: Partial<CampaignSitelink> = {}): CampaignSitelink => ({
    text,
    description1: '',
    description2: '',
    finalUrl: 'https://events.example.org/register',
    ...overrides,
  });

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  /**
   * Each Google extension section names its first box precisely (#3644). The heading with its
   * "(n/max)" count names the GROUP, through `aria-labelledby`, and is no longer the `<label for>`
   * of that box. Bound that way it became the box's accessible name, so a screen reader announced
   * "Google Sitelinks (0/20)" where every sibling box gives a field name. Each id is resolved
   * against the rendered DOM, so a renamed heading leaves no dangling reference.
   */
  it.each([
    ['callouts', 'google-callout-add', 'Callout text', 'Google Callouts'],
    ['sitelinks', 'google-sitelink-text', 'Sitelink link text', 'Google Sitelinks'],
    ['structured-snippets', 'google-snippet-header', 'Structured snippet header', 'Google Structured Snippets'],
    ['call-extensions', 'google-call-country', 'Call extension country code', 'Google Call Extensions'],
    ['promotions', 'google-promotion-target', 'Promotion target', 'Google Promotions'],
    ['prices', 'google-price-type', 'Price type', 'Google Price Extensions'],
  ])('names the %s group by its heading and its first box by the field', (section, controlId, name, heading) => {
    seedChannel(fixture, { includeSearch: true });
    const root: HTMLElement = fixture.nativeElement;
    const group = root.querySelector(`[data-testid="implementation-google-${section}-section"]`);

    expect(group?.getAttribute('role')).toBe('group');
    const headingEl = root.querySelector(`#${group?.getAttribute('aria-labelledby')}`);
    expect(headingEl?.textContent).toContain(heading);
    expect(root.querySelector(`label[for="${controlId}"]`)).toBeNull();
    expect(root.querySelector(`#${controlId}`)?.getAttribute('aria-label')).toBe(name);
  });

  /**
   * Every box in the sub-form is reachable by a screen reader on its own terms: each carries an
   * `aria-label` — a placeholder is not an accessible name and vanishes as soon as the operator
   * types. The ids are asserted against the message elements actually rendered, so a rename on
   * either side fails the test rather than leaving `aria-describedby` pointing at nothing.
   */
  it('names every box and points each at whichever of its messages is rendered', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleSitelink'](sitelink('Register now'));
    const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

    expect(find('implementation-google-sitelink-url')?.getAttribute('aria-label')).toBe('Sitelink destination URL');
    expect(find('implementation-google-sitelink-description1')?.getAttribute('aria-label')).toBe('Sitelink description line 1');
    expect(find('implementation-google-sitelink-description2')?.getAttribute('aria-label')).toBe('Sitelink description line 2');
    expect(find('implementation-google-sitelink-text')?.getAttribute('aria-describedby')).toBeNull();

    c['googleSitelinkDraft'].set(sitelink('A'.repeat(GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES + 1)));
    fixture.detectChanges();
    expect(find('implementation-google-sitelink-text')?.getAttribute('aria-describedby')).toBe(find('implementation-google-sitelink-too-long')?.id);

    c['googleSitelinkDraft'].set(sitelink('register now'));
    fixture.detectChanges();
    expect(find('implementation-google-sitelink-text')?.getAttribute('aria-describedby')).toBe(find('implementation-google-sitelink-duplicate')?.id);

    // Both description boxes point at the ONE line describing the pair — the rule they break is
    // about the pair, so naming it on only the box last typed in would be the wrong half.
    c['googleSitelinkDraft'].set(sitelink('Agenda', { description1: 'Talks and workshops' }));
    fixture.detectChanges();
    const halfDescribed = find('implementation-google-sitelink-half-described')?.id;
    expect(find('implementation-google-sitelink-description1')?.getAttribute('aria-describedby')).toBe(halfDescribed);
    expect(find('implementation-google-sitelink-description2')?.getAttribute('aria-describedby')).toBe(halfDescribed);

    c['googleSitelinkDraft'].set(sitelink('Agenda', { finalUrl: 'events.example.org/agenda' }));
    fixture.detectChanges();
    expect(find('implementation-google-sitelink-url')?.getAttribute('aria-describedby')).toBe(find('implementation-google-sitelink-url-invalid')?.id);
  });

  it('trims an added sitelink and drops the two blank description lines', () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['addGoogleSitelink'](sitelink('  Register now  ', { finalUrl: '  https://events.example.org/register  ' }))).toBe(true);

    // Descriptions OMITTED, not sent as empty strings: absent on both lines is one of the two
    // legal states upstream recognises, where one line present and one empty is not.
    expect(c['googleSitelinks']()).toEqual([{ text: 'Register now', finalUrl: 'https://events.example.org/register' }]);
  });

  it.each([
    ['no link text', sitelink('   ')],
    ['no destination', sitelink('Register', { finalUrl: '  ' })],
    ['a destination with no scheme', sitelink('Register', { finalUrl: 'events.example.org/register' })],
    ['a destination carrying embedded credentials', sitelink('Register', { finalUrl: 'https://user:pw@events.example.org/register' })],
  ])('refuses a sitelink with %s', (_label, entry) => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['addGoogleSitelink'](entry)).toBe(false);
    expect(c['googleSitelinks']()).toEqual([]);
  });

  it('refuses a sitelink that repeats an existing link text in a different case', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleSitelink'](sitelink('Register Now'));

    expect(c['addGoogleSitelink'](sitelink('register now'))).toBe(false);
    expect(c['googleSitelinks']()).toHaveLength(1);
  });

  it('refuses an add at the cap', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    for (let i = 0; i < GOOGLE_ADS_MAX_SITELINKS; i++) c['addGoogleSitelink'](sitelink(`Sitelink ${i + 1}`));

    expect(c['addGoogleSitelink'](sitelink('One more'))).toBe(false);
    expect(c['googleSitelinks']()).toHaveLength(GOOGLE_ADS_MAX_SITELINKS);
  });

  /**
   * Runes, not UTF-16 units — the same hazard the callouts carry. 25 astral-plane characters are
   * link text upstream accepts; counted with `.length` they would be 50 and refused for no reason.
   */
  it('accepts 25-emoji link text and refuses 26 characters', () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['addGoogleSitelink'](sitelink('🎉'.repeat(GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES)))).toBe(true);
    expect(c['addGoogleSitelink'](sitelink('A'.repeat(GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES + 1)))).toBe(false);

    expect(c['googleSitelinks']()).toHaveLength(1);
  });

  /** Google renders the two lines together and rejects an asset carrying only one. */
  it.each([
    ['only the first line', { description1: 'Seats are limited' }],
    ['only the second line', { description2: 'Seats are limited' }],
  ])('refuses a sitelink described on %s', (_label, overrides) => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['addGoogleSitelink'](sitelink('Register', overrides))).toBe(false);
  });

  /**
   * The 35-rune bound is PER LINE, not on the two together: upstream measures each line with its
   * own `utf8.RuneCountInString`. Summing them would refuse this 70-rune pair, which it accepts.
   */
  it('accepts both description lines at exactly 35 runes and refuses a 36th on either', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const line = 'A'.repeat(GOOGLE_ADS_MAX_SITELINK_DESCRIPTION_RUNES);

    expect(c['addGoogleSitelink'](sitelink('Register', { description1: line, description2: line }))).toBe(true);
    expect(c['addGoogleSitelink'](sitelink('Tickets', { description1: line, description2: `${line}B` }))).toBe(false);
  });

  it('warns on the sub-form in progress and withholds the add button until both required fields are filled', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleSitelink'](sitelink('Register Now'));

    // An empty sub-form is not yet a mistake — withheld, not warned about.
    expect(c['googleSitelinkUrlInvalid']()).toBe(false);
    expect(c['googleSitelinkAddDisabled']()).toBe(true);

    c['googleSitelinkDraft'].set({ text: '  register now ', description1: 'One line only', description2: '', finalUrl: 'not a url' });

    expect(c['googleSitelinkDuplicate']()).toBe(true);
    expect(c['googleSitelinkDescriptionHalfFilled']()).toBe(true);
    expect(c['googleSitelinkUrlInvalid']()).toBe(true);
    expect(c['googleSitelinkAddDisabled']()).toBe(true);

    c['googleSitelinkDraft'].set({
      text: '🎉'.repeat(GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES + 1),
      description1: '',
      description2: '',
      finalUrl: 'https://events.example.org/x',
    });

    expect(c['googleSitelinkTextLength']()).toBe(GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES + 1);
    expect(c['googleSitelinkTextTooLong']()).toBe(true);
  });

  /** Cleared ONLY on success, so a refused entry stays editable beside the warning that named it. */
  it('clears the sub-form on a successful add and leaves it standing on a refusal', () => {
    const c = seedChannel(fixture, { includeSearch: true });

    c['googleSitelinkDraft'].set(sitelink('Register'));
    c['onGoogleSitelinkAdd']();
    expect(c['googleSitelinkDraft']()).toEqual({ text: '', description1: '', description2: '', finalUrl: '' });

    c['googleSitelinkDraft'].set(sitelink('register'));
    c['onGoogleSitelinkAdd']();
    expect(c['googleSitelinkDraft']().text).toBe('register');
  });

  it('removes a sitelink by index', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleSitelink'](sitelink('First'));
    c['addGoogleSitelink'](sitelink('Second'));

    c['removeGoogleSitelink'](0);

    expect(c['googleSitelinks']().map((s: CampaignSitelink) => s.text)).toEqual(['Second']);
  });

  /**
   * Search and Demand Gen (`GOOGLE_CHANNELS_WITH_SITELINKS`; `validateAssetPlan` takes sitelinks alone
   * on Demand Gen since campaign-service v1.0.31), and WITHHELD elsewhere rather than refused.
   */
  it.each([
    ['Demand Gen', { includeDemandGen: true }, true],
    ['Display', { includeDisplay: true }, false],
    ['Performance Max', { includePerformanceMax: true }, true],
  ])('offers sitelinks on Search, and after a switch to %s sends them only where the channel takes them', (_label, channel, sent) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleSitelink'](sitelink('Register'));

    expect(c['googleSitelinksAvailable']()).toBe(true);
    expect(c['googleSitelinksPayload']()).toEqual({ sitelinks: [{ text: 'Register', finalUrl: 'https://events.example.org/register' }] });

    c['campaignForm'].patchValue({ includeSearch: false, ...channel });
    fixture.detectChanges();

    expect(c['googleSitelinksAvailable']()).toBe(sent);
    expect(c['googleSitelinksPayload']()).toEqual(sent ? { sitelinks: [{ text: 'Register', finalUrl: 'https://events.example.org/register' }] } : {});
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-sitelinks-section"]') !== null).toBe(sent);
    // Held, not discarded — the list is still there if the operator switches back.
    expect(c['googleSitelinks']()).toHaveLength(1);
  });

  /**
   * Sitelinks ONLY: upstream refuses every other extension on Demand Gen, so the callout, snippet,
   * call, promotion and price controls stay hidden there while the sitelink control shows.
   */
  it('shows the sitelink control on Demand Gen and none of the other extension controls', () => {
    seedChannel(fixture, { includeDemandGen: true });
    const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

    expect(find('implementation-google-sitelinks-section')).not.toBeNull();
    for (const id of ['callouts', 'structured-snippets', 'call-extensions', 'promotions', 'prices']) {
      expect(find(`implementation-google-${id}-section`)).toBeNull();
    }
  });

  /** Omitted rather than sent empty, so the upstream default is reached by the absent-key route. */
  it('omits the sitelinks key when nothing was added', () => {
    const c = seedChannel(fixture, { includeSearch: true });

    expect(c['googleSitelinksPayload']()).toEqual({});
  });

  it('round-trips the sitelinks through a draft', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    let emitted: CampaignImplementationDraft | undefined;
    fixture.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (emitted = d));
    c['addGoogleSitelink'](sitelink('Register'));

    expect(emitted?.googleSitelinks).toEqual([{ text: 'Register', finalUrl: 'https://events.example.org/register' }]);

    c['googleSitelinks'].set([]);
    restoreGoogleDraft(fixture, c, { googleSitelinks: [{ text: 'Register', finalUrl: 'https://events.example.org/register' }] });

    expect(c['googleSitelinks']()).toHaveLength(1);
  });

  /**
   * COPIED out of the draft ENTRY BY ENTRY, not just array-spread: a sitelink is an object, so a
   * shallow spread would still hand the draft's own entries over and let an edit here reach back
   * into the stored draft.
   */
  it('does not share the restored entries with the draft', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const saved = [sitelink('Register')];

    restoreGoogleDraft(fixture, c, { googleSitelinks: saved });
    c['googleSitelinks']()[0].text = 'Edited';

    expect(saved[0].text).toBe('Register');
  });

  /** A draft saved before this section shipped carries no key, and must not clear the list. */
  it.each([
    ['a trailing U+0085', 'Register', 'register\u0085'],
    ['final sigma', 'ΟΔΟΣ', 'οδοσ'],
  ])('refuses a repeated link text hidden by %s, on the add and in the live warning', (_label, first, repeat) => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleSitelink'](sitelink(first));

    c['googleSitelinkDraft'].set(sitelink(repeat));
    expect(c['googleSitelinkDuplicate']()).toBe(true);
    expect(c['addGoogleSitelink'](sitelink(repeat))).toBe(false);
    expect(c['googleSitelinks']()).toHaveLength(1);
  });

  it.each([
    ['a semicolon in the query', 'https://events.example.org/register?a=1;b=2'],
    ['a stray percent sign', 'https://events.example.org/50%off'],
    ['no `//` after the scheme', 'https:events.example.org/register'],
    ['a tab inside the path', 'https://events.example.org/reg\tister'],
  ])("refuses a destination with %s, which Go's URL parser refuses and `new URL()` accepts", (_label, finalUrl) => {
    const c = seedChannel(fixture, { includeSearch: true });

    c['googleSitelinkDraft'].set(sitelink('Register', { finalUrl }));
    expect(c['googleSitelinkUrlInvalid']()).toBe(true);
    expect(c['addGoogleSitelink'](sitelink('Register', { finalUrl }))).toBe(false);
  });

  /** BYTES, as Go's `len()` counts them: 1,100 two-byte characters cross 2,084 at half the length. */
  it('warns on and refuses a destination over the 2084-byte limit, pointing the box at the message', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const finalUrl = `https://events.example.org/${'é'.repeat(1100)}`;
    const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

    c['googleSitelinkDraft'].set(sitelink('Register', { finalUrl }));
    fixture.detectChanges();

    expect(c['googleSitelinkUrlBytesOver']()).toBe(new TextEncoder().encode(finalUrl).length);
    expect(c['googleSitelinkAddDisabled']()).toBe(true);
    expect(find('implementation-google-sitelink-url')?.getAttribute('aria-describedby')).toBe(find('implementation-google-sitelink-url-too-long')?.id);
    expect(c['addGoogleSitelink'](sitelink('Register', { finalUrl }))).toBe(false);
  });

  it('says out loud that sitelinks are withheld after a switch to Display, in the notice and its live region', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
    // Mounted, empty, before there is anything to say.
    expect(find('implementation-google-sitelinks-withheld-live')?.textContent?.trim()).toBe('');

    c['addGoogleSitelink'](sitelink('Register'));
    c['campaignForm'].patchValue({ includeSearch: false, includeDisplay: true });
    fixture.detectChanges();

    const notice = find('implementation-google-sitelinks-withheld')?.textContent ?? '';
    expect(notice).toContain('Display campaigns do not take sitelinks');
    expect(notice).toContain('the 1 you added');
    expect(notice).toContain('Switch to Search, Demand Gen or Performance Max to keep them');
    expect(find('implementation-google-sitelinks-withheld-live')?.textContent?.trim()).toBe(c['googleSitelinksWithheldWarning']());
    expect(find('implementation-google-sitelinks-withheld')?.getAttribute('role')).toBeNull();
  });

  it('shows no sitelinks notice when none were added', () => {
    const c = seedChannel(fixture, { includeDisplay: true });

    expect(c['googleSitelinksWithheldWarning']()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-sitelinks-withheld"]')).toBeNull();
  });

  /** Demand Gen takes them, so a list carried there is sent, not withheld, and nothing says otherwise. */
  it('shows no sitelinks notice on Demand Gen, where they are sent', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleSitelink'](sitelink('Register'));
    c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
    fixture.detectChanges();

    expect(c['googleSitelinksWithheldWarning']()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-google-sitelinks-withheld"]')).toBeNull();
  });

  /** The sitelink half of the channel-vs-capability split the callout tests describe in full. */
  it('still names the channel while the capability answer has not come back', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleSitelink'](sitelink('Register'));
    c['campaignForm'].patchValue({ includeSearch: false, includeDisplay: true });
    fixture.componentRef.setInput('googleCreativeEnabled', null);
    fixture.detectChanges();

    expect(c['googleSitelinksWithheldWarning']()).toContain('Display campaigns do not take sitelinks');
    expect(c['googleExtensionsCapabilityBlock']()).toBeNull();
  });

  it('never tells Search it takes no sitelinks while the capability is unanswered', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleSitelink'](sitelink('Register'));
    fixture.componentRef.setInput('googleCreativeEnabled', null);
    fixture.detectChanges();

    expect(c['googleSitelinksWithheldWarning']()).toBeNull();
    expect(c['googleExtensionsCapabilityBlock']()).not.toBeNull();
  });

  /** Through `submit()`, so deleting the payload spread fails here and not only in a helper test. */
  it.each([
    ['Search', { includeSearch: true }, [{ text: 'Register', finalUrl: 'https://events.example.org/register' }]],
    ['Demand Gen, after a switch from Search', { includeDemandGen: true }, [{ text: 'Register', finalUrl: 'https://events.example.org/register' }]],
    ['Display, after a switch from Search', { includeDisplay: true }, undefined],
  ])('sends the sitelinks on a submitted %s create only when the channel takes them', async (_label, channel, expected) => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleSitelink'](sitelink('Register'));
    c['campaignForm'].patchValue({ includeSearch: false, ...channel });
    fixture.detectChanges();
    expect(c['canSubmit']()).toBe(true);

    c['submit']();
    await fixture.whenStable();

    expect(createCampaign).toHaveBeenCalled();
    expect((createCampaign.mock.calls[0][0] as unknown as Record<string, unknown>)['sitelinks']).toEqual(expected);
  });

  /**
   * A Demand Gen create with no sitelinks entered is byte-identical to one built before sitelinks
   * reached Demand Gen — and lists Demand Gen does not take (here a callout and a snippet typed under
   * Search) are held, not sent, so they leave it identical too.
   */
  it('builds a byte-identical Demand Gen request when no sitelinks are entered, whatever else is held', async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1' }) as never);
    const submitDemandGen = async (seed: (c: Record<string, any>) => void): Promise<string> => {
      const c = seedChannel(fixture, { includeSearch: true });
      seed(c);
      c['campaignForm'].patchValue({ includeSearch: false, includeDemandGen: true });
      fixture.detectChanges();
      c['submit']();
      await fixture.whenStable();
      return JSON.stringify(createCampaign.mock.calls[createCampaign.mock.calls.length - 1][0]);
    };

    const bare = await submitDemandGen(() => undefined);
    const held = await submitDemandGen((c) => {
      c['addGoogleCallout']('Free To Attend');
      c['addGoogleStructuredSnippet']('Types', ['Talks', 'Labs', 'Demos']);
    });

    expect(bare).not.toContain('sitelinks');
    expect(held).toBe(bare);
  });

  it('leaves the list alone when the draft carries no sitelinks key', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['addGoogleSitelink'](sitelink('Register'));

    restoreGoogleDraft(fixture, c, {});

    expect(c['googleSitelinks']()).toHaveLength(1);
  });
});

/**
 * Pasted Google image URLs are checked in the browser when the operator leaves the field: an
 * advisory line only, since campaign-service downloads and checks every pasted URL before anything
 * is created. jsdom never loads an image, so `Image` is a controllable fake.
 */
describe('ImplementationTabComponent pasted Google image URL check', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  let images: FakeImage[];

  class FakeImage {
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public naturalWidth = 0;
    public naturalHeight = 0;
    public src = '';
    public referrerPolicy = '';
    public constructor() {
      images.push(this);
    }
    public load(width: number, height: number): void {
      this.naturalWidth = width;
      this.naturalHeight = height;
      this.onload?.();
    }
    public fail(): void {
      this.onerror?.();
    }
    /** What the component calls to cancel a download; a real browser stops fetching when `src` goes. */
    public removeAttribute(name: string): void {
      if (name === 'src') this.src = '';
    }
  }

  const group = GOOGLE_CREATIVE_REQUEST_KEYS.display;
  const key = `${group}.marketingImages`;
  const marketingField = (): Record<string, unknown> =>
    GOOGLE_CREATIVE_FIELD_SPECS.display.find((f) => f.control === 'marketingImages') as Record<string, unknown>;

  function setUrls(c: Record<string, any>, value: string): void {
    c['campaignForm'].controls[group].controls['marketingImages'].setValue(value);
  }

  function warning(c: Record<string, any>): string | undefined {
    return (c['googleTypedImageWarnings']() as Record<string, string>)[key];
  }

  beforeEach(async () => {
    images = [];
    vi.stubGlobal('Image', FakeImage);
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('names a pasted image that misses the slot shape, with its measured size', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://cdn.example.com/square.png');
    c['onGoogleImageFieldBlur'](group, marketingField());
    expect(images.map((i) => i.src)).toEqual(['https://cdn.example.com/square.png']);
    expect(warning(c)).toBeUndefined();

    images[0].load(300, 300);

    // Only the pixel size is measured here; the requirement, byte cap included, is what the slot needs.
    expect(warning(c)).toContain('Measured here: https://cdn.example.com/square.png (300x300) does not fit. This slot needs 1.91:1');
    // "Likely": a browser applies EXIF rotation that campaign-service's decoder does not.
    expect(warning(c)).toContain('Create will likely be refused for it;');
    expect(images[0]).toMatchObject({ referrerPolicy: 'no-referrer' });
  });

  it('says nothing about a pasted image that fits', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://cdn.example.com/wide.png');
    c['onGoogleImageFieldBlur'](group, marketingField());
    images[0].load(1200, 628);

    expect(warning(c)).toBeUndefined();
  });

  it('reports an image that will not load as unchecked, not as wrong', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://cdn.example.com/hotlinked.png');
    c['onGoogleImageFieldBlur'](group, marketingField());
    images[0].fail();

    expect(warning(c)).toBe('Could not be loaded here, so not checked: https://cdn.example.com/hotlinked.png. campaign-service checks it again at Create.');
  });

  it('gives up on a slow host after the timeout, as unchecked', () => {
    vi.useFakeTimers();
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://slow.example.com/a.png');
    c['onGoogleImageFieldBlur'](group, marketingField());

    vi.advanceTimersByTime(GOOGLE_TYPED_IMAGE_PROBE_TIMEOUT_MS - 1);
    expect(warning(c)).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(warning(c)).toContain('Could not be loaded here');
    // The timeout cancels the download, so a slow host is not left sending an image nothing reads.
    expect(images[0].src).toBe('');
    // A late load after the timeout changes nothing.
    images[0].load(300, 300);
    expect(warning(c)).not.toContain('does not fit');
  });

  it('stops a probe still loading when the tab is destroyed, and records nothing after', () => {
    vi.useFakeTimers();
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://slow.example.com/a.png');
    const timersBefore = vi.getTimerCount();
    c['onGoogleImageFieldBlur'](group, marketingField());
    expect(vi.getTimerCount()).toBe(timersBefore + 1);
    const probes = c['googleTypedImageProbes'] as () => Record<string, { state: string }>;
    expect(probes()['https://slow.example.com/a.png']).toEqual({ state: 'checking' });

    fixture.destroy();

    // Only the probe's own timer is counted: the tab's other timers are not this probe's to clear.
    expect(vi.getTimerCount()).toBe(timersBefore);
    expect(images[0].onload).toBeNull();
    expect(images[0].onerror).toBeNull();
    expect(images[0].src).toBe('');
    vi.advanceTimersByTime(GOOGLE_TYPED_IMAGE_PROBE_TIMEOUT_MS);
    expect(probes()['https://slow.example.com/a.png']).toEqual({ state: 'checking' });
  });

  it('releases its destroy callback once the answer is in', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const destroyRef = c['destroyRef'] as DestroyRef;
    const register = destroyRef.onDestroy.bind(destroyRef);
    const releases: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(destroyRef, 'onDestroy').mockImplementation((callback: () => void) => {
      const release = vi.fn(register(callback));
      releases.push(release);
      return release;
    });
    setUrls(c, 'https://cdn.example.com/wide.png');
    c['onGoogleImageFieldBlur'](group, marketingField());
    expect(releases).toHaveLength(1);
    expect(releases[0]).not.toHaveBeenCalled();

    images[0].load(1200, 628);

    // One callback per probe would otherwise pile up for the life of the tab.
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });

  it('drops the warning when the URL is removed', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://cdn.example.com/square.png');
    c['onGoogleImageFieldBlur'](group, marketingField());
    images[0].load(300, 300);
    expect(warning(c)).toBeDefined();

    setUrls(c, '');
    expect(warning(c)).toBeUndefined();
  });

  /**
   * A settled URL is probed again, so a host that answers differently now is heard. In a real browser a
   * same-URL replacement may still come back from the cache, which is why this is best effort; here the
   * fake answers whatever the test loads.
   */
  it('probes a settled URL again on the next blur and shows the newer answer', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://cdn.example.com/hero.png');
    c['onGoogleImageFieldBlur'](group, marketingField());
    images[0].load(300, 300);
    expect(warning(c)).toContain('(300x300)');

    c['onGoogleImageFieldBlur'](group, marketingField());
    expect(images).toHaveLength(2);
    // The last answer stays up while the URL is checked again, rather than blanking until it settles.
    expect(warning(c)).toContain('(300x300)');
    // Still in flight, so leaving the field again starts no third probe.
    c['onGoogleImageFieldBlur'](group, marketingField());
    expect(images).toHaveLength(2);
    images[1].load(1200, 628);
    expect(warning(c)).toBeUndefined();
  });

  it('retries a URL that could not be loaded', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://flaky.example.com/a.png');
    c['onGoogleImageFieldBlur'](group, marketingField());
    images[0].fail();
    expect(warning(c)).toContain('Could not be loaded here');

    c['onGoogleImageFieldBlur'](group, marketingField());
    images[1].load(1200, 628);
    expect(warning(c)).toBeUndefined();
  });

  it('starts one probe for a URL pasted on two lines', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://cdn.example.com/twice.png\nhttps://cdn.example.com/twice.png');
    c['onGoogleImageFieldBlur'](group, marketingField());

    expect(images).toHaveLength(1);
  });

  /** The line appears after focus has left the field, so an always-mounted region announces it. */
  it('announces the line in a live region that is mounted empty, naming the section and field', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    fixture.detectChanges();
    const region = (): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-google-image-url-check-live"]');
    expect(region()).not.toBeNull();
    expect(region()?.textContent?.trim()).toBe('');
    expect(region()?.getAttribute('role')).toBe('status');

    setUrls(c, 'https://cdn.example.com/square.png');
    c['onGoogleImageFieldBlur'](group, marketingField());
    images[0].load(300, 300);
    fixture.detectChanges();

    const marketingLabel = (marketingField() as { label: string }).label;
    expect(region()?.textContent?.trim()).toContain(
      `${GOOGLE_CREATIVE_SECTION_TITLES.display} ${marketingLabel}: Measured here: https://cdn.example.com/square.png (300x300) does not fit.`
    );
    // The visible line carries no role, so the text is read once.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-creative-url-check-display-marketingImages"]')?.getAttribute('role')
    ).toBeNull();
  });

  it('does not start a second probe while one for the same URL is still loading', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://cdn.example.com/slow.png');
    c['onGoogleImageFieldBlur'](group, marketingField());
    c['onGoogleImageFieldBlur'](group, marketingField());

    expect(images).toHaveLength(1);
  });

  it('names every misfit and every unchecked URL in one line, in the plural', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://cdn.example.com/a.png\nhttps://cdn.example.com/b.png\nhttps://down.example.com/c.png\nhttps://down.example.com/d.png');
    c['onGoogleImageFieldBlur'](group, marketingField());
    images[0].load(300, 300);
    images[1].load(100, 52);
    images[2].fail();
    images[3].fail();

    const line = warning(c) ?? '';
    expect(line).toContain('https://cdn.example.com/a.png (300x300), https://cdn.example.com/b.png (100x52) do not fit.');
    expect(line).toContain('Create will likely be refused for them;');
    expect(line).toContain('not checked: https://down.example.com/c.png, https://down.example.com/d.png. campaign-service checks them again at Create.');
  });

  it('probes nothing for a non-image field or a value that is not an http(s) URL', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls[group].controls['headlines'].setValue('https://cdn.example.com/a.png');
    c['onGoogleImageFieldBlur'](
      group,
      GOOGLE_CREATIVE_FIELD_SPECS.display.find((f) => f.control === 'headlines')
    );
    setUrls(c, 'not a url\nftp://files.example.com/a.png\nlfx-asset:1234');
    c['onGoogleImageFieldBlur'](group, marketingField());

    expect(images).toHaveLength(0);
  });

  /** The browser would send the operator's session cookie with it, so a route such as `/logout` would act on the session. */
  it("never probes a URL on the application's own host, whatever its scheme, port or trailing dot", () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const host = window.location.hostname;
    setUrls(
      c,
      `${window.location.origin}/logout\nhttp://${host}/logout\nhttps://${host}:8443/logout\nhttps://${host.toUpperCase()}./logout\nhttps://cdn.example.com/hero.png`
    );
    c['onGoogleImageFieldBlur'](group, marketingField());

    expect(images).toHaveLength(1);
    expect(images[0].src).toBe('https://cdn.example.com/hero.png');
    expect(warning(c)).toBeUndefined();
  });

  it('probes on leaving the textarea and renders the line under the field', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    setUrls(c, 'https://cdn.example.com/square.png');
    fixture.detectChanges();
    const textarea = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="implementation-creative-display-marketingImages"]'
    ) as HTMLTextAreaElement;
    textarea.dispatchEvent(new Event('blur'));
    images[0].load(300, 300);
    fixture.detectChanges();

    const line = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-creative-url-check-display-marketingImages"]');
    expect(line?.textContent).toContain('(300x300)');
  });
});
