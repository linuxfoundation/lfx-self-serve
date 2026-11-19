// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import {
  CREATIVE_ASSET_MAX_BYTES,
  CREATIVE_ASSET_TOO_LARGE_MESSAGE,
  CREATIVE_ASSET_WRONG_TYPE_MESSAGE,
  REDDIT_CALL_TO_ACTIONS,
} from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignCreateResult, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { CreativeLibraryUploadStubComponent, configureGoogleTab, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * Reddit needs a budget floor like its siblings.
 *
 * Reddit's client rejects a non-positive budget at dispatch ("invalid budget: must be a positive
 * number"), and creation is ASYNC — so without a local guard that surfaces as a dead job the
 * operator has to go and read, rather than as a blocked submit button.
 */
describe('ImplementationTabComponent reddit budget gate', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function canSubmit(): boolean {
    return (fixture.componentInstance as unknown as { canSubmit(): boolean }).canSubmit();
  }

  /** The rendered geo chips, by their own text — see the note in the ordering spec. */
  function geoChipTexts(): string[] {
    const section = fixture.nativeElement.querySelector('[data-testid="implementation-reddit-section"]');
    const label = [...(section?.querySelectorAll('label') ?? [])].find((l: Element) => l.textContent?.includes('Geo Targets'));
    const block = label?.parentElement;
    return [...(block?.querySelectorAll('span') ?? [])].map((el: Element) => (el.textContent ?? '').trim());
  }

  function setup(budget: number): void {
    const c = fixture.componentInstance as unknown as {
      selectedPlatforms: { set(v: string[]): void };
      redditBudgetUsd: { set(v: number): void };
      campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
    };
    c.selectedPlatforms.set(['reddit-ads']);
    c.redditBudgetUsd.set(budget);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://events.example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    fixture.detectChanges();
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

    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('blocks submit when the reddit budget is zero', () => {
    setup(0);
    expect(canSubmit()).toBe(false);
  });

  it('renders the reddit config section when reddit is selected', () => {
    setup(500);

    // The section's EXISTENCE is the fix: showRedditSection was computed but bound to nothing,
    // so a Reddit campaign dispatched on values the operator never saw. Query the budget input
    // specifically — a section that rendered a heading and no inputs would still be unusable.
    const section = fixture.nativeElement.querySelector('[data-testid="implementation-reddit-section"]');
    const budget = fixture.nativeElement.querySelector('[data-testid="implementation-reddit-budget"]');
    expect(section).not.toBeNull();
    expect(budget).not.toBeNull();
    expect((budget as HTMLInputElement).value).toBe('500');
  });

  it('shows the country-code fallback when the brief recommends no geo targets', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as { campaignForm: { controls: Record<string, { setValue(v: unknown): void }> } };
    c.campaignForm.controls['countryCode'].setValue('DE');
    fixture.detectChanges();

    // submit() falls back to [countryCode] when the brief recommends no geos, so a preview
    // reading the raw signal would render nothing for a request that targets Germany — the
    // section would hide the very targeting it exists to surface.
    const section = fixture.nativeElement.querySelector('[data-testid="implementation-reddit-section"]');
    expect(section?.textContent).toContain('DE');
  });

  it.each([
    ['above the platform cap', 2_000_000_000],
    ['not finite', Number.POSITIVE_INFINITY],
  ])('blocks submit when the reddit budget is %s', (_label, budget) => {
    setup(budget);
    // Reddit's client rejects both during dispatch. Creation is async, so without a local guard
    // these become dead jobs the operator has to go and read rather than a blocked button — the
    // same argument that justifies the floor.
    expect(canSubmit()).toBe(false);
  });

  it('blocks submit when the country code is cleared and the brief recommends no geos', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as { campaignForm: { controls: Record<string, { setValue(v: unknown): void }> } };
    // countryCode carries no validator, so clearing it is reachable. submit() previously sent
    // [''] in that state — a value Reddit cannot target, and one the operator could not see
    // because the preview correctly renders nothing.
    c.campaignForm.controls['countryCode'].setValue('');
    fixture.detectChanges();

    expect(geoChipTexts()).toEqual([]);
    expect(canSubmit()).toBe(false);
  });

  it.each([
    ['lowercase', 'us'],
    ['too long', 'USA'],
    ['too short', 'U'],
  ])('blocks submit when the country code is %s', (_label, code) => {
    setup(500);
    const c = fixture.componentInstance as unknown as { campaignForm: { controls: Record<string, { setValue(v: unknown): void }> } };
    c.campaignForm.controls['countryCode'].setValue(code);
    fixture.detectChanges();
    // 'us' normalises to 'US' and is fine; the other two have no valid shape and would reach
    // dispatch as an unusable geo. Asserted per-case rather than as one blanket expectation.
    expect(canSubmit()).toBe(code === 'us');
  });

  it('prefers recommended geos even when they arrive after the country code', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as {
      campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
      redditGeoTargets: { set(v: string[]): void };
    };
    // The ORDER matters: populateFromBrief patches the form first and assigns recommended geos
    // afterwards. A derivation keyed only on countryCode's valueChanges reads an empty geo list,
    // and nothing re-runs it when the real geos land — so the preview would show the fallback
    // while submit() dispatches the recommended list.
    c.campaignForm.controls['countryCode'].setValue('US');
    fixture.detectChanges();
    c.redditGeoTargets.set(['DE', 'FR']);
    fixture.detectChanges();

    // Assert on the CHIPS, not the section text: the budget label reads "(USD, lifetime)", so a
    // not-toContain('US') over the whole section can never pass — it would fail against correct
    // code and read as a real defect.
    const geos = geoChipTexts();
    expect(geos).toContain('DE');
    expect(geos).toContain('FR');
    // The fallback must be GONE, not merely joined by the recommended list.
    expect(geos).not.toContain('US');
  });

  it('falls back to the country code when the recommended geos are all unusable', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as {
      campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
      redditGeoTargets: { set(v: string[]): void };
    };
    // A generated or restored brief can carry a non-empty but unusable recommendation. Choosing
    // the branch on the RAW list makes it win on length alone, filter to nothing, and block
    // submit permanently — with a perfectly valid country sitting unread in the form.
    c.campaignForm.controls['countryCode'].setValue('US');
    c.redditGeoTargets.set(['USA']);
    fixture.detectChanges();

    expect(geoChipTexts()).toEqual(['US']);
    expect(canSubmit()).toBe(true);
  });

  it('strips an r/ prefix so the preview matches what dispatches', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as { redditSubreddits: { set(v: string[]): void } };
    // 'r/k8s' is a real stored value — campaign-service.service.spec.ts asserts it survives
    // restore verbatim — and dispatch strips an optional prefix. Rendered under the template's
    // fixed 'r/' it previewed as 'r/r/k8s', so the section promising to show what will be sent
    // showed something else.
    c.redditSubreddits.set(['r/k8s', 'kubernetes']);
    fixture.detectChanges();

    const chips = Array.from(fixture.nativeElement.querySelectorAll('span')).map((el) => (el as HTMLElement).textContent?.trim());
    expect(chips).toContain('r/k8s');
    expect(chips).not.toContain('r/r/k8s');
    expect(chips).toContain('r/kubernetes');
  });

  it('hides the subreddit block when every name normalises away', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as { redditSubreddits: { set(v: string[]): void } };
    // A brief carrying only unusable names: the raw list is non-empty, the effective list is not.
    // Gating on the raw list renders a "Subreddits (0)" heading above an empty chip row.
    c.redditSubreddits.set(['r/', '/r/', '   ']);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Subreddits (0)');

    // And a usable name still renders, or the assertion above would pass by hiding the block
    // unconditionally.
    c.redditSubreddits.set(['kubernetes']);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Subreddits (1)');
  });

  it('allows submit once the reddit budget is positive', () => {
    setup(500);
    // The positive case must pass, or the zero case above would be satisfied by any unrelated
    // guard rather than by the budget floor it claims to bind.
    expect(canSubmit()).toBe(true);
  });
});

/**
 * The Reddit objective picker, which until now did not exist: `objective` was declared on the
 * request interface and never serialized, so both creators fell back to their own default and
 * every Reddit campaign was built as Conversions with nothing on screen saying so.
 *
 * Structured as Meta's objective suite is, because the same two defects are possible — a picker
 * offering an objective the platform cannot run, and a restored draft silently displaying the
 * first selectable value instead of the stored one.
 */
describe('ImplementationTabComponent reddit objective', () => {
  /** Mount with a persisted draft naming `objective`, as a tab revisit would. */
  async function restoredWithObjective(objective: string): Promise<ComponentFixture<ImplementationTabComponent>> {
    const restored = TestBed.createComponent(ImplementationTabComponent);
    // `headlines`, `descriptions` and `countryCode` are supplied because `applyDraft` consumes
    // all three unguarded — it iterates the copy arrays and patches `countryCode` straight onto
    // the form, which the Reddit geo preview then trims. Every draft `emitDraft` produces carries
    // them, so this matches the real shape rather than working around anything.
    restored.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      redditObjective: objective,
      countryCode: 'US',
      headlines: [''],
      descriptions: [''],
    });
    // `redditCopy` carries every recommendation array because `populateFromBrief` assigns them
    // straight through once the key exists, and the read-only chip previews map over the result.
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://events.example.com/k' },
      selectedPlatforms: ['reddit-ads'],
      redditCopy: {
        variants: [{ headline: 'Brief reddit headline', destinationUrl: 'https://example.com/brief' }],
        recommendedSubreddits: ['briefsub'],
        recommendedInterests: ['brief-interest'],
        recommendedKeywords: ['brief-keyword'],
        recommendedGeos: ['US'],
      },
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();
    return restored;
  }

  function objectiveSelect(f: ComponentFixture<ImplementationTabComponent>): HTMLSelectElement {
    const el = f.nativeElement.querySelector('[data-testid="implementation-reddit-objective"]') as HTMLSelectElement;
    expect(el).not.toBeNull();
    return el;
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
        { provide: CampaignService, useValue: { createCampaign: vi.fn(), getLinkedInAccounts: () => of([]), getLinkedInTargetingProfiles: () => of([]) } },
      ],
    }).compileComponents();
  });

  /**
   * A LITERAL list, for the reason the Meta equivalent is one: comparing against the constant the
   * template renders from would agree with whatever that constant contained, and so could never
   * catch an objective appearing or disappearing from the picker.
   */
  it('renders exactly the selectable objectives, in order', async () => {
    const f = await restoredWithObjective('conversions');

    expect(Array.from(objectiveSelect(f).options).map((o) => o.value)).toEqual(['awareness', 'traffic', 'conversions', 'video_views']);
  });

  /**
   * `video_views` is offered now that a goal picker collects the `videoGoal` both creators require
   * for it — and offered as an ordinary, choosable option, not the disabled restore affordance.
   */
  it('offers video_views as a choosable objective', async () => {
    const select = objectiveSelect(await restoredWithObjective('conversions'));
    const option = Array.from(select.options).find((o) => o.value === 'video_views');

    expect(option?.text).toBe('Video Views');
    expect(option?.disabled).toBe(false);
  });

  /**
   * Driven through the REAL draft input rather than by setting the signal: a signal-only test
   * leaves `applyDraft` unexercised, and a coercion added there would silently discard the stored
   * objective while passing.
   */
  it('restores video_views from a persisted draft, selected and enabled', async () => {
    const f = await restoredWithObjective('video_views');
    const select = objectiveSelect(f);

    expect((f.componentInstance as unknown as Record<string, any>)['redditObjective']()).toBe('video_views');
    expect(select.value).toBe('video_views');
    expect(select.options[select.selectedIndex].disabled).toBe(false);
  });

  /** A restore affordance, not a permanent extra option — absent for a normal draft. */
  it('does not render the legacy option when the objective is selectable', async () => {
    const select = objectiveSelect(await restoredWithObjective('traffic'));

    expect(Array.from(select.options).map((o) => o.value)).toEqual(['awareness', 'traffic', 'conversions', 'video_views']);
    expect(Array.from(select.options).some((o) => o.text.includes('(no longer available)'))).toBe(false);
  });

  /** And the selectable value still round-trips, so the assertion above cannot pass by ignoring the draft. */
  it('restores a selectable objective from a persisted draft', async () => {
    const f = await restoredWithObjective('traffic');

    expect((f.componentInstance as unknown as Record<string, any>)['redditObjective']()).toBe('traffic');
    expect(objectiveSelect(f).value).toBe('traffic');
  });
});

/**
 * The call-to-action picker's half of the same guard, kept beside the objective's on purpose.
 *
 * The exposure is identical — a restored value that matches no `<option>` makes the browser fall
 * back to index 0, so the control reads "Default (Learn More)" while the signal still holds and
 * still sends the stored label. Latent, like the objective's guard now that every objective is
 * selectable: `REDDIT_CALL_TO_ACTIONS` is the whole upstream set and a stale CTA only becomes
 * possible once Reddit retires a label. Pinned anyway, so the two siblings cannot drift.
 */
describe('ImplementationTabComponent reddit call to action', () => {
  /**
   * Mount with a persisted draft naming `redditCallToAction`, as a tab revisit would.
   *
   * `redditCreativeEnabled: true` is the part the objective's equivalent does not need: the CTA
   * control lives inside the authored-post block, which `redditCreativeAvailable()` withholds
   * until the capability answers yes. Without it the select is simply absent and every assertion
   * below would fail on a null element rather than on the behaviour it names.
   */
  async function restoredWithCallToAction(cta: string): Promise<ComponentFixture<ImplementationTabComponent>> {
    const restored = TestBed.createComponent(ImplementationTabComponent);
    // Same three unguarded `applyDraft` keys the objective suite supplies, for the same reason.
    restored.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      redditCallToAction: cta,
      countryCode: 'US',
      headlines: [''],
      descriptions: [''],
    });
    restored.componentRef.setInput('redditCreativeEnabled', true);
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://events.example.com/k' },
      selectedPlatforms: ['reddit-ads'],
      redditCopy: {
        variants: [{ headline: 'Brief reddit headline', destinationUrl: 'https://example.com/brief' }],
        recommendedSubreddits: ['briefsub'],
        recommendedInterests: ['brief-interest'],
        recommendedKeywords: ['brief-keyword'],
        recommendedGeos: ['US'],
      },
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();
    return restored;
  }

  function ctaSelect(f: ComponentFixture<ImplementationTabComponent>): HTMLSelectElement {
    const el = f.nativeElement.querySelector('[data-testid="implementation-reddit-call-to-action"]') as HTMLSelectElement;
    expect(el).not.toBeNull();
    return el;
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
        { provide: CampaignService, useValue: { createCampaign: vi.fn(), getLinkedInAccounts: () => of([]), getLinkedInTargetingProfiles: () => of([]) } },
      ],
    }).compileComponents();
  });

  /**
   * The symptom the guard exists to prevent: the screen and the payload disagreeing. Without the
   * trailing option the select would read `Default (Learn More)` here while the signal still held
   * — and still sent — `Get Showtimes Legacy`, which upstream then refuses.
   */
  it('shows a retired call to action rather than falling back to the default option', async () => {
    const select = ctaSelect(await restoredWithCallToAction('Get Showtimes Legacy'));

    expect(select.value).toBe('Get Showtimes Legacy');
    expect(select.options[select.selectedIndex].text).toBe('Get Showtimes Legacy (no longer available)');
  });

  /** Visible so the operator can see what is stored, but not re-choosable. */
  it('renders the retired call to action as disabled', async () => {
    const select = ctaSelect(await restoredWithCallToAction('Get Showtimes Legacy'));

    expect(Array.from(select.options).find((o) => o.value === 'Get Showtimes Legacy')?.disabled).toBe(true);
  });

  /** A restore affordance, not a permanent extra option — absent for a CTA still in the set. */
  it('does not render the retired option when the call to action is current', async () => {
    const select = ctaSelect(await restoredWithCallToAction('Sign Up'));

    expect(select.value).toBe('Sign Up');
    expect(Array.from(select.options).filter((o) => o.disabled)).toEqual([]);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', ...REDDIT_CALL_TO_ACTIONS]);
  });

  /**
   * And the empty string is NOT unavailable: it is the real "let upstream default" selection the
   * first option carries, so treating it as a stale value would render a duplicate disabled
   * option reading " (no longer available)".
   */
  it('treats the empty selection as the default rather than as a retired value', async () => {
    const select = ctaSelect(await restoredWithCallToAction(''));

    expect(select.value).toBe('');
    expect(Array.from(select.options).filter((o) => o.disabled)).toEqual([]);
  });
});

/**
 * The results step's Reddit notice. Uses `configureGoogleTab` deliberately: that helper is a
 * plain ImplementationTabComponent harness with nothing Google-specific in its providers, and
 * the results step renders straight off the `results` signal with no capability gate.
 */
describe('ImplementationTabComponent reddit results notice', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  /**
   * A Reddit result exactly as `campaign-proxy.service.ts:2054-2064` builds one, with only the ad
   * count varied. `type` is `'social'` — Reddit has no `CampaignType` of its own — and
   * `adGroupCount` is the literal `1` the proxy hardcodes even when no ad was created, so a
   * notice keyed on the ad group rather than on `adCount` would not fire on the real payload.
   */
  const redditResult = (adCount: number): CampaignCreateResult => ({
    platform: 'reddit-ads',
    type: 'social',
    campaignName: 'Synthetic Summit 2026',
    campaignId: 't3_synthetic',
    adGroupCount: 1,
    keywordCount: 0,
    adCount,
    campaignUrl: 'https://ads.reddit.com/',
    steps: [],
  });

  /** The results step is driven straight off these two protected signals. */
  const atResults = (adCount: number): void => {
    const c = fixture.componentInstance as unknown as {
      results: { set(v: CampaignCreateResult[]): void };
      step: { set(v: 'results'): void };
    };
    c.results.set([redditResult(adCount)]);
    c.step.set('results');
    fixture.detectChanges();
  };

  const notice = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="implementation-reddit-no-ad-notice"]');

  /**
   * The Reddit no-ad notice carries TWO claims that pull against each other, and the notice has
   * been wrong in both directions. Each assertion below pins one of them.
   *
   * (Each reference below names the symbol to look up, not a line number — those drift.)
   *
   * 1. LFX activation never recovers. On the campaign-service arm the both-child-ids guard
   *    (`RedditDispatcher.ToggleStatus` in `internal/dispatch/reddit.go`) takes them from
   *    `redditChildIDs` in the same file, which reads only the persisted Result blob — nothing re-reads Reddit, so an ad attached by
   *    hand in Ads Manager is never discovered. The claim is pinned as "will not change that"
   *    rather than "stays refused" because this notice also renders for legacy-created campaigns:
   *    `results()` is set from the `createCampaign` subscribe (`implementation-tab.component.ts:2087`)
   *    as well as from `pollJob` (`:2688`), and a legacy campaign's toggle takes the legacy arm of
   *    `updateCampaignStatus` (`campaign-proxy.service.ts:1921`), which has no ad-existence guard
   *    and is NOT refused — it just activates a campaign with no ad to serve. Pinning the refusal
   *    would pin a sentence that is false on one of the two arms that render it.
   * 2. The campaign and ad group ALREADY EXIST. This notice renders only on `adCount === 0`,
   *    which is reached with both upstream resources created and PAUSED, so the recovery must
   *    name THIS campaign. Telling the operator to build one orphans the first — the defect
   *    campaign-service recorded at
   *    `docs/knowledge/code/internal-platform-reddit.md:263-265`.
   *
   * Pinned on the clauses that carry the claims rather than the whole sentence, so rewording is
   * free and quietly dropping a correction is not. The second clause keeps "the ad" rather than
   * the bare "to this campaign": the object matters, since what has to be named is the ad landing
   * on the campaign that already exists, and the verb is left loose so Add/Attach both pass.
   *
   * The negative assertion matches a PATTERN, not the one phrase that happened to ship. "Build and
   * launch the campaign" was the instance; the defect is any create-verb aimed at a campaign, and
   * "Create a new campaign in Reddit Ads Manager" would pass a literal `not.toContain` while
   * orphaning the first campaign exactly as before. It deliberately does NOT forbid "launch the
   * campaign" — the campaign exists and launching it from Ads Manager is the right answer — nor
   * the older "attach it to this campaign", which is correct now that the sentence also denies
   * that LFX activation helps. Forbidding a phrase by value is how a guard ends up refusing the
   * correct wording.
   */
  it('tells a Reddit campaign with no ad that LFX will not recover and points at the existing campaign', () => {
    atResults(0);

    expect(notice()).not.toBeNull();
    expect(notice()?.textContent).toContain('activating it from LFX will not change that');
    expect(notice()?.textContent).toContain('the ad to this campaign');
    expect(notice()?.textContent).not.toMatch(/\b(build|create|make|set up)\b[^.]{0,40}\bcampaign\b/i);
  });

  /** The notice is about the no-ad state, so a campaign that got an ad must not carry it. */
  it('omits the Reddit no-ad notice once an ad exists', () => {
    atResults(1);

    expect(notice()).toBeNull();
  });
});

/**
 * The Reddit image UPLOAD (decision D3): offered only on an explicit yes from BOTH the authored-post
 * capability and `redditAssetUploadEnabled`, it uploads the chosen file for the saved brief and
 * sends the returned id as `imageAssetId` in place of `imageUrl`. With the upload capability off the
 * section is exactly what it was: the pasted image URL, and nothing else.
 */
describe('ImplementationTabComponent reddit image upload', () => {
  const BRIEF_ID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
  const ASSET_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  let createCampaign: ReturnType<typeof vi.fn>;
  let uploadCreativeAsset: ReturnType<typeof vi.fn>;
  let resumeCreativeAssetUpload: ReturnType<typeof vi.fn>;
  let cancelCreativeAssetUpload: ReturnType<typeof vi.fn>;

  interface Internals {
    campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
    selectedPlatforms: { set(v: string[]): void };
    redditImageAssetId: () => string;
    redditImageUploadStatus: () => string;
    redditImageUploadError: () => string;
    creativeLibraryRevision: () => number;
    canSubmit: () => boolean;
    submit(): void;
  }
  const at = (f: ComponentFixture<ImplementationTabComponent>): Internals => f.componentInstance as unknown as Internals;

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['reddit-ads'],
      redditCopy: {
        variants: [{ headline: 'Brief reddit headline', destinationUrl: 'https://example.com/brief' }],
        recommendedSubreddits: ['briefsub'],
        recommendedInterests: [],
        recommendedKeywords: [],
        recommendedGeos: ['US'],
      },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;

  async function mount(
    upload: boolean | null,
    creative = true,
    draft: CampaignImplementationDraft | null = null
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(ImplementationTabComponent);
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    if (draft) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('redditCreativeEnabled', creative);
    f.componentRef.setInput('redditAssetUploadEnabled', upload);
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: BRIEF_ID, message: null, approved: true });
    f.componentRef.setInput('briefData', brief());
    at(f).selectedPlatforms.set(['reddit-ads']);
    f.detectChanges();
    await f.whenStable();
    return { fixture: f, latest: () => captured };
  }

  const fileInput = (f: ComponentFixture<ImplementationTabComponent>): HTMLInputElement | null =>
    f.nativeElement.querySelector('[data-testid="implementation-reddit-image-file"]') as HTMLInputElement | null;

  /** Drive the real `(change)` binding with a chosen file, as the browser's picker would. */
  function choose(f: ComponentFixture<ImplementationTabComponent>, file: File): void {
    const input = fileInput(f) as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  const png = (size = 16): File => new File([new Uint8Array(size)], 'promo.png', { type: 'image/png' });

  function submit(f: ComponentFixture<ImplementationTabComponent>): Record<string, unknown> {
    const c = at(f);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    f.detectChanges();
    c.submit();
    expect(createCampaign).toHaveBeenCalled();
    return createCampaign.mock.calls[0][0]['redditConfig'] as Record<string, unknown>;
  }

  function typeImageUrl(f: ComponentFixture<ImplementationTabComponent>, value: string): void {
    const input = f.nativeElement.querySelector('[data-testid="implementation-reddit-image-url"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  beforeEach(async () => {
    createCampaign = vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } }));
    uploadCreativeAsset = vi.fn().mockReturnValue(of({ id: ASSET_ID, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true }));
    resumeCreativeAssetUpload = vi.fn().mockReturnValue(null);
    cancelCreativeAssetUpload = vi.fn();

    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext: () => ({ slug: 'tlf' }) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: CampaignService,
          useValue: {
            createCampaign,
            uploadCreativeAsset,
            resumeCreativeAssetUpload,
            forgetCreativeAssetUpload: vi.fn(),
            cancelCreativeAssetUpload,
            getLinkedInAccounts: () => of([]),
            getLinkedInTargetingProfiles: () => of([]),
            // The slot grid mounts beside the upload control and reads the plan as soon as this
            // suite's brief is saved. Every list upstream returns is non-nil, so the empty plan
            // is spelled out rather than left undefined.
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
          },
        },
      ],
    }).compileComponents();
  });

  it.each([
    ['unanswered', null, true],
    ['off', false, true],
    ['on but the authored-post capability is off', true, false],
  ])('renders no upload control while the upload capability is %s, and keeps the image URL behaviour unchanged', async (_label, upload, creative) => {
    const f = (await mount(upload, creative)).fixture;

    expect(fileInput(f)).toBeNull();
    // The pasted URL is still the authored-post image whenever the creative capability allows it.
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-image-url"]') !== null).toBe(creative);
  });

  it('labels the upload control and uploads the chosen image for the saved brief, keeping its asset id', async () => {
    const f = (await mount(true)).fixture;
    const input = fileInput(f) as HTMLInputElement;
    expect(f.nativeElement.querySelector(`label[for="${input.id}"]`)?.textContent).toContain('upload an image');
    expect(input.getAttribute('accept')).toBe('image/png,image/jpeg');

    const file = png();
    choose(f, file);

    expect(uploadCreativeAsset).toHaveBeenCalledWith(file, 'tlf', BRIEF_ID, 'reddit');
    expect(at(f).redditImageAssetId()).toBe(ASSET_ID);
    const status = f.nativeElement.querySelector('[data-testid="implementation-reddit-image-status"]') as HTMLElement;
    expect(status.textContent).toContain('Uploaded: promo.png');
    const live = f.nativeElement.querySelector('[data-testid="implementation-reddit-image-status-live"]') as HTMLElement;
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent).toContain('Uploaded: promo.png');
  });

  // The slot plan is derived from the stored library, so an upload makes the grid's last answer
  // stale. The revision this bumps is what the grid reads as its reload token.
  // The library upload sits on top of the slot grid it feeds; each image it stores makes the
  // grid's answer, and the Google slots' library, stale.
  it('mounts the library upload for the saved brief and re-reads the library each time it stores an image', async () => {
    const f = (await mount(true)).fixture;
    const upload = f.debugElement.query(By.directive(CreativeLibraryUploadStubComponent)).componentInstance as CreativeLibraryUploadStubComponent;
    expect(upload.briefId()).toBe(BRIEF_ID);
    expect(upload.available()).toBe(true);
    const before = at(f).creativeLibraryRevision();

    upload.libraryChanged.emit(1);
    f.detectChanges();

    expect(at(f).creativeLibraryRevision()).toBe(before + 1);
    // Handed back, so a picker's upload re-reads the library upload's quota too.
    expect(upload.reloadToken()).toBe(before + 1);
  });

  // Unknown is not no: a capability read still pending must not tell the operator uploads are off.
  it('reads the library upload as unknown until every capability says no', async () => {
    const f = (await mount(false)).fixture;
    const upload = (): CreativeLibraryUploadStubComponent =>
      f.debugElement.query(By.directive(CreativeLibraryUploadStubComponent)).componentInstance as CreativeLibraryUploadStubComponent;
    expect(upload().available()).toBeNull();

    for (const flag of ['metaAssetUploadEnabled', 'linkedInAssetUploadEnabled', 'googleAssetUploadEnabled', 'microsoftAssetUploadEnabled']) {
      f.componentRef.setInput(flag, false);
    }
    f.detectChanges();
    // X's capability is still unanswered, so this is unknown rather than a no.
    expect(upload().available()).toBeNull();

    f.componentRef.setInput('twitterCreateEnabled', false);
    f.detectChanges();
    expect(upload().available()).toBe(false);
  });

  // The BFF route admits a library upload on `canCreateTwitter()` alone (the tweet image).
  it('offers the library upload when X creation is the only capability that says yes', async () => {
    const f = (await mount(false)).fixture;
    for (const flag of ['metaAssetUploadEnabled', 'linkedInAssetUploadEnabled', 'googleAssetUploadEnabled', 'microsoftAssetUploadEnabled']) {
      f.componentRef.setInput(flag, false);
    }
    f.componentRef.setInput('twitterCreateEnabled', true);
    f.detectChanges();
    const upload = f.debugElement.query(By.directive(CreativeLibraryUploadStubComponent)).componentInstance as CreativeLibraryUploadStubComponent;
    expect(upload.available()).toBe(true);
  });

  it('bumps the creative library revision once the upload lands, so the slot grid re-reads', async () => {
    const f = (await mount(true)).fixture;
    const before = at(f).creativeLibraryRevision();

    choose(f, png());

    expect(at(f).redditImageAssetId()).toBe(ASSET_ID);
    expect(at(f).creativeLibraryRevision()).toBe(before + 1);
  });

  it('announces the upload while it is in flight', async () => {
    const pending = new Subject<unknown>();
    uploadCreativeAsset.mockReturnValue(pending);
    const f = (await mount(true)).fixture;

    choose(f, png());

    const status = f.nativeElement.querySelector('[data-testid="implementation-reddit-image-status"]') as HTMLElement;
    expect(status.textContent).toContain('Uploading image');
    // Not disabled (that would drop keyboard focus), but the create waits for the upload.
    expect(fileInput(f)?.disabled).toBe(false);
    const c = at(f);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    expect(c.canSubmit()).toBe(false);
    pending.next({ id: ASSET_ID, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true });
    expect(c.canSubmit()).toBe(true);
  });

  // A tab switch destroys this component mid-upload. The request runs on in the service, and the
  // remount picks it back up from the draft rather than losing the image the operator chose.
  it('resumes an upload that was still in flight when the tab was left', async () => {
    const pending = new Subject<unknown>();
    uploadCreativeAsset.mockReturnValue(pending);
    const first = await mount(true);
    choose(first.fixture, png());
    const draft = first.latest() as CampaignImplementationDraft;
    expect(draft.redditImageUploadPendingName).toBe('promo.png');
    first.fixture.destroy();
    resumeCreativeAssetUpload.mockReturnValue(pending);

    const second = await mount(true, true, { ...draft, eventSlug: 'kubecon-eu-2026' });
    expect(resumeCreativeAssetUpload).toHaveBeenCalledWith('reddit', BRIEF_ID);
    expect(at(second.fixture).redditImageUploadStatus()).toBe('uploading');

    pending.next({ id: ASSET_ID, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true });
    second.fixture.detectChanges();

    expect(at(second.fixture).redditImageAssetId()).toBe(ASSET_ID);
    expect(second.latest()?.redditImageAssetId).toBe(ASSET_ID);
    expect(second.latest()?.redditImageUploadPendingName).toBe('');
    expect(submit(second.fixture)['imageAssetId']).toBe(ASSET_ID);
  });

  // Once the upload control is hidden mid-upload, the upload must still hold Create, visibly and
  // with a way out: unanswered, unconfirmed and switched-off support all hide the control, and a
  // resumed upload has no asset id yet, so without this the campaign went out without the image.
  it.each([
    ['still being checked', null, 'pending', 'pending'],
    ['unconfirmed', null, 'unknown', 'failed'],
    ['switched off', false, 'ready', 'unsupported'],
  ] as const)('holds Create with a visible Remove for an upload in flight while support is %s', async (_label, upload, read, kind) => {
    uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
    const f = (await mount(true)).fixture;
    choose(f, png());
    const c = at(f);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');

    f.componentRef.setInput('createCapabilityRead', read);
    f.componentRef.setInput('redditAssetUploadEnabled', upload);
    f.detectChanges();

    expect(fileInput(f)).toBeNull();
    const block = f.nativeElement.querySelector(`[data-testid="implementation-reddit-image-asset-block-${kind}"]`) as HTMLElement | null;
    expect(block).not.toBeNull();
    expect(c.canSubmit()).toBe(false);

    (f.nativeElement.querySelector('[data-testid="implementation-reddit-image-asset-block-remove"] button') as HTMLButtonElement).click();
    f.detectChanges();

    expect(c.redditImageUploadStatus()).toBe('idle');
    expect(c.canSubmit()).toBe(true);
  });

  it('holds Create for an upload resumed after a tab switch while support is still being checked', async () => {
    const pending = new Subject<unknown>();
    uploadCreativeAsset.mockReturnValue(pending);
    const first = await mount(true);
    choose(first.fixture, png());
    const draft = first.latest() as CampaignImplementationDraft;
    first.fixture.destroy();
    resumeCreativeAssetUpload.mockReturnValue(pending);

    const f = (await mount(null, true, { ...draft, eventSlug: 'kubecon-eu-2026' })).fixture;
    f.componentRef.setInput('createCapabilityRead', 'pending');
    const c = at(f);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    f.detectChanges();

    expect(c.redditImageUploadStatus()).toBe('uploading');
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-image-asset-block-pending"]')).not.toBeNull();
    expect(c.canSubmit()).toBe(false);
  });

  // A stalled upload has no timeout, so the shown control must offer a way out of it, and that way
  // out must abort the request rather than leave it running.
  it('offers Cancel while an upload is in flight, which aborts it and releases Create', async () => {
    uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
    const f = (await mount(true)).fixture;
    choose(f, png());
    const c = at(f);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    expect(c.canSubmit()).toBe(false);

    (f.nativeElement.querySelector('[data-testid="implementation-reddit-image-cancel"]') as HTMLButtonElement).click();
    f.detectChanges();

    expect(cancelCreativeAssetUpload).toHaveBeenCalled();
    expect(c.redditImageUploadStatus()).toBe('idle');
    expect(c.canSubmit()).toBe(true);
  });

  it('does not hold Create for an upload when a post URL is what the campaign sends', async () => {
    uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
    const f = (await mount(true)).fixture;
    choose(f, png());
    const c = at(f) as Internals & { redditPostUrl: { set(v: string): void } };
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');

    c.redditPostUrl.set('https://www.reddit.com/r/kubernetes/comments/abc123/promo/');
    f.detectChanges();

    expect(c.canSubmit()).toBe(true);
  });

  // A foundation switch clears the current brief but keeps the draft. The upload belongs to the brief
  // it was started for, so this mount must neither follow it (holding Create, then discarding the
  // answer as a brief change) nor drop it: it stays parked in the draft for when that brief reopens.
  it('parks an upload for another brief, then resumes it when that brief is open again', async () => {
    const pending = new Subject<unknown>();
    uploadCreativeAsset.mockReturnValue(pending);
    const first = await mount(true);
    choose(first.fixture, png());
    const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026' };
    expect(draft.redditImageUploadPendingBriefId).toBe(BRIEF_ID);
    first.fixture.destroy();
    resumeCreativeAssetUpload.mockReturnValue(pending);

    const switched = TestBed.createComponent(ImplementationTabComponent);
    let parked: CampaignImplementationDraft | null = null;
    switched.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (parked = d));
    switched.componentRef.setInput('draft', draft);
    switched.componentRef.setInput('redditCreativeEnabled', true);
    switched.componentRef.setInput('redditAssetUploadEnabled', true);
    switched.componentRef.setInput('briefPersistence', { status: 'idle', briefId: null, message: null, approved: false });
    switched.componentRef.setInput('briefData', brief());
    switched.detectChanges();
    await switched.whenStable();

    expect(resumeCreativeAssetUpload).not.toHaveBeenCalled();
    expect(at(switched).redditImageUploadStatus()).toBe('idle');
    expect(parked).not.toBeNull();
    expect((parked as unknown as CampaignImplementationDraft).redditImageUploadPendingName).toBe('promo.png');
    expect((parked as unknown as CampaignImplementationDraft).redditImageUploadPendingBriefId).toBe(BRIEF_ID);
    switched.destroy();

    const back = await mount(true, true, parked as unknown as CampaignImplementationDraft);
    expect(resumeCreativeAssetUpload).toHaveBeenCalledWith('reddit', BRIEF_ID);
    pending.next({ id: ASSET_ID, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true });
    back.fixture.detectChanges();
    expect(at(back.fixture).redditImageAssetId()).toBe(ASSET_ID);
  });

  // A new pick replaces the previous upload outright, a parked one included, so it is cancelled
  // rather than left running with nothing in the draft pointing at it.
  it('cancels a parked upload when another file is picked, even one that is refused', async () => {
    uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
    const first = await mount(true);
    choose(first.fixture, png());
    const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026', redditImageUploadPendingBriefId: 'another-brief' };
    first.fixture.destroy();
    cancelCreativeAssetUpload.mockClear();

    const second = await mount(true, true, draft);
    expect(at(second.fixture).redditImageUploadStatus()).toBe('idle');
    choose(second.fixture, new File([new Uint8Array(4)], 'promo.gif', { type: 'image/gif' }));

    expect(cancelCreativeAssetUpload).toHaveBeenCalled();
    expect(second.latest()?.redditImageUploadPendingName).toBe('');
  });

  it('shows a resumed upload that fails while the control is hidden, and holds Create until removed', async () => {
    const pending = new Subject<unknown>();
    uploadCreativeAsset.mockReturnValue(pending);
    const first = await mount(true);
    choose(first.fixture, png());
    const draft = first.latest() as CampaignImplementationDraft;
    first.fixture.destroy();
    resumeCreativeAssetUpload.mockReturnValue(pending);

    const f = (await mount(null, true, { ...draft, eventSlug: 'kubecon-eu-2026' })).fixture;
    const c = at(f);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    pending.error(new HttpErrorResponse({ status: 503 }));
    f.detectChanges();

    const block = f.nativeElement.querySelector('[data-testid="implementation-reddit-image-asset-block-uploadFailed"]') as HTMLElement | null;
    expect(block?.textContent).toContain('The Reddit image upload did not complete');
    expect(c.canSubmit()).toBe(false);

    (f.nativeElement.querySelector('[data-testid="implementation-reddit-image-asset-block-remove"] button') as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.canSubmit()).toBe(true);
  });

  it('does not hold Create on another brief for an upload that failed for the one left behind', async () => {
    const pending = new Subject<unknown>();
    uploadCreativeAsset.mockReturnValue(pending);
    const f = (await mount(true)).fixture;
    choose(f, png());
    const c = at(f);

    // A foundation switch with the tab open: the brief is cleared and the capabilities reset.
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: '0f8fad5b-d9cb-469f-a165-70867728950e', message: null, approved: true });
    f.componentRef.setInput('redditAssetUploadEnabled', null);
    pending.error(new HttpErrorResponse({ status: 503 }));
    f.detectChanges();

    expect(c.redditImageUploadStatus()).toBe('error');
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-image-asset-block-uploadFailed"]')).toBeNull();
  });

  // The live region must exist before the control does: created with it as upload support settles,
  // it would drop the first announcement.
  it('keeps the upload status live region mounted while the upload control is hidden', async () => {
    const f = (await mount(null)).fixture;
    expect(fileInput(f)).toBeNull();
    const live = f.nativeElement.querySelector('[data-testid="implementation-reddit-image-status-live"]') as HTMLElement | null;
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.getAttribute('aria-live')).toBe('polite');
  });

  // The failure must outlive a second tab switch too, or the block lifts and Create sends the
  // campaign without the image the operator chose and never removed.
  it('keeps a failed upload, and its hold on Create, across another tab switch', async () => {
    const pending = new Subject<unknown>();
    uploadCreativeAsset.mockReturnValue(pending);
    const first = await mount(true);
    choose(first.fixture, png());
    let draft = first.latest() as CampaignImplementationDraft;
    first.fixture.destroy();
    resumeCreativeAssetUpload.mockReturnValue(pending);

    const second = await mount(null, true, { ...draft, eventSlug: 'kubecon-eu-2026' });
    pending.error(new HttpErrorResponse({ status: 503 }));
    second.fixture.detectChanges();
    draft = second.latest() as CampaignImplementationDraft;
    expect(draft.redditImageUploadFailedBriefId).toBe(BRIEF_ID);
    second.fixture.destroy();
    resumeCreativeAssetUpload.mockReturnValue(null);

    const f = (await mount(null, true, { ...draft, eventSlug: 'kubecon-eu-2026' })).fixture;
    const c = at(f);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    f.detectChanges();

    expect(c.redditImageUploadStatus()).toBe('error');
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-image-asset-block-uploadFailed"]')).not.toBeNull();
    expect(c.canSubmit()).toBe(false);
  });

  it('says the upload was interrupted when there is nothing left to resume', async () => {
    uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
    const first = await mount(true);
    choose(first.fixture, png());
    const draft = first.latest() as CampaignImplementationDraft;
    first.fixture.destroy();

    const f = (await mount(true, true, { ...draft, eventSlug: 'kubecon-eu-2026' })).fixture;

    expect(at(f).redditImageUploadStatus()).toBe('error');
    expect(at(f).redditImageUploadError()).toBe('The upload of promo.png was interrupted. Choose the image again.');
    expect(at(f).redditImageAssetId()).toBe('');
  });

  it('does not send an asset uploaded to a different brief', async () => {
    const first = await mount(true);
    choose(first.fixture, png());
    const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026', redditImageAssetBriefId: 'another-brief' };
    first.fixture.destroy();

    const second = await mount(true, true, draft);
    const f = second.fixture;
    const q = (id: string): HTMLElement | null => f.nativeElement.querySelector(`[data-testid="${id}"]`);

    // Never sent, so never shown as usable: no "Uploaded", and Create blocked with a way out.
    expect(q('implementation-reddit-image-status')?.textContent).not.toContain('Uploaded');
    expect(q('implementation-reddit-image-asset-block-otherBrief')?.textContent).toContain('uploaded for a different brief');
    const c = at(f);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    expect(c.canSubmit()).toBe(false);
    c.submit();
    expect(createCampaign).not.toHaveBeenCalled();

    (q('implementation-reddit-image-asset-block-remove')?.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();

    expect(q('implementation-reddit-image-asset-block-otherBrief')).toBeNull();
    expect('imageAssetId' in submit(f)).toBe(false);
  });

  it('replaces the previous upload when a new pick is refused, and links the refusal to the input', async () => {
    const f = (await mount(true)).fixture;
    choose(f, png());
    choose(f, new File([new Uint8Array(4)], 'promo.gif', { type: 'image/gif' }));

    expect(at(f).redditImageAssetId()).toBe('');
    expect(fileInput(f)?.getAttribute('aria-describedby')).toContain('reddit-image-file-error');
    expect(fileInput(f)?.getAttribute('aria-invalid')).toBe('true');
    // The id the input names is the upload's own alert, not another platform's error.
    const described = f.nativeElement.querySelector('#reddit-image-file-error') as HTMLElement;
    expect(described.getAttribute('data-testid')).toBe('implementation-reddit-image-error');
    expect(described.textContent?.trim()).toBe(CREATIVE_ASSET_WRONG_TYPE_MESSAGE);
  });

  // The pick clears the old asset in the PARENT's draft too: otherwise a tab switch right after a
  // refused (or still-uploading) replacement restores the image the operator replaced.
  it.each([
    ['refused', (): File => new File([new Uint8Array(4)], 'promo.gif', { type: 'image/gif' })],
    ['still uploading', (): File => png()],
  ])('drops the replaced upload from the draft when the replacement is %s', async (label, replacement) => {
    const first = await mount(true);
    choose(first.fixture, png());
    expect(first.latest()?.redditImageAssetId).toBe(ASSET_ID);
    if (label === 'still uploading') {
      uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
    }

    choose(first.fixture, replacement());

    expect(first.latest()?.redditImageAssetId).toBe('');
    const draft = first.latest() as CampaignImplementationDraft;
    first.fixture.destroy();
    const second = await mount(true, true, { ...draft, eventSlug: 'kubecon-eu-2026' });
    expect('imageAssetId' in submit(second.fixture)).toBe(false);
  });

  it('sends imageAssetId instead of imageUrl once an image is uploaded', async () => {
    const f = (await mount(true)).fixture;
    typeImageUrl(f, 'https://cdn.example.org/promo.png');
    choose(f, png());

    const config = submit(f);

    expect(config['imageAssetId']).toBe(ASSET_ID);
    expect('imageUrl' in config).toBe(false);
  });

  it('falls back to the pasted image URL after the upload is removed', async () => {
    const f = (await mount(true)).fixture;
    typeImageUrl(f, 'https://cdn.example.org/promo.png');
    choose(f, png());
    (f.nativeElement.querySelector('[data-testid="implementation-reddit-image-remove"]') as HTMLButtonElement).click();
    f.detectChanges();

    const config = submit(f);

    expect('imageAssetId' in config).toBe(false);
    expect(config['imageUrl']).toBe('https://cdn.example.org/promo.png');
  });

  // Upstream refuses imageAssetId together with postUrl, where an imageUrl is merely ignored.
  it('withholds the uploaded image while a post URL is set', async () => {
    const f = (await mount(true)).fixture;
    choose(f, png());
    const post = f.nativeElement.querySelector('[data-testid="implementation-reddit-post-url"]') as HTMLInputElement;
    post.value = 'https://www.reddit.com/r/kubernetes/comments/abc123/attend/';
    post.dispatchEvent(new Event('input'));
    f.detectChanges();

    const config = submit(f);

    expect('imageAssetId' in config).toBe(false);
    expect(config['postUrl']).toBe('https://www.reddit.com/r/kubernetes/comments/abc123/attend/');
  });

  it('carries the uploaded image through a tab round-trip', async () => {
    const first = await mount(true);
    choose(first.fixture, png());
    const draft = first.latest();
    first.fixture.destroy();

    expect(draft?.redditImageAssetId).toBe(ASSET_ID);
    expect(draft?.redditImageAssetName).toBe('promo.png');
    expect(draft?.redditImageAssetBriefId).toBe(BRIEF_ID);

    const second = await mount(true, true, { ...(draft as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026' });
    expect(submit(second.fixture)['imageAssetId']).toBe(ASSET_ID);
  });

  it.each([
    ['a type outside the allowlist', new File([new Uint8Array(4)], 'promo.gif', { type: 'image/gif' }), CREATIVE_ASSET_WRONG_TYPE_MESSAGE],
    ['an image over the size limit', png(CREATIVE_ASSET_MAX_BYTES + 1), CREATIVE_ASSET_TOO_LARGE_MESSAGE],
  ])('refuses %s before uploading, with a readable alert', async (_label, file, message) => {
    const f = (await mount(true)).fixture;

    choose(f, file);

    expect(uploadCreativeAsset).not.toHaveBeenCalled();
    const alert = f.nativeElement.querySelector('[data-testid="implementation-reddit-image-error"]') as HTMLElement;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent?.trim()).toBe(message);
    expect(at(f).redditImageAssetId()).toBe('');
  });

  it.each([
    [413, {}, CREATIVE_ASSET_TOO_LARGE_MESSAGE],
    [415, {}, CREATIVE_ASSET_WRONG_TYPE_MESSAGE],
    [503, { error: 'busy', code: 'SERVICE_UNAVAILABLE' }, 'The image service is unavailable right now. Try again in a moment, or paste an image URL instead.'],
    [0, {}, 'The image service is unavailable right now. Try again in a moment, or paste an image URL instead.'],
    [400, { error: 'the image is truncated or corrupt', code: 'BAD_REQUEST' }, 'the image is truncated or corrupt'],
  ])('explains an upstream %i readably and keeps no asset', async (status, body, message) => {
    uploadCreativeAsset.mockReturnValue(throwError(() => new HttpErrorResponse({ status, error: body })));
    const f = (await mount(true)).fixture;

    choose(f, png());

    expect(at(f).redditImageUploadStatus()).toBe('error');
    expect(at(f).redditImageUploadError()).toBe(message);
    expect(at(f).redditImageAssetId()).toBe('');
  });

  /**
   * An upload retained across a tab round-trip while the capabilities are cleared (Optimize, then
   * back). The upload control is hidden then and the asset is withheld from the request, so the
   * create must be BLOCKED — never sent with no image — with a way out outside that hidden control.
   */
  describe('a retained upload while the capability is unknown or off', () => {
    async function remount(
      upload: boolean | null,
      creative: boolean | null,
      read: 'unknown' | 'pending' | 'ready' | 'failed'
    ): Promise<ComponentFixture<ImplementationTabComponent>> {
      const first = await mount(true);
      choose(first.fixture, png());
      const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026' };
      first.fixture.destroy();
      const f = (await mount(upload, creative as boolean, draft)).fixture;
      f.componentRef.setInput('redditCreativeEnabled', creative);
      f.componentRef.setInput('createCapabilityRead', read);
      const c = at(f);
      c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
      c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
      c.campaignForm.controls['startDate'].setValue('2026-09-01');
      c.campaignForm.controls['endDate'].setValue('2026-09-30');
      f.detectChanges();
      await f.whenStable();
      return f;
    }
    const q = (f: ComponentFixture<ImplementationTabComponent>, id: string): HTMLElement | null => f.nativeElement.querySelector(`[data-testid="${id}"]`);

    it('blocks Create while the capability read is pending, then sends the asset once it answers yes', async () => {
      const f = await remount(null, null, 'pending');

      expect(fileInput(f)).toBeNull();
      expect(at(f).canSubmit()).toBe(false);
      expect(q(f, 'implementation-reddit-image-asset-block-pending')?.textContent).toContain('Checking Reddit image upload support');
      expect(q(f, 'implementation-reddit-image-asset-block-live')?.textContent?.trim()).toBe('Checking Reddit image upload support…');
      at(f).submit();
      expect(createCampaign).not.toHaveBeenCalled();

      f.componentRef.setInput('redditCreativeEnabled', true);
      f.componentRef.setInput('redditAssetUploadEnabled', true);
      f.componentRef.setInput('createCapabilityRead', 'ready');
      f.detectChanges();
      await f.whenStable();

      expect(q(f, 'implementation-reddit-image-asset-block-live')?.textContent?.trim()).toBe('');
      expect(submit(f)['imageAssetId']).toBe(ASSET_ID);
    });

    it.each(['failed', 'unknown'] as const)('blocks Create with a Retry when the read is %s', async (read) => {
      const f = await remount(null, null, read);
      const retried = vi.fn();
      f.componentRef.instance.retryCreateCapabilities.subscribe(retried);

      expect(at(f).canSubmit()).toBe(false);
      expect(q(f, 'implementation-reddit-image-asset-block-failed')?.textContent).toContain('Could not confirm that Reddit image upload is supported');
      (q(f, 'implementation-reddit-image-asset-block-retry')?.querySelector('button') as HTMLButtonElement).click();

      expect(retried).toHaveBeenCalledTimes(1);
      expect(createCampaign).not.toHaveBeenCalled();
    });

    it('blocks Create when the upload capability is off, until the operator removes the image', async () => {
      const f = await remount(false, true, 'ready');

      expect(at(f).canSubmit()).toBe(false);
      expect(q(f, 'implementation-reddit-image-asset-block-unsupported')).not.toBeNull();

      (q(f, 'implementation-reddit-image-asset-block-remove')?.querySelector('button') as HTMLButtonElement).click();
      f.detectChanges();
      await f.whenStable();

      expect(q(f, 'implementation-reddit-image-asset-block-unsupported')).toBeNull();
      expect(at(f).redditImageAssetId()).toBe('');
      expect('imageAssetId' in submit(f)).toBe(false);
    });

    it('does not block while a post URL is set, since the asset is withheld by design then', async () => {
      const f = await remount(null, null, 'pending');
      const post = f.nativeElement.querySelector('[data-testid="implementation-reddit-post-url"]') as HTMLInputElement;
      post.value = 'https://www.reddit.com/r/kubernetes/comments/abc123/attend/';
      post.dispatchEvent(new Event('input'));
      f.detectChanges();

      expect(q(f, 'implementation-reddit-image-asset-block-pending')).toBeNull();
      expect(at(f).canSubmit()).toBe(true);
    });
  });
});
