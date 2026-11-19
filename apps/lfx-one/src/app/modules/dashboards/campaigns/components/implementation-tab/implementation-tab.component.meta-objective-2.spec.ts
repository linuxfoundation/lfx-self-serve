// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * Meta objective, placements and pixel id (LFXV2-3228).
 *
 * The shared interface has accepted all three for some time and `buildMetaConfig` spreads them
 * straight through, so the only thing that was missing was the form ever putting them on the
 * wire. These tests therefore assert on the REQUEST OBJECT rather than on the signals: a
 * collected-but-unsent field is precisely the defect being fixed, and a signal assertion would
 * pass while it persisted.
 *
 * The guards mirror campaign-service's `buildPlacementTargeting` and `buildPromotedObject`, both
 * of which run before any mutating call. Client-side validation therefore changes no outcome —
 * it changes only whether the user hears about it before or after a round trip.
 */
describe('ImplementationTabComponent Meta objective, placements and pixel', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  let createCampaign: ReturnType<typeof vi.fn>;

  function component(): Record<string, any> {
    return fixture.componentInstance as unknown as Record<string, any>;
  }

  function canSubmit(): boolean {
    return component()['canSubmit']();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  /** Read a rendered element, asserting presence before the cast. */
  function require<T extends HTMLElement>(testId: string): T {
    const el = query(testId);
    expect(el).not.toBeNull();
    return el as T;
  }

  /** Fill everything Meta's half of `canSubmit` needs, so one field at a time is the variable. */
  async function makeMetaValid(): Promise<void> {
    const c = component();
    c['selectedPlatforms'].set(['meta-ads']);
    c['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c['campaignForm'].controls['registrationUrl'].setValue('https://events.example.com/kubecon-eu-2026');
    c['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c['campaignForm'].controls['endDate'].setValue('2026-09-30');
    c['metaVariants'].set([{ primaryText: 'Join us', headline: 'KubeCon EU', description: 'September' }]);
    await fixture.whenStable();
  }

  /** Submit and return the `metaConfig` the service was actually called with. */
  async function submittedMetaConfig(): Promise<Record<string, any>> {
    component()['submit']();
    await fixture.whenStable();
    expect(createCampaign).toHaveBeenCalled();
    return createCampaign.mock.calls[0][0].metaConfig;
  }

  async function selectObjective(value: string): Promise<void> {
    const select = require<HTMLSelectElement>('implementation-meta-objective');
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  async function togglePlacement(key: string, enabled: boolean): Promise<void> {
    const box = require<HTMLInputElement>(`implementation-meta-placement-${key}`);
    box.checked = enabled;
    box.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  async function typePixelId(value: string): Promise<void> {
    const input = require<HTMLInputElement>('implementation-meta-pixel-id');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    createCampaign = vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } }));

    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        // `getLinkedInAccounts` is stubbed because `ngOnInit` calls it unconditionally, even with
        // only Meta selected; without it the component throws before any Meta assertion runs.
        { provide: CampaignService, useValue: { createCampaign, getLinkedInAccounts: () => of([]), getLinkedInTargetingProfiles: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await makeMetaValid();
  });

  /**
   * The Microsoft geo box must NOT apply Meta's assigned-country allowlist. That list is derived
   * from this app's own COUNTRIES and genuinely diverges from the table Microsoft validates
   * against — `AN` is in Microsoft's and not in ours. Dropping it silently meant the request fell
   * back to the event country and targeted a DIFFERENT market than the operator typed.
   *
   * Membership stays campaign-service's call: it checks Microsoft's own table and fails the create
   * before anything is created. This asserts shape-only handling, not that AN is targetable.
   */
  it('keeps a geo code Meta excludes but Microsoft supports', async () => {
    const c = component() as unknown as Record<string, any>;
    c['microsoftGeoTargets'].set([]);

    c['addMicrosoftGeoTarget']('an');

    expect(c['microsoftGeoTargets']()).toEqual(['AN']);
    expect(c['microsoftEffectiveGeoTargets']()).toEqual(['AN']);
  });

  it('still refuses a malformed geo code', async () => {
    const c = component() as unknown as Record<string, any>;
    c['microsoftGeoTargets'].set([]);

    c['addMicrosoftGeoTarget']('USA');

    expect(c['microsoftGeoTargets']()).toEqual([]);
  });

  it('refuses to add a geo target past the cap', async () => {
    const c = component() as unknown as Record<string, any>;
    c['microsoftGeoTargets'].set(Array.from({ length: 30 }, (_, i) => `G${i}`));
    await fixture.whenStable();

    c['addMicrosoftGeoTarget']('JP');
    expect(c['microsoftGeoTargets']().length).toBe(30);
  });

  /**
   * A RESTORED DRAFT can carry an over-cap list the add handlers never saw — a draft written
   * before these caps existed, replayed verbatim by `applyDraft` (which must replay verbatim, so
   * an emptied list stays emptied). Without the backstop the form looks valid and the BFF refuses.
   */
  it('blocks submit when a restored draft carries an over-cap Microsoft list', async () => {
    const c = component() as unknown as Record<string, any>;
    c['selectedPlatforms'].set(['microsoft-ads']);
    c['microsoftBudgetUsd'].set(100);
    c['microsoftGeoTargets'].set(['US']);
    c['microsoftKeywords'].set(Array.from({ length: 61 }, (_, i) => ({ text: `kw-${i}`, matchType: 'Exact' })));
    await fixture.whenStable();

    expect(c['microsoftBoundsValid']()).toBe(false);
    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * The match-type half of the same backstop, and it needs its own test: the over-cap case above
   * returns at the LENGTH check, so it never evaluates this branch. Deleting the match-type guard
   * left the whole app suite green — an unreached guard is not coverage.
   *
   * `BROAD_MATCH` rather than `EXACT`: `isMicrosoftMatchType` folds case, so `EXACT` is VALID and
   * a test built on it would assert the opposite of the contract. Google's SCREAMING_CASE
   * vocabulary is the realistic source, since the brief's keyword stage is shared with Google Ads
   * and a draft written from a Google-shaped brief can carry it.
   *
   * The list is within every cap, so nothing else can be what fails.
   */
  it('blocks submit when a restored draft carries a match type Microsoft has no name for', async () => {
    const c = component() as unknown as Record<string, any>;
    c['selectedPlatforms'].set(['microsoft-ads']);
    c['microsoftBudgetUsd'].set(100);
    c['microsoftGeoTargets'].set(['US']);
    c['microsoftKeywords'].set([
      { text: 'kubernetes', matchType: 'Exact' },
      { text: 'service mesh', matchType: 'BROAD_MATCH' },
    ]);
    await fixture.whenStable();

    expect(c['microsoftBoundsValid']()).toBe(false);
    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * The same draft with the match type CORRECTED submits, so the test above cannot pass for an
   * unrelated reason — without this, a form broken for any other cause would look like coverage.
   */
  it('allows submit once that draft carries a match type Microsoft accepts', async () => {
    const c = component() as unknown as Record<string, any>;
    c['selectedPlatforms'].set(['microsoft-ads']);
    c['microsoftBudgetUsd'].set(100);
    c['microsoftGeoTargets'].set(['US']);
    c['microsoftKeywords'].set([
      { text: 'kubernetes', matchType: 'Exact' },
      // Upper case on purpose: it is ACCEPTED, because the predicate folds case.
      { text: 'service mesh', matchType: 'BROAD' },
    ]);
    await fixture.whenStable();

    expect(c['microsoftBoundsValid']()).toBe(true);
    // canSubmit too, not just the bounds: without it an unrelated prerequisite being false would
    // leave BOTH cases green, and the pair would no longer prove the match type was what blocked
    // submission in the negative case above.
    expect(c['canSubmit']()).toBe(true);
  });

  /**
   * Microsoft refuses a supplied CpcBid outside [0.01, 1000] during dispatch, which surfaces as a
   * failed job rather than an error on the click. BLANK stays valid — unset means Microsoft applies
   * the account-currency minimum, a documented serve-capable floor — so an untouched box must not
   * block the submit.
   */
  it.each([
    ['blank, which means unset', '', true],
    ['at the minimum', '0.01', true],
    ['at the maximum', '1000', true],
    ['below the minimum', '0.001', false],
    ['above the maximum', '1001', false],
    ['not a number', 'abc', false],
  ])('treats a Microsoft CPC bid %s as submittable=%s', async (_label, bid, expected) => {
    const c = component() as unknown as Record<string, any>;
    c['selectedPlatforms'].set(['microsoft-ads']);
    c['microsoftKeywords'].set([{ text: 'kubernetes', matchType: 'Exact' }]);
    c['microsoftGeoTargets'].set(['US']);
    c['microsoftBudgetUsd'].set(100);
    c['microsoftCpcBid'].set(bid);
    await fixture.whenStable();

    expect(c['canSubmit']()).toBe(expected);
  });

  /**
   * The out-of-range value must BLOCK, not be silently dropped to "unset" — dispatching at the
   * account minimum while the box still displays 1001 would substitute a spend decision the
   * operator did make.
   */
  it('does not silently downgrade an out-of-range Microsoft CPC bid to unset', async () => {
    const c = component() as unknown as Record<string, any>;
    c['microsoftCpcBid'].set('1001');
    await fixture.whenStable();

    expect(c['microsoftEffectiveCpcBid']()).toBeNull();
    expect(c['microsoftCpcBidValid']()).toBe(false);
  });

  /**
   * `NaN < 1` is FALSE, so a bare comparison would let a NaN budget through to a client that
   * rejects it mid-dispatch — surfacing as a dead job rather than a blocked button. Pinned
   * separately from the zero case because only the `Number.isFinite` half catches it.
   */
  it.each([
    ['NaN', Number.NaN],
    ['zero', 0],
    ['negative', -5],
    // Mirrors redditBudgetIsUsable — over the client's cap is a dead job, not a refused request.
    ['over the maximum', 1_000_000_001],
  ])('blocks a Microsoft submit on a %s budget', async (_label, budget) => {
    const c = component() as unknown as Record<string, any>;
    // The guards are scoped to a Microsoft selection, so the platform must be selected or the
    // assertion would pass for the wrong reason — the arms would simply never be evaluated.
    c['selectedPlatforms'].set(['microsoft-ads']);
    c['microsoftKeywords'].set([{ text: 'kubernetes', matchType: 'Exact' }]);
    c['microsoftGeoTargets'].set(['US']);
    await fixture.whenStable();

    // Everything else valid, so only the budget can be what blocks it. Asserted first so a
    // failure below cannot be mistaken for an unrelated invalid field.
    c['microsoftBudgetUsd'].set(100);
    await fixture.whenStable();
    expect(c['canSubmit']()).toBe(true);

    c['microsoftBudgetUsd'].set(budget);
    await fixture.whenStable();
    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * The empty-array case, which the `!== undefined` restore exists for and a truthiness check
   * would break. Clearing every keyword is a DELIBERATE act the operator took; refilling it from
   * the brief on remount would hand back a campaign they had emptied, and `canSubmit` would then
   * pass on values they never re-chose.
   */
  it('treats a cleared Microsoft keyword list as a real value rather than refilling it', async () => {
    let draft: Record<string, any> | null = null;
    component()['draftChange'].subscribe((d: Record<string, any>) => (draft = d));

    component()['microsoftKeywords'].set([]);
    component()['emitDraft']();
    await fixture.whenStable();

    const restored = TestBed.createComponent(ImplementationTabComponent);
    restored.componentRef.setInput('draft', draft);
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: (draft as unknown as Record<string, any>)['eventSlug'] },
      keywords: [{ term: 'kubernetes', matchType: 'Exact', intentLevel: 'High', notes: '' }],
      selectedPlatforms: ['microsoft-ads'],
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();

    const c = restored.componentInstance as unknown as Record<string, any>;
    c['selectedPlatforms'].set(['microsoft-ads']);
    await restored.whenStable();

    expect(c['microsoftEffectiveKeywords']()).toEqual([]);
    // And the submit is blocked, naming the reason this matters rather than only the state.
    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * A draft persisted BEFORE these fields shipped carries none of them. Absence must mean "keep
   * what the brief seeded", never "the user chose the defaults" — otherwise an old draft silently
   * downgrades a Conversions campaign to traffic on the next tab switch. `undefined` is what
   * preserves that distinction; a present-but-empty `metaPixelId` is a real cleared value.
   */
  it('leaves Meta settings seeded when an older draft omits them', async () => {
    await selectObjective('conversions');
    await typePixelId('554433');
    const slug = component()['campaignForm'].controls['eventSlug'].value;

    const legacyDraft = {
      eventName: 'KubeCon EU 2026',
      countryCode: 'US',
      registrationUrl: 'https://events.example.com/kubecon-eu-2026',
      headlines: [],
      descriptions: [],
      budgetUsd: 500,
      searchBudgetPct: 70,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      includeSearch: true,
      includeDemandGen: false,
      includePerformanceMax: false,
      includeVideo: false,
      includeDisplay: false,
      eventSlug: slug,
    };

    const restored = TestBed.createComponent(ImplementationTabComponent);
    restored.componentRef.setInput('draft', legacyDraft);
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug, registrationUrl: 'https://events.example.com/kubecon-eu-2026' },
      selectedPlatforms: ['meta-ads'],
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();

    const c = restored.componentInstance as unknown as Record<string, any>;
    // Stand in for values the brief seeded on this mount. The legacy draft names none of the Meta
    // fields, so the restore must leave every one of them exactly as seeded.
    c['metaObjective'].set('conversions');
    c['metaPixelId'].set('554433');
    c['applyDraft']();
    await restored.whenStable();

    expect(c['metaObjective']()).toBe('conversions');
    expect(c['metaPixelId']()).toBe('554433');
  });

  // === Placements ===

  /**
   * Only the entries that differ from `META_DEFAULT_PLACEMENTS` are sent. Upstream merges the
   * override map field-by-field over those same defaults, so an untouched form must put no
   * placement keys on the wire at all.
   */
  it('sends no placement overrides when the defaults are untouched', async () => {
    expect((await submittedMetaConfig())['placements']).toEqual({});
  });

  it('sends only the placements that differ from the defaults', async () => {
    await togglePlacement('reels', true);

    expect((await submittedMetaConfig())['placements']).toEqual({ reels: true });
  });

  it('sends a disabled default placement as an explicit false', async () => {
    await togglePlacement('facebookFeed', false);

    expect((await submittedMetaConfig())['placements']).toEqual({ facebookFeed: false });
  });

  /**
   * Rule 3. `buildPlacementTargeting` refuses a request whose `publisher_platforms` list comes out
   * empty, and it does so at the ad-set call — after the campaign, a paid resource, exists.
   */
  /**
   * The override map is built by DROPPING keys equal to `META_DEFAULT_PLACEMENTS`, so toggling a
   * default-on placement off and back on must re-collapse to `{}`. The other placement specs only
   * move one direction, which a `!==`→`!=` slip or a lost shallow copy would still satisfy while
   * shipping a redundant `facebookFeed: true` override.
   */
  it('re-collapses to no overrides when a default placement is toggled off then on', async () => {
    await togglePlacement('facebookFeed', false);
    await togglePlacement('facebookFeed', true);

    expect((await submittedMetaConfig())['placements']).toEqual({});
  });

  it('blocks submit when every selectable placement is off', async () => {
    expect(canSubmit()).toBe(true);

    await togglePlacement('facebookFeed', false);
    await togglePlacement('instagramFeed', false);

    expect(canSubmit()).toBe(false);
    expect(query('implementation-meta-placement-error')).not.toBeNull();
  });

  /**
   * The checkbox group is a `fieldset`/`legend`, not a `div`/`span`. Without it a screen-reader
   * user hears each checkbox as an unrelated control, can switch the last placement off, and
   * reaches a disabled Create button with nothing announcing why — the group's error is not
   * associated with any control they visited.
   */
  it('groups the placements in a fieldset whose legend names the group', async () => {
    const legend: HTMLLegendElement | null = fixture.nativeElement.querySelector('fieldset > legend');

    expect(legend).not.toBeNull();
    expect(legend!.textContent?.trim()).toBe('Placements');
  });

  it('marks the placement fieldset invalid and points it at the error when none is enabled', async () => {
    const fieldset = (): HTMLFieldSetElement => {
      const el = fixture.nativeElement.querySelector('fieldset');
      expect(el).not.toBeNull();
      return el as HTMLFieldSetElement;
    };

    expect(fieldset().getAttribute('aria-invalid')).toBeNull();
    expect(fieldset().getAttribute('aria-describedby')).toBeNull();

    await togglePlacement('facebookFeed', false);
    await togglePlacement('instagramFeed', false);

    expect(fieldset().getAttribute('aria-invalid')).toBe('true');
    const describedBy = fieldset().getAttribute('aria-describedby');
    expect(describedBy).toBe('meta-placement-error');
    // The id must actually resolve, or the association announces nothing.
    const error: HTMLElement | null = fixture.nativeElement.querySelector(`#${describedBy}`);
    expect(error).not.toBeNull();
    // aria-describedby alone is only read when focus reaches the group; role="alert" is what
    // announces the error at the moment the last placement is switched off.
    expect(error!.getAttribute('role')).toBe('alert');
  });

  it('re-enables submit when a placement is turned back on', async () => {
    await togglePlacement('facebookFeed', false);
    await togglePlacement('instagramFeed', false);
    expect(canSubmit()).toBe(false);

    await togglePlacement('reels', true);

    expect(canSubmit()).toBe(true);
  });

  /**
   * Rule 2. Meta removed Messenger Inbox in November 2025 and campaign-service rejects the
   * placement outright. The toggle renders so its absence is not read as a missing feature, but
   * it must be inert.
   */
  it('renders the messengerInbox placement disabled', () => {
    const box = require<HTMLInputElement>('implementation-meta-placement-messengerInbox');

    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
  });

  /**
   * The disabled attribute is a presentation guarantee, not a state one. The handler refuses the
   * key independently, so even a direct call — a future template change binding a live control —
   * cannot put `messengerInbox: true` on the wire.
   */
  it('refuses a messengerInbox toggle even when the handler is called directly', async () => {
    component()['onMetaPlacementChange']('messengerInbox', { target: { checked: true } } as unknown as Event);
    await fixture.whenStable();

    expect(component()['metaPlacements']()['messengerInbox']).toBe(false);
    expect((await submittedMetaConfig())['placements']).toEqual({});
  });

  /** Enabling every selectable placement must still never introduce the retired key. */
  it('never sends messengerInbox even with every other placement enabled', async () => {
    await togglePlacement('stories', true);
    await togglePlacement('reels', true);
    await togglePlacement('audienceNetwork', true);

    const placements = (await submittedMetaConfig())['placements'];

    expect(placements).not.toHaveProperty('messengerInbox');
    expect(placements).toEqual({ stories: true, reels: true, audienceNetwork: true });
  });

  // === Pixel id ===

  /**
   * Only `conversions` promotes a pixel object. Under the other objectives campaign-service
   * promotes a page id or nothing, so collecting a pixel would be collecting a field it ignores.
   */
  it('hides the pixel field unless the objective is conversions', async () => {
    expect(query('implementation-meta-pixel-id')).toBeNull();

    await selectObjective('conversions');

    expect(query('implementation-meta-pixel-id')).not.toBeNull();
  });

  it('omits pixelId from the payload under a non-conversions objective', async () => {
    await selectObjective('engagement');

    expect(await submittedMetaConfig()).not.toHaveProperty('pixelId');
  });

  it('blocks submit when conversions is selected with no pixel id', async () => {
    expect(canSubmit()).toBe(true);

    await selectObjective('conversions');

    expect(canSubmit()).toBe(false);
    expect(query('implementation-meta-pixel-error')).not.toBeNull();
  });

  /**
   * The check `buildPromotedObject` makes that an empty-only test would miss. "PIX9" is
   * non-empty, so a truthiness guard passes it; Meta Pixel ids are numeric and upstream rejects
   * it on `numericIDRE`.
   */
  it('blocks submit for a non-empty but malformed pixel id', async () => {
    await selectObjective('conversions');

    await typePixelId('PIX9');

    expect(canSubmit()).toBe(false);
  });

  /** Upstream trims before both checks, so a whitespace-only id must read as empty here too. */
  it('blocks submit for a whitespace-only pixel id', async () => {
    await selectObjective('conversions');

    await typePixelId('   ');

    expect(canSubmit()).toBe(false);
  });

  it('allows submit and sends the pixel id once it is numeric', async () => {
    await selectObjective('conversions');
    await typePixelId('123456789012345');

    expect(canSubmit()).toBe(true);
    // The objective is asserted alongside the id so the pairing is pinned positively: a pixel id
    // must ship WITH `conversions`, not merely be absent under everything else.
    const config = await submittedMetaConfig();
    expect(config['pixelId']).toBe('123456789012345');
    expect(config['objective']).toBe('conversions');
  });

  it('trims the pixel id it sends', async () => {
    await selectObjective('conversions');
    await typePixelId('  123456789012345  ');

    expect(canSubmit()).toBe(true);
    const config = await submittedMetaConfig();
    expect(config['pixelId']).toBe('123456789012345');
    expect(config['objective']).toBe('conversions');
  });

  /**
   * A stale id left in the box after switching away from `conversions` must neither block submit
   * nor reach the wire — the field no longer applies, so it is neither validated nor sent.
   */
  it('drops a stale pixel id after switching away from conversions', async () => {
    await selectObjective('conversions');
    await typePixelId('PIX9');
    expect(canSubmit()).toBe(false);

    await selectObjective('traffic');

    expect(canSubmit()).toBe(true);
    expect(await submittedMetaConfig()).not.toHaveProperty('pixelId');
  });
});
