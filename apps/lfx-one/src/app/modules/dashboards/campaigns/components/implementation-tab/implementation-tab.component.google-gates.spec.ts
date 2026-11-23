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
import { SEED_KEYWORD, stubCreativeLibraryUpload } from './implementation-tab.spec-helper';

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
