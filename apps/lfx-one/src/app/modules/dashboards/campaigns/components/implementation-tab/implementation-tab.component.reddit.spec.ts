// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { REDDIT_CALL_TO_ACTIONS } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignCreateResult } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { configureGoogleTab, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

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
