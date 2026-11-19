// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft, CampaignPlatformResult } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { SEED_KEYWORD, configureGoogleTab, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

/**
 * The remaining signal-backed values, carried across the destroy/remount the parent's
 * `@switch`/`@case` performs on every tab visit (LFXV2-3230, and LFXV2-3315 for the Reddit
 * budget it names).
 *
 * Every test here asserts what the REMOUNTED component would SUBMIT, not that the emitted draft
 * object grew a key. A field added to `emitDraft` but never restored in `applyDraft` still loses
 * the user's edit, and a shape assertion on the draft passes throughout that failure — so the
 * round trip is the only assertion that means anything.
 *
 * Each edited value is deliberately DIFFERENT from both the component default and the brief's
 * recommendation. Reddit's brief seed is the trap: the component re-runs `populateFromBrief` on
 * every mount, so asserting the brief's own numbers back would pass with the restore deleted.
 */
/**
 * The draft with each LinkedIn variant's `key` blanked. A key only names a variant within one mount
 * and every seed makes new ones, so two mounts of the same brief agree on everything else.
 */
function withoutLinkedInVariantKeys(draft: CampaignImplementationDraft | null): CampaignImplementationDraft | null {
  return draft && { ...draft, linkedInVariants: draft.linkedInVariants?.map((variant) => ({ ...variant, key: '' })) };
}

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
    const f = TestBed.createComponent(ImplementationTabComponent);
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

  /** Returns null when the objective is not Video Views, which the show/hide tests assert on. */
  function redditVideoGoalSelect(f: ComponentFixture<ImplementationTabComponent>): HTMLSelectElement | null {
    return f.nativeElement.querySelector('[data-testid="implementation-reddit-video-goal"]') as HTMLSelectElement | null;
  }

  function pickRedditVideoGoal(f: ComponentFixture<ImplementationTabComponent>, value: string): void {
    const select = redditVideoGoalSelect(f) as HTMLSelectElement;
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

  // === Reddit: the bound controls ===

  /**
   * Driven through the real `(input)` binding: a test calling `redditBudgetUsd.set` directly would
   * stay green with the handler's `emitDraft()` removed, since it never exercises the emission
   * path a live edit takes.
   *
   * 750 is neither the component's 500 default nor anything the brief carries, so the assertion
   * cannot be satisfied by a re-stamp.
   */
  it('carries the reddit budget through a tab round-trip and into the request', async () => {
    const first = await mount(null);
    typeRedditBudget(first.fixture, 750);
    const draft = first.latest();
    first.fixture.destroy();

    expect(draft?.redditBudgetUsd).toBe(750);

    const second = await mount(draft);
    at(second.fixture).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(second.fixture);
    second.fixture.detectChanges();
    at(second.fixture).submit();

    expect(at(second.fixture).redditBudgetUsd()).toBe(750);
    expect(sentConfig('redditConfig')['budgetUsd']).toBe(750);
  });

  /**
   * The untouched picker must dispatch what both creators already assumed. `conversions` is
   * `defaultRedditObjective` upstream and `config.objective ?? 'conversions'` in the legacy
   * creator, so sending it explicitly changes nobody's campaign — which is the only thing that
   * makes turning this control on safe. Pinned as a LITERAL: asserting the constant back would
   * agree with any value someone later seeded it with.
   */
  it('sends conversions as the default reddit objective', async () => {
    const f = (await mount(null)).fixture;
    at(f).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(f);
    f.detectChanges();
    at(f).submit();

    expect(sentConfig('redditConfig')['objective']).toBe('conversions');
  });

  /**
   * The picked objective through the full round trip. `awareness` is neither the component
   * default nor anything the brief carries, so a restore that dropped the field would fail here
   * rather than coincide with a re-stamp. Driven through the template's own `(change)` binding
   * for the reason the budget is.
   */
  it('carries the reddit objective through a tab round-trip and into the request', async () => {
    const first = await mount(null);
    pickRedditObjective(first.fixture, 'awareness');
    const draft = first.latest();
    first.fixture.destroy();

    expect(draft?.redditObjective).toBe('awareness');

    const second = await mount(draft);
    at(second.fixture).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(second.fixture);
    second.fixture.detectChanges();
    at(second.fixture).submit();

    expect(at(second.fixture).redditObjective()).toBe('awareness');
    expect(sentConfig('redditConfig')['objective']).toBe('awareness');
  });

  /**
   * The Post URL is UNGATED, and this is the test that holds that open. Both creators read the
   * field and build the ad from it — the legacy one extracts the post id in
   * `reddit-ads.service.ts` exactly as campaign-service does — so gating it behind the creative
   * capability would withhold a control that works in every deployment. Mounted with the
   * capability left unanswered, which is the state that withholds the other two.
   */
  it('offers the reddit post url while the creative capability is unanswered', async () => {
    const first = await mount(null);
    typeRedditPostUrl(first.fixture, 'https://www.reddit.com/r/kubernetes/comments/abc123/attend/');
    const draft = first.latest();
    first.fixture.destroy();

    expect(draft?.redditPostUrl).toBe('https://www.reddit.com/r/kubernetes/comments/abc123/attend/');

    const second = await mount(draft);
    at(second.fixture).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(second.fixture);
    second.fixture.detectChanges();
    at(second.fixture).submit();

    expect(at(second.fixture).redditPostUrl()).toBe('https://www.reddit.com/r/kubernetes/comments/abc123/attend/');
    expect(sentConfig('redditConfig')['postUrl']).toBe('https://www.reddit.com/r/kubernetes/comments/abc123/attend/');
  });

  /**
   * An untouched Post URL sends no key at all. An empty string is not neutral upstream: the Go
   * client branches on `PostURL != ""` to choose between promoting a post and authoring one, and
   * a blank value is the same decision as an absent key, so sending one only gives a reader
   * something to misread.
   */
  it('omits the reddit post url when it was never typed', async () => {
    const f = (await mount(null)).fixture;
    at(f).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(f);
    f.detectChanges();
    at(f).submit();

    expect('postUrl' in sentConfig('redditConfig')).toBe(false);
  });

  // === Reddit: the video goal ===

  /** Shown only for Video Views — the one objective that takes a goal. */
  it('shows the reddit video goal only while the objective is video_views', async () => {
    const f = (await mount(null)).fixture;

    expect(redditVideoGoalSelect(f)).toBeNull();

    pickRedditObjective(f, 'video_views');
    const select = redditVideoGoalSelect(f);
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map((o) => [o.value, o.text.trim()])).toEqual([
      ['', 'Select a video goal'],
      ['VIDEO_VIEW_6S', '6-second video views'],
      ['VIDEO_VIEW_15S', '15-second video views'],
    ]);

    pickRedditObjective(f, 'traffic');
    expect(redditVideoGoalSelect(f)).toBeNull();
  });

  /**
   * Both creators refuse `video_views` without a goal, and creation is async, so an unguarded
   * submit would end as a dead job. The create must be blocked, with the reason on screen.
   */
  it('cannot submit video_views without a video goal', async () => {
    const f = (await mount(null)).fixture;
    at(f).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(f);
    pickRedditObjective(f, 'video_views');
    // The Post URL is valid first, so the goal is the ONLY thing blocking the submit below: without
    // it the Post URL guard alone would keep canSubmit() false and hide a missing goal guard.
    typeRedditPostUrl(f, 'https://www.reddit.com/r/kubernetes/comments/abc123/video/');

    expect(at(f).canSubmit()).toBe(false);
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-video-goal-error"]')?.textContent).toContain('Choose a video goal');
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-video-post-error"]')).toBeNull();

    at(f).submit();
    expect(createCampaign).not.toHaveBeenCalled();

    pickRedditVideoGoal(f, 'VIDEO_VIEW_6S');
    expect(at(f).canSubmit()).toBe(true);
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-video-goal-error"]')).toBeNull();
  });

  /**
   * Video Views must promote an existing video post: an image URL authors an IMAGE post, which can
   * never earn a video view, and neither creator checks the creative against the objective.
   */
  it('cannot submit video_views without a post url, even with an image url', async () => {
    const f = (await mount(null, true)).fixture;
    at(f).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(f);
    pickRedditObjective(f, 'video_views');
    pickRedditVideoGoal(f, 'VIDEO_VIEW_6S');
    typeRedditImageUrl(f, 'https://example.com/banner.png');

    expect(at(f).canSubmit()).toBe(false);
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-video-post-error"]')?.textContent).toContain('enter its Post URL');

    typeRedditPostUrl(f, 'https://www.reddit.com/r/kubernetes/comments/abc123/video/');
    expect(at(f).canSubmit()).toBe(true);
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-video-post-error"]')).toBeNull();
  });

  /** The chosen goal reaches `redditConfig`, picked through the template and carried across a tab round-trip. */
  it('carries the reddit video goal through a tab round-trip and into the request', async () => {
    const first = await mount(null);
    pickRedditObjective(first.fixture, 'video_views');
    pickRedditVideoGoal(first.fixture, 'VIDEO_VIEW_15S');
    typeRedditPostUrl(first.fixture, 'https://www.reddit.com/r/kubernetes/comments/abc123/video/');
    const draft = first.latest();
    first.fixture.destroy();

    expect(draft?.redditVideoGoal).toBe('VIDEO_VIEW_15S');

    const second = await mount(draft);
    at(second.fixture).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(second.fixture);
    second.fixture.detectChanges();

    expect(redditVideoGoalSelect(second.fixture)?.value).toBe('VIDEO_VIEW_15S');

    at(second.fixture).submit();

    expect(sentConfig('redditConfig')).toMatchObject({ objective: 'video_views', videoGoal: 'VIDEO_VIEW_15S' });
  });

  /** A goal left over from an earlier Video Views choice is not sent with another objective. */
  it('omits the reddit video goal for any other objective', async () => {
    const f = (await mount(null)).fixture;
    pickRedditObjective(f, 'video_views');
    pickRedditVideoGoal(f, 'VIDEO_VIEW_6S');
    pickRedditObjective(f, 'awareness');
    at(f).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(f);
    f.detectChanges();
    at(f).submit();

    const config = sentConfig('redditConfig');
    expect(config['objective']).toBe('awareness');
    expect('videoGoal' in config).toBe(false);
  });

  /**
   * The authored-post pair on an explicit yes: typed through the real bindings, carried across
   * the remount, and dispatched. `Shop Now` is neither the component default nor upstream's, so a
   * restore that dropped the field could not coincide with a re-stamp.
   */
  it('carries the reddit creative pair through a tab round-trip and into the request', async () => {
    const first = await mount(null, true);
    typeRedditImageUrl(first.fixture, 'https://cdn.example.org/promo.png');
    pickRedditCallToAction(first.fixture, 'Shop Now');
    const draft = first.latest();
    first.fixture.destroy();

    expect(draft?.redditImageUrl).toBe('https://cdn.example.org/promo.png');
    expect(draft?.redditCallToAction).toBe('Shop Now');

    const second = await mount(draft, true);
    at(second.fixture).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(second.fixture);
    second.fixture.detectChanges();
    at(second.fixture).submit();

    const config = sentConfig('redditConfig');
    expect(config['imageUrl']).toBe('https://cdn.example.org/promo.png');
    expect(config['callToAction']).toBe('Shop Now');
  });

  /**
   * The empty CTA choice is a real selection, not a missing one: it sends no key, which is what
   * makes upstream apply `defaultRedditCTA`. Asserting the key's ABSENCE rather than an empty
   * string, because upstream rejects any value outside its set and `''` is not in it.
   */
  it('sends no call to action for the default choice', async () => {
    const f = (await mount(null, true)).fixture;
    typeRedditImageUrl(f, 'https://cdn.example.org/promo.png');
    at(f).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(f);
    f.detectChanges();
    at(f).submit();

    const config = sentConfig('redditConfig');
    expect(config['imageUrl']).toBe('https://cdn.example.org/promo.png');
    expect('callToAction' in config).toBe(false);
  });

  // === Reddit: the conversion pixel override (#3484) ===

  /** Mounts with the pixel capability answered, which `mount` leaves at the parent's `null`. */
  async function mountWithPixel(
    draft: CampaignImplementationDraft | null,
    pixel: boolean | null
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const mounted = await mount(draft);
    mounted.fixture.componentRef.setInput('redditConversionPixelEnabled', pixel);
    mounted.fixture.detectChanges();
    await mounted.fixture.whenStable();
    return mounted;
  }

  function redditPixelInput(f: ComponentFixture<ImplementationTabComponent>): HTMLInputElement | null {
    return f.nativeElement.querySelector('#reddit-conversion-pixel') as HTMLInputElement | null;
  }

  function typeRedditPixel(f: ComponentFixture<ImplementationTabComponent>, value: string): void {
    const input = redditPixelInput(f) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  function submitReddit(f: ComponentFixture<ImplementationTabComponent>): Record<string, unknown> {
    at(f).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(f);
    f.detectChanges();
    at(f).submit();
    return sentConfig('redditConfig');
  }

  it('renders the conversion pixel as an optional control when the capability says yes', async () => {
    const f = (await mountWithPixel(null, true)).fixture;
    at(f).selectedPlatforms.set(['reddit-ads']);
    f.detectChanges();

    const input = redditPixelInput(f);
    expect(input).not.toBeNull();
    expect(input?.required).toBe(false);
  });

  /**
   * Withheld at both `null` and `false`: the legacy creator never reads the field, so a rendered
   * control would accept a pixel and drop it without saying so.
   */
  it.each([[null], [false]])('renders no conversion pixel control while redditConversionPixelEnabled is %s', async (capability) => {
    const f = (await mountWithPixel(null, capability)).fixture;
    at(f).selectedPlatforms.set(['reddit-ads']);
    f.detectChanges();

    expect(redditPixelInput(f)).toBeNull();
  });

  it('sends a typed conversion pixel, trimmed, as redditConfig.conversionPixelId', async () => {
    const f = (await mountWithPixel(null, true)).fixture;
    typeRedditPixel(f, '  t2_synthpixel  ');

    expect(submitReddit(f)['conversionPixelId']).toBe('t2_synthpixel');
  });

  /** Blank means "use the connection's pixel" upstream, which is what an absent key says too. */
  it('omits conversionPixelId entirely when the pixel is left blank', async () => {
    const f = (await mountWithPixel(null, true)).fixture;
    typeRedditPixel(f, '   ');

    expect('conversionPixelId' in submitReddit(f)).toBe(false);
  });

  /** A pixel restored from a draft while the capability is off is kept in the draft but not sent. */
  it('does not send a remembered pixel while the capability is off', async () => {
    const first = await mountWithPixel(null, true);
    typeRedditPixel(first.fixture, 't2_synthpixel');
    const draft = first.latest();
    first.fixture.destroy();

    const f = (await mountWithPixel(draft, false)).fixture;

    expect(at(f).redditConversionPixelId()).toBe('t2_synthpixel');
    expect('conversionPixelId' in submitReddit(f)).toBe(false);
  });

  /**
   * A brief switch on a LIVE mount: the parent clears the draft and hands over the next brief, and
   * the component re-seeds in place. The pixel typed on the first brief must not ride along.
   */
  it('drops a typed pixel when a different brief is handed over', async () => {
    const mounted = await mountWithPixel(null, true);
    const f = mounted.fixture;
    typeRedditPixel(f, 't2_synthpixel');
    expect(mounted.latest()?.redditConversionPixelId).toBe('t2_synthpixel');

    const next = brief();
    f.componentRef.setInput('draft', null);
    f.componentRef.setInput('briefData', { ...next, eventDetails: { ...next.eventDetails, name: 'Open Source Summit', slug: 'oss-na-2026' } });
    f.detectChanges();
    await f.whenStable();

    expect(mounted.latest()?.eventSlug).toBe('oss-na-2026');
    expect(mounted.latest()?.redditConversionPixelId).toBe('');
    expect(redditPixelInput(f)?.value ?? '').toBe('');
    expect('conversionPixelId' in submitReddit(f)).toBe(false);
  });

  /**
   * The rest of the Reddit fields the brief does not derive, on the same live brief switch (#4589).
   * Every typed value is one neither the component default nor the brief carries, so a field that
   * survived the switch could not pass by coinciding with a re-seed.
   */
  it('drops every typed reddit field when a different brief is handed over', async () => {
    const mounted = await mount(null, true);
    const f = mounted.fixture;
    typeRedditBudget(f, 750);
    pickRedditObjective(f, 'video_views');
    pickRedditVideoGoal(f, 'VIDEO_VIEW_15S');
    typeRedditPostUrl(f, 'https://www.reddit.com/r/kubernetes/comments/abc123/attend/');
    typeRedditImageUrl(f, 'https://cdn.example.org/promo.png');
    pickRedditCallToAction(f, 'Shop Now');
    expect(mounted.latest()).toMatchObject({
      redditBudgetUsd: 750,
      redditObjective: 'video_views',
      redditVideoGoal: 'VIDEO_VIEW_15S',
      redditPostUrl: 'https://www.reddit.com/r/kubernetes/comments/abc123/attend/',
      redditImageUrl: 'https://cdn.example.org/promo.png',
      redditCallToAction: 'Shop Now',
    });

    const next = brief();
    f.componentRef.setInput('draft', null);
    f.componentRef.setInput('briefData', { ...next, eventDetails: { ...next.eventDetails, name: 'Open Source Summit', slug: 'oss-na-2026' } });
    f.detectChanges();
    await f.whenStable();

    expect(mounted.latest()).toMatchObject({
      eventSlug: 'oss-na-2026',
      redditBudgetUsd: 500,
      redditObjective: 'conversions',
      redditVideoGoal: '',
      redditPostUrl: '',
      redditImageUrl: '',
      redditCallToAction: '',
    });
    const el = (testId: string): HTMLInputElement | HTMLSelectElement =>
      f.nativeElement.querySelector(`[data-testid="implementation-reddit-${testId}"]`) as HTMLInputElement | HTMLSelectElement;
    expect(el('budget').value).toBe('500');
    expect(el('objective').value).toBe('conversions');
    expect(redditVideoGoalSelect(f)).toBeNull();
    expect(el('post-url').value).toBe('');
    expect(el('image-url').value).toBe('');
    expect(el('call-to-action').value).toBe('');

    const config = submitReddit(f);
    expect(config['budgetUsd']).toBe(500);
    expect(config['objective']).toBe('conversions');
    for (const key of ['videoGoal', 'postUrl', 'imageUrl', 'imageAssetId', 'callToAction']) {
      expect(key in config).toBe(false);
    }
  });

  // === The other platforms on the same live brief switch (#4624) ===

  /** The next brief: another event, same platforms. `strip` removes copy blocks the conditional resets key on. */
  function otherBrief(strip: (keyof CampaignBriefOutput)[] = []): CampaignBriefOutput {
    const next = brief() as unknown as Record<string, unknown>;
    for (const key of strip) delete next[key];
    return {
      ...next,
      eventDetails: { ...(next['eventDetails'] as object), name: 'Open Source Summit', slug: 'oss-na-2026' },
    } as unknown as CampaignBriefOutput;
  }

  /** Hand `next` to the SAME fixture as the parent does on a brief switch: the draft cleared first. */
  async function switchBrief(f: ComponentFixture<ImplementationTabComponent>, next: CampaignBriefOutput): Promise<void> {
    f.componentRef.setInput('draft', null);
    f.componentRef.setInput('briefData', next);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  }

  /** A first mount of `next`, the baseline a switched component must match: nothing but defaults and the brief. */
  async function freshMount(
    next: CampaignBriefOutput
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(ImplementationTabComponent);
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    f.componentRef.setInput('briefData', next);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return { fixture: f, latest: () => captured };
  }

  /** Submit one platform and return the config the service was called with on THIS submit. */
  function submitOne(f: ComponentFixture<ImplementationTabComponent>, platform: string, key: string): Record<string, unknown> {
    at(f).selectedPlatforms.set([platform]);
    makeSubmittable(f);
    f.detectChanges();
    expect(at(f).canSubmit()).toBe(true);
    at(f).submit();
    return createCampaign.mock.calls[createCampaign.mock.calls.length - 1][0][key] as Record<string, unknown>;
  }

  /** Typed values are neither default; the 7300/lifetime pair the first brief seeds is the conditional reset, as the next carries none. */
  it('drops every typed linkedin field when a different brief is handed over', async () => {
    const mounted = await mount(null);
    const f = mounted.fixture;
    at(f).selectedPlatforms.set(['linkedin-ads']);
    f.detectChanges();
    const q = (testId: string): HTMLElement => f.nativeElement.querySelector(`[data-testid="implementation-linkedin-${testId}"]`) as HTMLElement;
    const account = q('account') as HTMLSelectElement;
    account.value = 'urn:li:sponsoredAccount:2';
    account.dispatchEvent(new Event('change'));
    typeLinkedInBudget(f, 900);
    q('profile-mcp').click();
    f.detectChanges();
    expect(mounted.latest()).toMatchObject({
      linkedInAccountId: 'urn:li:sponsoredAccount:2',
      linkedInBudgetUsd: 900,
      linkedInLifetimeBudget: true,
      linkedInTargetingProfile: 'mcp',
    });

    const next = otherBrief();
    const nextCopy = (next as unknown as { linkedInCopy: Record<string, unknown> }).linkedInCopy;
    delete nextCopy['strategy'];
    await switchBrief(f, next);

    expect(mounted.latest()).toMatchObject({
      eventSlug: 'oss-na-2026',
      linkedInAccountId: 'urn:li:sponsoredAccount:1',
      linkedInBudgetUsd: 500,
      linkedInLifetimeBudget: false,
      linkedInTargetingProfile: 'cloud-native',
      linkedInGeoTargets: [{ urn: 'urn:li:geo:103644278', label: 'United States' }],
    });
    expect((q('account') as HTMLSelectElement).value).toBe('urn:li:sponsoredAccount:1');
    expect((q('budget') as HTMLInputElement).value).toBe('500');
    expect((q('budget').closest('.grid')?.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    expect(q('profile-cloud-native').getAttribute('aria-pressed')).toBe('true');
    expect(q('profile-mcp').getAttribute('aria-pressed')).toBe('false');

    const fresh = await freshMount(next);
    expect(withoutLinkedInVariantKeys(mounted.latest())).toEqual(withoutLinkedInVariantKeys(fresh.latest()));

    const config = submitOne(f, 'linkedin-ads', 'linkedInConfig');
    expect(config).toMatchObject({ budgetUsd: 500, lifetimeBudget: false, targetingProfile: 'cloud-native', adAccountId: 'urn:li:sponsoredAccount:1' });
    expect(config).toEqual(submitOne(fresh.fixture, 'linkedin-ads', 'linkedInConfig'));
  });

  /** The geos, profile and variants are seeded only from LinkedIn copy, so a brief without any opens on none. */
  it('clears the linkedin copy fields when the next brief carries no linkedin copy', async () => {
    const mounted = await mount(null);
    const f = mounted.fixture;
    at(f).selectedPlatforms.set(['linkedin-ads']);
    f.detectChanges();
    (f.nativeElement.querySelector('[data-testid="implementation-linkedin-profile-mcp"]') as HTMLElement).click();
    f.detectChanges();
    expect(at(f).linkedInVariants()).toHaveLength(1);

    await switchBrief(f, otherBrief(['linkedInCopy']));

    expect(mounted.latest()).toMatchObject({
      linkedInGeoTargets: [],
      linkedInTargetingProfile: 'cloud-native',
      linkedInBudgetUsd: 500,
      linkedInLifetimeBudget: false,
    });
    expect(at(f).linkedInVariants()).toEqual([]);
  });

  /** The variants and the four targeting lists are seeded only from Reddit copy, so a brief without any opens on none (#4648). */
  it('clears the reddit copy lists when the next brief carries no reddit copy', async () => {
    const mounted = await mount(null, true);
    const f = mounted.fixture;
    at(f).selectedPlatforms.set(['reddit-ads']);
    f.detectChanges();
    const section = (fixture: ComponentFixture<ImplementationTabComponent>): string =>
      (fixture.nativeElement.querySelector('[data-testid="implementation-reddit-section"]')?.textContent as string) ?? '';
    for (const seeded of ['briefsub', 'brief-interest', 'brief-keyword', 'Brief reddit headline']) expect(section(f)).toContain(seeded);
    expect(at(f).redditGeoTargets()).toEqual(['US']);

    const next = otherBrief(['redditCopy']);
    await switchBrief(f, next);

    expect(mounted.latest()?.eventSlug).toBe('oss-na-2026');
    for (const list of [at(f).redditVariants(), at(f).redditSubreddits(), at(f).redditInterests(), at(f).redditKeywords(), at(f).redditGeoTargets()]) {
      expect(list).toEqual([]);
    }
    at(f).selectedPlatforms.set(['reddit-ads']);
    f.detectChanges();
    for (const stale of ['briefsub', 'brief-interest', 'brief-keyword', 'Brief reddit headline']) expect(section(f)).not.toContain(stale);

    const fresh = await freshMount(next);
    expect(withoutLinkedInVariantKeys(mounted.latest())).toEqual(withoutLinkedInVariantKeys(fresh.latest()));
    fresh.fixture.componentRef.setInput('redditCreativeEnabled', true);
    at(fresh.fixture).selectedPlatforms.set(['reddit-ads']);
    fresh.fixture.detectChanges();
    expect(section(f)).toEqual(section(fresh.fixture));

    // No variants on either side, so the ad comes from a post: typed alike on both.
    for (const side of [f, fresh.fixture]) typeRedditPostUrl(side, 'https://www.reddit.com/r/kubernetes/comments/abc123/attend/');
    const config = submitOne(f, 'reddit-ads', 'redditConfig');
    expect(config).toMatchObject({ subreddits: [], interests: [], keywords: [], variants: [], geoTargets: ['US'] });
    expect(config).toEqual(submitOne(fresh.fixture, 'reddit-ads', 'redditConfig'));
  });

  /** Budget, legacy CPC bid and geos; the bidding capability is left unanswered, so the legacy bid box is the one shown. */
  it('drops every typed microsoft field when a different brief is handed over', async () => {
    const mounted = await mount(null);
    const f = mounted.fixture;
    at(f).selectedPlatforms.set(['microsoft-ads']);
    f.detectChanges();
    const q = (testId: string): HTMLInputElement => f.nativeElement.querySelector(`[data-testid="implementation-microsoft-${testId}"]`) as HTMLInputElement;
    for (const [testId, value, event] of [
      ['budget', '650', 'input'],
      ['cpc-bid', '2.5', 'input'],
      ['geo-add', 'JP', 'change'],
    ] as const) {
      q(testId).value = value;
      q(testId).dispatchEvent(new Event(event));
      f.detectChanges();
    }
    expect(mounted.latest()).toMatchObject({ microsoftBudgetUsd: 650, microsoftCpcBid: '2.5', microsoftGeoTargets: ['JP'] });

    const next = otherBrief();
    await switchBrief(f, next);

    expect(mounted.latest()).toMatchObject({ eventSlug: 'oss-na-2026', microsoftBudgetUsd: 500, microsoftCpcBid: '', microsoftGeoTargets: [] });
    // The brief does not name Microsoft, so its section is picked again to read the inputs.
    at(f).selectedPlatforms.set(['microsoft-ads']);
    f.detectChanges();
    expect(q('budget').value).toBe('500');
    expect(q('cpc-bid').value).toBe('');
    expect(f.nativeElement.querySelector('[data-testid="implementation-microsoft-section"]')?.textContent).not.toContain('JP');

    // The brief carries no keywords, and Microsoft refuses a create without one: added to both sides alike.
    (f.componentInstance as unknown as Record<string, (k: string) => void>)['addMicrosoftKeyword']('service mesh');
    const config = submitOne(f, 'microsoft-ads', 'microsoftConfig');
    expect(config['budgetUsd']).toBe(500);
    expect('cpcBid' in config).toBe(false);
    const fresh = await freshMount(next);
    (fresh.fixture.componentInstance as unknown as Record<string, (k: string) => void>)['addMicrosoftKeyword']('service mesh');
    expect(config).toEqual(submitOne(fresh.fixture, 'microsoft-ads', 'microsoftConfig'));
  });

  it('renders the pixel through the shared lfx-input-text wrapper, tied to its hint', async () => {
    const f = (await mountWithPixel(null, true)).fixture;
    at(f).selectedPlatforms.set(['reddit-ads']);
    f.detectChanges();

    expect(redditPixelInput(f)?.closest('lfx-input-text')).not.toBeNull();
    expect(redditPixelInput(f)?.getAttribute('aria-describedby')).toBe('reddit-conversion-pixel-hint');
  });

  it('carries the typed pixel across a tab round-trip through the draft', async () => {
    const first = await mountWithPixel(null, true);
    typeRedditPixel(first.fixture, 't2_synthpixel');
    const draft = first.latest();
    first.fixture.destroy();

    expect(draft?.redditConversionPixelId).toBe('t2_synthpixel');

    const second = await mountWithPixel(draft, true);
    expect(submitReddit(second.fixture)['conversionPixelId']).toBe('t2_synthpixel');
  });

  /**
   * The withholding itself, at both `null` and `false`. With the cutover dark the legacy creator
   * reads neither key, so a rendered Image URL would be typed, accepted, and discarded into a
   * campaign with no ad — the same silent discard the Google creative capability exists to
   * prevent.
   */
  it.each([[undefined], [false]])('renders no authored-post controls while redditCreativeEnabled is %s', async (capability) => {
    const f = (await mount(null, capability as boolean | undefined)).fixture;

    expect(redditImageUrlInput(f)).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-call-to-action"]')).toBeNull();
  });

  /**
   * The HINT has to be withheld with the controls it describes. Its second sentence offers a route
   * — leave the post URL blank and a post is composed from the image below — that exists only
   * while the capability is granted. Left unconditional it tells an operator with the cutover dark
   * to do the one thing that produces a campaign with no ad, and points at a field that is not on
   * the page. The test asserts both halves so neither the sentence nor its `@if` can be dropped
   * without a failure.
   */
  it.each([
    [true, true],
    [false, false],
  ])('offers the composed-post route in the hint only while the capability is %s', async (capability, offered) => {
    const f = (await mount(null, capability)).fixture;
    const input = f.nativeElement.querySelector('[data-testid="implementation-reddit-post-url"]') as HTMLInputElement;
    const hint = input.parentElement?.querySelector('p')?.textContent ?? '';

    // The first sentence describes the field itself and is never withheld.
    expect(hint).toContain('the post id on its own');
    expect(hint.includes('Leave it blank')).toBe(offered);
  });

  /**
   * A withheld capability must not reach the REQUEST either, even when a draft written while it
   * was granted still carries the values. The draft deliberately keeps them — destroying an
   * operator's text on a capability answer they never saw would be worse — so the request is the
   * only place the gate can be enforced, and this is the test that proves it is.
   */
  it('drops a restored creative pair from the request while the capability is withheld', async () => {
    const granted = await mount(null, true);
    typeRedditImageUrl(granted.fixture, 'https://cdn.example.org/promo.png');
    pickRedditCallToAction(granted.fixture, 'Shop Now');
    const draft = granted.latest();
    granted.fixture.destroy();

    const withheld = await mount(draft, false);
    at(withheld.fixture).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(withheld.fixture);
    withheld.fixture.detectChanges();
    at(withheld.fixture).submit();

    // Remembered...
    expect(at(withheld.fixture).redditImageUrl()).toBe('https://cdn.example.org/promo.png');
    expect(at(withheld.fixture).redditCallToAction()).toBe('Shop Now');
    // ...and not sent.
    const config = sentConfig('redditConfig');
    expect('imageUrl' in config).toBe(false);
    expect('callToAction' in config).toBe(false);
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
  it.each([[undefined], [false]])('names only the post url while redditCreativeEnabled is %s', async (capability) => {
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
  it('says nothing when reddit is not selected', async () => {
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

  it('judges a half-cent lifetime budget as campaign-service rounds it', async () => {
    const { fixture } = await mount(null);
    enableDailyCap(fixture);
    typeLinkedInBudget(fixture, 100.125);
    toggleLinkedInLifetimeBudget(fixture, true);
    typeLinkedInDailyCap(fixture, '100.13');

    const error = fixture.nativeElement.querySelector('[data-testid="implementation-linkedin-daily-cap-error"]') as HTMLElement | null;
    expect(error?.textContent).toContain("can't be more than the lifetime budget");
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
    ["under LinkedIn's $10 daily minimum", '9.99', 'at least $10'],
    ['above the lifetime budget', '1500', "can't be more than the lifetime budget"],
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
    ['unknown (null)', null],
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
  it('leaves the platform values seeded when an older draft omits them', async () => {
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
  it('re-seeds the brief-derived arrays from the brief on remount rather than from the draft', async () => {
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
  it('ignores brief-derived arrays left in a draft by an older build', async () => {
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

/**
 * The create handler's error arm, which is the last step of the named-refusal path.
 *
 * Every guard on the server writes a field and a stated remedy, and all of that is wasted if the
 * tab replaces the message with connection advice on the way to the screen. This handler took no
 * parameter at all before this change, so EVERY non-2xx was reported as a connection failure.
 *
 * Both directions are asserted, because each alone passes against a different wrong handler: a
 * test that only checked the server message passes against a handler that prints whatever it is
 * handed, including the status-derived envelope `gatewayFetch` composes for an upstream failure;
 * and a test that only checked the fallback passes against the unfixed handler.
 */
describe('ImplementationTabComponent create failure messaging', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  const submittableGoogleCreate = () => {
    fixture.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl: 'https://example.com',
      includeSearch: true,
      budgetUsd: 500,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      headlines: ['Join us at KubeCon'],
      descriptions: ['Register today for KubeCon EU 2026.'],
    } as unknown as CampaignImplementationDraft);
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
  };

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

  it('surfaces the field refusal the server wrote instead of connection advice', async () => {
    // The exact shape a server guard emits: 400 carrying VALIDATION_ERROR and the operator-facing
    // sentence. `isBffValidationError` keys on the CODE, not the status, because a relayed
    // upstream 400 carries a status-derived code and a message no person wrote.
    vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'VALIDATION_ERROR',
              error:
                'the Google Ads budget must be greater than 0 — this one resolves to no spend at all once the Search share is applied. Set a larger budget and create again.',
            },
          })
      )
    );
    submittableGoogleCreate();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['submit']();
    await fixture.whenStable();

    expect(c['errors']()).toEqual([expect.stringContaining('Google Ads budget must be greater than 0')]);
    // Back to the form, not stranded on the progress step — the operator has to be able to act on
    // the remedy the message just gave them.
    expect(c['step']()).toBe('form');
  });

  // #5491: `ServiceValidationError.forField`'s real body, with a reason longer than the 200 characters
  // `serverAuthoredMessage` puts in front of a reader. This is the registration URL refusal's own text.
  const LONG_FIELD_REFUSAL =
    "the saved brief's registration URL is not a complete web address, so the ad platforms will refuse it. Select Edit brief, enter a full https:// Registration URL, then Save & Proceed and create again, now.";

  it('shows a BFF field refusal in full, even past the plain-text length cap, beside the button', async () => {
    expect(LONG_FIELD_REFUSAL.length).toBeGreaterThan(200);
    vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'VALIDATION_ERROR',
              error: 'Validation failed for registrationUrl',
              errors: [{ field: 'registrationUrl', message: LONG_FIELD_REFUSAL, code: 'FIELD_VALIDATION_ERROR' }],
            },
          })
      )
    );
    submittableGoogleCreate();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['submit']();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(c['errors']()).toEqual([LONG_FIELD_REFUSAL]);
    const shown = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-submit-error"]');
    expect(shown?.textContent?.trim()).toBe(LONG_FIELD_REFUSAL);
    expect(shown?.getAttribute('role')).toBe('alert');
  });

  it('keeps reading a non-validation 400 through the shared gate, which prefers its top-level message', async () => {
    // Only a BFF `VALIDATION_ERROR` takes the field-first reader: any other body keeps the shared
    // rule, so a relayed `errors[]` entry does not displace the message the response leads with.
    vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'BAD_REQUEST', error: 'The campaign request was refused.', errors: [{ message: 'an upstream detail' }] },
          })
      )
    );
    submittableGoogleCreate();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['submit']();
    await fixture.whenStable();

    expect(c['errors']()).toEqual(['The campaign request was refused.']);
  });

  it('scrolls the refusal into view once the form is back', async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'VALIDATION_ERROR', error: 'Set an end date and create again.' } }))
      );
      submittableGoogleCreate();

      (fixture.componentInstance as unknown as Record<string, any>)['submit']();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(scrolled.map((node) => node.getAttribute('data-testid'))).toEqual(['implementation-submit-error']);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('keeps the connection fallback for a failure that carried no server message', async () => {
    vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 0, error: null, statusText: 'Unknown Error' }))
    );
    submittableGoogleCreate();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['submit']();
    await fixture.whenStable();

    expect(c['errors']()).toEqual([expect.stringContaining('Unable to reach the campaign service')]);
    expect(c['step']()).toBe('form');
  });
});

/**
 * #5491: whenever Create Campaign is disabled, the line under it says what blocks it. `canSubmit` is
 * `createBlockedReason() === null`, so the two cannot disagree; these pin the reason's wording for the
 * registration URL case (#5490) and the generic invalid-control case, and that nothing shows when
 * Create is enabled.
 */
describe('ImplementationTabComponent create blocked reason', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  const reasonEl = (): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-submit-blocked-reason"]');
  const c = (): Record<string, any> => fixture.componentInstance as unknown as Record<string, any>;

  const seed = (registrationUrl: string): void => {
    fixture.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl,
      includeSearch: true,
      budgetUsd: 500,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      headlines: ['Join us at KubeCon'],
      descriptions: ['Register today for KubeCon EU 2026.'],
    } as unknown as CampaignImplementationDraft);
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl, countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
  };

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

  it('shows nothing while Create is enabled', () => {
    seed('https://example.com');

    expect(c()['canSubmit']()).toBe(true);
    expect(c()['createBlockedReason']()).toBeNull();
    expect(reasonEl()).toBeNull();
  });

  it('names the empty Registration URL and the editor that sets it on the brief', () => {
    seed('');

    expect(c()['canSubmit']()).toBe(false);
    expect(reasonEl()?.textContent?.trim()).toBe(
      'Create Campaign is unavailable: Registration URL is empty. Select Edit brief, enter the Registration URL, then Save & Proceed to Implement.'
    );
  });

  it('names the first invalid required control when the Google form is invalid', () => {
    seed('https://example.com');
    c()['campaignForm'].controls.budgetUsd.setValue(0);
    fixture.detectChanges();

    expect(c()['canSubmit']()).toBe(false);
    expect(reasonEl()?.textContent?.trim()).toBe('Create Campaign is unavailable: Google Ads: the daily budget is missing or not valid.');
  });

  it('names an unlisted control from its key', () => {
    seed('https://example.com');
    c()['campaignForm'].controls.eventSlug.setValidators(() => ({ required: true }));
    c()['campaignForm'].controls.eventSlug.updateValueAndValidity();
    fixture.detectChanges();

    expect(c()['createBlockedReason']()).toBe('Google Ads: the event slug field is missing or not valid.');
  });

  it('names the missing Start Date', () => {
    seed('https://example.com');
    c()['campaignForm'].controls.startDate.setValue('');
    fixture.detectChanges();

    expect(reasonEl()?.textContent?.trim()).toBe('Create Campaign is unavailable: Choose a Start Date.');
  });
});

/**
 * campaign-service platform rows whose `error` is one of issue #208's fixed dispatch-failure
 * sentences (`DispatchFailureMessage`). The row must turn a known connection reason into a next
 * step, mark a proven pre-create failure as nothing sent, and keep "could not be confirmed" for
 * everything else.
 */
describe('ImplementationTabComponent dispatch failure reasons', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const atResults = (rows: CampaignPlatformResult[]): HTMLElement => {
    const c = fixture.componentInstance as unknown as {
      platformResults: { set(v: CampaignPlatformResult[]): void };
      step: { set(v: 'results'): void };
    };
    c.platformResults.set(rows);
    c.step.set('results');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const row = (el: HTMLElement, platform: string): HTMLElement => el.querySelector(`[data-testid="implementation-platform-result-${platform}"]`) as HTMLElement;
  const heading = (el: HTMLElement): string => el.querySelector('[data-testid="implementation-platform-results"] h3')?.textContent?.trim() ?? '';
  const notUsable = (provider: string, token: string) =>
    `this project's ${provider} connection cannot be used as configured (reason: ${token}); nothing was sent`;

  it.each([
    ['account_not_selected', "Ask an LFX administrator to choose an ad account on this project's Meta Ads connection, then create again."],
    ['connection_inactive', "Ask an LFX administrator to reactivate this project's Meta Ads connection, then create again."],
    ['credentials_undecodable', "Ask an LFX administrator to reconnect this project's Meta Ads connection to save fresh credentials, then create again."],
    ['credentials_incomplete', "Ask an LFX administrator to reconnect this project's Meta Ads connection to save fresh credentials, then create again."],
    ['credentials_expired', "Ask an LFX administrator to re-authorize this project's Meta Ads connection, then create again."],
  ])('renders the next step for %s in place of the raw reason', (token, step) => {
    const el = row(atResults([{ platform: 'meta-ads', ok: false, error: notUsable('meta-ads', token) }]), 'meta-ads');
    expect(el.querySelector('[data-testid="implementation-platform-result-next-step"]')?.textContent?.trim()).toBe(step);
    expect(el.textContent).not.toContain('(reason:');
    expect(el.textContent).toContain('cannot be used as configured; nothing was sent');
    expect(el.textContent).toContain('not created');
    expect(el.querySelector('[data-testid="implementation-platform-result-nothing-created"]')?.textContent?.trim()).toBe(
      'Nothing was created on the platform.'
    );
    expect(el.textContent).not.toContain('could not be confirmed');
  });

  it('shows an unknown reason token verbatim with no next step', () => {
    const error = notUsable('meta-ads', 'token_request_rejected');
    const el = row(atResults([{ platform: 'meta-ads', ok: false, error }]), 'meta-ads');
    expect(el.textContent).toContain(error);
    expect(el.querySelector('[data-testid="implementation-platform-result-next-step"]')).toBeNull();
  });

  it('keeps "could not be confirmed" for an unconfirmed failure', () => {
    const error = 'meta-ads campaign creation could not be confirmed; something may have been created — verify on the platform before retrying';
    const el = atResults([{ platform: 'meta-ads', ok: false, error }]);
    expect(row(el, 'meta-ads').textContent).toContain('could not be confirmed — check the ad account before creating it again');
    expect(el.querySelector('[data-testid="implementation-platform-result-nothing-created"]')).toBeNull();
    expect(heading(el)).toBe('Campaign Status Unconfirmed');
  });

  it('labels the service-defect sentence as nothing created, with no next step', () => {
    const error = 'meta-ads campaign creation was stopped before anything was sent by a defect in this service; the connection is not at fault';
    const el = row(atResults([{ platform: 'meta-ads', ok: false, error }]), 'meta-ads');
    expect(el.querySelector('[data-testid="implementation-platform-result-nothing-created"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="implementation-platform-result-next-step"]')).toBeNull();
    expect(el.textContent).not.toContain('could not be confirmed');
    // No operator fix exists for a service defect, so the row states the fact and offers no retry advice.
    expect(el.textContent).not.toMatch(/retry|create again/i);
  });

  it('keeps "could not be confirmed" for an unclassified failure and a skip', () => {
    const el = atResults([
      { platform: 'meta-ads', ok: false, error: 'platform campaign creation failed' },
      { platform: 'reddit-ads', ok: false, error: 'skipped: another concurrent dispatch owns this platform' },
    ]);
    expect(row(el, 'meta-ads').textContent).toContain('could not be confirmed');
    expect(row(el, 'reddit-ads').textContent).toContain('could not be confirmed');
  });

  it('keeps an id-bearing row orphaned, with no "create again" step, whatever its message says', () => {
    const el = atResults([{ platform: 'meta-ads', ok: false, campaignId: '123', error: notUsable('meta-ads', 'account_not_selected') }]);
    expect(row(el, 'meta-ads').textContent).toContain('created upstream but not recorded');
    expect(row(el, 'meta-ads').querySelector('[data-testid="implementation-platform-result-next-step"]')).toBeNull();
    expect(row(el, 'meta-ads').querySelector('[data-testid="implementation-platform-result-nothing-created"]')).toBeNull();
    expect(heading(el)).toBe('Campaigns Created');
  });

  it('heads the panel "No Campaigns Created" only when every row is a proven pre-create failure', () => {
    let el = atResults([
      { platform: 'meta-ads', ok: false, error: notUsable('meta-ads', 'account_not_selected') },
      { platform: 'reddit-ads', ok: false, error: 'reddit-ads refused the request (HTTP 400) before anything was created; nothing was created' },
    ]);
    expect(heading(el)).toBe('No Campaigns Created');

    el = atResults([
      { platform: 'meta-ads', ok: false, error: notUsable('meta-ads', 'account_not_selected') },
      { platform: 'reddit-ads', ok: false, error: 'platform campaign creation failed' },
    ]);
    expect(heading(el)).toBe('Campaign Status Unconfirmed');
  });
});
