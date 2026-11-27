// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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
   * The untouched picker must dispatch what both creators already assumed. `conversions` is
   * `defaultRedditObjective` upstream and `config.objective ?? 'conversions'` in the legacy
   * creator, so sending it explicitly changes nobody's campaign — which is the only thing that
   * makes turning this control on safe. Pinned as a LITERAL: asserting the constant back would
   * agree with any value someone later seeded it with.
   */
  it('sends conversions as the default reddit objective', STATE_ONLY, async () => {
    const f = (await mount(null)).fixture;
    at(f).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(f);
    f.detectChanges();
    at(f).submit();

    expect(sentConfig('redditConfig')['objective']).toBe('conversions');
  });

  /**
   * The Post URL is UNGATED, and this is the test that holds that open. Both creators read the
   * field and build the ad from it — the legacy one extracts the post id in
   * `reddit-ads.service.ts` exactly as campaign-service does — so gating it behind the creative
   * capability would withhold a control that works in every deployment. Mounted with the
   * capability left unanswered, which is the state that withholds the other two.
   */
  it('offers the reddit post url while the creative capability is unanswered', async () => {
    const f = (await mount(null)).fixture;
    typeRedditPostUrl(f, 'https://www.reddit.com/r/kubernetes/comments/abc123/attend/');
    at(f).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(f);
    f.detectChanges();
    at(f).submit();

    expect(sentConfig('redditConfig')['postUrl']).toBe('https://www.reddit.com/r/kubernetes/comments/abc123/attend/');
  });

  /**
   * An untouched Post URL sends no key at all. An empty string is not neutral upstream: the Go
   * client branches on `PostURL != ""` to choose between promoting a post and authoring one, and
   * a blank value is the same decision as an absent key, so sending one only gives a reader
   * something to misread.
   */
  it('omits the reddit post url when it was never typed', STATE_ONLY, async () => {
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
    // With no Post URL yet, its reason is on screen too (`redditVideoPostError` reaches the template).
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-video-post-error"]')?.textContent).toContain('enter its Post URL');
    // The Post URL is valid next, so the goal is the ONLY thing blocking the submit below: without
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

    // With a valid goal, a missing post alone holds Create (`redditVideoPostError` reaches `redditCreateRefusal`).
    typeRedditPostUrl(f, '');
    expect(at(f).createBlockedReason()).toBe('Reddit Ads: Video Views needs a video post.');
    at(f).submit();
    expect(createCampaign).not.toHaveBeenCalled();
    typeRedditPostUrl(f, 'https://www.reddit.com/r/kubernetes/comments/abc123/video/');
    expect(at(f).canSubmit()).toBe(true);
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
    pixel: boolean | null,
    redditCreative?: boolean
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const mounted = await mount(draft, redditCreative);
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
   * Every Reddit value an operator can change, through the real bindings. The draft is read after EACH handler, so one
   * missing its `emitDraft()` fails here even though a later handler would snapshot its value. Each value is neither the
   * default nor the brief's, so the remount's request cannot pass on a re-seed. What the draft carries and what a restore
   * sets, field by field, are `redditDraftFields` and `redditDraftRestore`'s rows (#5980).
   */
  it('carries every reddit field through a tab round-trip and into the request', async () => {
    const postUrl = 'https://www.reddit.com/r/kubernetes/comments/abc123/video/';
    const first = await mountWithPixel(null, true, true);
    const f = first.fixture;
    typeRedditBudget(f, 750);
    expect(first.latest()?.redditBudgetUsd).toBe(750);
    pickRedditObjective(f, 'video_views');
    expect(first.latest()?.redditObjective).toBe('video_views');
    pickRedditVideoGoal(f, 'VIDEO_VIEW_15S');
    expect(first.latest()?.redditVideoGoal).toBe('VIDEO_VIEW_15S');
    typeRedditPostUrl(f, postUrl);
    expect(first.latest()?.redditPostUrl).toBe(postUrl);
    typeRedditImageUrl(f, 'https://cdn.example.org/promo.png');
    expect(first.latest()?.redditImageUrl).toBe('https://cdn.example.org/promo.png');
    pickRedditCallToAction(f, 'Shop Now');
    expect(first.latest()?.redditCallToAction).toBe('Shop Now');
    typeRedditPixel(f, 't2_synthpixel');
    expect(first.latest()?.redditConversionPixelId).toBe('t2_synthpixel');
    const draft = first.latest();
    f.destroy();

    const second = await mountWithPixel(draft, true, true);
    expect(redditVideoGoalSelect(second.fixture)?.value).toBe('VIDEO_VIEW_15S');
    expect(submitReddit(second.fixture)).toMatchObject({
      budgetUsd: 750,
      objective: 'video_views',
      videoGoal: 'VIDEO_VIEW_15S',
      postUrl,
      imageUrl: 'https://cdn.example.org/promo.png',
      callToAction: 'Shop Now',
      conversionPixelId: 't2_synthpixel',
    });
  });

  /**
   * A brief switch on a LIVE mount: the parent clears the draft and hands over the next brief, and the component re-seeds
   * in place. No Reddit field the brief does not derive may ride along (#3484, #4589); the values they reset to are
   * `redditBriefReset`'s row. Every typed value is one neither the component default nor the brief carries.
   */
  it('drops every typed reddit field when a different brief is handed over', async () => {
    const mounted = await mountWithPixel(null, true, true);
    const f = mounted.fixture;
    typeRedditPixel(f, 't2_synthpixel');
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
      redditConversionPixelId: 't2_synthpixel',
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
      redditConversionPixelId: '',
    });
    const el = (testId: string): HTMLInputElement | HTMLSelectElement =>
      f.nativeElement.querySelector(`[data-testid="implementation-reddit-${testId}"]`) as HTMLInputElement | HTMLSelectElement;
    expect(el('budget').value).toBe('500');
    expect(el('objective').value).toBe('conversions');
    expect(redditVideoGoalSelect(f)).toBeNull();
    expect(el('post-url').value).toBe('');
    expect(el('image-url').value).toBe('');
    expect(el('call-to-action').value).toBe('');
    expect(redditPixelInput(f)?.value).toBe('');

    const config = submitReddit(f);
    expect(config['budgetUsd']).toBe(500);
    expect(config['objective']).toBe('conversions');
    for (const key of ['videoGoal', 'postUrl', 'imageUrl', 'imageAssetId', 'callToAction', 'conversionPixelId']) {
      expect(key in config).toBe(false);
    }
  });

  // === Reddit: the conversion event (#6108 row 2) ===

  /** Mounts with the conversion event capability answered; the rules are `campaign-reddit-conversion-event.utils` rows. */
  async function mountWithConversionEvent(
    draft: CampaignImplementationDraft | null,
    enabled: boolean | null
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const mounted = await mount(draft);
    mounted.fixture.componentRef.setInput('redditConversionEventEnabled', enabled);
    mounted.fixture.componentRef.setInput('createCapabilityRead', 'ready');
    mounted.fixture.detectChanges();
    await mounted.fixture.whenStable();
    return mounted;
  }

  it('carries a picked conversion event through a tab round-trip and into the request', async () => {
    const first = await mountWithConversionEvent(null, true);
    at(first.fixture).selectedPlatforms.set(['reddit-ads']);
    first.fixture.detectChanges();
    // The shared select's own (valueChange), as a pick reports it; the select itself is covered by its own spec.
    first.fixture.debugElement.query(By.css('[data-testid="implementation-reddit-conversion-event"]')).triggerEventHandler('valueChange', 'LEAD');
    expect(first.latest()?.redditConversionEvent).toBe('LEAD');
    const draft = first.latest();
    first.fixture.destroy();

    const second = await mountWithConversionEvent(draft, true);
    expect(submitReddit(second.fixture)['conversionEvent']).toBe('LEAD');
  });

  it('holds Create for a remembered conversion event the capability withdrew, until it is set back to Purchase', STATE_ONLY, async () => {
    interface ConversionEventHandlers {
      onRedditConversionEventChange(value: string | null): void;
      useDefaultRedditConversionEvent(): void;
    }
    const first = await mountWithConversionEvent(null, true);
    (first.fixture.componentInstance as unknown as ConversionEventHandlers).onRedditConversionEventChange('LEAD');
    const draft = first.latest();
    first.fixture.destroy();

    const f = (await mountWithConversionEvent(draft, false)).fixture;
    at(f).selectedPlatforms.set(['reddit-ads']);
    makeSubmittable(f);

    expect(at(f).canSubmit()).toBe(false);
    (f.componentInstance as unknown as ConversionEventHandlers).useDefaultRedditConversionEvent();
    expect(at(f).canSubmit()).toBe(true);
  });

  // Reddit custom audiences (#6108 row 1): the rules are in `campaign-reddit-custom-audiences.utils.spec.ts`; these test the wiring.
  async function mountWithCustomAudiences(
    draft: CampaignImplementationDraft | null,
    enabled: boolean | null
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const mounted = await mount(draft);
    mounted.fixture.componentRef.setInput('redditCustomAudiencesEnabled', enabled);
    mounted.fixture.componentRef.setInput('createCapabilityRead', 'ready');
    at(mounted.fixture).selectedPlatforms.set(['reddit-ads']);
    mounted.fixture.detectChanges();
    await mounted.fixture.whenStable();
    return mounted;
  }

  it('carries picked custom audiences from the picker through a tab round-trip and into the request', async () => {
    const first = await mountWithCustomAudiences(null, true);
    first.fixture.debugElement
      .query(By.css('lfx-reddit-custom-audiences'))
      .triggerEventHandler('audiencesChange', { customAudienceIds: ['aud_in'], excludedCustomAudienceIds: ['aud_out'] });
    expect(first.latest()).toMatchObject({ redditCustomAudienceIds: ['aud_in'], redditExcludedCustomAudienceIds: ['aud_out'] });
    const draft = first.latest();
    first.fixture.destroy();

    const second = await mountWithCustomAudiences(draft, true);
    expect(submitReddit(second.fixture)).toMatchObject({ customAudienceIds: ['aud_in'], excludedCustomAudienceIds: ['aud_out'] });
  });

  it('holds Create for remembered custom audiences the capability answered no to, and shows why', async () => {
    const first = await mountWithCustomAudiences(null, true);
    first.fixture.debugElement
      .query(By.css('lfx-reddit-custom-audiences'))
      .triggerEventHandler('audiencesChange', { customAudienceIds: ['aud_in'], excludedCustomAudienceIds: [] });
    const draft = first.latest();
    first.fixture.destroy();

    const f = (await mountWithCustomAudiences(draft, false)).fixture;
    makeSubmittable(f);

    expect(at(f).canSubmit()).toBe(false);
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-custom-audiences-block-restricted"]')).not.toBeNull();
  });

  // Reddit targeting exclusions (#6108 row 3): the rules are in `campaign-reddit-targeting-exclusions.utils.spec.ts`; these test the wiring.
  async function mountWithExclusions(
    draft: CampaignImplementationDraft | null,
    enabled: boolean | null
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const mounted = await mount(draft);
    mounted.fixture.componentRef.setInput('redditTargetingExclusionsEnabled', enabled);
    mounted.fixture.componentRef.setInput('createCapabilityRead', 'ready');
    at(mounted.fixture).selectedPlatforms.set(['reddit-ads']);
    mounted.fixture.detectChanges();
    await mounted.fixture.whenStable();
    return mounted;
  }
  const EXCLUSIONS = { excludedSubreddits: ['synth_offtopic'], excludedGeoTargets: ['AQ'] };

  it('carries exclusions from the boxes through a tab round-trip and into the request', async () => {
    const first = await mountWithExclusions(null, true);
    first.fixture.debugElement.query(By.css('lfx-reddit-targeting-exclusions')).triggerEventHandler('exclusionsChange', EXCLUSIONS);
    expect(first.latest()).toMatchObject({ redditExcludedSubreddits: ['synth_offtopic'], redditExcludedGeoTargets: ['AQ'] });
    const draft = first.latest();
    first.fixture.destroy();

    const second = await mountWithExclusions(draft, true);
    expect(submitReddit(second.fixture)).toMatchObject(EXCLUSIONS);
  });

  it('holds Create for remembered exclusions the deployment answered no to, and shows why', async () => {
    const first = await mountWithExclusions(null, true);
    first.fixture.debugElement.query(By.css('lfx-reddit-targeting-exclusions')).triggerEventHandler('exclusionsChange', EXCLUSIONS);
    const draft = first.latest();
    first.fixture.destroy();

    const f = (await mountWithExclusions(draft, false)).fixture;
    makeSubmittable(f);

    expect(at(f).canSubmit()).toBe(false);
    expect(f.nativeElement.querySelector('[data-testid="implementation-reddit-targeting-exclusions-block-restricted"]')).not.toBeNull();
  });

  // Editable Reddit subreddits and interests (#6108 row 4): the rules are in `campaign-reddit-targeting-lists.utils.spec.ts`; these test the wiring.
  async function mountWithResolution(
    draft: CampaignImplementationDraft | null,
    enabled: boolean | null
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const mounted = await mount(draft);
    mounted.fixture.componentRef.setInput('redditTargetingResolutionEnabled', enabled);
    at(mounted.fixture).selectedPlatforms.set(['reddit-ads']);
    mounted.fixture.detectChanges();
    await mounted.fixture.whenStable();
    return mounted;
  }

  it('carries edited subreddits and interests through a tab round-trip and into the request', async () => {
    const edited = { subreddits: ['synth_devops'], interests: ['technology_v3'] };
    const first = await mountWithResolution(null, true);
    first.fixture.debugElement.query(By.css('lfx-reddit-targeting-lists')).triggerEventHandler('listsChange', edited);
    expect(first.latest()).toMatchObject({ redditEditedSubreddits: ['synth_devops'], redditEditedInterests: ['technology_v3'] });
    const draft = first.latest();
    first.fixture.destroy();

    const second = await mountWithResolution(draft, true);
    expect(submitReddit(second.fixture)).toMatchObject(edited);
  });

  it('keeps the lists read-only, and out of the draft, without the capability', async () => {
    const { fixture, latest } = await mountWithResolution(null, false);

    expect(fixture.nativeElement.querySelector('lfx-reddit-targeting-lists')).toBeNull();
    expect(latest()).not.toHaveProperty('redditEditedSubreddits');
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
    const f = TestBed.createComponent(tabComponentUnderTest());
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
});
