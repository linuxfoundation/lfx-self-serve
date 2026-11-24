// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload, STATE_ONLY, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

describe('ImplementationTabComponent per-platform draft round-trip', () => {
  const EVENT_SLUG = 'kubecon-eu-2026';

  let createCampaign: ReturnType<typeof vi.fn>;

  /**
   * A brief that seeds all three platforms, so every assertion below has a re-stamped value to
   * beat. Without the seed a restored value and an unrestored default can look identical.
   */
  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: EVENT_SLUG, countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['linkedin-ads', 'reddit-ads', 'meta-ads'],
      structuredCopy: { google_search: { headlines: ['Attend KubeCon'], descriptions: ['Join us in September'] } },
      linkedInCopy: {
        variants: [{ headline: 'Brief headline', introText: 'Brief intro', destinationUrl: 'https://example.com/brief' }],
        recommendedGeoTargets: [{ urn: 'urn:li:geo:103644278', label: 'United States' }],
        recommendedTargetingProfile: 'cloud-native',
        // `populateFromBrief` reads `strategy.budgetRecommendation.lifetimeBudgetUsd` and, when it
        // is a finite number, seeds BOTH `linkedInBudgetUsd` and `linkedInLifetimeBudget` (true).
        // 7300/true is deliberately neither component default (500/false), which is what lets the
        // omitted-fields test below distinguish "the brief's seed survived" from "the restore
        // re-stamped the defaults". Without this seed that test asserts 500/false — the very
        // values a defaulting implementation would write — and so cannot fail.
        strategy: {
          budgetRecommendation: { dailyBudgetUsd: 250, lifetimeBudgetUsd: 7300, rationale: 'Brief recommendation' },
        },
      },
      redditCopy: {
        variants: [{ headline: 'Brief reddit headline', destinationUrl: 'https://example.com/brief' }],
        recommendedSubreddits: ['briefsub'],
        recommendedInterests: ['brief-interest'],
        recommendedKeywords: ['brief-keyword'],
        recommendedGeos: ['US'],
      },
      metaCopy: {
        variants: [{ primaryText: 'Brief primary', headline: 'Brief meta headline', description: 'Brief description' }],
        recommendedGeos: ['US'],
      },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;

  /**
   * Only the members these tests drive; the component's own members stay protected.
   *
   * The brief-derived arrays are typed READ-ONLY on purpose. They have no editor in the template,
   * so a test that writes one is manufacturing a state no user can reach — which is how the
   * removed round-trip tests came to assert the draft agreeing with itself. They are read here
   * only to check the BRIEF re-seeds them. `emitDraft` is absent for the same reason: calling it
   * by hand fakes the emission a real handler is supposed to make.
   */
  interface Internals {
    campaignForm: { controls: Record<string, { setValue(v: unknown): void; value: unknown }> };
    selectedPlatforms: { set(v: string[]): void };
    linkedInVariants: () => unknown[];
    linkedInBudgetUsd: () => number;
    linkedInLifetimeBudget: () => boolean;
    linkedInDailyCapUsd: { (): number | null; set(v: number | null): void };
    createBlockedReason: () => string | null;
    redditSubreddits: () => string[];
    redditInterests: () => string[];
    redditKeywords: () => string[];
    redditGeoTargets: () => string[];
    redditVariants: () => unknown[];
    redditBudgetUsd: () => number;
    redditObjective: () => string;
    redditPostUrl: () => string;
    redditConversionPixelId: () => string;
    redditImageUrl: () => string;
    redditCallToAction: () => string;
    redditNoAdWarning: () => string | null;
    canSubmit: () => boolean;
    metaVariants: () => unknown[];
    submit(): void;
  }
  const at = (f: ComponentFixture<ImplementationTabComponent>): Internals => f.componentInstance as unknown as Internals;

  /**
   * Mount as the parent does, carrying ONLY the previous mount's emitted draft — which is all
   * that survives the component's teardown in production.
   */
  async function mount(
    draft: CampaignImplementationDraft | null,
    // Left UNSET by default, which is the `null` the parent holds before its capability read
    // answers — so every test that does not name it runs with the authored-post controls
    // withheld, the state a deployment with the cutover dark is in.
    redditCreative?: boolean
  ): Promise<{
    fixture: ComponentFixture<ImplementationTabComponent>;
    latest: () => CampaignImplementationDraft | null;
  }> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    if (draft) f.componentRef.setInput('draft', draft);
    if (redditCreative !== undefined) f.componentRef.setInput('redditCreativeEnabled', redditCreative);
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    return { fixture: f, latest: () => captured };
  }

  /** Fill the non-platform fields `canSubmit` requires, so `submit()` reaches the service. */
  function makeSubmittable(f: ComponentFixture<ImplementationTabComponent>): void {
    const c = at(f);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
  }

  /**
   * Drive the REAL template bindings rather than the signals or any `set*` convenience method.
   *
   * This is the whole point of these three. The template binds `(input)`/`(change)` to
   * `onLinkedInBudgetInput` and `onLinkedInLifetimeBudgetChange`; a test driving a `set*` helper
   * instead stays green while `emitDraft()` is missing from the LIVE handler, leaving the
   * production regression path uncovered. That trap already cost this file once — see the note at
   * the removed `setLinkedInAccount`, which only a test ever called.
   */
  function typeRedditBudget(f: ComponentFixture<ImplementationTabComponent>, value: number): void {
    const input = f.nativeElement.querySelector('[data-testid="implementation-reddit-budget"]') as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  function pickRedditObjective(f: ComponentFixture<ImplementationTabComponent>, value: string): void {
    const select = f.nativeElement.querySelector('[data-testid="implementation-reddit-objective"]') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  function typeRedditPostUrl(f: ComponentFixture<ImplementationTabComponent>, value: string): void {
    const input = f.nativeElement.querySelector('[data-testid="implementation-reddit-post-url"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  /** Returns null when the capability withholds the control, which several tests assert on. */
  function redditImageUrlInput(f: ComponentFixture<ImplementationTabComponent>): HTMLInputElement | null {
    return f.nativeElement.querySelector('[data-testid="implementation-reddit-image-url"]') as HTMLInputElement | null;
  }

  function typeRedditImageUrl(f: ComponentFixture<ImplementationTabComponent>, value: string): void {
    const input = redditImageUrlInput(f) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  function pickRedditCallToAction(f: ComponentFixture<ImplementationTabComponent>, value: string): void {
    const select = f.nativeElement.querySelector('[data-testid="implementation-reddit-call-to-action"]') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  function typeLinkedInBudget(f: ComponentFixture<ImplementationTabComponent>, value: number): void {
    const input = f.nativeElement.querySelector('[data-testid="implementation-linkedin-budget"]') as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  /** The lifetime-budget checkbox carries no testid; it is the checkbox beside the budget input. */
  function toggleLinkedInLifetimeBudget(f: ComponentFixture<ImplementationTabComponent>, checked: boolean): void {
    const budget = f.nativeElement.querySelector('[data-testid="implementation-linkedin-budget"]') as HTMLInputElement;
    const box = budget.closest('.grid')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.checked = checked;
    box.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  /** The daily cap field (#5774); null while the lifetime budget is off, which several tests assert on. */
  function linkedInDailyCapInput(f: ComponentFixture<ImplementationTabComponent>): HTMLInputElement | null {
    return f.nativeElement.querySelector('[data-testid="implementation-linkedin-daily-cap"]') as HTMLInputElement | null;
  }

  /** The deployment offers the daily cap (`linkedInDailyCapEnabled`); left unset, the field is withheld. */
  function enableDailyCap(f: ComponentFixture<ImplementationTabComponent>): void {
    f.componentRef.setInput('linkedInDailyCapEnabled', true);
    f.detectChanges();
  }

  function typeLinkedInDailyCap(f: ComponentFixture<ImplementationTabComponent>, value: string): void {
    const input = linkedInDailyCapInput(f) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  /** The config the remounted component would dispatch for one platform. */
  function sentConfig(key: string): Record<string, unknown> {
    expect(createCampaign).toHaveBeenCalled();
    return createCampaign.mock.calls[0][0][key] as Record<string, unknown>;
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
        {
          provide: CampaignService,
          useValue: {
            createCampaign,
            // Two accounts, so a picked account is one a re-seed could not land on by default.
            getLinkedInAccounts: () =>
              of([
                { accountId: 'urn:li:sponsoredAccount:1', name: 'LF Account', status: 'ACTIVE' },
                { accountId: 'urn:li:sponsoredAccount:2', name: 'LF Events Account', status: 'ACTIVE' },
              ]),
            getLinkedInTargetingProfiles: () => of([]),
          },
        },
      ],
    }).compileComponents();
  });

  // === Reddit: the pre-submit no-ad warning ===

  /** Render the Reddit section, which is what `redditNoAdWarning` is scoped to. */
  function selectReddit(f: ComponentFixture<ImplementationTabComponent>): Internals {
    const c = at(f);
    c.selectedPlatforms.set(['reddit-ads']);
    f.detectChanges();
    return c;
  }

  const warningText = (f: ComponentFixture<ImplementationTabComponent>): string | undefined =>
    (f.nativeElement.querySelector('[data-testid="implementation-reddit-no-ad-warning"]') as HTMLElement | null)?.textContent?.trim();

  /**
   * The warning, and the fact that it is only a warning.
   *
   * Both creators accept a Reddit create with no post and no image — they make the campaign and its
   * ad group, return success, and leave nothing that can serve — so the button must stay live. The
   * `canSubmit` assertion is the half that matters most: turning this into a refusal would block a
   * create the platform makes, which is the one thing this section's controls are forbidden to do.
   *
   * The activation clause says "will not change that" rather than "stays refused permanently", for
   * the reason the post-submit sibling was corrected to the same wording in #3451: the clause has
   * to hold on BOTH arms, and only campaign-service refuses
   * (`RedditDispatcher.ToggleStatus` in `internal/dispatch/reddit.go`).
   * The legacy toggle has no ad-existence guard at all and goes through — to a campaign with
   * nothing to serve. Claiming a refusal there would be a sentence the running code never delivers.
   */
  it('warns before submit when a reddit create would make no ad, without blocking it', async () => {
    const f = (await mount(null, true)).fixture;
    const c = selectReddit(f);

    expect(c.redditNoAdWarning()).toBe(
      'No post URL and no image URL, so this campaign is created with no ad: the campaign and its ad group are made and the create reports success, ' +
        'but nothing serves. Activating it from LFX will not change that, so either supply a post above or build and launch the campaign in Reddit Ads Manager.'
    );
    expect(warningText(f)).toBe(c.redditNoAdWarning());
    expect(c.canSubmit()).toBe(true);
  });

  /**
   * With the authored-post controls withheld there is no image field on screen, so naming one would
   * be advice the operator cannot take. Asserted at both withheld states, since `null` (unanswered)
   * and `false` (answered no) reach the template by different routes.
   */
  it.each([[undefined], [false]])('names only the post url while redditCreativeEnabled is %s', STATE_ONLY, async (capability) => {
    const f = (await mount(null, capability as boolean | undefined)).fixture;
    const c = selectReddit(f);

    expect(c.redditNoAdWarning()).toContain('No post URL, so this campaign is created with no ad');
    expect(c.redditNoAdWarning()).not.toContain('image URL');
  });

  /** A post URL is the one answer that works on both arms, so it clears the warning on both. */
  it.each([[undefined], [true]])('clears once a post url is typed, with redditCreativeEnabled %s', async (capability) => {
    const f = (await mount(null, capability as boolean | undefined)).fixture;
    const c = selectReddit(f);
    expect(c.redditNoAdWarning()).not.toBeNull();

    typeRedditPostUrl(f, 'https://redd.it/abc123');

    expect(c.redditNoAdWarning()).toBeNull();
    expect(warningText(f)).toBeUndefined();
  });

  /** An image authors the post upstream, so with the capability granted it is a real answer too. */
  it('clears once an image url is typed while the capability is granted', async () => {
    const f = (await mount(null, true)).fixture;
    const c = selectReddit(f);

    typeRedditImageUrl(f, 'https://cdn.example.org/promo.png');

    expect(c.redditNoAdWarning()).toBeNull();
  });

  /**
   * The asymmetry that makes this warning worth having, and the one a warning keyed on the controls
   * instead of on the payload's own gates would get wrong: a draft written while the capability was
   * granted still carries an image, the remount still remembers it, and the request still drops it
   * — so there is still no ad, and the warning must still fire.
   */
  it('keeps warning about a remembered image the request will not carry', async () => {
    const granted = await mount(null, true);
    typeRedditImageUrl(granted.fixture, 'https://cdn.example.org/promo.png');
    const draft = granted.latest();
    granted.fixture.destroy();

    const withheld = await mount(draft, false);
    const c = selectReddit(withheld.fixture);

    expect(c.redditImageUrl()).toBe('https://cdn.example.org/promo.png');
    expect(c.redditNoAdWarning()).not.toBeNull();
  });

  /** Nothing here belongs to a campaign Reddit is not part of. */
  it('says nothing when reddit is not selected', STATE_ONLY, async () => {
    const f = (await mount(null, true)).fixture;
    const c = at(f);
    c.selectedPlatforms.set(['linkedin-ads']);
    f.detectChanges();

    expect(c.redditNoAdWarning()).toBeNull();
  });

  /**
   * How it reaches a screen reader, which is a separate question from what it says — and the same
   * one the Google warning's region answers. The region must be in the DOM BEFORE the sentence
   * appears: an aria-live element inserted with its text already in it is not reliably announced,
   * and the visible copy's guard IS the sentence, so no placement inside that guard works.
   *
   * Each assertion fails against a different wrong fix: the region existing while empty rules out
   * wrapping it in an `@if`; the text pins that it carries the message; and the bare `<p>` rules
   * out putting `role="status"` on the visible element, which would announce it twice.
   */
  it('announces the no-ad warning politely, from a region that outlives it', async () => {
    const f = (await mount(null, true)).fixture;
    const find = (testId: string): HTMLElement | null => f.nativeElement.querySelector(`[data-testid="${testId}"]`);
    // Away from the brief's own selection first, so the region is observed with nothing to say and
    // the sentence arrives as a CONTENT change in an element that already existed.
    at(f).selectedPlatforms.set(['linkedin-ads']);
    f.detectChanges();

    const live = find('implementation-reddit-no-ad-live');
    expect(live).not.toBeNull();
    expect(live?.textContent?.trim()).toBe('');
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.getAttribute('aria-atomic')).toBe('true');

    const c = selectReddit(f);
    expect(find('implementation-reddit-no-ad-live')).toBe(live);
    expect(live?.textContent?.trim()).toBe(c.redditNoAdWarning());

    const visible = find('implementation-reddit-no-ad-warning');
    expect(visible?.getAttribute('role')).toBeNull();
    expect(visible?.getAttribute('aria-live')).toBeNull();
  });

  // === LinkedIn: the budget pair ===

  /**
   * Driven through the template's own `(input)` and `(change)` bindings. The budget pair's loss
   * is measured in money — a silent revert puts the campaign back to $500 daily, a spend decision
   * the operator did not make and the form does not show them re-making.
   */
  it('carries the linkedin budget pair through a tab round-trip and into the request', async () => {
    const first = await mount(null);
    typeLinkedInBudget(first.fixture, 2500);
    // FALSE, against the brief seed's `true`: a restore arm that silently re-stamped the seed
    // would still satisfy an assertion of `true`.
    toggleLinkedInLifetimeBudget(first.fixture, false);
    const draft = first.latest();
    first.fixture.destroy();

    expect(draft?.linkedInBudgetUsd).toBe(2500);
    expect(draft?.linkedInLifetimeBudget).toBe(false);

    const second = await mount(draft);
    const c = at(second.fixture);
    c.selectedPlatforms.set(['linkedin-ads']);
    makeSubmittable(second.fixture);
    c.campaignForm.controls['linkedInGeoTargets'].setValue([{ urn: 'urn:li:geo:103644278', label: 'United States' }]);
    second.fixture.detectChanges();
    c.submit();

    expect(c.linkedInBudgetUsd()).toBe(2500);
    expect(c.linkedInLifetimeBudget()).toBe(false);
    const config = sentConfig('linkedInConfig');
    expect(config['budgetUsd']).toBe(2500);
    expect(config['lifetimeBudget']).toBe(false);
  });

  // === LinkedIn: the daily cap beside a lifetime budget (#5774) ===

  /** Driven through the template's own bindings, like the budget pair above. */
  it('carries the linkedin daily cap through a tab round-trip and into the request', async () => {
    const first = await mount(null);
    enableDailyCap(first.fixture);
    typeLinkedInBudget(first.fixture, 1000);
    toggleLinkedInLifetimeBudget(first.fixture, true);
    typeLinkedInDailyCap(first.fixture, '20');
    const draft = first.latest();
    first.fixture.destroy();

    expect(draft?.linkedInDailyCapUsd).toBe(20);

    const second = await mount(draft);
    enableDailyCap(second.fixture);
    const c = at(second.fixture);
    c.selectedPlatforms.set(['linkedin-ads']);
    makeSubmittable(second.fixture);
    c.campaignForm.controls['linkedInGeoTargets'].setValue([{ urn: 'urn:li:geo:103644278', label: 'United States' }]);
    second.fixture.detectChanges();
    c.submit();

    expect(linkedInDailyCapInput(second.fixture)?.value).toBe('20');
    const config = sentConfig('linkedInConfig');
    expect(config['lifetimeBudget']).toBe(true);
    expect(config['budgetUsd']).toBe(1000);
    expect(config['dailyCapUsd']).toBe(20);
  });

  it('shows the daily cap only beside a lifetime budget, and drops it when the lifetime budget is turned off', async () => {
    const { fixture } = await mount(null);
    enableDailyCap(fixture);
    toggleLinkedInLifetimeBudget(fixture, false);
    expect(linkedInDailyCapInput(fixture)).toBeNull();

    typeLinkedInBudget(fixture, 1000);
    toggleLinkedInLifetimeBudget(fixture, true);
    typeLinkedInDailyCap(fixture, '20');
    toggleLinkedInLifetimeBudget(fixture, false);

    expect(linkedInDailyCapInput(fixture)).toBeNull();
    const c = at(fixture);
    expect(c.linkedInDailyCapUsd()).toBeNull();
    c.selectedPlatforms.set(['linkedin-ads']);
    makeSubmittable(fixture);
    c.campaignForm.controls['linkedInGeoTargets'].setValue([{ urn: 'urn:li:geo:103644278', label: 'United States' }]);
    fixture.detectChanges();
    c.submit();
    expect('dailyCapUsd' in sentConfig('linkedInConfig')).toBe(false);
  });

  it('refuses an entry the browser cannot parse instead of reading it as no cap', async () => {
    const { fixture } = await mount(null);
    enableDailyCap(fixture);
    typeLinkedInBudget(fixture, 1000);
    toggleLinkedInLifetimeBudget(fixture, true);
    // A number input holding `1e` reports value '' with validity.badInput; jsdom does not model it.
    const input = linkedInDailyCapInput(fixture) as HTMLInputElement;
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true } });
    typeLinkedInDailyCap(fixture, '');

    expect(at(fixture).linkedInDailyCapUsd()).toBeNaN();
    const error = fixture.nativeElement.querySelector('[data-testid="implementation-linkedin-daily-cap-error"]') as HTMLElement | null;
    expect(error?.textContent).toContain('Enter the daily cap in US dollars');
    expect(at(fixture).createBlockedReason()).toBe('LinkedIn Ads: fix the daily cap.');
  });

  it('restores an unparsable daily cap as no cap after a remount, as its empty box shows', async () => {
    const first = await mount(null);
    enableDailyCap(first.fixture);
    typeLinkedInBudget(first.fixture, 1000);
    toggleLinkedInLifetimeBudget(first.fixture, true);
    const input = linkedInDailyCapInput(first.fixture) as HTMLInputElement;
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true } });
    typeLinkedInDailyCap(first.fixture, '');
    expect(at(first.fixture).linkedInDailyCapUsd()).toBeNaN();
    const draft = first.latest();
    first.fixture.destroy();
    expect(draft?.linkedInDailyCapUsd).toBeNaN();

    const second = await mount(draft);
    enableDailyCap(second.fixture);
    const c = at(second.fixture);
    expect(c.linkedInDailyCapUsd()).toBeNull();
    expect(linkedInDailyCapInput(second.fixture)?.value).toBe('');
    expect(second.fixture.nativeElement.querySelector('[data-testid="implementation-linkedin-daily-cap-error"]')).toBeNull();
    c.selectedPlatforms.set(['linkedin-ads']);
    expect(c.createBlockedReason()).not.toBe('LinkedIn Ads: fix the daily cap.');
  });

  it('leaves an entry the browser cannot parse in the box instead of writing over it', async () => {
    const { fixture } = await mount(null);
    enableDailyCap(fixture);
    typeLinkedInBudget(fixture, 1000);
    toggleLinkedInLifetimeBudget(fixture, true);
    typeLinkedInDailyCap(fixture, '20');
    const input = linkedInDailyCapInput(fixture) as HTMLInputElement;
    // Record what the binding writes into the box from here on.
    const writes: string[] = [];
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => '',
      set: (v: string) => writes.push(String(v)),
    });
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true } });
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(at(fixture).linkedInDailyCapUsd()).toBeNaN();
    expect(writes).toEqual([]);
    expect(at(fixture).createBlockedReason()).toBe('LinkedIn Ads: fix the daily cap.');
  });

  it('treats an emptied daily cap as no cap', async () => {
    const { fixture } = await mount(null);
    enableDailyCap(fixture);
    typeLinkedInBudget(fixture, 1000);
    toggleLinkedInLifetimeBudget(fixture, true);
    typeLinkedInDailyCap(fixture, '20');
    typeLinkedInDailyCap(fixture, '');
    expect(at(fixture).linkedInDailyCapUsd()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-linkedin-daily-cap-error"]')).toBeNull();
  });

  it.each([
    // The rest of the rules are table rows in `campaign-linkedin-form.utils.spec.ts` (#5980).
    ["under LinkedIn's $10 daily minimum", '9.99', 'at least $10'],
  ])('blocks Create, with the reason under the field, for a daily cap %s', async (_name, value, message) => {
    const { fixture } = await mount(null);
    enableDailyCap(fixture);
    const c = at(fixture);
    c.selectedPlatforms.set(['linkedin-ads']);
    makeSubmittable(fixture);
    c.campaignForm.controls['linkedInGeoTargets'].setValue([{ urn: 'urn:li:geo:103644278', label: 'United States' }]);
    typeLinkedInBudget(fixture, 1000);
    toggleLinkedInLifetimeBudget(fixture, true);
    typeLinkedInDailyCap(fixture, value);

    const error = fixture.nativeElement.querySelector('[data-testid="implementation-linkedin-daily-cap-error"]') as HTMLElement | null;
    expect(error?.textContent).toContain(message);
    expect(c.createBlockedReason()).toBe('LinkedIn Ads: fix the daily cap.');

    expect(linkedInDailyCapInput(fixture)?.getAttribute('aria-describedby')).toBe(
      'implementation-linkedin-daily-cap-hint implementation-linkedin-daily-cap-error'
    );

    typeLinkedInDailyCap(fixture, '20');
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-linkedin-daily-cap-error"]')).toBeNull();
    expect(linkedInDailyCapInput(fixture)?.getAttribute('aria-describedby')).toBe('implementation-linkedin-daily-cap-hint');
    expect(c.createBlockedReason()).not.toBe('LinkedIn Ads: fix the daily cap.');
  });

  it.each([
    // Unknown (null) is the same rule, a table row in `campaign-linkedin-form.utils.spec.ts` (#5980).
    ['off', false],
  ])('withholds the daily cap, and sends none, while the deployment capability is %s', async (_name, enabled) => {
    const { fixture } = await mount(null);
    if (enabled !== null) {
      fixture.componentRef.setInput('linkedInDailyCapEnabled', enabled);
      fixture.detectChanges();
    }
    typeLinkedInBudget(fixture, 1000);
    toggleLinkedInLifetimeBudget(fixture, true);
    expect(linkedInDailyCapInput(fixture)).toBeNull();

    // A cap restored from a draft written while the capability was on is not sent either.
    const c = at(fixture);
    c.linkedInDailyCapUsd.set(20);
    c.selectedPlatforms.set(['linkedin-ads']);
    makeSubmittable(fixture);
    c.campaignForm.controls['linkedInGeoTargets'].setValue([{ urn: 'urn:li:geo:103644278', label: 'United States' }]);
    fixture.detectChanges();
    expect(c.createBlockedReason()).not.toBe('LinkedIn Ads: fix the daily cap.');
    c.submit();
    expect('dailyCapUsd' in sentConfig('linkedInConfig')).toBe(false);
  });

  // === Handler emission, which naming the field in `emitDraft` does not give you ===

  /**
   * These handlers mutate signals `campaignForm.valueChanges` cannot see, so without their
   * own `emitDraft()` call the parent never learns the edit — and the field is lost despite being
   * named in the emit.
   *
   * The regression protection is that these drive the REAL bindings and nothing else: each
   * dispatches a genuine `input`/`change` event at the template's own control and then reads the
   * draft the component emitted of its own accord. `Internals` deliberately exposes no
   * `emitDraft`, so no test here can supply the emission the handler is supposed to make.
   *
   * That property is the whole point, because its absence is what let the defect hide: the
   * earlier versions of these tests drove `set*` helpers the template never called, and stayed
   * green with `emitDraft()` deleted from either live LinkedIn handler. Driving the binding is
   * what makes that mutation fail, so a `set*`-style shortcut must not come back.
   */
  it('emits the draft when the reddit budget handler runs', async () => {
    const first = await mount(null);
    typeRedditBudget(first.fixture, 640);

    expect(first.latest()?.redditBudgetUsd).toBe(640);
  });

  it('emits the draft when the reddit objective handler runs', async () => {
    const first = await mount(null);
    pickRedditObjective(first.fixture, 'traffic');

    expect(first.latest()?.redditObjective).toBe('traffic');
  });

  it('emits the draft when the reddit post url handler runs', async () => {
    const first = await mount(null);
    typeRedditPostUrl(first.fixture, 'https://redd.it/abc123');

    expect(first.latest()?.redditPostUrl).toBe('https://redd.it/abc123');
  });

  it('emits the draft when the reddit image url handler runs', async () => {
    const first = await mount(null, true);
    typeRedditImageUrl(first.fixture, 'https://cdn.example.org/promo.png');

    expect(first.latest()?.redditImageUrl).toBe('https://cdn.example.org/promo.png');
  });

  it('emits the draft when the reddit call to action handler runs', async () => {
    const first = await mount(null, true);
    pickRedditCallToAction(first.fixture, 'Sign Up');

    expect(first.latest()?.redditCallToAction).toBe('Sign Up');
  });

  it('emits the draft when the linkedin budget handler runs', async () => {
    const first = await mount(null);
    typeLinkedInBudget(first.fixture, 1750);

    expect(first.latest()?.linkedInBudgetUsd).toBe(1750);
  });

  it('emits the draft when the linkedin lifetime-budget handler runs', async () => {
    const first = await mount(null);
    // Toggled to FALSE, away from the brief seed's `true`. Asserting `true` here would match the
    // seed the mount already produced, so dropping `emitDraft()` from the live handler would keep
    // this green — the mutation this test exists to catch.
    toggleLinkedInLifetimeBudget(first.fixture, false);

    expect(first.latest()?.linkedInLifetimeBudget).toBe(false);
  });

  /**
   * An older draft carries none of the budget fields, and absence must mean "keep what the brief
   * seeded" rather than "the user chose the defaults" — the same rule the Meta block follows.
   *
   * Without it, a draft persisted before this shipped would wipe a Reddit campaign's budget on the
   * next tab switch, which would be a strictly worse bug than the one being fixed.
   *
   * The LinkedIn pair is what gives this test teeth, and it only does so because `brief()` seeds
   * `strategy.budgetRecommendation.lifetimeBudgetUsd`. The remount therefore starts at 7300/true,
   * NOT at the component's 500/false, so an `applyDraft` that wrote the defaults over an omitted
   * legacy field — the exact regression this guards — lands on 500/false and fails here. Asserting
   * the defaults back, as an earlier revision did, agreed with that broken implementation: fixture
   * and code shared the 500/false assumption, so the test passed either way while a real brief
   * carrying a non-default lifetime budget would be silently downgraded (LFXV2-3230 review).
   *
   * Reddit has no brief-seeded budget to beat, so its 500 is the component default by nature; it
   * is asserted to pin that an omitted field is not turned into some OTHER value — and the same
   * for `redditObjective` and the three promoted-post fields, which every draft written before
   * those controls shipped omits. The post fields start EMPTY by design: the brief recommends no
   * post and no image, so there is nothing to seed and an omitted field must leave them blank
   * rather than acquire a value from anywhere.
   */
  it('leaves the platform values seeded when an older draft omits them', STATE_ONLY, async () => {
    const first = await mount(null);
    const legacy = { ...(first.latest() as CampaignImplementationDraft) } as Record<string, unknown>;
    for (const key of [
      'redditBudgetUsd',
      'redditObjective',
      'redditPostUrl',
      'redditImageUrl',
      'redditCallToAction',
      'linkedInBudgetUsd',
      'linkedInLifetimeBudget',
    ]) {
      delete legacy[key];
    }
    first.fixture.destroy();

    // Guard the guard: if the brief ever stops seeding a non-default pair, the assertions below
    // silently go back to agreeing with the defaults, and this test stops being able to fail.
    expect(legacy['linkedInBudgetUsd']).toBeUndefined();
    expect(legacy['linkedInLifetimeBudget']).toBeUndefined();

    const second = await mount(legacy as unknown as CampaignImplementationDraft);
    const c = at(second.fixture);

    expect(c.redditBudgetUsd()).toBe(500);
    expect(c.redditObjective()).toBe('conversions');
    expect(c.redditPostUrl()).toBe('');
    expect(c.redditImageUrl()).toBe('');
    expect(c.redditCallToAction()).toBe('');
    expect(c.linkedInBudgetUsd()).toBe(7300);
    expect(c.linkedInLifetimeBudget()).toBe(true);
  });

  /**
   * The brief-derived arrays are re-seeded from the brief on every mount, which is WHY the draft
   * does not carry them (LFXV2-3230 review). This is the test that keeps that justification
   * honest: if `populateFromBrief` ever stopped re-seeding one of them, dropping it from the draft
   * would become a real loss and this goes red.
   *
   * Mounting with a draft present is the point — it proves the restore leaves them alone rather
   * than overwriting the fresh seed with a stale copy, which is what carrying them used to do.
   *
   * All SIX excluded arrays are asserted, and the count is the point: `emitDraft`'s note names
   * six, and an earlier revision missed `redditVariants`, so dropping it from the brief seed stayed
   * green under a docblock claiming every array was covered. `linkedInVariants` left the set when it
   * gained an editor (#5547); its round trip is tested with the LinkedIn variant editor.
   */
  it('re-seeds the brief-derived arrays from the brief on remount rather than from the draft', STATE_ONLY, async () => {
    const first = await mount(null);
    const draft = first.latest();
    first.fixture.destroy();

    const second = await mount(draft);
    const c = at(second.fixture);

    expect(c.redditSubreddits()).toEqual(['briefsub']);
    expect(c.redditInterests()).toEqual(['brief-interest']);
    expect(c.redditKeywords()).toEqual(['brief-keyword']);
    expect(c.redditGeoTargets()).toEqual(['US']);
    expect(c.redditVariants()).toEqual([{ headline: 'Brief reddit headline', destinationUrl: 'https://example.com/brief' }]);
    expect(c.metaVariants()).toEqual([{ primaryText: 'Brief primary', headline: 'Brief meta headline', description: 'Brief description' }]);
  });

  /**
   * A draft written by an OLDER build still carries the arrays. The restore must IGNORE them, not
   * replay them over the brief's fresh seed — that stale-copy replay is the concrete harm the
   * `!== undefined` arms were doing, since an empty array is `undefined`-negative and wins.
   *
   * Every array the stale draft supplies is also asserted on the remount. `redditVariants: []` was
   * supplied here without ever being read back, so a restore arm replaying it would have wiped the
   * brief's variants while this test stayed green (LFXV2-3230 review).
   */
  it('ignores brief-derived arrays left in a draft by an older build', STATE_ONLY, async () => {
    const first = await mount(null);
    const stale = {
      ...(first.latest() as CampaignImplementationDraft),
      redditSubreddits: [],
      redditInterests: ['stale-interest'],
      redditKeywords: [],
      redditGeoTargets: ['ZZ'],
      redditVariants: [],
      metaVariants: [],
    } as unknown as CampaignImplementationDraft;
    first.fixture.destroy();

    const second = await mount(stale);
    const c = at(second.fixture);

    // The brief's values, not the draft's — and emphatically not the empty lists.
    expect(c.redditSubreddits()).toEqual(['briefsub']);
    expect(c.redditInterests()).toEqual(['brief-interest']);
    expect(c.redditKeywords()).toEqual(['brief-keyword']);
    expect(c.redditGeoTargets()).toEqual(['US']);
    // Asserted by VALUE, not by length: the stale draft supplies `redditVariants: []`, so a
    // length check alone would pass on a replay of any non-empty list, and the seventh array was
    // supplied here but never checked at all until LFXV2-3230 review.
    expect(c.redditVariants()).toEqual([{ headline: 'Brief reddit headline', destinationUrl: 'https://example.com/brief' }]);
    expect(c.metaVariants()).toHaveLength(1);
  });
});
