// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_REQUEST_KEYS,
  GOOGLE_CREATIVE_REQUIRED_NOTICE,
  GOOGLE_CREATIVE_SECTION_TITLES,
  GOOGLE_SEARCH_ASSETS_NOTICE,
} from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { SEED_KEYWORD, configureGoogleTab, seedChannel, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();

describe('ImplementationTabComponent demand gen capability gate', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function checkbox(): HTMLInputElement | null {
    return fixture.nativeElement.querySelector('input[formControlName="includeDemandGen"]');
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

  /**
   * Asserted in BOTH directions on the RENDERED output, not on the input signal.
   *
   * A test that only checked the disabled case would pass against a template that never renders
   * the control at all, and one that only read `demandGenEnabled()` would pass against a template
   * that ignores it entirely.
   */
  /**
   * The gate that actually keeps `demand-gen` off the wire.
   *
   * Hiding the checkbox is not sufficient on its own: `applyDraft` runs once at mount under
   * `untracked`, so a tab that mounts while the capability is still `null` restores
   * `includeDemandGen: true` onto the form. When the capability later resolves `false` the
   * control disappears, but the FORM value remains true — and `submit` builds `campaignTypes`
   * from the form, not from the input. Without this gate a create carrying `demand-gen` reaches
   * a server that refuses it, and the user gets an error for a control they cannot see.
   *
   * Asserted on `canSubmit` rather than by driving `submit`, because reaching the builder needs
   * a fully valid Google form (headlines, descriptions, budget) and that scaffolding would test
   * the validators rather than this gate.
   *
   * The matching guard in the request builder is pinned separately, by `sends only search when a
   * hidden Demand Gen selection accompanies Search` below — which reaches `submit()` with
   * `canSubmit()` true and asserts the payload. That distinction matters: `canSubmit` only
   * rejects Google with NEITHER type selected, so it does not cover Search plus a stale hidden
   * Demand Gen, and the builder guard is the only thing keeping that off the wire.
   */
  it('does not treat a hidden Demand Gen selection as a submittable Google campaign', () => {
    fixture.componentRef.setInput('demandGenEnabled', false);
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    // Exactly the state a draft restore leaves behind: Demand Gen ticked, Search not, and the
    // control hidden. Search alone would be submittable; a hidden Demand Gen alone must not be.
    c['campaignForm'].patchValue({
      eventName: 'KubeCon EU 2026',
      registrationUrl: 'https://example.com',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      includeSearch: false,
      includeDemandGen: true,
      includePerformanceMax: false,
      includeVideo: false,
      includeDisplay: false,
    });
    fixture.detectChanges();

    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * The generated campaign name must describe the request that will actually be sent.
   *
   * The preview reads the same form value the builder does, so a hidden `includeDemandGen: true`
   * would render `Multi` while the request carries only `search` — naming a campaign that will
   * not be created, in a name operators use to find it in the ad platform later.
   */
  it('previews a Search-only name when a hidden Demand Gen selection cannot be created', () => {
    fixture.componentRef.setInput('demandGenEnabled', false);
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['campaignForm'].patchValue({ includeSearch: true, includeDemandGen: true });
    fixture.detectChanges();

    // `Multi` is what the raw form value would produce; `Search` is what will be created.
    expect(c['campaignName']()).toContain('| Search |');
    expect(c['campaignName']()).not.toContain('| Multi |');
  });

  /**
   * The preview must follow the capability, not just the form.
   *
   * `campaignName` is `toSignal` over `valueChanges`, so a signal read inside its `map` is NOT a
   * reactive dependency — it re-evaluates only when the form changes. Gating the preview on the
   * capability therefore froze it at whatever the capability was AT MOUNT: a tab that mounts with
   * the capability still `null` previews Search, and a later `true` leaves the name saying Search
   * while submit sends `demand-gen`.
   */
  it('updates the previewed name when the capability arrives after mount', () => {
    fixture.componentRef.setInput('demandGenEnabled', null);
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['campaignForm'].patchValue({ includeSearch: true, includeDemandGen: true });
    fixture.detectChanges();
    expect(c['campaignName']()).toContain('| Search |');

    // The capability resolves AFTER mount, with no further form edit.
    fixture.componentRef.setInput('demandGenEnabled', true);
    fixture.detectChanges();

    expect(c['campaignName']()).toContain('| Multi |');
  });

  /**
   * The WIRE guard, reached with `canSubmit` passing — the case an earlier revision wrongly called
   * `canSubmit` covered.
   *
   * It does not. `canSubmit` only rejects Google with NEITHER type selected; with Search also
   * ticked it passes, and `campaignTypes.push('demand-gen')` at the builder is then the only
   * thing keeping the hidden selection off the request. Deleting that line left the suite green.
   *
   * Search + a stale hidden Demand Gen is the ordinary shape of this bug: a draft saved when the
   * capability was on, restored on a deployment where it is off.
   */
  it('sends only search when a hidden Demand Gen selection accompanies Search', async () => {
    const createCampaign = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j-1' }));

    // `null` AT MOUNT, so `applyDraft` PRESERVES the draft's `true` — the clear at :1636 fires
    // only on an explicit `false`. This is the one sequence that puts a hidden `true` on the
    // form, and therefore the only one the wire guard can be reached through.
    fixture.componentRef.setInput('demandGenEnabled', null);
    fixture.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl: 'https://example.com',
      includeSearch: true,
      includeDemandGen: true,
      includePerformanceMax: false,
      includeVideo: false,
      includeDisplay: false,
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

    // The capability now resolves OFF. The control disappears; the form value does not change.
    fixture.componentRef.setInput('demandGenEnabled', false);
    fixture.detectChanges();

    const c = fixture.componentInstance as unknown as Record<string, any>;
    // The form really is submittable — otherwise this would pass without reaching the builder.
    expect(c['canSubmit']()).toBe(true);
    // The hidden `true` the wire guard exists for. If this were already false the guard would
    // have nothing to guard and the test would pass against its deletion.
    expect(c['campaignForm'].controls['includeDemandGen'].value).toBe(true);

    c['submit']();
    await fixture.whenStable();

    expect(createCampaign).toHaveBeenCalled();
    expect(createCampaign.mock.calls[0][0].campaignTypes).toEqual(['search']);
  });

  it('hides the Demand Gen control when the deployment cannot create it', () => {
    fixture.componentRef.setInput('demandGenEnabled', false);
    fixture.detectChanges();
    expect(checkbox()).toBeNull();
  });

  it('shows the Demand Gen control when the deployment can create it', () => {
    fixture.componentRef.setInput('demandGenEnabled', true);
    fixture.detectChanges();
    expect(checkbox()).not.toBeNull();
  });

  it('defaults to hidden, so a deployment that never reports the capability cannot offer it', () => {
    expect(checkbox()).toBeNull();
  });

  it('withholds the control while the capability is still unknown', () => {
    fixture.componentRef.setInput('demandGenEnabled', null);
    fixture.detectChanges();
    expect(checkbox()).toBeNull();
  });

  /**
   * The distinction the tri-state exists for. `null` withholds the control exactly as `false`
   * does, so this cannot be asserted through the DOM — only the draft outcome separates them,
   * and getting it wrong destroys a user's saved selection rather than merely hiding a checkbox.
   */
  it('preserves a restored draft selection while the capability is unknown', () => {
    restoreDraft(null, true);
    expect(demandGenValue()).toBe(true);
  });

  /**
   * Order matters, and getting it wrong makes the negative case pass for the wrong reason.
   *
   * The seeding effect depends only on `briefData` and reads `draft` inside `untracked()`, so the
   * draft must already be set when the brief lands — setting the brief first runs the effect with
   * no draft, and a later `setInput('draft', ...)` never re-triggers it. `applyDraft` also returns
   * early unless the draft's `eventSlug` matches the form's, which the brief is what populates.
   *
   * With either mistake the control keeps its `[false]` default and the "forces to Search" test
   * passes without the guard existing at all.
   */
  function restoreDraft(enabled: boolean | null, includeDemandGen: boolean): void {
    fixture.componentRef.setInput('demandGenEnabled', enabled);
    fixture.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl: 'https://example.com',
      includeSearch: true,
      includeDemandGen,
      // Required: `applyDraft` calls `replaceCopyArray` on both unconditionally, so a draft
      // without them throws "values is not iterable" before it reaches the checkbox.
      headlines: ['Join us at KubeCon'],
      descriptions: ['Register today for KubeCon EU 2026.'],
    } as unknown as CampaignImplementationDraft);
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
  }

  function demandGenValue(): boolean {
    return (fixture.componentInstance as unknown as Record<string, any>)['campaignForm'].controls['includeDemandGen'].value;
  }

  /**
   * Hiding the control is not enough on its own: the draft restore writes `includeDemandGen`
   * directly, so a draft saved when the capability was available would put a hidden `true` on the
   * form and submit it into a refusal. Asserts the VALUE, not merely that the path ran.
   */
  it('forces a restored draft to Search when the deployment cannot create Demand Gen', () => {
    restoreDraft(false, true);
    expect(demandGenValue()).toBe(false);
  });

  /**
   * The paired positive case. Without it the guard could be `includeDemandGen: false` outright
   * and the negative test above would still pass, so this is what proves the gate reads the
   * capability rather than discarding the draft value unconditionally.
   */
  it('preserves a restored draft Demand Gen selection where the deployment supports it', () => {
    restoreDraft(true, true);
    expect(demandGenValue()).toBe(true);
  });
});

/**
 * The SAME gate, one capability over, for Performance Max / Video / Display.
 *
 * A separate describe rather than extra rows in the one above, because the two capabilities are
 * independent and derived by OPPOSITE rules upstream: `demandGenEnabled` is TRUE while the create
 * cutover is dark (the legacy creator serves Demand Gen), `googleChannelsEnabled` is FALSE there
 * (the legacy creator does not know these three and would build a funded DEMAND GEN campaign for
 * them and report success). Every assertion below is written so that collapsing the two inputs into one
 * would break it.
 */
describe('ImplementationTabComponent google channels capability gate', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function checkbox(control: string): HTMLInputElement | null {
    return fixture.nativeElement.querySelector(`input[formControlName="${control}"]`);
  }

  function value(control: string): boolean {
    return (fixture.componentInstance as unknown as Record<string, any>)['campaignForm'].controls[control].value;
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

  it.each([['includePerformanceMax'], ['includeVideo'], ['includeDisplay']])('shows %s only on an explicit true', (control) => {
    expect(checkbox(control)).toBeNull();

    fixture.componentRef.setInput('googleChannelsEnabled', null);
    fixture.detectChanges();
    expect(checkbox(control)).toBeNull();

    fixture.componentRef.setInput('googleChannelsEnabled', false);
    fixture.detectChanges();
    expect(checkbox(control)).toBeNull();

    fixture.componentRef.setInput('googleChannelsEnabled', true);
    fixture.detectChanges();
    expect(checkbox(control)).not.toBeNull();
  });

  /**
   * The two capabilities must not stand in for one another. With `demandGenEnabled` on and the
   * newer capability unanswered, Demand Gen renders and the three do not — which is exactly the
   * production state during the staged rollout.
   */
  it('does not let the demand-gen capability unlock the three newer channels', () => {
    fixture.componentRef.setInput('demandGenEnabled', true);
    fixture.detectChanges();

    expect(checkbox('includeDemandGen')).not.toBeNull();
    expect(checkbox('includePerformanceMax')).toBeNull();
    expect(checkbox('includeVideo')).toBeNull();
    expect(checkbox('includeDisplay')).toBeNull();
  });

  /**
   * `restoreDraft` sets the draft BEFORE the brief, for the reason spelled out on the demand-gen
   * sibling: the seeding effect depends on `briefData` and reads `draft` inside `untracked()`, so
   * the other order silently leaves the controls at their `[false]` default and makes the negative
   * assertions pass without any guard existing.
   */
  function restoreDraft(enabled: boolean | null, selected: boolean): void {
    fixture.componentRef.setInput('googleChannelsEnabled', enabled);
    fixture.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl: 'https://example.com',
      includeSearch: false,
      includeDemandGen: false,
      includePerformanceMax: selected,
      includeVideo: selected,
      includeDisplay: selected,
      headlines: ['Join us at KubeCon'],
      descriptions: ['Register today for KubeCon EU 2026.'],
    } as unknown as CampaignImplementationDraft);
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com' },
      selectedPlatforms: ['google-ads'],
      keywords: [SEED_KEYWORD],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
  }

  it('clears a restored selection when the deployment has answered that it cannot create these channels', () => {
    restoreDraft(false, true);
    expect(value('includePerformanceMax')).toBe(false);
    expect(value('includeVideo')).toBe(false);
    expect(value('includeDisplay')).toBe(false);
  });

  /**
   * The tri-state's whole reason for existing. `null` is "unanswered", not "no" — collapsing the
   * two would have `applyDraft` rewrite a user's saved selection from a value that was never a
   * server fact, which is a destructive edit to persisted state rather than a hidden checkbox.
   */
  it('preserves a restored selection while the capability is still unknown', () => {
    restoreDraft(null, true);
    expect(value('includePerformanceMax')).toBe(true);
    expect(value('includeVideo')).toBe(true);
    expect(value('includeDisplay')).toBe(true);
  });

  /**
   * The paired positive case: without it the clear above could be an unconditional `false` and
   * still pass, so this is what proves the restore reads the capability.
   */
  it('preserves a restored selection where the deployment supports it', () => {
    restoreDraft(true, true);
    expect(value('includePerformanceMax')).toBe(true);
  });

  /**
   * Seeds a GENUINELY VALID Google form, then applies the channel selection under test.
   *
   * The draft route rather than a bare `patchValue`, because `canSubmit` also returns false on
   * `campaignForm.invalid` — a form missing budget, headlines or descriptions makes every negative
   * assertion below pass without the channel guard existing at all. `allows a flagged channel on
   * its own` is the control that proves this seed really is submittable.
   */
  function seedGoogleForm(
    patch: Record<string, unknown>,
    caps: { demandGen?: boolean | null; googleChannels?: boolean | null; googleCreative?: boolean | null } = {}
  ): Record<string, any> {
    fixture.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      eventName: 'KubeCon EU 2026',
      registrationUrl: 'https://example.com',
      includeSearch: false,
      includeDemandGen: false,
      includePerformanceMax: false,
      includeVideo: false,
      includeDisplay: false,
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

    const c = fixture.componentInstance as unknown as Record<string, any>;
    c['campaignForm'].patchValue({
      includeSearch: false,
      includeDemandGen: false,
      includePerformanceMax: false,
      includeVideo: false,
      includeDisplay: false,
      ...patch,
    });
    // The capability inputs are set LAST, after the form is in its final state.
    //
    // `canSubmit` is a `computed` that reads `campaignForm.controls.*.value` DIRECTLY — plain
    // property reads, not signals. `campaignFormRevision` is what makes a `patchValue` invalidate
    // the memo at all, and `canSubmit reacts to a channel ticked after it was last read` below is
    // the test that holds that bridge in place. The ordering here is kept anyway: it is the state
    // a real user reaches — a form filled in, then a capability resolving — and it means this seed
    // does not depend on the bridge to be correct, so a regression there shows up as that one
    // named failure rather than as every Google assertion in this file going red at once.
    if ('demandGen' in caps) fixture.componentRef.setInput('demandGenEnabled', caps.demandGen);
    if ('googleChannels' in caps) fixture.componentRef.setInput('googleChannelsEnabled', caps.googleChannels);
    if ('googleCreative' in caps) fixture.componentRef.setInput('googleCreativeEnabled', caps.googleCreative);
    fixture.detectChanges();
    return c;
  }

  it('folds a line break in generated creative copy into a space, in linear time however long the whitespace run', () => {
    const c = fixture.componentInstance as unknown as Record<string, any>;
    const fit = (values: unknown[]): string[] => c['fittingCreativeCopy']('demand-gen', 'headlines', values);

    // Behaviour the fold has always had: a run holding a break is one space, any other run is kept as written.
    expect(fit(['Join\nus', 'Join \r\n  now', 'a  b', 'Line\n\n\nbreaks'])).toEqual(['Join us', 'Join now', 'a  b', 'Line breaks']);

    // The old `/\s*[\r\n]+\s*/g` took seconds per string at this size and quadruples with each doubling: a run of
    // spaces with no break in it, as a peer's saved brief could hold. Kept small so a regression fails, not hangs.
    const run = ' '.repeat(60_000);
    const hostile = [run, `a${run}b`, `${run}\n${run}`];
    const start = performance.now();
    const fitted = fit(hostile);
    expect(performance.now() - start).toBeLessThan(2_000);
    expect(fitted).toEqual([]);
  });

  /**
   * One config carries one channel, so a Performance Max / Video / Display selection paired with
   * anything else would dispatch a single campaign and silently drop the rest — and their share of
   * the budget. The server refuses the pair; refusing it here turns a terminal failure into a
   * disabled button.
   */
  it('refuses a flagged channel combined with anything else', () => {
    const c = seedGoogleForm({ includeSearch: true, includeDisplay: true }, { googleChannels: true });

    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * The narrowness of that refusal, which is the point of it. While the cutover is DARK, Search +
   * Demand Gen is served by the LEGACY creator, so blocking it would break a working capability —
   * the mistake the server guard's own comments record.
   *
   * `googleCreative: false` is what says "the cutover does not own this create"; it is the input
   * the server derives from `cutoverOwnsCreate()`, and it is the only thing separating this case
   * from the one below.
   */
  it('still allows search combined with demand gen while the cutover is dark', () => {
    const c = seedGoogleForm({ includeSearch: true, includeDemandGen: true }, { demandGen: true, googleChannels: true, googleCreative: false });

    expect(c['canSubmit']()).toBe(true);
  });

  /**
   * An unresolved capability is treated as dark, like every other capability read on this form. A
   * client that refuses a create the server would have accepted is the costlier mistake, and the
   * window before the capability call returns is exactly where that would happen.
   */
  it('still allows search combined with demand gen while the capability is unknown', () => {
    const c = seedGoogleForm({ includeSearch: true, includeDemandGen: true }, { demandGen: true, googleChannels: true, googleCreative: null });

    expect(c['canSubmit']()).toBe(true);
  });

  /**
   * The other side of that narrowness, and the gap this closes.
   *
   * Once the cutover owns the create, `createCampaigns` refuses EVERY Google pair — its guard is
   * `selectedGoogleChannels.length > 1` with no flag test, so Search + Demand Gen is refused
   * exactly like the flagged ones. The legacy exception no longer applies, because the legacy
   * creator is no longer the one that runs. Submitting is then a certain terminal refusal.
   */
  it('refuses search combined with demand gen once the cutover owns the create', () => {
    const c = seedGoogleForm({ includeSearch: true, includeDemandGen: true }, { demandGen: true, googleChannels: true, googleCreative: true });

    expect(c['canSubmit']()).toBe(false);
  });

  it('allows a flagged channel on its own', () => {
    const c = seedGoogleForm({ includeDisplay: true }, { googleChannels: true });
    expect(c['canSubmit']()).toBe(true);
  });

  /**
   * The control for the two refusals above: one channel is submittable in the very state that
   * refuses two. Without it, a `canSubmit` that returned false for an unrelated reason once the
   * cutover is on — a bidding plan that only renders there, say — would make them pass vacuously.
   */
  it('allows a single channel once the cutover owns the create', () => {
    const c = seedGoogleForm({ includeSearch: true }, { demandGen: true, googleChannels: true, googleCreative: true });

    expect(c['canSubmit']()).toBe(true);
  });

  /**
   * The bridge that makes every assertion above mean anything on a live page.
   *
   * `canSubmit` reads the form directly — `campaignForm.invalid`, `form.eventName.value`, and
   * `selectedGoogleChannels()`, which is `getRawValue()` underneath. None of those is a reactive
   * dependency, so the memo only ever recomputed when one of the few SIGNALS it also reads moved.
   * Ticking a Google channel moves none of them: the checkboxes are form controls and nothing
   * else changes with them. The button therefore kept whatever state it had, and the mixed-channel
   * rule directly above — whose only inputs ARE those checkboxes — never reached the screen.
   *
   * The sequencing is the whole test. `canSubmit()` is read FIRST, with no channel selected, so
   * the memo is warm and holding `false`; the channel is then ticked with no `setInput` and no
   * `detectChanges` to invalidate it by another route; and only then is it read again. Remove
   * `campaignFormRevision` from `canSubmit` and the second read returns the cached `false`.
   */
  it('canSubmit reacts to a channel ticked after it was last read', () => {
    const c = seedGoogleForm({}, { googleChannels: true });

    // Warm the memo in the no-channel state. Not an incidental assertion — if this were already
    // true, the flip below would prove nothing.
    expect(c['canSubmit']()).toBe(false);

    c['campaignForm'].controls.includeDisplay.setValue(true);

    expect(c['canSubmit']()).toBe(true);
  });

  /**
   * And the same bridge in the other direction, through `statusChanges` rather than
   * `valueChanges`: clearing a required field leaves the form INVALID without the Google
   * checkboxes moving at all. `merge(valueChanges, statusChanges)` is what carries this one —
   * `setValue('')` does emit both, but the assertion is about the state `canSubmit` reports, and
   * it is the case a reviewer reaches for when asking why `statusChanges` is in that merge.
   */
  it('canSubmit reacts to a required field being emptied after it was last read', () => {
    const c = seedGoogleForm({ includeDisplay: true }, { googleChannels: true });

    expect(c['canSubmit']()).toBe(true);

    c['campaignForm'].controls.budgetUsd.setValue(null);

    expect(c['campaignForm'].invalid).toBe(true);
    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * Video is the one flagged channel the capability CANNOT unlock, because the limit is Google's:
   * the Ads API has no call that creates a Video campaign, so `CreateVideoCampaign` refuses in its
   * first statement upstream. The box is disabled in the form, but `selectedGoogleChannels` reads
   * `getRawValue()`, which reports disabled controls — so a draft that carries a `true` from
   * before the box was disabled would still dispatch a create Google refuses outright.
   *
   * The capability is set TRUE here deliberately. With it false this would pass against no guard
   * at all, since the whole block is gated on it — the assertion has to be made in the one state
   * where every other flagged channel IS submittable. `allows a flagged channel on its own`
   * directly above is that control: same seed, same capability, Display instead of Video.
   */
  it('refuses Video even with the capability on and the raw value set', () => {
    const c = seedGoogleForm({}, { googleChannels: true });
    c['campaignForm'].controls.includeVideo.setValue(true);

    expect(c['campaignForm'].getRawValue().includeVideo).toBe(true);
    expect(c['selectedGoogleChannels']()).not.toContain('video');
    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * And it is disabled rather than hidden — the assertion that distinguishes this change from
   * simply dropping the channel. A user who finds no Video box cannot tell a deliberate answer
   * from a missing feature, so the box, its label and the reason all have to be on screen.
   */
  it('renders the Video box disabled, with the reason, once the capability is on', () => {
    fixture.componentRef.setInput('googleChannelsEnabled', true);
    fixture.detectChanges();

    const box = checkbox('includeVideo');
    expect(box).not.toBeNull();
    expect(box?.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="implementation-include-video-reason"]')).not.toBeNull();
  });

  /**
   * A hidden selection must not make the form submittable either. `applyDraft` can leave
   * `includeDisplay: true` on a tab that mounted while the capability was `null`; the control then
   * disappears when it resolves `false`, but the FORM value stays true and `submit` builds
   * `campaignTypes` from the form.
   *
   * Display rather than Video, which this used to use: Video is now refused by its own guard
   * regardless of the capability, so it would pass here against no capability gate at all.
   */
  it('does not treat a hidden flagged selection as a submittable Google campaign', () => {
    const c = seedGoogleForm({ includeDisplay: true }, { googleChannels: false });

    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * The generated name goes into Google Ads and is what the marketing team filters reporting on,
   * so it must describe the request that will actually be sent — not the raw checkbox state.
   */
  it.each([
    ['includePerformanceMax', 'PMax'],
    ['includeDisplay', 'Display'],
  ])('previews the %s name token', (control, token) => {
    const c = seedGoogleForm({ [control]: true }, { googleChannels: true });

    expect(c['campaignName']()).toContain(`| ${token} |`);
  });

  /**
   * `demand-gen` keeps rendering as `DG Display`, not as its product label. The token predates the
   * nicer name, and renaming it would split a campaign's reporting history in two.
   */
  it('keeps the legacy DG Display token for demand gen', () => {
    const c = seedGoogleForm({ includeDemandGen: true }, { demandGen: true });

    expect(c['campaignName']()).toContain('| DG Display |');
  });

  it('previews a Search-only name when a hidden flagged selection accompanies Search', () => {
    const c = seedGoogleForm({ includeSearch: true, includeDisplay: true }, { googleChannels: false });

    expect(c['campaignName']()).toContain('| Search |');
    expect(c['campaignName']()).not.toContain('| Multi |');
  });

  /**
   * #4755. On the campaign-service road one Google type is created per create, so the type row is an
   * exclusive choice there: ticking a second type unticks the first instead of leaving Create
   * disabled with no reason given. The legacy road still creates Search + Demand Gen together.
   */
  describe('one Google campaign type per create', () => {
    const cutover = { demandGen: true, googleChannels: true, googleCreative: true };

    function tick(control: string): void {
      const box = checkbox(control);
      expect(box, `${control} is not rendered`).not.toBeNull();
      box!.click();
      fixture.detectChanges();
    }

    function q(testId: string): HTMLElement | null {
      return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
    }

    it('unticks the other types when one is ticked on the campaign-service road', () => {
      seedGoogleForm({ includeSearch: true }, cutover);

      tick('includePerformanceMax');

      expect(value('includePerformanceMax')).toBe(true);
      expect(value('includeSearch')).toBe(false);

      tick('includeDemandGen');

      expect(value('includeDemandGen')).toBe(true);
      expect(value('includePerformanceMax')).toBe(false);
    });

    it('leaves the others alone when a type is unticked', () => {
      const c = seedGoogleForm({ includeSearch: true, includeDisplay: true }, cutover);

      tick('includeDisplay');

      expect(value('includeDisplay')).toBe(false);
      expect(value('includeSearch')).toBe(true);
      expect(c['canSubmit']()).toBe(true);
    });

    it('keeps Search and Demand Gen tickable together, with the split, on the legacy road', () => {
      seedGoogleForm({ includeSearch: true }, { demandGen: true, googleChannels: false, googleCreative: false });

      tick('includeDemandGen');

      expect(value('includeSearch')).toBe(true);
      expect(value('includeDemandGen')).toBe(true);
      expect(q('implementation-budget-split')).not.toBeNull();
      expect(q('implementation-google-channel-single-note')).toBeNull();
    });

    it('says each type is created on its own, and offers no budget split, on the campaign-service road', () => {
      seedGoogleForm({ includeSearch: true }, cutover);

      expect(q('implementation-google-channel-single-note')?.textContent).toContain('created on its own');

      // The pair the split funds, reached by a route this road still allows: a restored selection.
      seedGoogleForm({ includeSearch: true, includeDemandGen: true }, cutover);

      expect(q('implementation-budget-split')).toBeNull();
    });

    it('names the conflict a restored multi-type selection leaves, rather than silently disabling Create', () => {
      const c = seedGoogleForm({ includeSearch: true, includeDemandGen: true, includeDisplay: true }, cutover);

      expect(c['canSubmit']()).toBe(false);
      const conflict = q('implementation-google-channel-conflict');
      expect(conflict?.getAttribute('role')).toBe('alert');
      expect(conflict?.textContent).toContain('Search, Demand Gen and Display cannot be created together');
      // Named, not cleared: which campaign to make is the operator's call.
      expect(value('includeSearch')).toBe(true);
      expect(value('includeDemandGen')).toBe(true);
    });

    it('omits the note, and the description pointing at it, when Search is the only type offered', () => {
      seedGoogleForm({ includeSearch: true }, { demandGen: false, googleChannels: false, googleCreative: true });

      expect(q('implementation-google-channel-single-note')).toBeNull();
      expect(checkbox('includeSearch')?.getAttribute('aria-describedby')).toBeNull();
    });

    it('describes each type checkbox by the note, so ticking one explains unticking the rest', () => {
      seedGoogleForm({ includeSearch: true }, cutover);

      const note = fixture.nativeElement.querySelector('#implementation-google-channel-single-note');
      expect(note).not.toBeNull();
      for (const control of ['includeSearch', 'includeDemandGen', 'includePerformanceMax', 'includeDisplay']) {
        expect(checkbox(control)?.getAttribute('aria-describedby'), control).toBe('implementation-google-channel-single-note');
      }
    });

    it('describes no checkbox by the note on the legacy road', () => {
      seedGoogleForm({ includeSearch: true }, { demandGen: true, googleChannels: false, googleCreative: false });

      expect(checkbox('includeSearch')?.getAttribute('aria-describedby')).toBeNull();
      expect(checkbox('includeDemandGen')?.getAttribute('aria-describedby')).toBeNull();
    });

    it('raises the conflict when the capability answer arrives after a multi-type selection', () => {
      seedGoogleForm({ includeSearch: true, includeDemandGen: true }, { demandGen: true, googleChannels: true, googleCreative: null });
      expect(q('implementation-google-channel-conflict')).toBeNull();

      fixture.componentRef.setInput('googleCreativeEnabled', true);
      fixture.detectChanges();

      expect(q('implementation-google-channel-conflict')?.textContent).toContain('Search and Demand Gen cannot be created together');
    });
  });
});

/**
 * The Search-copy gate.
 *
 * Headlines and descriptions are required for the two channels whose ad IS that copy, and for no
 * others — a Performance Max or Display campaign carries its copy in its own creative object, and
 * an unconditional `Validators.required` here once made those campaigns unsubmittable.
 *
 * `demand-gen` is in the gate alongside `search` because the LEGACY in-process creator builds a
 * DEMAND GEN campaign for an unknown type, so that pair reaches the same ad-copy requirement.
 */
describe('ImplementationTabComponent google search-copy gate', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it.each([['includeSearch'], ['includeDemandGen']])('asks for the ad copy on %s', (control) => {
    const c = seedChannel(fixture, { [control]: true });

    expect(c['searchCopyApplies']()).toBe(true);

    c['campaignForm'].controls.headlines.at(0).setValue('');

    expect(c['campaignForm'].controls.headlines.invalid).toBe(true);
    expect(c['canSubmit']()).toBe(false);
  });

  /**
   * The other direction, which is the regression this gate exists for. The same empty copy must
   * leave a Display campaign submittable — its ad lives in `displayCreative`.
   */
  it.each([['includePerformanceMax'], ['includeDisplay']])('does not ask for the ad copy on %s', (control) => {
    const c = seedChannel(fixture, { [control]: true });
    c['campaignForm'].controls.headlines.at(0).setValue('');
    c['campaignForm'].controls.descriptions.at(0).setValue('');

    expect(c['searchCopyApplies']()).toBe(false);
    expect(c['campaignForm'].controls.headlines.valid).toBe(true);
    expect(c['canSubmit']()).toBe(true);
  });

  /**
   * Nothing re-runs a validator when a SIBLING control changes, so the gate is inert without the
   * constructor effect that revalidates both arrays when the gate's answer moves. Reading the
   * arrays' validity BEFORE and AFTER the tick is what holds that effect in place.
   *
   * The `detectChanges` is load-bearing: an effect settles on the next flush, where the
   * `valueChanges` subscription this replaced ran synchronously on the tick.
   */
  it('revalidates the copy arrays when the channel changes under them', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.headlines.at(0).setValue('');
    expect(c['campaignForm'].controls.headlines.valid).toBe(true);

    c['campaignForm'].controls.includeDisplay.setValue(false);
    c['campaignForm'].controls.includeSearch.setValue(true);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.headlines.invalid).toBe(true);
  });

  /**
   * The checkboxes are not the only thing that moves the gate. `showGoogleSection()` reads
   * `selectedPlatforms`, a signal input — dropping Google in the parent makes the copy stop being
   * required without either checkbox emitting, which the `valueChanges` pair this replaced missed.
   */
  it('revalidates the copy arrays when google leaves the selected platforms', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.headlines.at(0).setValue('');
    expect(c['campaignForm'].controls.headlines.invalid).toBe(true);

    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com', countryCode: 'US' },
      selectedPlatforms: ['linkedin-ads'],
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();

    expect(c['searchCopyApplies']()).toBe(false);
    expect(c['campaignForm'].controls.headlines.valid).toBe(true);
  });
});

/**
 * The per-channel creative sections.
 *
 * Everything here is driven off `GOOGLE_CREATIVE_FIELD_SPECS`, and the assertions name the
 * catalogue rather than repeating its numbers — a bound that moves upstream should move these
 * tests' expectations with it, not leave them green against a stale literal.
 */
describe('ImplementationTabComponent google creative sections', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  beforeEach(async () => {
    await configureGoogleTab();
    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it.each([
    ['includeDemandGen', 'demand-gen'],
    ['includePerformanceMax', 'performance-max'],
    ['includeDisplay', 'display'],
    ['includeSearch', 'search'],
  ])('renders the %s section', (control, channel) => {
    const c = seedChannel(fixture, { [control]: true });
    const sections = c['googleCreativeSections']();

    expect(sections).toHaveLength(1);
    expect(sections[0].channel).toBe(channel);
    expect(sections[0].label).toBe(GOOGLE_CREATIVE_SECTION_TITLES[channel as keyof typeof GOOGLE_CREATIVE_SECTION_TITLES]);
    expect(sections[0].groupName).toBe(GOOGLE_CREATIVE_REQUEST_KEYS[channel as keyof typeof GOOGLE_CREATIVE_REQUEST_KEYS]);
  });

  /**
   * #5262: Search's section collects its campaign assets, not its copy (the two shared arrays), and is
   * sent as `searchAssets` with each list split one per line, as every creative is.
   */
  it('sends the Search assets under searchAssets, one entry per line', () => {
    const c = seedChannel(fixture, { includeSearch: true });
    c['campaignForm'].controls.searchAssets.patchValue({
      businessName: ' Example Foundation ',
      adImages: 'https://cdn.example.org/a.png\n\nhttps://cdn.example.org/b.png',
      landscapeAdImages: 'https://cdn.example.org/wide.png',
      businessLogoImages: '',
    });

    expect(c['googleCreativeWirePayload']()).toEqual({
      searchAssets: {
        businessName: 'Example Foundation',
        adImages: ['https://cdn.example.org/a.png', 'https://cdn.example.org/b.png'],
        landscapeAdImages: ['https://cdn.example.org/wide.png'],
      },
    });
  });

  /** A Search campaign serves on its ads alone, so its section says its assets are optional rather than warning of an empty shell. */
  it('shows the optional-assets line on the Search section and the empty-shell line on the others', () => {
    seedChannel(fixture, { includeSearch: true, includeDisplay: true });
    const notice = (channel: string): string | undefined =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="implementation-creative-notice-${channel}"]`)?.textContent?.trim();

    expect(notice('search')).toBe(GOOGLE_SEARCH_ASSETS_NOTICE);
    expect(notice('display')).toBe(GOOGLE_CREATIVE_REQUIRED_NOTICE);
  });

  it('renders no section when Google is not a selected platform', () => {
    const c = fixture.componentInstance as unknown as Record<string, any>;

    expect(c['googleCreativeSections']()).toEqual([]);
  });

  /**
   * The creative capability is withheld until the cutover owns the create, because the legacy
   * in-process creator sends no creative object at all — rendering the fields there would collect
   * copy the create then silently drops. `null` is the "not known yet" state and withholds too.
   */
  it.each([[null], [false]])('renders no section while googleCreativeEnabled is %s', (capability) => {
    const c = seedChannel(fixture, { includeDisplay: true });
    fixture.componentRef.setInput('googleCreativeEnabled', capability);
    fixture.detectChanges();

    expect(c['googleCreativeSections']()).toEqual([]);
  });

  /**
   * Search and Demand Gen are one campaign on the wire: `buildGoogleAdsConfig`'s Search branch
   * sends no `googleCreative` at all. Leaving the Demand Gen section up alongside Search would
   * collect creative the request then drops, so Search takes the section down.
   */
  it('drops the demand gen section when search is ticked alongside it', () => {
    const c = seedChannel(fixture, { includeSearch: true, includeDemandGen: true, includeDisplay: true });

    expect(c['googleCreativeSections']().map((section: { channel: string }) => section.channel)).toEqual(['display', 'search']);
  });

  /**
   * The hazard the section rules open, and the effect that closes it: a withheld section leaves a
   * `FormGroup` nobody can reach, and an enabled invalid group holds `campaignForm.invalid` true
   * with no control on screen to fix. Only the rendered groups stay enabled.
   */
  it('enables only the creative groups it renders', () => {
    const c = seedChannel(fixture, { includeDisplay: true });

    expect(c['campaignForm'].controls.displayCreative.enabled).toBe(true);
    expect(c['campaignForm'].controls.demandGenCreative.enabled).toBe(false);
    expect(c['campaignForm'].controls.performanceMaxCreative.enabled).toBe(false);

    c['campaignForm'].controls.includeDisplay.setValue(false);
    c['campaignForm'].controls.includePerformanceMax.setValue(true);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.displayCreative.enabled).toBe(false);
    expect(c['campaignForm'].controls.performanceMaxCreative.enabled).toBe(true);
  });

  /**
   * Disabling a group must not change what the payload, the snapshot or a restore can see.
   * `getRawValue()` reports disabled controls, which is why none of those three needed a change.
   */
  it('still reads a disabled creative group through getRawValue', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.controls.longHeadline.setValue('Still here');

    c['campaignForm'].controls.includeDisplay.setValue(false);
    fixture.detectChanges();

    expect(c['campaignForm'].controls.displayCreative.enabled).toBe(false);
    expect(c['campaignForm'].getRawValue().displayCreative.longHeadline).toBe('Still here');
  });

  /**
   * The line split that turns a textarea into the array the wire carries. Both newline
   * conventions, trimmed, empties dropped — a trailing newline must not become an entry that
   * counts against the cap or reaches Google as an empty image URL.
   */
  it('splits a list field on either newline convention, trimming and dropping empties', () => {
    const c = fixture.componentInstance as unknown as Record<string, any>;

    expect(c['splitCreativeLines']('one\r\n  two  \n\n\nthree\n')).toEqual(['one', 'two', 'three']);
    expect(c['splitCreativeLines']('')).toEqual([]);
    expect(c['splitCreativeLines'](null)).toEqual([]);
    expect(c['splitCreativeLines'](undefined)).toEqual([]);
  });

  /**
   * The list bound is PER LINE, which `Validators.maxLength` cannot express: the control holds one
   * multi-line string, so bounding its own length would refuse five short headlines for being long
   * together. Both assertions are needed — the first alone passes against a `maxLength` on the raw
   * control.
   */
  it('bounds a list field per entry, not on the whole control', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const headlines = c['campaignForm'].controls.displayCreative.controls.headlines;
    const spec = GOOGLE_CREATIVE_FIELD_SPECS.display[0];

    headlines.setValue(Array.from({ length: spec.max }, () => 'a'.repeat(spec.width)).join('\n'));
    expect(headlines.valid).toBe(true);

    headlines.setValue('a'.repeat(spec.width + 1));
    expect(headlines.errors?.['creativeListWidth']).toEqual({ label: spec.label, width: spec.width });

    headlines.setValue(Array.from({ length: spec.max + 1 }, () => 'ok').join('\n'));
    expect(headlines.errors?.['creativeListMax']).toEqual({ label: spec.label, max: spec.max, actual: spec.max + 1 });
  });

  /**
   * The scalar bound is measured on the TRIMMED value, matching both the list bound beside it
   * (`splitCreativeLines` trims every entry) and the payload builder, which trims before it sends.
   *
   * `Validators.maxLength` measured the raw control, so a value at exactly the width plus a
   * trailing space was refused here while the string that would actually have gone upstream was
   * inside the bound — a client refusing a create campaign-service would have accepted, which is
   * the one thing no guard on this road may do. The second assertion is what keeps this from
   * being a bound that no longer bounds anything.
   */
  it('bounds a text field on its trimmed value, not the raw control', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const spec = GOOGLE_CREATIVE_FIELD_SPECS.display[1];
    const longHeadline = c['campaignForm'].controls.displayCreative.controls.longHeadline;

    longHeadline.setValue(`  ${'a'.repeat(spec.width)}  `);
    expect(longHeadline.valid).toBe(true);
    // The value the wire would have carried, which is what the bound was applied to.
    expect((c['googleCreativePayload']()['displayCreative'] as Record<string, unknown>)['longHeadline']).toBe('a'.repeat(spec.width));

    longHeadline.setValue(`  ${'a'.repeat(spec.width + 1)}  `);
    expect(longHeadline.errors?.['maxlength']).toEqual({ requiredLength: spec.width, actualLength: spec.width + 1 });
  });

  /**
   * The rune-counting fix, pinned at the boundary on BOTH call sites — `creativeTextBounds` and
   * `creativeListBounds` each measure with `googleCreativeFieldWidth`, which charges an emoji 1 as
   * campaign-service's `textWeight` does, and each would silently regress to the old over-refusal if
   * someone swapped in `String.length`.
   *
   * ASCII cannot catch that: `'a'.repeat(n)` is `n` units and `n` runes, so the test above stays
   * green under either implementation. A non-BMP character is where the two measures diverge — an
   * emoji is 2 UTF-16 units and 1 rune — so a value at exactly the width is 2× the width in units
   * and MUST still be accepted. That is the whole point: campaign-service counts these as runes
   * and accepts them, and a client that refused them would be refusing a create upstream makes.
   * The Microsoft keyword box pins the same hazard the same way.
   *
   * The over-the-bound half keeps this from being a test that no longer tests anything, and
   * `actualLength` proves the error reports runes too, not units.
   */
  it('bounds text and list fields in code points, not UTF-16 units', () => {
    const emoji = '\u{1F600}';
    const c = seedChannel(fixture, { includeDemandGen: true, includeDisplay: true });

    const scalar = GOOGLE_CREATIVE_FIELD_SPECS.display[1];
    const longHeadline = c['campaignForm'].controls.displayCreative.controls.longHeadline;

    longHeadline.setValue(emoji.repeat(scalar.width));
    // Twice the bound in UTF-16 units — what `String.length` would have refused on.
    expect(longHeadline.value.length).toBe(scalar.width * 2);
    expect(longHeadline.valid).toBe(true);

    longHeadline.setValue(emoji.repeat(scalar.width + 1));
    expect(longHeadline.errors?.['maxlength']).toEqual({ requiredLength: scalar.width, actualLength: scalar.width + 1 });

    const list = GOOGLE_CREATIVE_FIELD_SPECS['demand-gen'][0];
    const headlines = c['campaignForm'].controls.demandGenCreative.controls.headlines;

    headlines.setValue(emoji.repeat(list.width));
    expect(headlines.valid).toBe(true);

    headlines.setValue(emoji.repeat(list.width + 1));
    expect(headlines.errors?.['creativeListWidth']).toEqual({ label: list.label, width: list.width });
  });

  /**
   * Display width, as campaign-service judges headlines, long headlines, descriptions and business
   * names (`validateCreativeText`, `textWeight`): a CJK ideograph counts 2. Each value below is
   * within the field's width in code points and over it in display width, so a code-point bound
   * (what this tab measured before #5219's review) accepts it and upstream refuses it after the
   * budget. Both list call sites and the scalar one are pinned.
   */
  it('bounds headlines, descriptions and business names by display width, CJK counting double', () => {
    const cjk = '会';
    const c = seedChannel(fixture, { includeDemandGen: true, includeDisplay: true, includePerformanceMax: true });

    const pmaxDescriptions = c['campaignForm'].controls.performanceMaxCreative.controls.descriptions;
    pmaxDescriptions.setValue(cjk.repeat(45));
    expect(pmaxDescriptions.valid).toBe(true);
    pmaxDescriptions.setValue(cjk.repeat(46));
    expect(pmaxDescriptions.errors?.['creativeListWidth']).toEqual({ label: 'Descriptions', width: 90 });

    const dgHeadlines = c['campaignForm'].controls.demandGenCreative.controls.headlines;
    dgHeadlines.setValue(cjk.repeat(15));
    expect(dgHeadlines.valid).toBe(true);
    dgHeadlines.setValue(cjk.repeat(16));
    expect(dgHeadlines.errors?.['creativeListWidth']).toEqual({ label: 'Headlines', width: 30 });

    const businessName = c['campaignForm'].controls.displayCreative.controls.businessName;
    businessName.setValue(cjk.repeat(12));
    expect(businessName.valid).toBe(true);
    businessName.setValue(cjk.repeat(13));
    expect(businessName.errors?.['maxlength']).toEqual({ requiredLength: 25, actualLength: 26 });
  });

  /**
   * The call to action is a closed list since #1614 (F13): Google refuses text outside the documented
   * list after the campaign exists. The rune-count bound campaign-service applies
   * (`maxDisplayCallToActionRunes`) still stands beside it, so text past 30 runes carries both.
   */
  it('holds the call to action to its list, beside the rune-count bound campaign-service applies', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const cta = c['campaignForm'].controls.displayCreative.controls.callToActionText;

    cta.setValue('Learn More');
    expect(cta.valid).toBe(true);
    cta.setValue('会'.repeat(30));
    expect(cta.errors?.['creativeOption']).toBeDefined();
    expect(cta.errors?.['maxlength']).toBeUndefined();
    cta.setValue('会'.repeat(31));
    expect(cta.errors?.['maxlength']).toEqual({ requiredLength: 30, actualLength: 31 });
  });

  /**
   * `assetGroupName`'s width is the one bound this change ADDS to the catalogue, and nothing else
   * in the suite touches it: the scalar boundary tests above both drive Display's `longHeadline`,
   * so deleting `width: 256` from the catalogue entry left every test green. That is the exact
   * shape of regression this feature exists to prevent — an unbounded field reaching
   * campaign-service and coming back refused, one round trip later.
   *
   * Both halves are pinned because either alone can rot independently: the catalogue can lose the
   * number while the validator wiring stands, and the wiring can stop reading `width` while the
   * number sits there unused. 256 is `maxAssetGroupNameRunes` upstream, counted on the trimmed
   * value, which is why the over-the-bound case uses a trailing space.
   */
  it('bounds the asset group name at the width the catalogue carries', () => {
    const spec = GOOGLE_CREATIVE_FIELD_SPECS['performance-max'].find((field) => field.control === 'assetGroupName');
    expect(spec?.width).toBe(256);

    const width = spec?.width ?? 0;
    const c = seedChannel(fixture, { includePerformanceMax: true });
    const assetGroupName = c['campaignForm'].controls.performanceMaxCreative.controls.assetGroupName;

    assetGroupName.setValue(`  ${'a'.repeat(width)}  `);
    expect(assetGroupName.valid).toBe(true);

    assetGroupName.setValue(`  ${'a'.repeat(width + 1)}  `);
    expect(assetGroupName.errors?.['maxlength']).toEqual({ requiredLength: width, actualLength: width + 1 });
  });

  /**
   * No CONTROL VALIDATOR carries `min`, and that is not an oversight. A validator sees one control
   * and never the group, so it cannot tell a half-filled creative from an empty one — and a
   * channel with no creative at all is a create campaign-service makes. The floor is enforced at
   * submit instead, where the whole creative is in view; `googleCreativeError` below is that half.
   */
  it('does not enforce a list field minimum on the control', () => {
    const c = seedChannel(fixture, { includePerformanceMax: true });
    const headlines = c['campaignForm'].controls.performanceMaxCreative.controls.headlines;

    headlines.setValue('just the one');

    expect(GOOGLE_CREATIVE_FIELD_SPECS['performance-max'][0].min).toBeGreaterThan(1);
    expect(headlines.valid).toBe(true);
    expect(c['campaignForm'].controls.performanceMaxCreative.valid).toBe(true);
  });

  /** All four bound combinations a guidance sentence is assembled from, plus the catalogue's own note. */
  it('states a field’s bounds in its guidance', () => {
    const c = fixture.componentInstance as unknown as Record<string, any>;

    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'list', min: 1, max: 5, width: 30 })).toBe(
      '1–5 entries, one per line. Up to 30 characters each.'
    );
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'list', max: 5 })).toBe('Up to 5 entries, one per line.');
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'list', min: 2 })).toBe('At least 2 entries, one per line.');
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'list' })).toBe('One entry per line.');
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'text', width: 25 })).toBe('Up to 25 characters.');
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'text' })).toBe('');
    expect(c['creativeFieldGuidance']({ control: 'a', label: 'A', kind: 'text', width: 25, hint: 'Required.' })).toBe('Up to 25 characters. Required.');
  });

  /**
   * The template reads `field.guidance`, not a method — the sentence is assembled once when the
   * section resolves instead of on every change-detection pass. This pins the two together.
   */
  it('carries each field’s guidance on the resolved section', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const section = c['googleCreativeSections']().find((entry: { groupName: string }) => entry.groupName === 'displayCreative');

    expect(section.fields).toHaveLength(GOOGLE_CREATIVE_FIELD_SPECS.display.length);
    section.fields.forEach((field: Record<string, any>, index: number) => {
      expect(field['guidance']).toBe(c['creativeFieldGuidance'](GOOGLE_CREATIVE_FIELD_SPECS.display[index]));
    });
  });

  /**
   * The error line stays silent until the field is touched — every one of these controls starts
   * empty and valid, and an untouched field has nothing to report.
   */
  it('reports a field error only once the field is touched', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const spec = GOOGLE_CREATIVE_FIELD_SPECS.display[0];
    const headlines = c['campaignForm'].controls.displayCreative.controls.headlines;
    headlines.setValue(Array.from({ length: spec.max + 1 }, () => 'ok').join('\n'));

    expect(c['creativeFieldErrors']()[`displayCreative.${spec.control}`]).toBeUndefined();

    // Blur emits on neither `valueChanges` nor `statusChanges`, so the touched state reaches the
    // error map over its own `AbstractControl.events` stream. This is the assertion that pins it.
    headlines.markAsTouched();

    expect(c['creativeFieldErrors']()[`displayCreative.${spec.control}`]).toBe(`At most ${spec.max} entries — ${spec.max + 1} given.`);
  });

  it('reports the width and maxlength errors in the field’s own words', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    const listSpec = GOOGLE_CREATIVE_FIELD_SPECS.display[0];
    const textSpec = GOOGLE_CREATIVE_FIELD_SPECS.display[1];
    const group = c['campaignForm'].controls.displayCreative.controls;

    group.headlines.setValue('a'.repeat(listSpec.width + 1));
    group.headlines.markAsTouched();
    expect(c['creativeFieldErrors']()[`displayCreative.${listSpec.control}`]).toBe(`Each entry must be ${listSpec.width} characters or fewer.`);

    group.longHeadline.setValue('a'.repeat(textSpec.width + 1));
    group.longHeadline.markAsTouched();
    expect(c['creativeFieldErrors']()[`displayCreative.${textSpec.control}`]).toBe(`Must be ${textSpec.width} characters or fewer.`);
  });

  /**
   * Shape-never-content, matching the BFF normalizer this feeds: a field that trims to nothing is
   * OMITTED rather than sent as `''` or `[]`, and a channel whose whole creative is empty emits no
   * key at all — an empty array is a positive statement ("no images") where absence means "none
   * asked for", and upstream treats the two differently on the reciprocal image fields.
   */
  it('omits empty creative fields and empty creatives entirely', () => {
    const c = seedChannel(fixture, { includeDisplay: true });

    expect(c['googleCreativePayload']()).toEqual({});

    c['campaignForm'].controls.displayCreative.patchValue({ headlines: '  \n \n', businessName: '   ' });
    expect(c['googleCreativePayload']()).toEqual({});

    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'One\nTwo\n', businessName: '  Acme  ' });
    expect(c['googleCreativePayload']()).toEqual({ displayCreative: { headlines: ['One', 'Two'], businessName: 'Acme' } });
  });

  /**
   * A creative is only sent for a channel whose section is actually rendered.
   *
   * The payload reads `googleCreativeSections()` — the same signal the template renders — rather
   * than a second reading of the ticked channels, so the rule is proved by changing what is
   * SELECTED, not by what the caller passes. A filled-in creative left behind by a since-unticked
   * channel must not reach the wire.
   */
  it('sends no creative for an unselected channel', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'One' });
    expect(c['googleCreativePayload']()).toEqual({ displayCreative: { headlines: ['One'] } });

    c['campaignForm'].patchValue({ includeDisplay: false });
    fixture.detectChanges();

    expect(c['googleCreativePayload']()).toEqual({});
  });

  /**
   * The draft round-trip, including a key the catalogue no longer has. The draft is persisted
   * JSON, and Angular throws on a `patchValue` naming a control that is not there — so one stale
   * key must not take the whole restore down with it.
   */
  it('round-trips the creative text through a draft, skipping a stale key', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'One\nTwo', businessName: 'Acme' });

    const snapshot = c['googleCreativeSnapshot']();
    expect(snapshot['displayCreative']).toMatchObject({ headlines: 'One\nTwo', businessName: 'Acme' });

    c['campaignForm'].controls.displayCreative.patchValue({ headlines: '', businessName: '' });
    c['restoreGoogleCreatives']({ ...snapshot, displayCreative: { ...snapshot['displayCreative'], retiredField: 'x' }, retiredGroup: { headlines: 'y' } });

    expect(c['campaignForm'].controls.displayCreative.getRawValue()).toMatchObject({ headlines: 'One\nTwo', businessName: 'Acme' });
  });

  /** The snapshot is a copy, not a live view of a form this component is about to destroy. */
  it('snapshots the creative groups by value', () => {
    const c = seedChannel(fixture, { includeDisplay: true });
    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'One' });

    const snapshot = c['googleCreativeSnapshot']();
    c['campaignForm'].controls.displayCreative.patchValue({ headlines: 'Changed' });

    expect(snapshot['displayCreative'].headlines).toBe('One');
  });
});
