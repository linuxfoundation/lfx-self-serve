// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { Signal, WritableSignal } from '@angular/core';
import { computed, signal } from '@angular/core';
import type {
  BriefMetrics,
  BriefMetricsRow,
  CampaignAudience,
  CampaignServiceEmailMetrics,
  CampaignBriefOutput,
  CampaignBriefPersistResult,
  CampaignBriefPersistenceState,
  CampaignImplementationDraft,
  CampaignDeliveryType,
  CampaignListResult,
  CampaignTab,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { provideRouter } from '@angular/router';
import { CampaignService } from '@services/campaign.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';
import { EVENT_TERM_GENERIC, HUBSPOT_TEMPLATE_RENDER_LIMIT } from '@lfx-one/shared/constants';
import type { HubSpotMarketingEmail } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { map, NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { CampaignsComponent } from './campaigns.component';
import { seedSelectedFoundation, STATE_ONLY, campaignsComponentUnderTest, trackStateOnlyTests } from './campaigns.spec-helper';
import { ImplementationTabComponent } from './components/implementation-tab/implementation-tab.component';
import { PlanningTabComponent } from './components/planning-tab/planning-tab.component';

seedSelectedFoundation({ uid: 'f-t', slug: 'tlf', name: 'TLF' });
trackStateOnlyTests();

/** A draft with every REQUIRED member of {@link CampaignImplementationDraft} present. */
function completeDraftFor(slug: string): CampaignImplementationDraft {
  return {
    eventName: 'KubeCon',
    countryCode: 'US',
    registrationUrl: 'https://example.com',
    headlines: ['Generated A', 'Generated B'],
    descriptions: ['Generated desc'],
    budgetUsd: 500,
    searchBudgetPct: 100,
    startDate: '2026-01-01',
    endDate: '2026-02-01',
    includeSearch: true,
    includeDemandGen: false,
    includePerformanceMax: false,
    includeVideo: false,
    includeDisplay: false,
    linkedInAccountId: '',
    linkedInGeoTargets: [],
    linkedInTargetingProfile: 'mcp',
    eventSlug: slug,
  };
}

/**
 * LFXV2-3229: leaving the Implement tab must not discard what the user typed.
 *
 * `ImplementationTabComponent` stays inside the lazy `@switch` — it resolves the LinkedIn ad-account list in
 * `ngOnInit`, so mounting it eagerly the way LFXV2-3202 (PR #1437, pending) proposes mounting the planner would issue that
 * request on every page load for a tab many users never open. The component is therefore still
 * destroyed on a tab switch; what changed is that its edits now live on the parent.
 *
 * Driven through the real DOM rather than by poking the child, because the destruction IS the
 * mechanism under test — a test that kept one child instance alive would prove nothing.
 */
describe('CampaignsComponent — Implementation edits survive a tab switch', () => {
  let fixture: ComponentFixture<CampaignsComponent>;

  interface Internals {
    selectedTab: WritableSignal<CampaignTab>;
    briefOutput: WritableSignal<CampaignBriefOutput | null>;
    implementationDraft: WritableSignal<CampaignImplementationDraft | null>;
    briefCampaignsDemandGenEnabled: WritableSignal<boolean | null>;
    selectTab(tab: CampaignTab, owner: CampaignDeliveryType): void;
    onProceedToImplementation(brief: CampaignBriefOutput): void;
    resetToPlanning(): void;
  }
  const internals = (): Internals => fixture.componentInstance as unknown as Internals;

  const briefFor = (slug: string): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon', slug, countryCode: 'US', registrationUrl: 'https://example.com' },
      totalBudget: 500,
      selectedPlatforms: ['google-ads'],
      structuredCopy: { google_search: { headlines: ['Generated A', 'Generated B'], descriptions: ['Generated desc'] } },
    }) as unknown as CampaignBriefOutput;

  /** The first headline input inside the Implement panel, which is what a user actually types in. */
  const headlineInput = (): HTMLInputElement | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-headline-0"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(campaignsComponentUnderTest());
    TestBed.inject(PersonaService).currentPersona.set('executive-director');
    fixture.detectChanges();
  });

  /** The budget-split slider, and the label DERIVED from it through `toSignal(valueChanges)`. */
  const budgetSlider = (): HTMLInputElement | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-budget-split"]');
  const budgetLabel = (): string => {
    const el = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-budget-split"]')?.previousElementSibling;
    return el?.textContent?.trim() ?? '';
  };

  /**
   * The field class the other round-trip tests miss, raised by @dealako.
   *
   * Every existing restore assertion reads a native input's `.value`, and a native input's DOM
   * tracks its control REGARDLESS of whether the patch emitted. So a restore that suppressed
   * emission passed them all while leaving the DERIVED displays stale — the slider thumb moved to
   * the draft value and the label beside it still showed the brief's.
   *
   * Asserting the rendered label is what catches that, because it is computed from
   * `valueChanges` rather than read off the control.
   */
  it('restores the budget-split LABEL, not just the slider value', async () => {
    internals().onProceedToImplementation(briefFor('kubecon-eu-2026'));
    // The slider is shown for the one pair whose budget it actually splits, Search + Demand Gen,
    // so the capability has to be answered and the box ticked before it is in the DOM at all.
    internals().briefCampaignsDemandGenEnabled.set(true);
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    const demandGen = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[formControlName="includeDemandGen"]');
    expect(demandGen).not.toBeNull();
    demandGen!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const slider = budgetSlider();
    expect(slider).not.toBeNull();

    // Drag the split to 30% search / 70% demand gen.
    slider!.value = '30';
    slider!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(budgetLabel()).toContain('Search 30%');
    expect(budgetLabel()).toContain('Demand Gen 70%');

    // Leave and come back — this destroys the component.
    internals().selectTab('insights', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    // The control restores either way; the LABEL is what the suppressed emission broke.
    expect(budgetSlider()!.value).toBe('30');
    expect(budgetLabel()).toContain('Search 30%');
    expect(budgetLabel()).toContain('Demand Gen 70%');
  });

  /**
   * The slider is not a permanent fixture of the Google section (#3317, Copilot).
   *
   * It splits a budget between Search and Demand Gen and nothing else — `normalizeBudgetSplit` on
   * the legacy road consults no other channel, and campaign-service refuses every multi-channel
   * create on the cutover road. Rendering it beside Performance Max and Display, labelled
   * "Display", told the user they were dividing a budget that was never divided.
   */
  it('withholds the budget-split slider when the split funds nothing', async () => {
    internals().onProceedToImplementation(briefFor('kubecon-eu-2026'));
    internals().briefCampaignsDemandGenEnabled.set(true);
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    // Search alone — the default — funds one campaign with the whole budget.
    expect(budgetSlider()).toBeNull();

    const demandGen = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[formControlName="includeDemandGen"]');
    demandGen!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(budgetSlider()).not.toBeNull();

    // Demand Gen alone takes the whole budget too, so the split goes away again.
    const search = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[formControlName="includeSearch"]');
    search!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(budgetSlider()).toBeNull();
  });

  it('carries a typed headline back after a trip to another tab', async () => {
    internals().onProceedToImplementation(briefFor('kubecon-eu-2026'));
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    const input = headlineInput();
    expect(input).not.toBeNull();

    // Type over the generated copy, the way a marketer would.
    input!.value = 'Hand-edited headline';
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    // The parent must already hold it — the child is about to be destroyed.
    expect(internals().implementationDraft()?.headlines?.[0]).toBe('Hand-edited headline');

    // Leave and come back. This DESTROYS the component; that is the point.
    internals().selectTab('insights', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-implementation-panel"]')).toBeNull();

    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(headlineInput()?.value).toBe('Hand-edited headline');
  });

  it('seeds the parent draft with the brief copy, not the empty initial control', async () => {
    // Regression: `replaceCopyArray` originally suppressed emission for BOTH callers, so the
    // brief seed never reached the parent and the draft held the form's empty starting control.
    // Switching away and back then restored `[""]` over real generated headlines — the fix
    // making the bug worse than the bug. Emission is now the caller's decision.
    internals().onProceedToImplementation(briefFor('kubecon-eu-2026'));
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(internals().implementationDraft()?.headlines).toEqual(['Generated A', 'Generated B']);
  });

  it('carries a corrected registration URL back, which is where the spend lands', async () => {
    // The highest-cost field on the form: a reverted URL sends paid traffic at the stale scraped
    // value. It is a plain text input the user types into, and populateFromBrief re-stamps it
    // from the brief on every remount — so it needs the same treatment as the copy.
    internals().onProceedToImplementation(briefFor('kubecon-eu-2026'));
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    const url = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-reg-url"]') as HTMLInputElement | null;
    expect(url).not.toBeNull();
    url!.value = 'https://corrected.example.com/register';
    url!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    internals().selectTab('insights', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    const back = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="implementation-reg-url"]') as HTMLInputElement | null;
    expect(back?.value).toBe('https://corrected.example.com/register');
  });

  it('discards the draft when the brief it belongs to is discarded', async () => {
    // `resetToPlanning` is the one draft-CLEARING path this change adds, and it was declared on
    // Internals without ever being driven. Keeping the draft here would replay the discarded
    // brief's copy over whatever is generated next — the eventSlug guard cannot catch that,
    // because a program switch can land on the same event.
    internals().onProceedToImplementation(briefFor('kubecon-eu-2026'));
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(internals().implementationDraft()).not.toBeNull();

    internals().resetToPlanning();
    fixture.detectChanges();

    expect(internals().implementationDraft()).toBeNull();
  });

  it('survives a SECOND tab leave with no typing in between', async () => {
    internals().onProceedToImplementation(briefFor('kubecon-eu-2026'));
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    const input = headlineInput();
    input!.value = 'Typed once';
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    // First round trip.
    internals().selectTab('insights', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(headlineInput()?.value).toBe('Typed once');

    // SECOND round trip, typing nothing. The remount re-seeded the parent from the brief and
    // applyDraft restored silently, so without a re-emit the parent now holds the BRIEF copy
    // while the form shows the edit — and this leave overwrites the edit with it.
    internals().selectTab('insights', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(headlineInput()?.value).toBe('Typed once');
  });

  it('does not replay one event edits onto a different brief', async () => {
    // The guard that makes the draft safe to hold un-keyed on the parent. Without it, generating
    // a brief for event B and opening Implement would restore event A's copy over it.
    //
    // ORDER MATTERS, and an earlier version of this test had it wrong (@dealako caught it):
    // `onProceedToImplementation` runs `implementationDraft.set(null)` FIRST, so seeding the
    // draft before that call left the child mounting with `draft === null`. `applyDraft` then
    // returned at its `if (!draft)` line and never reached the `eventSlug` mismatch branch —
    // deleting the guard entirely still passed. Proceed first, seed the stale draft after, so the
    // child mounts with a draft whose slug genuinely disagrees.
    internals().onProceedToImplementation(briefFor('event-b'));

    internals().implementationDraft.set({
      eventName: 'Event A',
      countryCode: 'US',
      registrationUrl: 'https://event-a.example.com',
      headlines: ['Copy for event A'],
      descriptions: [],
      budgetUsd: 999,
      searchBudgetPct: 10,
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      includeSearch: true,
      includeDemandGen: false,
      includePerformanceMax: false,
      includeVideo: false,
      includeDisplay: false,
      // Event A's LinkedIn picks (LFXV2-3230). Present so this stale draft is a COMPLETE one —
      // the guard under test must reject it on the slug alone, not because it happened to be
      // missing fields.
      linkedInAccountId: 'urn:li:sponsoredAccount:event-a',
      linkedInGeoTargets: [],
      linkedInTargetingProfile: 'mcp',
      eventSlug: 'event-a',
    });

    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    // Event B's own generated copy stands.
    expect(headlineInput()?.value).toBe('Generated A');
  });

  /**
   * #3810 (Copilot): the draft clear is right for everything refine REGENERATES and wrong for the
   * two extension lists, which it does not.
   *
   * Refine for the same event hands back a brief carrying the callouts and sitelinks the generator
   * produced the first time — the operator has been editing them since, and the clear puts the
   * originals back over their work. The slug guard one level down cannot catch it: refining the
   * SAME event is the whole scenario, so the slugs agree.
   */
  const briefWithExtensions = (slug: string): CampaignBriefOutput =>
    ({
      ...briefFor(slug),
      googleCallouts: ['Generated callout'],
      googleSitelinks: [{ text: 'Register', finalUrl: 'https://example.com/register' }],
    }) as unknown as CampaignBriefOutput;

  it('keeps an edited callout list when the same event is refined and proceeded again', async () => {
    // The SAVED half of the carry, not just the in-memory one. `onProceedToImplementation` hands
    // `handedOver` to both `briefOutput` and `persistBrief`, and a regression passing the pre-carry
    // `brief` to the second would leave the editor showing the operator's edits while the stored row
    // held the generator's originals — invisible until the next Restore quietly lost them.
    //
    // The stub RESOLVES, and must: `persistBrief` serializes saves on `persistChain`, so a `NEVER`
    // here would leave the first Proceed's save in flight forever and the second one would never be
    // sent at all — the assertion below would then read the first call and fail for the wrong
    // reason. It resolves as the cutover-dark no-op (`enabled: false`, no id), which records no
    // ownership and leaves the banner idle, so the save bookkeeping other specs own stays out of
    // this one.
    const persistBrief = vi
      .spyOn(TestBed.inject(CampaignService), 'persistBrief')
      .mockReturnValue(of({ enabled: false, briefId: '', etag: null, created: false, approved: false }));

    // Driven through the mounted child rather than by hand-building a draft, so the carry is shown
    // composing with the draft `buildDraft` actually emits — the editor's own edits are then layered
    // onto that real draft the way `draftChange` would.
    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    const emitted = internals().implementationDraft();
    expect(emitted).not.toBeNull();
    expect(emitted!.eventSlug).toBe('kubecon-eu-2026');
    internals().implementationDraft.set({ ...emitted!, googleCallouts: ['Early bird pricing'] });

    // Back to Planning, refine, proceed again — the SAME event, so a new brief object carrying the
    // generator's original list arrives while the operator's edit lives only in the draft. The
    // child's `eventSlug` guard cannot help: the slugs agree, which is the whole scenario.
    internals().selectTab('planning', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();
    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(internals().briefOutput()?.googleCallouts).toEqual(['Early bird pricing']);
    // And the regenerated copy still wins for the fields refine actually produces.
    expect(headlineInput()?.value).toBe('Generated A');

    // The same object the page holds, not a sibling that happens to match: identity is what pins
    // `persistBrief(handedOver)` rather than `persistBrief(brief)`, since the two differ only in
    // the carried lists.
    // Awaited, not read straight away: saves are dispatched from `persistChain`, a promise queue
    // `fixture.whenStable()` does not drain — the second Proceed's link only runs once the first
    // save's response has been handled, which lands after the awaits above have resolved.
    await vi.waitFor(() => expect(persistBrief).toHaveBeenCalledTimes(2));
    const persisted = persistBrief.mock.calls[1][0];
    expect(persisted).toBe(internals().briefOutput());
    expect(persisted.googleCallouts).toEqual(['Early bird pricing']);
    expect(persisted.googleSitelinks).toEqual(emitted!.googleSitelinks);
  });

  it('leaves a brief that carries no extension lists exactly as it arrived', STATE_ONLY, () => {
    // `buildDraft` always emits both fields as arrays, so without the empty-and-absent exception a
    // second Proceed would add `googleCallouts: []` to a brief that never had one — a field written
    // into the persisted row recording a clearance of a list that was never there.
    internals().onProceedToImplementation(briefFor('kubecon-eu-2026'));
    // The shape `emitDraft` actually produces — both fields present and EMPTY. A draft with the
    // fields missing returns on `callouts !== undefined` before the exception clause this test
    // exists to pin is ever reached, so it would stay green with the clause deleted.
    internals().implementationDraft.set({ ...completeDraftFor('kubecon-eu-2026'), googleCallouts: [], googleSitelinks: [] });

    const plain = briefFor('kubecon-eu-2026');
    internals().onProceedToImplementation(plain);

    expect(internals().briefOutput()).toBe(plain);
  });

  it('carries an emptied extension list as [], so a full clear-out is not undone', STATE_ONLY, () => {
    // The case Copilot named explicitly. On `CampaignBriefOutput` absent and empty differ — `[]`
    // CLEARS the editor, `undefined` leaves it alone — so dropping an empty list here would put the
    // generator's entries back over a deliberate removal.
    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));
    internals().implementationDraft.set({
      ...completeDraftFor('kubecon-eu-2026'),
      googleCallouts: [],
      googleSitelinks: [],
    });

    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));

    expect(internals().briefOutput()?.googleCallouts).toEqual([]);
    expect(internals().briefOutput()?.googleSitelinks).toEqual([]);
  });

  it('carries edited sitelinks and leaves the regenerated fields alone', STATE_ONLY, () => {
    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));
    const edited = { text: 'Operator link', finalUrl: 'https://example.com/schedule' };
    internals().implementationDraft.set({ ...completeDraftFor('kubecon-eu-2026'), googleSitelinks: [edited] });

    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));

    expect(internals().briefOutput()?.googleSitelinks).toEqual([{ text: 'Operator link', finalUrl: 'https://example.com/schedule' }]);
    // Deep-copied, not aliased — the entry the editor goes on to mutate must not be the same object
    // the brief (and the row persisted from it) now holds.
    expect(internals().briefOutput()?.googleSitelinks?.[0]).not.toBe(edited);
    // Everything refine DOES regenerate is untouched by the carry.
    expect(internals().briefOutput()?.googleCallouts).toEqual(['Generated callout']);
  });

  it('does not carry one event extensions onto a different event brief', STATE_ONLY, () => {
    internals().onProceedToImplementation(briefWithExtensions('event-a'));
    internals().implementationDraft.set({
      ...completeDraftFor('event-a'),
      googleCallouts: ['Event A only'],
    });

    internals().onProceedToImplementation(briefWithExtensions('event-b'));

    expect(internals().briefOutput()?.googleCallouts).toEqual(['Generated callout']);
  });

  /**
   * #3810 round 2 (Copilot and Cursor, independently): the carry was keyed on the event SLUG, and
   * the slug cannot tell "the same brief, refined" from "the same event, generated again".
   *
   * The route is real and sits in the Planning tab's own template: `planning-new-brief-btn` calls
   * `reset()`, which puts the step back to `input` and re-arms Generate without leaving the event.
   * A full generate emits NEW callouts and sitelinks; the draft from the last Implement visit then
   * replaced them, so the regenerated brief opened — and `persistBrief` stored it — carrying the
   * previous generation's extensions.
   *
   * The whole class is "every transition that replaces the brief", and each member has a test here
   * rather than this one route being patched: refine must still carry (both the first and the
   * second time), restore must not, and Start Over must leave nothing behind.
   */
  const regeneratedBrief = (slug: string): CampaignBriefOutput =>
    ({
      ...briefFor(slug),
      googleCallouts: ['Regenerated callout'],
      googleSitelinks: [{ text: 'Book now', finalUrl: 'https://example.com/book' }],
    }) as unknown as CampaignBriefOutput;

  it('drops the edits when the same event is generated again, rather than overwriting the new lists', STATE_ONLY, () => {
    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));
    internals().implementationDraft.set({
      ...completeDraftFor('kubecon-eu-2026'),
      googleCallouts: ['Early bird pricing'],
      googleSitelinks: [{ text: 'Operator link', finalUrl: 'https://example.com/schedule' }],
    });

    // New Brief → Generate: same event, same slug, different lists.
    internals().onProceedToImplementation(regeneratedBrief('kubecon-eu-2026'));

    expect(internals().briefOutput()?.googleCallouts).toEqual(['Regenerated callout']);
    expect(internals().briefOutput()?.googleSitelinks).toEqual([{ text: 'Book now', finalUrl: 'https://example.com/book' }]);
  });

  it('still carries the edits on a SECOND refine of the same brief', () => {
    // The trap in the obvious fix. Comparing the incoming lists against the brief ON SCREEN works
    // once and then stops: after the first carry the on-screen brief holds the operator's edits
    // while Planning still holds the generator's originals, so the second refine compares unequal
    // and silently drops the edits. The baseline is therefore recorded from the INCOMING brief,
    // before the carry, which keeps it equal to what Planning keeps handing back.
    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));
    internals().implementationDraft.set({ ...completeDraftFor('kubecon-eu-2026'), googleCallouts: ['Early bird pricing'] });

    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));
    expect(internals().briefOutput()?.googleCallouts).toEqual(['Early bird pricing']);

    // Refine a second time. The edit is re-entered because the first Proceed cleared the draft,
    // exactly as a returning operator would re-enter the editor and have it seeded from the brief.
    internals().implementationDraft.set({ ...completeDraftFor('kubecon-eu-2026'), googleCallouts: ['Early bird pricing'] });
    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));

    expect(internals().briefOutput()?.googleCallouts).toEqual(['Early bird pricing']);
  });

  it('carries nothing on the first Proceed of a session, when no brief has been handed over yet', STATE_ONLY, () => {
    // Fail-closed: a draft with no baseline behind it is a draft typed over nothing this page
    // handed out, so it has no claim on the incoming lists.
    internals().implementationDraft.set({ ...completeDraftFor('kubecon-eu-2026'), googleCallouts: ['Stale'] });

    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));

    expect(internals().briefOutput()?.googleCallouts).toEqual(['Generated callout']);
  });

  it('does not carry onto a restored brief, and records its lists for what follows', STATE_ONLY, () => {
    const restore = internals() as unknown as { onProceedToImplementation(b: CampaignBriefOutput, alreadyPersisted: boolean): void };

    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));
    internals().implementationDraft.set({ ...completeDraftFor('kubecon-eu-2026'), googleCallouts: ['Early bird pricing'] });

    // A restore writes nothing, so substituting into it would show values no stored row holds.
    const restored = regeneratedBrief('kubecon-eu-2026');
    restore.onProceedToImplementation(restored, true);
    expect(internals().briefOutput()).toBe(restored);

    // And the baseline moved with it: edits typed over the RESTORED brief carry back onto it, and
    // the pre-restore generation's lists no longer match anything.
    internals().implementationDraft.set({ ...completeDraftFor('kubecon-eu-2026'), googleCallouts: ['After restore'] });
    internals().onProceedToImplementation(regeneratedBrief('kubecon-eu-2026'));
    expect(internals().briefOutput()?.googleCallouts).toEqual(['After restore']);
  });

  it('does not carry onto a restored brief whose lists MATCH the baseline', STATE_ONLY, () => {
    // The case the test above cannot cover. There the restored brief's lists differ from the
    // baseline, so `sameCallouts` refuses the carry on its own and the `alreadyPersisted` exclusion
    // could be deleted with the test still green. Here the restored lists are the baseline's, the
    // draft holds an edit, and the exclusion is the ONLY thing standing between them — a realistic
    // flow too: generate, proceed, edit, New Brief, then restore the row this generation wrote.
    const restore = internals() as unknown as { onProceedToImplementation(b: CampaignBriefOutput, alreadyPersisted: boolean): void };

    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));
    internals().implementationDraft.set({
      ...completeDraftFor('kubecon-eu-2026'),
      googleCallouts: ['Early bird pricing'],
      googleSitelinks: [{ text: 'Operator link', finalUrl: 'https://example.com/schedule' }],
    });

    const restored = briefWithExtensions('kubecon-eu-2026');
    restore.onProceedToImplementation(restored, true);

    // Identity, not equality: a restore must hand the stored object through untouched, and a carry
    // would return a substituted copy carrying the draft's edits over values no row holds.
    expect(internals().briefOutput()).toBe(restored);
    expect(internals().briefOutput()?.googleCallouts).toEqual(['Generated callout']);
  });

  it('carries nothing after Start Over, which clears the baseline with the draft', STATE_ONLY, () => {
    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));
    internals().implementationDraft.set({ ...completeDraftFor('kubecon-eu-2026'), googleCallouts: ['Early bird pricing'] });

    internals().resetToPlanning();
    // Re-seeded the way a stale draft would survive if anything ever held one past the reset: the
    // baseline alone must be enough to refuse the carry.
    internals().implementationDraft.set({ ...completeDraftFor('kubecon-eu-2026'), googleCallouts: ['Early bird pricing'] });

    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));

    expect(internals().briefOutput()?.googleCallouts).toEqual(['Generated callout']);
  });

  it('gates each extension list on its own, so one regenerated list does not void the other', STATE_ONLY, () => {
    internals().onProceedToImplementation(briefWithExtensions('kubecon-eu-2026'));
    internals().implementationDraft.set({
      ...completeDraftFor('kubecon-eu-2026'),
      googleCallouts: ['Early bird pricing'],
      googleSitelinks: [{ text: 'Operator link', finalUrl: 'https://example.com/schedule' }],
    });

    // Callouts regenerated, sitelinks handed back unchanged.
    const mixed = {
      ...briefWithExtensions('kubecon-eu-2026'),
      googleCallouts: ['Regenerated callout'],
    } as unknown as CampaignBriefOutput;
    internals().onProceedToImplementation(mixed);

    expect(internals().briefOutput()?.googleCallouts).toEqual(['Regenerated callout']);
    expect(internals().briefOutput()?.googleSitelinks).toEqual([{ text: 'Operator link', finalUrl: 'https://example.com/schedule' }]);
  });

  it('treats a reordered list as regenerated, since positional edits no longer line up', STATE_ONLY, () => {
    const twoCallouts = { ...briefFor('kubecon-eu-2026'), googleCallouts: ['First', 'Second'] } as unknown as CampaignBriefOutput;
    internals().onProceedToImplementation(twoCallouts);
    internals().implementationDraft.set({ ...completeDraftFor('kubecon-eu-2026'), googleCallouts: ['First edited', 'Second'] });

    const reordered = { ...briefFor('kubecon-eu-2026'), googleCallouts: ['Second', 'First'] } as unknown as CampaignBriefOutput;
    internals().onProceedToImplementation(reordered);

    expect(internals().briefOutput()?.googleCallouts).toEqual(['Second', 'First']);
  });
});

/**
 * The HubSpot template picker (LFXV2-3198).
 *
 * Staging an email CLONES one of the project's marketing emails and `sourceEmailId` has no
 * default, so choosing one is the whole gate on this channel. These tests pin the four states the
 * picker must keep distinct, because collapsing any pair states something false:
 *
 *   not connected · search failed · searched-and-empty · results
 *
 * The dangerous collapse is failure into emptiness: "this portal has no marketing emails" is a
 * claim only a completed search can support, and it sends someone to go create one they may
 * already have.
 */
describe('CampaignsComponent — HubSpot template picker', () => {
  let fixture: ComponentFixture<CampaignsComponent>;
  let httpMock: HttpTestingController;
  // A writable context signal so a foundation SWITCH can be driven, not just its absence.
  let ctx: WritableSignal<ProjectContext | null>;

  interface PickerInternals {
    emailTemplates: WritableSignal<HubSpotMarketingEmail[] | null>;
    emailTemplatesError: WritableSignal<string | null>;
    emailTemplatesTruncated: WritableSignal<boolean>;
    emailChannelEnabled: WritableSignal<boolean | null>;
    selectedEmailTemplateId: WritableSignal<string>;
    emailTemplatesAnnouncement: Signal<string>;
    searchEmailTemplates(query: string): void;
    onSelectEmailTemplate(id: string): void;
    emailBriefOutput: WritableSignal<CampaignBriefOutput | null>;
    emailTemplateSuggestionId: Signal<string>;
    emailTemplateSuggestionTerms: Signal<readonly string[]>;
    emailTemplatesRendered: Signal<HubSpotMarketingEmail[]>;
    selectedEmailTypeId: WritableSignal<string>;
    canStageEmail: Signal<boolean>;
    emailAudience: WritableSignal<CampaignAudience | null>;
  }
  const picker = (): PickerInternals => fixture.componentInstance as unknown as PickerInternals;

  beforeEach(async () => {
    ctx = signal<ProjectContext | null>({ uid: 'u1', name: 'The Linux Foundation', slug: 'tlf', logoUrl: '' } as ProjectContext);
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [
        // The page scopes the root negative-keyword service, which injects the app-root MessageService.
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext: ctx, activeContextUid: computed(() => ctx()?.uid ?? '') } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(campaignsComponentUnderTest());
    TestBed.inject(PersonaService).currentPersona.set('executive-director');
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  function respond(body: { enabled: boolean; error: string | null; possiblyTruncated: boolean; emails: HubSpotMarketingEmail[] }): void {
    const req = httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails');
    req.flush(body);
    fixture.detectChanges();
  }

  /**
   * The event-derived template suggestion.
   *
   * No issue number here deliberately. The branch is named `issue-1698`, but #1698 is the
   * brand_kit-driven body/footer work (de-hardcoding the reference app's portal coupling) and has
   * nothing to do with reading the event off the brief. Citing it made the traceability actively
   * wrong -- worse than absent, because a reader following the link lands on unrelated work.
   *
   * The mapping of event -> branding lives in HubSpot, in the names its operators gave their
   * templates. These pin that it is read rather than guessed at, and — more importantly — that a
   * weak signal is NOT turned into a confident pre-selection. Since #2057 even a strong one is
   * only a recommendation: nothing is selected until the operator clicks a row.
   */
  describe('event-derived template suggestion', () => {
    const briefFor = (name: string, slug: string, city = ''): CampaignBriefOutput => ({ eventDetails: { name, slug, city } }) as unknown as CampaignBriefOutput;

    /**
     * Put the page on Email/Implement so the picker panel is in the DOM.
     *
     * Without this every DOM query returns null -- which makes a NEGATIVE assertion pass for a
     * reason that has nothing to do with the suggestion: the classic test that cannot fail.
     */
    const showPicker = (): void => {
      const c = fixture.componentInstance as unknown as {
        selectorForm: { controls: { deliveryType: { setValue(v: string): void } } };
        selectTab(tab: string, owner: string): void;
      };
      c.selectorForm.controls.deliveryType.setValue('email');
      c.selectTab('implementation', 'email');
      fixture.detectChanges();
      // selectTab issues its own entry search; answer it so it cannot collide with the
      // explicit one each test makes.
      httpMock
        .match((r) => r.url === '/api/campaigns/hubspot/emails')
        .forEach((r) => r.flush({ enabled: true, error: null, possiblyTruncated: false, emails: [] }));
      fixture.detectChanges();
    };

    /**
     * A pending search clears the suggestion at dispatch, not only when it answers: it describes
     * the rows being replaced. Nothing was ever selected for the operator, so there is no
     * selection to release and Stage stays disabled throughout.
     *
     * Asserts the state DURING the flight -- the request is deliberately left unanswered.
     */
    it('clears the suggestion when a new search is dispatched, before it answers', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon Europe 2026', 'kubecon-eu-2026'));
      picker().searchEmailTemplates('kubecon');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'k26', name: 'KubeCon Europe 2026 announcement', subject: 'Register now' }] as HubSpotMarketingEmail[],
      });

      // Suggested, and NOT selected (#2057).
      expect(picker().emailTemplateSuggestionId()).toBe('k26');
      expect(picker().selectedEmailTemplateId()).toBe('');

      // Dispatch a narrower search and leave it IN FLIGHT.
      picker().searchEmailTemplates('workshop');
      fixture.detectChanges();

      expect(picker().emailTemplateSuggestionId(), 'the suggestion outlived the rows it described').toBe('');
      expect(picker().selectedEmailTemplateId()).toBe('');
      expect(picker().canStageEmail()).toBe(false);

      // Drain so the harness's afterEach verification does not trip on the open request.
      httpMock
        .match((r) => r.url === '/api/campaigns/hubspot/emails')
        .forEach((r) => r.flush({ enabled: true, error: null, possiblyTruncated: false, emails: [] }));
    });

    /**
     * The YEAR outranks the CITY, and a prior edition naming the city is the case that proves it.
     *
     * `eventRankBonus` summed the two into one scalar, so extra city tokens on a STALE edition
     * beat the single year point on the current one: for "KubeCon North America 2026" in "Salt
     * Lake City", the 2025 template scored salt+lake+city = 3 against the 2026 template's year =
     * 1, and the PRIOR edition was pre-selected. Staging then clones last year's HubSpot draft --
     * an edition-level wrong clone, which reads as decided and is unlikely to be re-checked.
     *
     * Both templates score identically on the decisive term, so only the tie-break can order them.
     */
    /**
     * A city repeated in the EVENT NAME must not become decisive.
     *
     * The city is meant to RANK, never to justify a suggestion on its own -- that is the whole
     * point of splitting decisive from ranking terms. But the ranking set is built with
     * `!decisive.has(token)`, so when the name already contains the city ("Regional Summit
     * Nairobi" in Nairobi) the token stays in `decisive` and, being six characters, clears the
     * threshold alone. An unrelated "Nairobi newsletter" is then auto-selected.
     */
    /**
     * An UN-LISTED generic long word still SUGGESTS, and that is the known trade-off.
     *
     * `EVENT_TERM_GENERIC` is a vocabulary, so a generic word nobody has added yet -- `developer`
     * -- still scores the double weight and clears the threshold alone. This test pins the
     * CURRENT behavior rather than asserting it is correct: the deny-list closes words someone has
     * noticed, and the next un-noticed one is a fresh false positive.
     *
     * What #2057 changed is the cost of that false positive: it is a badge, not a selection, so the
     * unrelated template is never staged unless the operator picks it. The test pins both halves.
     */
    it('does not let a generic-heavy row block an eligible suggestion', () => {
      showPicker();
      // 'kubecon' is the decisive term. The distractor matches three GENERIC words, so it wins on
      // eventMatchScore (which counts them) while scoring 0 on eventSuggestionScore (which does
      // not). Picking the winner first and gating it afterwards therefore suppressed the eligible
      // KubeCon row entirely -- a template the operator would have been right to see.
      picker().emailBriefOutput.set(briefFor('KubeCon Community Training Webinar', 'kubecon-community-training-webinar'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'generic', name: 'Community training webinar newsletter', subject: 'Monthly update' },
          { id: 'eligible', name: 'KubeCon announcement', subject: 'Register now' },
        ] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('eligible');
    });

    it('still suggests on an un-enumerated generic long word (known limit), but selects nothing', () => {
      showPicker();
      expect(EVENT_TERM_GENERIC.has('developer')).toBe(false);
      picker().emailBriefOutput.set(briefFor('Developer Conference', 'developer-conference'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'unrelated', name: 'Developer newsletter', subject: 'Monthly update' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('unrelated');
      expect(picker().selectedEmailTemplateId(), 'a heuristic match selected a template nobody chose').toBe('');
      expect(picker().canStageEmail()).toBe(false);
    });

    /**
     * An ASCII slug must not smuggle the city back into the decisive set.
     *
     * `cityTokens` is built from `details.city`, which arrives accented -- "München" tokenizes to
     * `münchen`. The decisive pass reads the NAME and the SLUG, and LF slugs are ASCII, so the
     * same city arrives as `munchen`. Comparing raw strings, the two are different words: the
     * accented form was excluded while the ASCII one became decisive and, being seven characters,
     * cleared the threshold on its own -- auto-selecting a template that merely names the city.
     *
     * That is the accented spelling of the city-decides-alone false positive, so it is fixed the
     * same way: membership is tested on a fold, while the terms themselves stay accented because
     * they still have to match accented template names.
     */
    it('does not let an ASCII-folded city in the slug become decisive', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('Cloud Summit', 'cloud-summit-munchen-2026', 'München'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'city-only', name: 'Munchen visitor newsletter', subject: 'Monthly update' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('');
      expect(picker().selectedEmailTemplateId()).toBe('');
    });

    /**
     * TWO generic terms must not add up to a suggestion.
     *
     * Excluding generic words from the DOUBLE weight was not enough: each still scored
     * `EVENT_TERM_WEIGHT`, so two of them summed to exactly the threshold (3 + 3 = 6) and
     * auto-selected on vocabulary that describes neither the event nor the template. Every
     * matching term here -- `community`, `training` -- is in `EVENT_TERM_GENERIC`, so the
     * non-generic evidence is zero and nothing may be offered.
     *
     * This is the case that separates ranking from justification: the template is a perfectly
     * reasonable ORDERING for these terms, and still not evidence that it is the right one.
     */
    it('withholds a suggestion when only generic terms match, however many', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('Community Training Workshop', 'community-training-workshop'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'generic', name: 'Community training newsletter', subject: 'Monthly update' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('');
      expect(picker().selectedEmailTemplateId()).toBe('');
    });

    /**
     * An UN-ENUMERATED generic long word must not decide alone.
     *
     * The deny-list closes the words someone has already noticed; the proxy behind it is the real
     * defect. Any decisive term of six-plus characters scores EVENT_TERM_WEIGHT*2 = the threshold,
     * so `register`, `webinar`, `keynote`, `session` and `speaker` all clear it on a single hit --
     * none of them on the list, each a fresh false positive until someone appends it.
     *
     * Uses `speaker`, which IS in `EVENT_TERM_GENERIC` -- so this pins the deny-list, not the
     * structure. An earlier version of this docstring claimed `speaker` was un-enumerated and
     * that the test therefore caught a regression to enumeration; it checked the wrong list
     * (`EVENT_TERM_STOPWORDS`, which indeed does not contain it) and the claim was false.
     *
     * The un-listed case is covered separately below, and it documents a real remaining
     * trade-off rather than a guarantee.
     */
    it('withholds a suggestion when a single generic long word is the only match', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('Speaker Enablement Program', 'speaker-enablement-program'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'generic', name: 'Speaker reminder — monthly' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId(), 'a single generic long word auto-selected a template').toBe('');
      expect(picker().selectedEmailTemplateId()).toBe('');
    });

    it('does not let a city repeated in the event name justify a suggestion', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('Regional Summit Nairobi', 'regional-summit-nairobi', 'Nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'unrelated', name: 'Nairobi newsletter — monthly roundup' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId(), 'a city-only match was auto-selected').toBe('');
      expect(picker().selectedEmailTemplateId()).toBe('');
    });

    it('prefers the year-matching edition over a prior one that names the city', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon North America 2026', 'kubecon-north-america-2026', 'Salt Lake City'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          // Three city tokens, wrong year -- the row that used to win.
          { id: 'stale', name: 'KubeCon Salt Lake City 2025 Registration' },
          // No city tokens, right year.
          { id: 'current', name: 'KubeCon NA 2026 Registration' },
        ] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId(), 'the prior edition outranked the year-matching one').toBe('current');
      expect(picker().selectedEmailTemplateId()).toBe('');
    });

    it('suggests the template whose name carries the event, badges it, and says what it matched', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'kc', name: 'KubeCon registration reminder' },
          { id: 'mcp', name: 'MCP Dev Summit Nairobi — registration push' },
        ] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('mcp');
      expect(picker().selectedEmailTemplateId(), "the suggestion selected a template on the operator's behalf").toBe('');
      // The REASON must be visible; a suggestion nobody can check is one nobody should trust.
      expect(picker().emailTemplateSuggestionTerms()).toContain('nairobi');
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-template-suggestion"]')).not.toBeNull();

      // A visible TEXT badge on the suggested row only -- not colour alone.
      const host = fixture.nativeElement as HTMLElement;
      // Both badges stay MOUNTED, so a row's width never shifts as the suggestion moves; only the
      // suggested row's badge is visible (frontend-checklist 8).
      const suggestedBadge = host.querySelector('[data-testid="campaigns-email-template-suggested-mcp"]');
      const otherBadge = host.querySelector('[data-testid="campaigns-email-template-suggested-kc"]');
      expect(suggestedBadge?.textContent?.trim()).toBe('Suggested');
      expect(suggestedBadge?.classList.contains('invisible')).toBe(false);
      expect(otherBadge, 'the badge slot was removed rather than hidden').not.toBeNull();
      expect(otherBadge?.classList.contains('invisible')).toBe(true);
      // And the row is NOT drawn as selected: the badge is the only mark it carries.
      const row = host.querySelector<HTMLButtonElement>('[data-testid="campaigns-email-template-mcp"]');
      expect(row?.getAttribute('aria-pressed')).toBe('false');
      // aria-label replaces the badge text for assistive tech, so the label carries the same fact.
      expect(row?.getAttribute('aria-label')).toContain('suggested for this event');
      expect(host.querySelector('[data-testid="campaigns-email-template-kc"]')?.getAttribute('aria-label')).not.toContain('suggested');
    });

    /**
     * The core of #2057: the suggestion RECOMMENDS, and only an explicit click selects.
     *
     * Every other Stage precondition is satisfied here, so the selection is the only thing that
     * can hold Stage back -- and it must, until the operator clicks. Before #2057 the suggestion
     * wrote `selectedEmailTemplateId`, which becomes `hubspotConfig.sourceEmailId` on stage, so a
     * heuristic match could clone a branded HubSpot draft that nobody chose.
     */
    it('selects nothing and keeps Stage disabled until the operator clicks the suggested row', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().emailAudience.set({
        id: 'aud-1',
        briefId: 'brief-1',
        platform: 'hubspot',
        platformMasterListId: '900',
        inclusionSummary: '1 signal list',
        status: 'built',
        version: 1,
      });
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'kc', name: 'KubeCon registration reminder' },
          { id: 'mcp', name: 'MCP Dev Summit Nairobi — registration push' },
        ] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('mcp');
      expect(picker().selectedEmailTemplateId(), 'selected before any click').toBe('');
      expect(picker().canStageEmail(), 'Stage was enabled on a template nobody chose').toBe(false);

      // The explicit operator action, through the DOM rather than the handler.
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="campaigns-email-template-mcp"]')?.click();
      fixture.detectChanges();

      expect(picker().selectedEmailTemplateId()).toBe('mcp');
      expect(picker().canStageEmail(), 'fixture precondition: the click is the only thing Stage was waiting for').toBe(true);
    });

    /**
     * A RE-PICK of the suggested row is the operator's choice, not the system's.
     *
     * The banner and the screen-reader announcement both asked `suggestionId === selectedId`. That
     * is true again after an operator overrides the suggestion and then deliberately picks that
     * same template back, so both claimed the system chose what the operator chose — and for a
     * screen-reader user the announcement is the only channel, with no highlight to contradict it.
     *
     * Driven through `onSelectEmailTemplate`, because that is the setter that knows the
     * provenance; asserting on the flag directly would pass under an id-equality implementation.
     */
    /**
     * A LONG term is not automatically a distinctive one.
     *
     * The distinctiveness rule scores any term of six-plus characters as evidence on its own, on
     * the reasoning that `kubecon`/`nairobi`/`pytorch` separate from `dev`/`mcp` at that length.
     * Generic words are long too: `source`, `global`, `online`, `storage`. "Open Source Summit"
     * reduces to `open` + `source` once `summit` is dropped, and `source` alone then clears the
     * threshold against an unrelated "Source newsletter" -- a confident wrong pick, which is the
     * one outcome this feature exists to prevent.
     */
    it('does not pre-select on a generic long word like "source"', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('Open Source Summit', 'open-source-summit'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'src', name: 'Source newsletter — monthly roundup' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId(), 'a generic word pre-selected an unrelated template').toBe('');
      expect(picker().selectedEmailTemplateId()).toBe('');
    });

    it('drops the banner and announcement once the operator picks the suggested row themselves', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'kc', name: 'KubeCon registration reminder' },
          { id: 'mcp', name: 'MCP Dev Summit Nairobi — registration push' },
        ] as HubSpotMarketingEmail[],
      });
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('[data-testid="campaigns-email-template-suggestion"]'),
        'precondition: the suggestion banner is up'
      ).not.toBeNull();

      // The operator accepts the suggestion with a click -- now it is their choice.
      picker().onSelectEmailTemplate('mcp');
      fixture.detectChanges();

      expect(picker().emailTemplateSuggestionId()).toBe('mcp');
      expect(picker().selectedEmailTemplateId()).toBe('mcp');

      expect(
        fixture.nativeElement.querySelector('[data-testid="campaigns-email-template-suggestion"]'),
        'the banner kept recommending after the operator chose'
      ).toBeNull();
      expect(
        (fixture.componentInstance as unknown as { emailTemplateSuggestionAnnouncement(): string }).emailTemplateSuggestionAnnouncement(),
        'the screen-reader announcement kept recommending after the operator chose'
      ).toBe('');
    });

    /**
     * The case that matters most. A portal whose templates do not name their event must produce NO
     * pre-selection — a confident wrong pick clones another event's branding into a real HubSpot
     * draft, and because it reads as decided nobody re-examines it.
     */
    it('withholds the suggestion when nothing identifies the event', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'a', name: 'Monthly newsletter' },
          { id: 'b', name: 'Registration reminder' },
        ] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('');
      expect(picker().selectedEmailTemplateId()).toBe('');
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-template-suggestion"]')).toBeNull();
    });

    /**
     * The safety property, and the one the earlier "nothing identifies the event" case does NOT
     * cover: that test scores 0, so it is stopped by the no-match guard and never reaches the
     * threshold. This lands in the WEAK band — one distinctive term hit, below
     * EVENT_TEMPLATE_SUGGESTION_MIN_SCORE — which is exactly where a confident-looking wrong pick
     * would clone another event's branding into a real HubSpot draft.
     */
    it('withholds a suggestion that matches on only one term', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        // Matches 'dev' and nothing else: a real but weak signal, not evidence of the event.
        emails: [{ id: 'weak', name: 'Dev tools digest' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('');
      expect(picker().selectedEmailTemplateId()).toBe('');
      // Positive control: the panel is mounted, so the absence above is a real absence.
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-template-list"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-template-suggestion"]')).toBeNull();
    });

    /**
     * Found against the LIVE portal, not in a fixture: "KubeCon North America" reduces to
     * `kubecon | salt | lake | city`, and the real template "KubeCon NA 2026 - Modern Registration
     * Template" matches only `kubecon`. Scoring every term equally withheld it — one hit — even
     * though the name states the event unambiguously. A brand token needs no corroboration.
     */
    it('suggests on a single distinctive term, so a brand name alone is enough', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon North America', 'kubecon-na-2026', 'Salt Lake City'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'kc', name: 'KubeCon NA 2026 - Modern Registration Template' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('kc');
      expect(picker().emailTemplateSuggestionTerms()).toEqual(['kubecon']);
    });

    /**
     * A distinctive term suggests on its own, so a bare substring test would pre-select
     * "KubeConference recap" for KubeCon outright. Matching on word boundaries removes that
     * without costing any real name: verified byte-identical against the live portal.
     */
    it('does not match a term buried inside a longer word', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon North America', 'kubecon-na-2026'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'nope', name: 'KubeConference recap' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('');
    });

    /** The naming patterns LF actually uses must keep matching — the boundary is any non-alphanumeric. */
    it('still matches an event name joined by punctuation', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon North America', 'kubecon-na-2026'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'joined', name: 'KubeCon+CloudNativeCon NA 2026 registration' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('joined');
    });

    /**
     * The other half of the same rule, at the TOP of the sub-distinctive band rather than the
     * bottom. A five-character term is long enough to look meaningful and still short enough to
     * collide, so it must not decide on its own — this pins the boundary at 6, not merely that
     * three-character tokens are weak.
     */
    it('still withholds on a single five-character term, one short of distinctive', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('Seoul Open Infra Days', 'seoul-open-infra-days'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        // 'seoul' matches, and is five characters — one below EVENT_TERM_DISTINCTIVE_LENGTH.
        emails: [{ id: 'weak', name: 'Seoul city guide' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('');
    });

    /** Two distinctive terms IS enough — the threshold must not be so high it never fires. */
    it('offers a suggestion once two distinctive terms match', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'ok', name: 'MCP Nairobi invite' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('ok');
    });

    /** A generic word shared by the event name and an unrelated template must not manufacture a hit. */
    it('does not match on a stopword the event name happens to contain', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('Open Source Summit Europe', 'open-source-summit-europe'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'x', name: 'Cloud Summit Europe 2026 invite' }] as HubSpotMarketingEmail[],
      });

      // 'summit' and 'europe' are stopwords; only 'open'/'source' are distinctive, and neither
      // appears in the template. A match here would be the false positive the list exists to stop.
      expect(picker().emailTemplateSuggestionId()).toBe('');
    });

    it('never overwrites a template the operator already picked', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().onSelectEmailTemplate('chosen-by-hand');
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'chosen-by-hand', name: 'Something the operator knows about' },
          { id: 'mcp', name: 'MCP Dev Summit Nairobi — registration push' },
        ] as HubSpotMarketingEmail[],
      });

      expect(picker().selectedEmailTemplateId()).toBe('chosen-by-hand');
    });

    /**
     * An override must SURVIVE a re-search: the derivation re-runs on every successful search, and
     * a suggestion that reinstated itself over a hand-pick would read as the app ignoring the
     * operator.
     *
     * What actually pins it is the empty-selection check — a separate "was it overridden" flag was
     * written first and removed as unfalsifiable (see the comment in the component). This test is
     * therefore about the re-search path specifically, which the sibling test above does not
     * exercise.
     */
    it('does not reinstate the suggestion after a re-search once the operator has overridden it', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      const emails = [
        { id: 'mcp', name: 'MCP Dev Summit Nairobi — registration push' },
        { id: 'other', name: 'Nairobi welcome note' },
      ] as HubSpotMarketingEmail[];
      respond({ enabled: true, error: null, possiblyTruncated: false, emails });
      expect(picker().selectedEmailTemplateId()).toBe('');

      picker().onSelectEmailTemplate('other');
      picker().searchEmailTemplates('');
      respond({ enabled: true, error: null, possiblyTruncated: false, emails });

      expect(picker().selectedEmailTemplateId()).toBe('other');
    });

    /**
     * The worst state this feature can reach: a banner pointing at a "Suggested" row that no
     * VISIBLE row carries.
     *
     * Ranking and the suggestion agree on the event half but not the type half, and a tie falls to
     * the server's original order — so a genuinely-suggested template can rank below enough
     * type-keyword matches to be cut by the 100-row render limit. The operator would then be told
     * about a recommendation they cannot see or accept. The suggested row is spliced back in for
     * exactly this reason.
     *
     * Built to reproduce it: 150 rows that match three GENERIC event words, which rank but can
     * never justify a suggestion, plus one true KubeCon template.
     */
    it('always draws the suggested row, even when ranking would cut it past the render limit', () => {
      showPicker();
      // Ranking counts GENERIC event terms; the suggestion does not. So 150 rows matching three
      // generic words ("community", "training", "webinar") all outrank the one row carrying the
      // decisive `kubecon`, pushing it past the render cap -- while it is still the only row
      // eligible to be suggested.
      picker().emailBriefOutput.set(briefFor('KubeCon Community Training Webinar', 'kubecon-community-training-webinar'));
      picker().searchEmailTemplates('');

      const noise = Array.from({ length: 150 }, (_, i) => ({
        id: `noise-${i}`,
        name: `Community training webinar newsletter #${i}`,
      })) as HubSpotMarketingEmail[];
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [...noise, { id: 'kc', name: 'KubeCon announcement' } as HubSpotMarketingEmail],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('kc');
      expect(picker().selectedEmailTemplateId()).toBe('');
      // The assertion that matters: it is actually DRAWN, so its badge can be seen and clicked.
      expect(
        picker()
          .emailTemplatesRendered()
          .some((t) => t.id === 'kc')
      ).toBe(true);
      // And the render cap is still honoured — the splice replaces a row, it does not append.
      expect(picker().emailTemplatesRendered().length).toBe(HUBSPOT_TEMPLATE_RENDER_LIMIT);
    });

    /**
     * Both pinned rows past the cap at once: a hand-picked row AND a different suggested row. The
     * cap must hold, both must be drawn, and the selection keeps the last slot it always had.
     */
    it('draws both the selected and the suggested row when ranking cuts both past the render limit', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon Community Training Webinar', 'kubecon-community-training-webinar'));
      picker().searchEmailTemplates('');
      const noise = Array.from({ length: 150 }, (_, i) => ({
        id: `noise-${i}`,
        name: `Community training webinar newsletter #${i}`,
      })) as HubSpotMarketingEmail[];
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [...noise, { id: 'kc', name: 'KubeCon announcement' } as HubSpotMarketingEmail],
      });
      // The noise rows tie, so the server order decides and the last one ranks 150th -- past the cap.
      picker().onSelectEmailTemplate('noise-149');

      const rendered = picker().emailTemplatesRendered();
      expect(rendered.length).toBe(HUBSPOT_TEMPLATE_RENDER_LIMIT);
      expect(rendered.slice(-2).map((t) => t.id)).toEqual(['kc', 'noise-149']);
      expect(new Set(rendered.map((t) => t.id)).size, 'a pinned row was drawn twice').toBe(HUBSPOT_TEMPLATE_RENDER_LIMIT);
    });

    /** One pinned row already drawn, the other cut: the drawn one keeps its place, the cap holds. */
    it('keeps an already-drawn selection in place while pinning a cut suggestion', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon Community Training Webinar', 'kubecon-community-training-webinar'));
      picker().searchEmailTemplates('');
      const noise = Array.from({ length: 150 }, (_, i) => ({
        id: `noise-${i}`,
        name: `Community training webinar newsletter #${i}`,
      })) as HubSpotMarketingEmail[];
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [...noise, { id: 'kc', name: 'KubeCon announcement' } as HubSpotMarketingEmail],
      });
      picker().onSelectEmailTemplate('noise-0');

      const rendered = picker().emailTemplatesRendered();
      expect(rendered.length).toBe(HUBSPOT_TEMPLATE_RENDER_LIMIT);
      expect(rendered[0].id).toBe('noise-0');
      expect(rendered[rendered.length - 1].id).toBe('kc');
    });

    /**
     * The event decides WHETHER to suggest; the selected type decides WHICH of that event's
     * templates. A portal that runs an event well has several of its emails, and they score
     * identically on the event — so a strict `>` over the server's newest-first order picked
     * whichever was edited last. Observed live: the three MCP Dev Summit templates tie, and the
     * newest is a CFP-deadline email, which is the wrong answer for Registration Push.
     */
    it('breaks an event tie using the selected email type', () => {
      showPicker();
      picker().selectedEmailTypeId.set('main-registration-push');
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        // Both name the event identically; only the TYPE separates them, and the CFP one is first
        // (newest), so a tie-blind scan would take it.
        emails: [
          { id: 'cfp', name: 'MCP Dev Summit Nairobi — 5 days left to submit to speak' },
          { id: 'reg', name: 'MCP Dev Summit Nairobi — registration reminder' },
        ] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('reg');
    });

    /**
     * The chosen template belongs to the brief that chose it. Left set, it survives into the next
     * event in the same foundation — where it is wrong, still stageable, and hides the new event's
     * suggestion banner, which shows only while nothing is selected.
     */
    it('clears the chosen template when the brief-derived state resets', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'mcp', name: 'MCP Dev Summit Nairobi registration' }] as HubSpotMarketingEmail[],
      });
      picker().onSelectEmailTemplate('mcp');
      expect(picker().selectedEmailTemplateId()).toBe('mcp');

      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      expect(picker().selectedEmailTemplateId()).toBe('');
    });

    /**
     * The banner is help BEFORE a decision, so it must not survive one: repeating the
     * recommendation beside a template the operator chose argues with their choice.
     */
    it('hides the suggestion banner once the operator picks a different row', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'mcp', name: 'MCP Dev Summit Nairobi registration' },
          { id: 'other', name: 'Something else entirely' },
        ] as HubSpotMarketingEmail[],
      });
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-template-suggestion"]')).not.toBeNull();

      picker().onSelectEmailTemplate('other');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-template-suggestion"]')).toBeNull();
    });

    /**
     * Accents must survive tokenizing. Deleting non-`[a-z0-9]` turned "München" into "mnchen" on
     * the BRIEF side only, so a template actually named "München" could never match — an
     * international event permanently unsuggestable.
     */
    it('matches an accented event name against an accented template name', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon München', 'kubecon-munchen', 'München'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'de', name: 'KubeCon München — Registrierung' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('de');
      // The DECISIVE term is what the accent handling has to preserve, and it is what the banner
      // reports. `münchen` is a CITY token now -- it ranks but never justifies a suggestion, so
      // it is deliberately absent from the reasons shown. Asserting it here would pin the old
      // behavior where a city could be presented as a reason.
      expect(picker().emailTemplateSuggestionTerms()).toContain('kubecon');
    });

    /** The banner is one sentence; an @if between text nodes rendered "event . Nothing is". */
    it('renders the banner without a space before the full stop', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'mcp', name: 'MCP Dev Summit Nairobi registration' }] as HubSpotMarketingEmail[],
      });

      const text = fixture.nativeElement.querySelector('[data-testid="campaigns-email-template-suggestion"]')?.textContent?.replace(/\s+/g, ' ') ?? '';
      expect(text).not.toContain(' .');
      expect(text).toContain('. Nothing is selected until you choose a template.');
    });

    /**
     * The type is the tie-break, so it must be re-applied when the type CHANGES. A suggestion made
     * under Registration Push is the wrong answer once the operator switches to CFP Launch. Only
     * the badge moves; nothing is selected either side of the change.
     */
    it('re-derives the suggestion when the email type changes', () => {
      showPicker();
      picker().selectedEmailTypeId.set('main-registration-push');
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'cfp', name: 'MCP Dev Summit Nairobi — call for proposals closes soon' },
          { id: 'reg', name: 'MCP Dev Summit Nairobi — registration reminder' },
        ] as HubSpotMarketingEmail[],
      });
      expect(picker().emailTemplateSuggestionId()).toBe('reg');
      expect(picker().selectedEmailTemplateId()).toBe('');

      (fixture.componentInstance as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('cfp-launch');
      expect(picker().emailTemplateSuggestionId()).toBe('cfp');
      expect(picker().selectedEmailTemplateId(), 'a type change selected the re-derived suggestion').toBe('');
    });

    /** A hand-picked template is the operator's; a type change is not permission to replace it. */
    it('leaves a hand-picked template alone when the email type changes', () => {
      showPicker();
      picker().selectedEmailTypeId.set('main-registration-push');
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'cfp', name: 'MCP Dev Summit Nairobi — call for proposals closes soon' },
          { id: 'reg', name: 'MCP Dev Summit Nairobi — registration reminder' },
        ] as HubSpotMarketingEmail[],
      });
      picker().onSelectEmailTemplate('cfp');

      (fixture.componentInstance as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('cfp-launch');
      expect(picker().selectedEmailTemplateId()).toBe('cfp');
    });

    /**
     * Years were enumerated in the stopword list, so the protection EXPIRED: in 2028 an unrelated
     * "Open newsletter 2028" would match `open` plus `2028`, reach the threshold and be
     * pre-selected. A pattern cannot go stale.
     */
    it('drops a year token from any year, not only the enumerated ones', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('Open Source Summit 2028', 'open-source-summit-2028'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'unrelated', name: 'Open newsletter 2028' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('');
    });

    /**
     * The banner is a plain <p> inserted when the suggestion lands, and a newly inserted element is
     * not reliably announced — so a screen-reader user could miss that one row is recommended.
     */
    it('announces the suggestion through the existing live region', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'mcp', name: 'MCP Dev Summit Nairobi registration' }] as HubSpotMarketingEmail[],
      });

      const live = fixture.nativeElement.querySelector('[data-testid="campaigns-email-templates-live"]')?.textContent ?? '';
      expect(live).toContain('Suggested template for this event: MCP Dev Summit Nairobi registration');
      expect(live).toContain('nairobi');
      expect(live).toContain('Nothing is selected until you choose a template.');

      // Silent once the operator has chosen.
      picker().onSelectEmailTemplate('mcp-other');
      fixture.detectChanges();
      const after = fixture.nativeElement.querySelector('[data-testid="campaigns-email-templates-live"]')?.textContent ?? '';
      expect(after).not.toContain('Suggested template for this event');
    });

    /**
     * City tokens must never be the reason a template is suggested.
     *
     * "Salt Lake City visitor guide" matched `salt`, `lake` and `city` for a KubeCon brief and
     * scored 9 against a threshold of 6 — a template with no relation to the event, pre-selected
     * on location words alone. Operators do name templates by city, so the terms still ORDER
     * results; they just cannot justify a suggestion.
     */
    it('withholds a suggestion that matches only on city words', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon North America', 'kubecon-na-2026', 'Salt Lake City'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'city', name: 'Salt Lake City visitor guide' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('');
    });

    /**
     * A search that drops the suggested row drops the suggestion, and selects nothing in its
     * place -- a badge must never describe a row the results no longer contain.
     */
    it('drops the suggestion when a search no longer returns it, and selects nothing', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'mcp', name: 'MCP Dev Summit Nairobi registration' }] as HubSpotMarketingEmail[],
      });
      expect(picker().emailTemplateSuggestionId()).toBe('mcp');
      expect(picker().selectedEmailTemplateId()).toBe('');

      // A narrowed search that no longer returns the suggested row.
      picker().searchEmailTemplates('newsletter');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'other', name: 'Monthly newsletter' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('');
      expect(picker().selectedEmailTemplateId()).toBe('');
    });

    /**
     * A hand-pick of the SUGGESTED row is the operator's like any other, and survives a search
     * that no longer returns it.
     */
    it('keeps a hand-picked template that happens to match the suggestion', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      const emails = [
        { id: 'mcp', name: 'MCP Dev Summit Nairobi registration' },
        { id: 'other', name: 'Something else' },
      ] as HubSpotMarketingEmail[];
      respond({ enabled: true, error: null, possiblyTruncated: false, emails });
      expect(picker().selectedEmailTemplateId()).toBe('');

      // Away and deliberately back to the suggested id.
      picker().onSelectEmailTemplate('other');
      picker().onSelectEmailTemplate('mcp');

      picker().searchEmailTemplates('newsletter');
      respond({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: 'n', name: 'Monthly newsletter' }] as HubSpotMarketingEmail[] });

      expect(picker().selectedEmailTemplateId()).toBe('mcp');
    });

    /**
     * A FAILED search drops the suggestion too, and leaves nothing selected.
     *
     * `applyEventTemplateSuggestion` runs only after a successful listing, so the error arms must
     * clear it themselves or a suggestion would outlive the list it described.
     */
    it('drops the suggestion when the search fails, leaving nothing selected', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'mcp', name: 'MCP Dev Summit Nairobi registration' }] as HubSpotMarketingEmail[],
      });
      expect(picker().emailTemplateSuggestionId()).toBe('mcp');

      picker().searchEmailTemplates('anything');
      respond({ enabled: true, error: 'HubSpot refused the search', possiblyTruncated: false, emails: [] });

      expect(picker().emailTemplateSuggestionId()).toBe('');
      expect(picker().selectedEmailTemplateId()).toBe('');
    });

    /**
     * When the list is GONE rather than replaced, a hand-picked template goes with it (#2057).
     *
     * There is no list to render the row in, and `canStageEmail` reads the id, so a surviving
     * selection would let Stage Email Draft clone a template the operator can no longer see. One
     * row per terminal arm of `searchEmailTemplates` that answers a request. The fifth arm, no
     * foundation, is reached only through a foundation switch, and that switch clears the
     * selection itself, so a row for it could not fail. A search that merely replaces the list
     * keeps the pick (the test below).
     */
    it.each([
      ['HubSpot refuses the search', (): void => respond({ enabled: true, error: 'HubSpot refused the search', possiblyTruncated: false, emails: [] })],
      ['the channel is off', (): void => respond({ enabled: false, error: null, possiblyTruncated: false, emails: [] })],
      [
        'every row is unusable',
        (): void => respond({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: '', name: 'No id' }] as HubSpotMarketingEmail[] }),
      ],
      [
        'the request fails in transport',
        (): void => {
          httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails').error(new ProgressEvent('error'));
          fixture.detectChanges();
        },
      ],
    ])('clears a hand-picked template when %s', (_arm, fail) => {
      showPicker();
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'hand', name: 'Something the operator knows about' }] as HubSpotMarketingEmail[],
      });
      picker().onSelectEmailTemplate('hand');
      expect(picker().selectedEmailTemplateId()).toBe('hand');

      picker().searchEmailTemplates('newsletter');
      fail();

      expect(picker().selectedEmailTemplateId(), 'an invisible, stageable selection survived the list').toBe('');
      expect(picker().emailTemplatesRendered()).toEqual([]);
      expect(picker().canStageEmail()).toBe(false);
    });

    /**
     * A type change during a search must not re-derive the suggestion from the rows that search is
     * replacing: the loading state hides them, so the live region would announce a recommendation
     * for a row nobody can see. The search's own answer derives it under the new type.
     */
    it('does not suggest from the previous results while a search is pending', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'mcp', name: 'MCP Dev Summit Nairobi registration' }] as HubSpotMarketingEmail[],
      });
      expect(picker().emailTemplateSuggestionId()).toBe('mcp');

      picker().searchEmailTemplates('newsletter');
      (picker() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('cfp-launch');

      expect(picker().emailTemplateSuggestionId(), 'a suggestion was derived from rows the pending search is replacing').toBe('');
    });

    /** A HAND-PICKED template is the operator's and survives a search that drops it. */
    it('keeps a hand-picked template selected across a search that no longer returns it', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'mcp', name: 'MCP Dev Summit Nairobi registration' },
          { id: 'hand', name: 'Something the operator knows about' },
        ] as HubSpotMarketingEmail[],
      });
      picker().onSelectEmailTemplate('hand');

      picker().searchEmailTemplates('newsletter');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'other', name: 'Monthly newsletter' }] as HubSpotMarketingEmail[],
      });

      expect(picker().selectedEmailTemplateId()).toBe('hand');
      // RENDERED, not merely retained. Asserting the id alone locked in an invisible-but-stageable
      // selection: `emailTemplatesRendered` spliced the selected row back only when it could find it
      // in the CURRENT results, so a narrowed search that excluded it left the operator able to stage
      // a template no longer on screen. `canStageEmail` reads the id, not the list.
      expect(
        picker()
          .emailTemplatesRendered()
          .map((t) => t.id)
      ).toContain('hand');
    });

    /**
     * The retained row must be released with the selection it belongs to.
     *
     * `selectedEmailTemplateRow` keeps the chosen template so a narrowed search cannot hide it.
     * That retention has to end when the selection does, or the row outlives its own id and gets
     * appended to a later, unrelated result set -- a template from a previous brief rendered as
     * though the operator had just picked it. Removing all four clear sites left every other test
     * green, so nothing covered this until now.
     */
    it('stops rendering the retained row once the selection is cleared', () => {
      showPicker();
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'mcp', name: 'MCP Dev Summit Nairobi registration' },
          { id: 'hand', name: 'Something the operator knows about' },
        ] as HubSpotMarketingEmail[],
      });
      picker().onSelectEmailTemplate('hand');

      picker().searchEmailTemplates('newsletter');
      respond({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: 'other', name: 'Monthly newsletter' }] as HubSpotMarketingEmail[] });
      expect(
        picker()
          .emailTemplatesRendered()
          .map((t) => t.id)
      ).toContain('hand');

      // The operator picks a row from the CURRENT results; the old retained row must go with the
      // selection it belonged to.
      picker().onSelectEmailTemplate('other');
      fixture.detectChanges();

      expect(picker().selectedEmailTemplateId()).toBe('other');
      expect(
        picker()
          .emailTemplatesRendered()
          .map((t) => t.id)
      ).not.toContain('hand');
    });

    /** But a city match still ranks, once the event itself is identified. */
    it('ranks a template naming both the event and the city above one naming only the event', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon North America', 'kubecon-na-2026', 'Salt Lake City'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'plain', name: 'KubeCon registration' },
          { id: 'both', name: 'KubeCon Salt Lake City registration' },
        ] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('both');
    });

    /**
     * Annual editions tie on the event name alone, so the server's newest-first order chose
     * between "KubeCon NA 2025" and "KubeCon NA 2026" — last year's template, pre-selected and
     * stageable. The year breaks that tie without being able to reach the threshold itself.
     */
    it('prefers the edition whose year matches the brief', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon North America 2026', 'kubecon-na-2026'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        // Last year's first, as a newest-first server order could return it.
        emails: [
          { id: 'y2025', name: 'KubeCon NA 2025 - Registration' },
          { id: 'y2026', name: 'KubeCon NA 2026 - Registration' },
        ] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('y2026');
    });

    /**
     * A template matched on its SUBJECT may carry no name, and announcing an empty string reads as
     * "Suggested template for this event: . Nothing is selected" — which tells a screen-reader user
     * nothing about what is recommended.
     */
    it('announces a subject-matched template by its subject rather than an empty name', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'subj', name: '', subject: 'MCP Dev Summit Nairobi — register now' }] as HubSpotMarketingEmail[],
      });

      const live = fixture.nativeElement.querySelector('[data-testid="campaigns-email-templates-live"]')?.textContent ?? '';
      expect(live).toContain('register now');
      expect(live).not.toContain('event: .');
    });

    /** The two announcements must not run together into one word. */
    it('separates the two live-region announcements with a space', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'mcp', name: 'MCP Dev Summit Nairobi registration' }] as HubSpotMarketingEmail[],
      });

      const live = fixture.nativeElement.querySelector('[data-testid="campaigns-email-templates-live"]')?.textContent ?? '';
      // No word boundary swallowed: a full stop is never immediately followed by a capital letter
      // with no space between them.
      expect(live).not.toMatch(/\.[A-Z]/);
    });

    /** The year still cannot carry a suggestion on its own — the 2028 false positive stays shut. */
    it('does not let a year match alone justify a suggestion', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('Open Source Summit 2028', 'open-source-summit-2028'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'unrelated', name: 'Open newsletter 2028' }] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('');
    });

    /** The suggestion ranks too, so the derived template is reachable past the render cap. */
    it('ranks the event match to the top of the rendered list', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'a', name: 'Zulu unrelated' },
          { id: 'b', name: 'Yankee unrelated' },
          { id: 'mcp', name: 'MCP Dev Summit Nairobi — registration push' },
        ] as HubSpotMarketingEmail[],
      });

      expect(picker().emailTemplatesRendered()[0].id).toBe('mcp');
    });
  });

  it('loads templates when the implementation tab is entered, not only on proceed', () => {
    // The only other searchEmailTemplates call site is onEmailProceedFromPlanning, so
    // arriving at this tab any other way — clicking it directly, or returning after a
    // foundation switch cleared the list — used to leave an empty box. This file's own
    // comment calls that state "a broken channel".
    const comp = fixture.componentInstance as unknown as { selectTab(t: string, owner: string): void };
    comp.selectTab('implementation', 'email');
    fixture.detectChanges();

    // The request itself is the assertion: expectOne throws if entering the tab issued none.
    const req = httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails');
    req.flush({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: '1', name: 'KubeCon promo' }] });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('KubeCon promo');
  });

  it('lists the templates a search returned, dropping any row with no id', STATE_ONLY, () => {
    picker().searchEmailTemplates('');
    respond({
      enabled: true,
      error: null,
      possiblyTruncated: false,
      // The id is what `sourceEmailId` takes, so a row without one is not a choice that can be
      // made. Rendering it would offer a button that cannot work.
      emails: [
        { id: '1', name: 'KubeCon promo' },
        { id: '', name: 'broken row' },
      ],
    });

    expect(
      picker()
        .emailTemplates()
        ?.map((e) => e.id)
    ).toEqual(['1']);
  });

  // The collapse that matters. An empty array asserts the portal holds nothing; only a completed
  // search can support that.
  it('leaves the list NULL when the search fails, rather than empty', STATE_ONLY, () => {
    picker().searchEmailTemplates('kubecon');
    const req = httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails');
    req.flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(picker().emailTemplates()).toBeNull();
    expect(picker().emailTemplatesError()).toBeTruthy();
  });

  it('leaves the list NULL when the service reports an upstream error', STATE_ONLY, () => {
    picker().searchEmailTemplates('');
    respond({ enabled: true, error: 'HubSpot refused the request', possiblyTruncated: false, emails: [] });

    expect(picker().emailTemplates()).toBeNull();
    expect(picker().emailTemplatesError()).toBe('HubSpot refused the request');
  });

  // Not an error: the steady state wherever HubSpot is not connected for the foundation.
  it('reports a disconnected channel without rendering it as a failure', STATE_ONLY, () => {
    picker().searchEmailTemplates('');
    respond({ enabled: false, error: null, possiblyTruncated: false, emails: [] });

    expect(picker().emailChannelEnabled()).toBe(false);
    expect(picker().emailTemplatesError()).toBeNull();
    expect(picker().emailTemplates()).toBeNull();
  });

  it('distinguishes a successful empty search from a failure', STATE_ONLY, () => {
    picker().searchEmailTemplates('nothing-matches');
    respond({ enabled: true, error: null, possiblyTruncated: false, emails: [] });

    expect(picker().emailTemplates()).toEqual([]);
    expect(picker().emailTemplatesError()).toBeNull();
  });

  // possiblyTruncated is only meaningful for an EMPTY query. Telling someone to narrow a search
  // that was already exhaustive sends them hunting for a template that does not exist.
  it('carries the truncation warning through', STATE_ONLY, () => {
    picker().searchEmailTemplates('');
    respond({ enabled: true, error: null, possiblyTruncated: true, emails: [{ id: '1', name: 'One' }] });

    expect(picker().emailTemplatesTruncated()).toBe(true);
  });

  it('refuses to search without a foundation rather than listing another portal', STATE_ONLY, () => {
    ctx.set(null);
    fixture.detectChanges();

    picker().searchEmailTemplates('kubecon');

    httpMock.expectNone((r) => r.url === '/api/campaigns/hubspot/emails');
    expect(picker().emailTemplatesError()).toContain('foundation');
  });

  // The four states are pinned in the COMPONENT above and were entirely unpinned in the UI that
  // expresses them: a reviewer deleted all four rendering blocks and every test still passed. The
  // defect class this whole picker guards against could therefore reappear in the template with a
  // green suite. These assert the DOM, one state at a time, using the testids already present.
  interface PanelNav {
    selectorForm: { controls: { deliveryType: { setValue(v: string): void } } };
    selectTab(tab: string, owner: string): void;
  }
  function panel(): HTMLElement {
    const nav = fixture.componentInstance as unknown as PanelNav;
    nav.selectorForm.controls.deliveryType.setValue('email');
    nav.selectTab('implementation', 'email');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the connect-HubSpot state and nothing else when the channel is off', () => {
    picker().searchEmailTemplates('');
    respond({ enabled: false, error: null, possiblyTruncated: false, emails: [] });

    const el = panel();
    expect(el.querySelector('[data-testid="campaigns-email-not-connected"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="campaigns-email-templates-error"]')).toBeNull();
    expect(el.querySelector('[data-testid="campaigns-email-templates-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="campaigns-email-template-list"]')).toBeNull();
  });

  /**
   * campaign-service answers the SAME typed 404 for an absent connection row and for a project id
   * that does not exist (the typed 404 both cases share), so this copy is the only place a
   * mistyped slug can be distinguished from an unconfigured one. Naming nothing reported every
   * typo as a missing integration.
   */
  it('names the project it queried in the connect-HubSpot state', () => {
    picker().searchEmailTemplates('');
    respond({ enabled: false, error: null, possiblyTruncated: false, emails: [] });

    const text = panel().querySelector('[data-testid="campaigns-email-not-connected"]')?.textContent ?? '';
    expect(text).toContain('tlf');
  });

  it('announces the same named message it renders', () => {
    // The visible node and the live region held two separate copies of this sentence. A screen
    // reader hearing an unnamed message while the screen names one is told a different story.
    picker().searchEmailTemplates('');
    respond({ enabled: false, error: null, possiblyTruncated: false, emails: [] });

    const text = panel().querySelector('[data-testid="campaigns-email-not-connected"]')?.textContent?.trim() ?? '';
    expect(picker().emailTemplatesAnnouncement()).toBe(text);
  });

  it('renders the error state, not an empty portal, when the search failed', () => {
    picker().searchEmailTemplates('');
    respond({ enabled: true, error: 'HubSpot refused the request', possiblyTruncated: false, emails: [] });

    const el = panel();
    expect(el.querySelector('[data-testid="campaigns-email-templates-error"]')).not.toBeNull();
    // The claim that must never render over a failure.
    expect(el.querySelector('[data-testid="campaigns-email-templates-empty"]')).toBeNull();
  });

  it('reloads the picker when the foundation changes while it is already open', () => {
    // The entry load lives in selectTab, which only runs on a tab TRANSITION. An operator
    // already sitting on the picker who switches foundation never triggers it, so the clears
    // in the switch handler left a blank panel in front of them.
    panel();
    httpMock
      .expectOne((r) => r.url === '/api/campaigns/hubspot/emails')
      .flush({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: '1', name: 'TLF promo' }] });
    fixture.detectChanges();

    ctx.set({ uid: 'u2', name: 'CNCF', slug: 'cncf', logoUrl: '' } as ProjectContext);
    fixture.detectChanges();

    // The switch must issue a fresh load for the NEW foundation, not leave the panel empty.
    const req = httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails');
    req.flush({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: '9', name: 'CNCF promo' }] });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('CNCF promo');
  });

  it('announces the metadata that disambiguates two same-named templates', () => {
    // aria-label REPLACES descendant text, so a name-only label made two same-named rows
    // sound identical — defeating the very date the picker renders to tell them apart.
    picker().searchEmailTemplates('');
    respond({
      enabled: true,
      error: null,
      possiblyTruncated: false,
      emails: [
        { id: '1', name: 'KubeCon promo', subject: 'Join us', state: 'PUBLISHED', updatedAt: '2026-08-14' },
        { id: '2', name: 'KubeCon promo', subject: 'Last call', state: 'DRAFT', updatedAt: '2026-08-01' },
      ],
    });

    const labels = Array.from(panel().querySelectorAll('[data-testid="campaigns-email-template-list"] button')).map((b) => b.getAttribute('aria-label'));
    expect(labels.length).toBe(2);
    // The two rows share a name; their labels must NOT be identical.
    expect(labels[0]).not.toBe(labels[1]);
    expect(labels[0]).toContain('Aug 14, 2026');
    expect(labels[0]).toContain('Join us');
  });

  it('treats a whitespace-only query as the unfiltered search the server actually runs', () => {
    // The controller trims `q` before calling upstream, so "   " is an UNFILTERED portal
    // search. Storing it raw made the empty state claim `No templates match "   "` about a
    // search that had no filter at all.
    picker().searchEmailTemplates('   ');
    const req = httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails');
    // An empty query omits the param entirely rather than sending `q=`, which is the same
    // unfiltered request the server would have made after trimming.
    expect(req.request.params.get('q')).toBeNull();
    req.flush({ enabled: true, error: null, possiblyTruncated: false, emails: [] });
    fixture.detectChanges();

    const empty = panel().querySelector('[data-testid="campaigns-email-templates-empty"]');
    expect(empty?.textContent).toContain('no marketing emails yet');
  });

  it('keeps the empty state naming the query that ran, not what is being typed', () => {
    picker().searchEmailTemplates('alpha');
    respond({ enabled: true, error: null, possiblyTruncated: false, emails: [] });
    expect(panel().querySelector('[data-testid="campaigns-email-templates-empty"]')?.textContent).toContain('alpha');

    // Type a new query WITHOUT submitting it. The results on screen are still alpha's, so the
    // empty state must keep saying alpha — naming beta would assert a search that never ran.
    const el = panel();
    const input = el.querySelector('[data-testid="campaigns-email-template-search"]') as HTMLInputElement;
    input.value = 'beta';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const empty = panel().querySelector('[data-testid="campaigns-email-templates-empty"]');
    expect(empty?.textContent).toContain('alpha');
    expect(empty?.textContent).not.toContain('beta');
  });

  it('names the query in the empty state, so it reads as being about the search', () => {
    picker().searchEmailTemplates('nothing-matches');
    respond({ enabled: true, error: null, possiblyTruncated: false, emails: [] });

    const empty = panel().querySelector('[data-testid="campaigns-email-templates-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('nothing-matches');
  });

  it('renders a row per template with an accessible name', () => {
    picker().searchEmailTemplates('');
    respond({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: '1', name: 'KubeCon promo' }] });

    const row = panel().querySelector('[data-testid="campaigns-email-template-1"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('aria-label')).toContain('KubeCon promo');
  });

  // The input was one-way, so the signal only changed INSIDE searchEmailTemplates. Typing
  // "kubecon" then clicking Search re-ran the previous query — empty on arrival — returning the
  // full listing while the box still read "kubecon", so the user concludes their search matched
  // everything.
  it('searches what is typed, not the previous query', () => {
    const el = panel();
    // Entering the tab issues the initial load (see selectTab). Answer it so the assertion
    // below is about what the SEARCH sent, not about that first request.
    httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails').flush({ enabled: true, error: null, possiblyTruncated: false, emails: [] });
    fixture.detectChanges();

    const input = el.querySelector('[data-testid="campaigns-email-template-search"]') as HTMLInputElement;
    input.value = 'kubecon';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (el.querySelector('[data-testid="campaigns-email-template-search-button"]') as HTMLButtonElement).click();

    const req = httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails');
    expect(req.request.params.get('q')).toBe('kubecon');
    req.flush({ enabled: true, error: null, possiblyTruncated: false, emails: [] });
  });

  // A CHANGED foundation is the same hazard as a missing one, and searchEmailTemplates' own
  // guard cannot see it: the results are already on screen, now labelled with whichever
  // foundation is selected. selectedEmailTemplateId is the one that must not survive — it becomes
  // hubspotConfig.sourceEmailId on create, so a stale selection stages a send that clones
  // foundation A's email into foundation B's portal.
  it('clears the picker when the foundation changes', STATE_ONLY, () => {
    picker().searchEmailTemplates('');
    respond({ enabled: true, error: null, possiblyTruncated: true, emails: [{ id: '1', name: 'A-only template' }] });
    picker().onSelectEmailTemplate('1');
    expect(picker().selectedEmailTemplateId()).toBe('1');

    ctx.set({ uid: 'u2', name: 'Other Foundation', slug: 'other', logoUrl: '' } as ProjectContext);
    fixture.detectChanges();

    expect(picker().selectedEmailTemplateId()).toBe('');
    expect(picker().emailTemplates()).toBeNull();
    expect(picker().emailChannelEnabled()).toBeNull();
    expect(picker().emailTemplatesTruncated()).toBe(false);
  });

  // The live region was mounted INSIDE @switch → @case('implementation'), and both entry paths
  // call searchEmailTemplates synchronously BEFORE that case renders — so the node was inserted
  // with "Searching templates" already in it, which is not reliably announced. Its own comment
  // states the rule it broke. Mounted above the @switch it exists before any text changes.
  it('keeps the search live region mounted before the picker is entered', () => {
    const el = fixture.nativeElement as HTMLElement;
    const nav = fixture.componentInstance as unknown as PanelNav;
    nav.selectorForm.controls.deliveryType.setValue('email');
    fixture.detectChanges();

    // Present while still on Plan — i.e. BEFORE the implementation case has ever rendered.
    const live = el.querySelector('[data-testid="campaigns-email-templates-live"]');
    expect(live, 'the region must exist before its contents change').not.toBeNull();
    expect(live?.textContent?.trim()).toBe('');
    // It must NOT be inside the implementation panel, or it is destroyed on every tab change.
    expect(el.querySelector('[data-testid="campaigns-email-implementation-panel"]')?.contains(live as Node)).toBeFalsy();

    nav.selectTab('implementation', 'email');
    fixture.detectChanges();

    // Same node, now carrying the progress text: a CONTENT change, not an insertion.
    const after = el.querySelector('[data-testid="campaigns-email-templates-live"]');
    expect(after).toBe(live);
    expect(after?.textContent).toContain('Searching templates');
  });

  // The button was [disabled] while loading but Enter called searchEmailTemplates directly, so a
  // held Enter fired a full portal walk per repeat. The generation counter discards the late
  // answers; it does not cancel the requests, so the cost is still paid upstream.
  it('refuses an Enter press while a search is already in flight', () => {
    const el = panel();
    httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails').flush({ enabled: true, error: null, possiblyTruncated: false, emails: [] });
    fixture.detectChanges();

    const input = el.querySelector('[data-testid="campaigns-email-template-search"]') as HTMLInputElement;
    input.value = 'kubecon';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(httpMock.match((r) => r.url === '/api/campaigns/hubspot/emails').length).toBe(1);

    // Held down: every repeat while the first is unanswered must issue nothing.
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    httpMock.expectNone((r) => r.url === '/api/campaigns/hubspot/emails');
  });

  // The failure-as-measurement class this PR exists to fix. The server drops id-less rows, so a
  // response carrying ONLY such rows means the contract was violated — not that the portal is
  // empty. Filtering to [] rendered "This portal has no marketing emails yet" over rows that
  // proved the opposite.
  it('does not report a portal as empty when every returned row was unusable', () => {
    picker().searchEmailTemplates('');
    respond({
      enabled: true,
      error: null,
      possiblyTruncated: false,
      emails: [{ id: '', name: 'broken row' }, { id: '' }] as HubSpotMarketingEmail[],
    });

    expect(picker().emailTemplates(), 'an empty array here claims the portal holds nothing').toBeNull();
    expect(picker().emailTemplatesError()).toBeTruthy();

    const el = panel();
    expect(el.querySelector('[data-testid="campaigns-email-templates-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="campaigns-email-templates-error"]')).not.toBeNull();
  });

  // The switch handler's reload reads selectedDeliveryType() AT THAT MOMENT. A foundation switch
  // made while on Paid therefore cleared the picker and skipped the reload, and nothing
  // re-checked it — returning to email/Implement showed a permanently blank panel.
  it('reloads the picker when returning to email after a foundation switch made elsewhere', () => {
    panel();
    httpMock
      .expectOne((r) => r.url === '/api/campaigns/hubspot/emails')
      .flush({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: '1', name: 'TLF promo' }] });
    fixture.detectChanges();

    const nav = fixture.componentInstance as unknown as PanelNav;
    nav.selectorForm.controls.deliveryType.setValue('paid-marketing');
    fixture.detectChanges();

    // The switch clears the picker but must not load templates for a hidden panel.
    ctx.set({ uid: 'u2', name: 'CNCF', slug: 'cncf', logoUrl: '' } as ProjectContext);
    fixture.detectChanges();
    httpMock.expectNone((r) => r.url === '/api/campaigns/hubspot/emails');

    nav.selectorForm.controls.deliveryType.setValue('email');
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails');
    req.flush({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: '9', name: 'CNCF promo' }] });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('CNCF promo');
  });

  // The announcement and the visible copy must not say different things. The truncation clause is
  // the one a screen-reader user cannot recover any other way, so it is compared word-for-word.
  it('announces the same truncation and empty-state wording the panel shows', () => {
    picker().searchEmailTemplates('');
    respond({ enabled: true, error: null, possiblyTruncated: true, emails: [{ id: '1', name: 'One' }] });

    const banner = panel().querySelector('[data-testid="campaigns-email-templates-truncated"]')?.textContent?.trim();
    expect(banner).toBe('This may be a partial list. Search to narrow it.');
    expect(picker().emailTemplatesAnnouncement()).toBe('1 template found. This may be a partial list. Search to narrow it.');

    // The query is quoted in both, so a multi-word query cannot dissolve into the sentence.
    picker().searchEmailTemplates('no templates');
    respond({ enabled: true, error: null, possiblyTruncated: false, emails: [] });
    expect(picker().emailTemplatesAnnouncement()).toBe('No templates match “no templates”.');
    expect(panel().querySelector('[data-testid="campaigns-email-templates-empty"]')?.textContent?.trim()).toBe('No templates match “no templates”.');
  });

  it('records the chosen template id, which is what sourceEmailId takes', STATE_ONLY, () => {
    picker().onSelectEmailTemplate('123');
    expect(picker().selectedEmailTemplateId()).toBe('123');
  });
});

describe('CampaignsComponent — HubSpot template picker correctness', () => {
  let fixture: ComponentFixture<CampaignsComponent>;
  let httpMock: HttpTestingController;
  let ctx: WritableSignal<ProjectContext | null>;

  interface PickerInternals {
    emailTemplates: WritableSignal<HubSpotMarketingEmail[] | null>;
    emailTemplatesError: WritableSignal<string | null>;
    emailChannelEnabled: WritableSignal<boolean | null>;
    selectedEmailTab: WritableSignal<Exclude<CampaignTab, 'optimization'>>;
    selectorForm: { controls: { deliveryType: { setValue(v: CampaignDeliveryType): void } } };
    searchEmailTemplates(query: string): void;
    onSelectEmailTemplate(id: string): void;
    emailTemplatesAnnouncement: Signal<string>;
  }
  const picker = (): PickerInternals => fixture.componentInstance as unknown as PickerInternals;

  /**
   * The picker renders under `@switch (selectedEmailTab())` → `@case ('implementation')`, so a
   * DOM assertion needs the email delivery type AND that tab selected. Without both, the list is
   * simply not in the document and a `toContain` check fails against correct code.
   */
  function openEmailImplementationTab(): void {
    picker().selectorForm.controls.deliveryType.setValue('email');
    picker().selectedEmailTab.set('implementation');
    fixture.detectChanges();
  }

  beforeEach(async () => {
    ctx = signal<ProjectContext | null>({ uid: 'u1', name: 'The Linux Foundation', slug: 'tlf', logoUrl: '' } as ProjectContext);
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [
        // The page scopes the root negative-keyword service, which injects the app-root MessageService.
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext: ctx, activeContextUid: computed(() => ctx()?.uid ?? '') } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(campaignsComponentUnderTest());
    TestBed.inject(PersonaService).currentPersona.set('executive-director');
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  /**
   * A slow FIRST search must not overwrite a fast SECOND one.
   *
   * Each call is an independent subscribe, so without a generation guard the earlier response
   * lands last and wins — leaving the list from search A on screen while the query box shows B.
   * Driven by flushing the two requests out of order, which is the only way to reproduce it.
   */
  it('ignores a stale response that lands after a newer search', STATE_ONLY, () => {
    picker().searchEmailTemplates('alpha');
    picker().searchEmailTemplates('beta');

    const reqs = httpMock.match((r) => r.url === '/api/campaigns/hubspot/emails');
    expect(reqs.length).toBe(2);

    // The NEWER search answers first…
    reqs[1].flush({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: 'beta-1', name: 'Beta template' }] });
    fixture.detectChanges();
    // …then the older one lands.
    reqs[0].flush({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: 'alpha-1', name: 'Alpha template' }] });
    fixture.detectChanges();

    const listed = picker().emailTemplates();
    expect(listed?.length).toBe(1);
    expect(listed?.[0].id, 'the stale first search overwrote the newer result').toBe('beta-1');
  });

  /**
   * A transport failure must surface as a failure, not as "HubSpot is not connected".
   *
   * The template checks `emailChannelEnabled() === false` BEFORE the error branch, so a stale
   * false from an earlier response outranks a real error and the operator is told to fix a
   * connection that is fine.
   */
  it('does not report a later failure as a disconnected channel', () => {
    picker().searchEmailTemplates('one');
    httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails').flush({ enabled: false, error: null, possiblyTruncated: false, emails: [] });
    fixture.detectChanges();
    expect(picker().emailChannelEnabled()).toBe(false);

    // A second search that fails at the transport.
    picker().searchEmailTemplates('two');
    httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails').error(new ProgressEvent('network'));
    fixture.detectChanges();

    expect(picker().emailTemplatesError()).toBe('Could not load templates. Try again.');
    expect(picker().emailChannelEnabled(), 'a stale false outranks the error branch and hides it').not.toBe(false);
  });

  /** Two templates routinely share a name; the date is what tells them apart. */
  it('renders each template updated date', () => {
    openEmailImplementationTab();
    picker().searchEmailTemplates('');
    httpMock
      .expectOne((r) => r.url === '/api/campaigns/hubspot/emails')
      .flush({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: '1', name: 'KubeCon promo', updatedAt: '2026-08-14T10:00:00Z' },
          { id: '2', name: 'KubeCon promo' },
        ],
      });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Aug 14, 2026');
    // A row with no date renders no placeholder — a dash would read as a reported value.
    expect(text).not.toContain('· Updated –');
  });

  /**
   * WCAG 1.4.1: the selected row must not be distinguished by color alone.
   *
   * Asserts the RENDERED opacity class on the check icon rather than the presence of the `<i>`,
   * because the icon is always in the DOM — an existence check passes against a row that renders
   * it permanently invisible, which is exactly the bug this guards.
   */
  it('marks the selected template with a non-colour indicator', () => {
    openEmailImplementationTab();
    picker().searchEmailTemplates('');
    httpMock
      .expectOne((r) => r.url === '/api/campaigns/hubspot/emails')
      .flush({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: '1', name: 'Alpha' },
          { id: '2', name: 'Beta' },
        ],
      });
    fixture.detectChanges();

    picker().onSelectEmailTemplate('1');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const iconIn = (id: string): HTMLElement => root.querySelector(`[data-testid="campaigns-email-template-${id}"] i.fa-check`) as HTMLElement;

    // The chosen row shows the check AND exposes it as text to assistive tech.
    expect(iconIn('1').classList.contains('opacity-100')).toBe(true);
    expect(iconIn('1').getAttribute('aria-label')).toBe('Selected');

    // The unchosen row hides it and keeps it out of the accessible name.
    expect(iconIn('2').classList.contains('opacity-0')).toBe(true);
    expect(iconIn('2').getAttribute('aria-label')).toBeNull();
    expect(iconIn('2').getAttribute('aria-hidden')).toBe('true');
  });

  /**
   * With no `name`, the primary label falls through to `subject` — so the metadata line must not
   * print it a second time.
   *
   * Counts OCCURRENCES of the subject in the row rather than asserting the metadata line is
   * empty: the line still carries state and date, so an emptiness check would fail against
   * correct code and a `toContain` check would pass against the duplicate.
   */
  it('does not repeat the subject when it is already the primary label', () => {
    openEmailImplementationTab();
    picker().searchEmailTemplates('');
    httpMock
      .expectOne((r) => r.url === '/api/campaigns/hubspot/emails')
      .flush({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [
          { id: 'no-name', subject: 'Register for KubeCon', state: 'DRAFT' },
          { id: 'named', name: 'KubeCon promo', subject: 'Register for KubeCon', state: 'DRAFT' },
        ],
      });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const occurrences = (id: string): number =>
      ((root.querySelector(`[data-testid="campaigns-email-template-${id}"]`)?.textContent ?? '').match(/Register for KubeCon/g) ?? []).length;

    // Name absent: subject is the primary label, so it appears exactly once.
    expect(occurrences('no-name')).toBe(1);
    // Name present: primary label is the NAME, and the subject renders once beneath it as
    // genuinely extra information. Also once — but for the opposite reason, so both the primary
    // label and the metadata line are asserted directly rather than inferred from the count.
    expect(occurrences('named')).toBe(1);

    const named = root.querySelector('[data-testid="campaigns-email-template-named"]') as HTMLElement;
    // The name is the primary label…
    expect(named.querySelector('span.font-medium')?.textContent?.trim()).toBe('KubeCon promo');
    // …and the subject is the metadata line, which is where the one occurrence lives.
    expect(named.textContent).toContain('Register for KubeCon');

    const unnamed = root.querySelector('[data-testid="campaigns-email-template-no-name"]') as HTMLElement;
    // Subject IS the primary label here, so the metadata line must not repeat it: what is left
    // there is the state alone.
    expect(unnamed.querySelector('span.font-medium')?.textContent?.trim()).toBe('Register for KubeCon');
    const meta = unnamed.querySelectorAll('span')[unnamed.querySelectorAll('span').length - 1];
    expect(meta.textContent).not.toContain('Register for KubeCon');
    expect(meta.textContent).toContain('DRAFT');
  });

  /**
   * A filtered search is exempt from the service's 500-row cap, so a broad query can answer with
   * thousands of rows. The render is capped — and the UI must SAY the render was capped.
   *
   * Asserts the exact sentence and both numbers, not merely that a banner exists: a banner
   * reading "Showing 100 of 100" would satisfy an existence check while telling the
   * user nothing true.
   */
  it('caps how many templates it renders and says so, without discarding the rest', () => {
    openEmailImplementationTab();
    picker().searchEmailTemplates('a');
    const emails = Array.from({ length: HUBSPOT_TEMPLATE_RENDER_LIMIT + 37 }, (_, i) => ({ id: `t-${i}`, name: `Template ${i}` }));
    httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails').flush({ enabled: true, error: null, possiblyTruncated: false, emails });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;

    // Only the cap is drawn…
    expect(root.querySelectorAll('[data-testid="campaigns-email-template-list"] > li').length).toBe(HUBSPOT_TEMPLATE_RENDER_LIMIT);
    // …and the LAST fetched row is genuinely not on screen.
    expect(root.querySelector(`[data-testid="campaigns-email-template-t-${HUBSPOT_TEMPLATE_RENDER_LIMIT + 36}"]`)).toBeNull();

    // The truth about the cut is stated, with the real total — not the drawn count.
    const banner = root.querySelector('[data-testid="campaigns-email-templates-render-capped"]')?.textContent?.trim();
    expect(banner).toBe(`Showing ${HUBSPOT_TEMPLATE_RENDER_LIMIT} of ${HUBSPOT_TEMPLATE_RENDER_LIMIT + 37}. Search to narrow the list.`);

    // A screen-reader user cannot see the banner, so the same fact reaches the live region.
    expect(picker().emailTemplatesAnnouncement()).toContain(`Showing ${HUBSPOT_TEMPLATE_RENDER_LIMIT} of ${HUBSPOT_TEMPLATE_RENDER_LIMIT + 37}`);

    // The rows were not thrown away — the cap is a render limit, not a truncation of the result.
    expect(picker().emailTemplates()?.length).toBe(HUBSPOT_TEMPLATE_RENDER_LIMIT + 37);
  });

  /** At or under the limit nothing is cut, so claiming a cut would be a fresh falsehood. */
  it('says nothing about a cap when every fetched template is drawn', () => {
    openEmailImplementationTab();
    picker().searchEmailTemplates('a');
    const emails = Array.from({ length: HUBSPOT_TEMPLATE_RENDER_LIMIT }, (_, i) => ({ id: `t-${i}`, name: `Template ${i}` }));
    httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails').flush({ enabled: true, error: null, possiblyTruncated: false, emails });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-testid="campaigns-email-template-list"] > li').length).toBe(HUBSPOT_TEMPLATE_RENDER_LIMIT);
    expect(root.querySelector('[data-testid="campaigns-email-templates-render-capped"]')).toBeNull();
    expect(picker().emailTemplatesAnnouncement()).not.toContain('Showing the first');
  });
});

describe('CampaignsComponent when the client flag is on and the user holds a campaign_manager FGA grant', () => {
  let fgaFixture: ComponentFixture<CampaignsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(true), providerReady: signal(true) } },
      ],
    }).compileComponents();
    fgaFixture = TestBed.createComponent(campaignsComponentUnderTest());
    const personas = TestBed.inject(PersonaService);
    personas.currentPersona.set('contributor');
    personas.isCampaignManager.set(true);
    fgaFixture.detectChanges();
  });

  it('admits the contributor without requiring ED persona', () => {
    expect((fgaFixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-no-access"]')).toBeNull();
  });
});

/**
 * The Email Monitor tab (#1699).
 *
 * The defect class these guard against is a single substitution: rendering a row that carries NO
 * measurement as a measurement of zero. On this channel that is not a hypothetical — dispatch
 * stages a DRAFT and a human sends it in HubSpot afterwards, so "staged, never sent" is the most
 * ordinary state the channel has, and it is what every read before that moment returns.
 */
describe('CampaignsComponent email monitor', () => {
  let fixture: ComponentFixture<CampaignsComponent>;

  interface MonitorInternals {
    emailBriefId: { set(v: string): void };
    emailMetrics: { (): BriefMetrics | null; set(v: BriefMetrics | null): void };
    emailMetricsState: { (): string; set(v: string): void };
    emailMetricsError: { (): string; set(v: string): void };
    emailMetricsRows(): BriefMetricsRow[];
    emailMetricsOkRows(): BriefMetricsRow[];
    emailMetricsPendingRows(): BriefMetricsRow[];
    emailMetricsProblemRows(): BriefMetricsRow[];
    emailMetricsTotals(): CampaignServiceEmailMetrics | null;
    emailMetricsNothingSent(): boolean;
    emailMetricsRates(): { delivery: number | null; open: number | null; click: number | null; bounce: number | null };
    loadEmailMetrics(): void;
    canRefreshEmailMetrics(): boolean;
    activeFoundationSlug(): string;
    emailBriefOutput: { set(v: unknown): void };
    onEmailProceedFromPlanning(brief: unknown): void;
    rememberBriefId(key: string, value: { id: string; etag: string | null }): void;
    ownershipKey(projectSlug: string, brief: unknown): string | null;
  }

  const internals = (): MonitorInternals => fixture.componentInstance as unknown as MonitorInternals;

  /** A measured email row. Counters are the design's own examples, so they exercise real magnitudes. */
  const okRow = (over: Partial<CampaignServiceEmailMetrics> = {}): BriefMetricsRow =>
    ({
      campaign_id: 'c-email',
      platform: 'hubspot',
      status: 'ok',
      metrics: {
        campaign_id: 'c-email',
        platform_campaign_id: '104670127234',
        window: 'last_30_days',
        impressions: 1840,
        clicks: 212,
        cost_micros: 0,
        ctr: 0.115,
        email: { sent: 9400, delivered: 9268, opens: 1840, clicks: 212, bounces: 95, unsubscribes: 17, ...over },
      },
    }) as unknown as BriefMetricsRow;

  const metrics = (rows: BriefMetricsRow[]): BriefMetrics =>
    ({ brief_id: 'b1', window: 'last_30_days', rows, ok_count: rows.filter((r) => r.status === 'ok').length, action_items: [] }) as BriefMetrics;

  /**
   * Put the page on Email/Monitor before asserting anything about the DOM.
   *
   * Both delivery containers are mounted at once and the panel is inside an `@switch` on the tab,
   * so without this the queries below find nothing and every DOM assertion fails for a reason
   * that has nothing to do with what it is testing.
   */
  const showMonitor = (): void => {
    const c = fixture.componentInstance as unknown as {
      selectorForm: { controls: { deliveryType: { setValue(v: CampaignDeliveryType): void } } };
      selectTab(tab: CampaignTab, owner: CampaignDeliveryType): void;
    };
    c.selectorForm.controls.deliveryType.setValue('email');
    c.selectTab('insights', 'email');
    fixture.detectChanges();
  };

  const load = (rows: BriefMetricsRow[]): void => {
    showMonitor();
    internals().emailMetrics.set(metrics(rows));
    internals().emailMetricsState.set('loaded');
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(campaignsComponentUnderTest());
    TestBed.inject(PersonaService).currentPersona.set('executive-director');
    fixture.detectChanges();
  });

  /**
   * The load-bearing case, verified against a real staged HubSpot draft (email 220600410544):
   * campaign-service answers `not_ready` with NO `metrics` object at all.
   *
   * The mutation that matters is defaulting the absent object to zeroes. Doing so makes `totals`
   * a filled record and this assertion fail — which is the point: `null` is what suppresses the
   * metric cards, and a filled record would render "0 sent / 0.0% open rate" for an email nobody
   * has sent yet.
   */
  it('renders no totals for a staged email that has never been sent', () => {
    load([{ campaign_id: 'c1', platform: 'hubspot', status: 'not_ready', reason: 'not sent yet' } as BriefMetricsRow]);

    expect(internals().emailMetricsTotals()).toBeNull();
    expect(internals().emailMetricsPendingRows()).toHaveLength(1);
    expect(internals().emailMetricsOkRows()).toHaveLength(0);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="campaigns-email-metrics-pending"]')).not.toBeNull();
    // The absence is the assertion: no card may render for an unmeasured row.
    expect(el.querySelector('[data-testid="campaigns-email-metrics-totals"]')).toBeNull();
  });

  /**
   * A brief is shared across delivery types, so its metrics read returns the paid rows too.
   * Without the platform filter those become "email performance" — real, plausible numbers about
   * a different campaign entirely.
   */
  it('excludes ad-platform rows from the email totals', () => {
    load([
      okRow(),
      {
        campaign_id: 'c-google',
        platform: 'google-ads',
        status: 'ok',
        metrics: {
          campaign_id: 'c-google',
          platform_campaign_id: 'g1',
          window: 'last_30_days',
          impressions: 999_999,
          clicks: 8888,
          cost_micros: 5_000_000,
          ctr: 0.08,
        },
      } as unknown as BriefMetricsRow,
    ]);

    expect(internals().emailMetricsRows()).toHaveLength(1);
    // Not merely "1 row": the google clicks must not have been folded into the email click total.
    expect(internals().emailMetricsTotals()?.clicks).toBe(212);
  });

  /**
   * `sent === 0` separates the two cases the issue insists must not be conflated: HubSpot
   * answered (so this is not `not_ready`), but it counted no sends, so a 0% open rate would not
   * mean what it looks like it means.
   */
  it('suppresses rates when the read succeeded but nothing was sent', () => {
    load([okRow({ sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0 })]);

    expect(internals().emailMetricsNothingSent()).toBe(true);
    const rates = internals().emailMetricsRates();
    // `null`, never 0 — a rendered 0.0% asserts a measurement that was never taken.
    expect(rates.open).toBeNull();
    expect(rates.click).toBeNull();
    expect(rates.delivery).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-metrics-nothing-sent"]')).not.toBeNull();

    // RENDERING, not just the computed values. The three assertions above passed while all four
    // rate lines still rendered as "— of sent" / "— of delivered" beside the counters: a null
    // rate suppresses the NUMBER, not the line. The test's own name claimed the lines were
    // suppressed, so it read as covering this and did not.
    const el = fixture.nativeElement as HTMLElement;
    for (const id of ['delivery-rate', 'open-rate', 'click-rate', 'bounce-rate']) {
      expect(el.querySelector(`[data-testid="campaigns-email-metric-${id}"]`)).toBeNull();
    }
    // The COUNTERS stay. "0 sent" is a true measurement and the answer the operator came for --
    // suppressing those too would leave the panel saying nothing at all.
    expect(el.querySelector('[data-testid="campaigns-email-metric-sent"]')?.textContent).toContain('0');
    expect(el.querySelector('[data-testid="campaigns-email-metric-delivered"]')).not.toBeNull();
  });

  /**
   * Open and click rates are taken over DELIVERED, not sent: an email that bounced was never a
   * chance to open, and HubSpot's own reporting uses the same denominator. Asserted with
   * delivered !== sent so the two denominators give different answers — equal values would let a
   * wrong denominator pass.
   */
  it('computes open and click rates over delivered, not sent', () => {
    load([okRow()]);

    const rates = internals().emailMetricsRates();
    expect(rates.open).toBeCloseTo((1840 / 9268) * 100, 6);
    expect(rates.click).toBeCloseTo((212 / 9268) * 100, 6);
    // Delivery and bounce are over SENT, which is the only denominator that makes them mean anything.
    expect(rates.delivery).toBeCloseTo((9268 / 9400) * 100, 6);
    expect(rates.bounce).toBeCloseTo((95 / 9400) * 100, 6);
  });

  /**
   * An em dash, not `0.0%` — the whole point of carrying `null` this far rather than defaulting.
   *
   * Asserted on the RENDERED text rather than on a formatter in isolation, because the formatting
   * now happens in `MetricPercentPipe`. A unit test of the pipe would pass even if the template
   * stopped using it.
   */
  it('renders a missing rate as an em dash, and a real measured zero as 0.0%', () => {
    load([okRow({ sent: 100, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0 })]);

    const el = fixture.nativeElement as HTMLElement;
    // delivered is 0, so open rate has no denominator -> em dash, NOT 0.0%.
    expect(el.querySelector('[data-testid="campaigns-email-metric-open-rate"]')?.textContent).toContain('—');
    // delivery rate DOES have a denominator (sent=100) and is a genuine measured zero.
    expect(el.querySelector('[data-testid="campaigns-email-metric-delivery-rate"]')?.textContent).toContain('0.0%');
  });

  /**
   * The regression that three reviewers converged on, and that the mutation sweep had missed.
   *
   * `emailMetricsOkRows` once stopped at `metrics !== undefined`, so a row whose `metrics` existed
   * WITHOUT an `email` object passed the filter, was skipped by the reducer, and was counted on
   * both sides of the partial-coverage comparison — so no disclosure fired. With such a row alone,
   * the reducer's zero seed survived and six zeroes rendered as a measurement.
   */
  it('renders no totals when the only ok row carries no email counters', () => {
    load([
      {
        campaign_id: 'c-noemail',
        platform: 'hubspot',
        status: 'ok',
        metrics: { campaign_id: 'c-noemail', platform_campaign_id: '77', window: 'last_30_days', impressions: 0, clicks: 0, cost_micros: 0, ctr: 0 },
      } as unknown as BriefMetricsRow,
    ]);

    expect(internals().emailMetricsTotals()).toBeNull();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="campaigns-email-metrics-totals"]')).toBeNull();
    // And it must not claim HubSpot counted no sends — nothing was counted at all.
    expect(el.querySelector('[data-testid="campaigns-email-metrics-nothing-sent"]')).toBeNull();
    // It must be VISIBLE somewhere rather than vanishing from every bucket.
    expect(el.querySelector('[data-testid="campaigns-email-metrics-problems"]')).not.toBeNull();
  });

  /**
   * A status this UI does not know must surface, not blank the panel.
   *
   * With an allow-listed problem bucket the row matched nothing, and because `emailMetricsRows()`
   * was non-empty the empty state was suppressed too — the operator got a header and a Refresh
   * button over nothing. `BriefMetricsRowStatus` is a closed union, so TypeScript cannot catch a
   * status campaign-service adds later; the complement is what makes the failure visible.
   */
  it('surfaces a row whose status this UI does not recognise', () => {
    load([{ campaign_id: 'cx', platform: 'hubspot', status: 'throttled', reason: 'rate limited upstream' } as unknown as BriefMetricsRow]);

    expect(internals().emailMetricsProblemRows()).toHaveLength(1);
    const problems = fixture.nativeElement.querySelector('[data-testid="campaigns-email-metrics-problems"]');
    expect(problems).not.toBeNull();
    expect(problems?.textContent).toContain('rate limited upstream');
  });

  /** A failure row with no `reason` must not render an empty bullet under a non-zero count. */
  it('names a problem row that reported no reason', () => {
    load([{ campaign_id: 'c-noreason', platform: 'hubspot', status: 'failed' } as unknown as BriefMetricsRow]);

    const problems = fixture.nativeElement.querySelector('[data-testid="campaigns-email-metrics-problems"]');
    expect(problems?.textContent).toContain('No reason was reported');
  });

  /**
   * A total over some of the rows must never be presented as the channel's. The count is stated
   * whenever the measured rows are fewer than the email rows.
   */
  it('discloses when totals cover only some of the staged emails', () => {
    load([okRow(), { campaign_id: 'c2', platform: 'hubspot', status: 'not_ready', reason: 'not sent yet' } as BriefMetricsRow]);

    const partial = fixture.nativeElement.querySelector('[data-testid="campaigns-email-metrics-partial"]');
    expect(partial).not.toBeNull();
    expect(partial?.textContent).toContain('1 of 2');
  });

  /**
   * The mixed case the original disclosure test could not catch.
   *
   * An `ok` row missing its `email` object used to be counted on BOTH sides of the comparison, so
   * the totals covered one of two emails with no caveat at all — a plausible half-total presented
   * as the channel's performance, which is worse than an obviously-wrong zero.
   */
  it('discloses partial coverage when an ok row carries no email counters', () => {
    load([
      okRow(),
      {
        campaign_id: 'c-noemail',
        platform: 'hubspot',
        status: 'ok',
        metrics: { campaign_id: 'c-noemail', platform_campaign_id: '77', window: 'last_30_days', impressions: 0, clicks: 0, cost_micros: 0, ctr: 0 },
      } as unknown as BriefMetricsRow,
    ]);

    expect(internals().emailMetricsOkRows()).toHaveLength(1);
    const partial = fixture.nativeElement.querySelector('[data-testid="campaigns-email-metrics-partial"]');
    expect(partial).not.toBeNull();
    expect(partial?.textContent).toContain('1 of 2');
  });

  /**
   * A failed REQUEST is not a campaign that could not be measured. Leaving an empty result behind
   * would render "No email staged for this brief" — a claim about HubSpot that a failed request
   * establishes nothing about.
   */
  it('does not claim anything about HubSpot when the request itself failed', () => {
    const svc = TestBed.inject(CampaignService);
    vi.spyOn(svc, 'getBriefMetrics').mockReturnValue(throwError(() => new Error('gateway down')));

    showMonitor();
    internals().emailBriefId.set('b1');
    internals().loadEmailMetrics();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="campaigns-email-metrics-empty"]')).toBeNull();
  });

  /**
   * A reset must not strand the Monitor tab.
   *
   * It clears `emailBriefId`, which parked the read in `idle` — and Refresh was disabled there on
   * the grounds that it was a no-op, so an operator returning to Monitor had no way to load
   * anything at all. The ownership cache survives the reset and names the same row, so the read
   * recovers from it without a re-persist.
   */
  it('recovers the brief from ownership after a reset cleared the id', async () => {
    showMonitor();
    const svc = TestBed.inject(CampaignService);
    const read = vi.spyOn(svc, 'getBriefMetrics').mockReturnValue(of(metrics([])));

    // `persistBrief` is not mocked in this describe, so it would hit the testing backend and
    // never resolve -- ownership would never be recorded and the test would fail for a reason
    // unrelated to the fallback.
    vi.spyOn(svc, 'persistBrief').mockReturnValue(of({ status: 'saved', approved: true, briefId: 'b1', etag: null } as unknown as CampaignBriefPersistResult));

    // Ownership is what survives the reset, so it has to be established the way the real flow
    // does -- a persist that records it -- rather than by setting `emailBriefId` alone.
    const c = fixture.componentInstance as unknown as {
      emailBriefOutput: { set(v: CampaignBriefOutput): void };
      ensureEmailBriefId(b: CampaignBriefOutput, slug: string): Promise<string>;
      activeFoundationSlug(): string;
      resetEmailBriefDerivedState(): void;
    };
    const brief = { eventDetails: { slug: 'kubecon-eu-2026' } } as unknown as CampaignBriefOutput;
    c.emailBriefOutput.set(brief);
    fixture.detectChanges();
    await c.ensureEmailBriefId(brief, c.activeFoundationSlug());
    read.mockClear();

    c.resetEmailBriefDerivedState();
    // The brief output survives the reset (it is the operator's, not derived state); the ID does
    // not. Without the ownership fallback the load returns early and never issues a read.
    c.emailBriefOutput.set(brief);
    internals().loadEmailMetrics();

    expect(read).toHaveBeenCalled();
  });

  /**
   * Refresh is otherwise silent to a screen reader: the spinner and the changing numbers are both
   * visual only, so activating it announced nothing about running, finished or failed.
   *
   * The announcement states MEASURED against TOTAL rather than a bare count, because that
   * difference is the point of the panel — a count alone would imply every staged email reported
   * numbers.
   */
  it('announces the metrics read to a screen reader', () => {
    showMonitor();
    const live = (): string => fixture.nativeElement.querySelector('[data-testid="campaigns-email-metrics-live"]')?.textContent?.trim() ?? '';

    // Silent before anything has happened, so it does not speak on unrelated tabs.
    expect(live()).toBe('');

    load([okRow(), { campaign_id: 'c2', platform: 'hubspot', status: 'not_ready', reason: 'not sent yet' } as BriefMetricsRow]);
    expect(live()).toContain('1 of 2');

    internals().emailMetricsState.set('error');
    internals().emailMetricsError.set('Could not read email performance.');
    fixture.detectChanges();
    expect(live()).toContain('Could not read email performance.');
  });

  /**
   * Clearing the signals does not stop a request already in flight.
   *
   * Start a read, reset the brief-derived state (what a foundation switch does), then let the
   * original response resolve. Without the generation bump it still carries the generation it was
   * issued under, passes `isCurrent()`, and writes the PREVIOUS context's rows into a panel now
   * labelled with the new one.
   */
  it('discards a read that resolves after the brief-derived state was reset', async () => {
    showMonitor();
    const svc = TestBed.inject(CampaignService);
    const late = new Subject<BriefMetrics>();
    vi.spyOn(svc, 'getBriefMetrics').mockReturnValue(late.asObservable());

    internals().emailBriefId.set('b1');
    internals().loadEmailMetrics();

    (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
    late.next(metrics([{ campaign_id: 'stale', platform: 'hubspot', status: 'not_ready', reason: 'x' } as BriefMetricsRow]));
    late.complete();
    fixture.detectChanges();

    expect(internals().emailMetrics()).toBeNull();
    expect(internals().emailMetricsRows()).toHaveLength(0);
  });

  /**
   * A delivery-type round trip does not fire `selectTab`, so nothing re-read the metrics — an
   * operator returning to a Monitor tab they never left saw whatever was on screen before. These
   * numbers change when a human presses send in HubSpot, outside this app entirely.
   */
  it('re-reads the metrics when the delivery type returns to email on the monitor tab', () => {
    showMonitor();
    const svc = TestBed.inject(CampaignService);
    const read = vi.spyOn(svc, 'getBriefMetrics').mockReturnValue(of(metrics([])));
    internals().emailBriefId.set('b1');
    read.mockClear();

    const form = (fixture.componentInstance as unknown as { selectorForm: { controls: { deliveryType: { setValue(v: string): void } } } }).selectorForm;
    form.controls.deliveryType.setValue('paid-marketing');
    form.controls.deliveryType.setValue('email');
    fixture.detectChanges();

    expect(read).toHaveBeenCalled();
  });

  /**
   * TWO measured rows, with distinct counters in every field.
   *
   * Every other test in this suite pairs ONE measured row with rows that must be ignored, so a
   * regression returning the first measured row's metrics instead of summing them would pass all
   * of them: with a single contributor, "the first" and "the sum" are the same object. This is
   * the case that separates them, and the counters differ per field so a reducer that summed only
   * `sent` and carried the rest from the first row is caught too.
   */
  it('sums every measured email rather than reporting the first', () => {
    load([
      okRow(),
      {
        ...okRow(),
        campaign_id: 'c-email-2',
        metrics: {
          campaign_id: 'c-email-2',
          platform_campaign_id: '104670127235',
          window: 'last_30_days',
          impressions: 500,
          clicks: 60,
          cost_micros: 0,
          ctr: 0.12,
          email: { sent: 100, delivered: 90, opens: 40, clicks: 60, bounces: 5, unsubscribes: 3 },
        },
      } as unknown as BriefMetricsRow,
    ]);

    expect(internals().emailMetricsTotals()).toEqual({
      sent: 9500,
      delivered: 9358,
      opens: 1880,
      clicks: 272,
      bounces: 100,
      unsubscribes: 20,
    });
  });

  /**
   * A row that is `ok` on its ad counters but carries no `email` object must be skipped, not
   * treated as six zeroes — otherwise it silently widens the denominator the totals are read
   * against while contributing nothing.
   */
  it('skips an ok row that carries no email object rather than counting it as zeroes', () => {
    load([
      okRow(),
      {
        campaign_id: 'c3',
        platform: 'hubspot',
        status: 'ok',
        metrics: { campaign_id: 'c3', platform_campaign_id: '999', window: 'last_30_days', impressions: 0, clicks: 0, cost_micros: 0, ctr: 0 },
      } as unknown as BriefMetricsRow,
    ]);

    // The WHOLE record, not just one counter. Asserting `sent` alone passes against a mutation
    // that leaves `sent` intact and corrupts another field — which is exactly what "skipped"
    // has to rule out: the row must contribute nothing to ANY counter.
    expect(internals().emailMetricsTotals()).toEqual({ sent: 9400, delivered: 9268, opens: 1840, clicks: 212, bounces: 95, unsubscribes: 17 });
  });

  /**
   * `idle` is two states, and Refresh must only be live for one of them.
   *
   * A Monitor parked by a reset still has a resolvable owned row, so Refresh reloads it. A genuine
   * no-brief context resolves `briefId === ''` and early-returns to the same idle it started from,
   * so an enabled button there silently does nothing -- indistinguishable, to an operator or a
   * screen-reader user, from a load that failed without saying so.
   *
   * Asserts the COMPUTED the template binds, not the request: the defect is a control that renders
   * enabled beside a panel it cannot change.
   */
  it('does not offer Refresh when no brief id is resolvable', STATE_ONLY, () => {
    internals().emailBriefId.set('');
    internals().emailBriefOutput.set(null);
    internals().emailMetricsState.set('idle');
    fixture.detectChanges();

    expect(internals().canRefreshEmailMetrics()).toBe(false);
  });

  it('offers Refresh in the recoverable idle state a reset leaves behind', STATE_ONLY, () => {
    // Establish the slug EXPLICITLY rather than inheriting whatever the shared TestBed happens
    // to hold. `canRefreshEmailMetrics` is now gated on it, and these positive assertions were
    // passing only because another suite leaks 'foundation-b' through the shared context -- a
    // dependency that would break them for a reason unrelated to what they test.
    TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-m', slug: 'tlf', name: 'The Linux Foundation' } as never, false);
    // Drives the REAL reset rather than hand-setting the signals it clears.
    //
    // An earlier version of this test set `emailBriefId` to a nonempty value and asserted true.
    // That returns through the direct-id branch and never reaches the ownership fallback, so
    // deleting the fallback entirely left all 201 specs green -- the test agreed with itself.
    // Here the id is cleared by `resetEmailBriefDerivedState` (via the proceed handler that calls
    // it), so the ONLY thing that can make Refresh available is the ownership cache. That is the
    // whole point of the recoverable-idle case.
    const brief = { eventDetails: { name: 'KubeCon Europe 2026', slug: 'kubecon-eu-2026' } };
    const key = internals().ownershipKey(internals().activeFoundationSlug(), brief);
    expect(key).not.toBeNull();
    internals().rememberBriefId(key as string, { id: 'b-owned', etag: '"1"' });

    internals().onEmailProceedFromPlanning(brief);
    internals().emailMetricsState.set('idle');
    fixture.detectChanges();

    // The reset cleared the signal; only the cache can answer now.
    expect(internals().canRefreshEmailMetrics()).toBe(true);
  });

  /**
   * A real sub-0.1% rate must not render as `0.0%`.
   *
   * `MetricPercentPipe` formats to one decimal, so 1 click in 10,000 delivered (0.01%) printed as
   * `0.0%` -- a zero sitting beside a click counter reading 1, which reads as "no clicks" rather
   * than "very few". The em dash keeps meaning "no denominator", so rounding up is not an option
   * either. Click and bounce now use two decimals, matching the CTR convention already set in the
   * marketing-impact email tab; delivery and open keep one, being large.
   *
   * Asserted on RENDERED text: a pipe unit test would pass even if the template stopped using it.
   */
  it('renders a rate below 0.005% as <0.01%, never a false zero', () => {
    // 1 click in 100,000 delivered is 0.001%. `toFixed(2)` rounds that to "0.00%" -- the same
    // false zero one decimal gave at 0.01%, just further out. The counter says 1; the rate must
    // not say nothing happened. A genuine zero still prints as 0.00%.
    load([okRow({ sent: 100000, delivered: 100000, opens: 50000, clicks: 1, bounces: 0, unsubscribes: 0 })]);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="campaigns-email-metric-click-rate"]')?.textContent).toContain('<0.01%');
    // A measured zero is not a tiny number and must not borrow the same treatment.
    expect(el.querySelector('[data-testid="campaigns-email-metric-bounce-rate"]')?.textContent).toContain('0.00%');
  });

  it('renders a real sub-0.1% click and bounce rate rather than 0.0%', () => {
    load([okRow({ sent: 10000, delivered: 10000, opens: 5000, clicks: 1, bounces: 2, unsubscribes: 0 })]);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="campaigns-email-metric-click-rate"]')?.textContent).toContain('0.01%');
    expect(el.querySelector('[data-testid="campaigns-email-metric-bounce-rate"]')?.textContent).toContain('0.02%');
    // The large rates stay at one decimal -- a second is noise, and this pins that the change was
    // scoped to the low-rate pair rather than applied to every percentage on the panel.
    expect(el.querySelector('[data-testid="campaigns-email-metric-delivery-rate"]')?.textContent).toContain('100.0%');
  });

  it('picks up an ownership entry recorded AFTER the computed was first read', STATE_ONLY, () => {
    // Establish the slug EXPLICITLY rather than inheriting whatever the shared TestBed happens
    // to hold. `canRefreshEmailMetrics` is now gated on it, and these positive assertions were
    // passing only because another suite leaks 'foundation-b' through the shared context -- a
    // dependency that would break them for a reason unrelated to what they test.
    TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-m', slug: 'tlf', name: 'The Linux Foundation' } as never, false);
    // `knownBriefIds` is a plain Map, so a computed reading it is evaluated once and never
    // invalidated when an entry lands. That is why writes go through `rememberBriefId`, which
    // bumps a signal the computed depends on.
    //
    // The ORDER is the whole test: read first (caching false), then write. A version-less
    // implementation stays false forever here and the button is stuck disabled through exactly
    // the recoverable case it was widened for -- while a test that writes before the first read
    // passes either way.
    const brief = { eventDetails: { name: 'KubeCon Europe 2026', slug: 'kubecon-eu-2026' } };
    internals().onEmailProceedFromPlanning(brief);
    internals().emailMetricsState.set('idle');
    fixture.detectChanges();

    // First read: no entry yet, so this caches `false`.
    expect(internals().canRefreshEmailMetrics()).toBe(false);

    const key = internals().ownershipKey(internals().activeFoundationSlug(), brief);
    internals().rememberBriefId(key as string, { id: 'b-late', etag: null });
    fixture.detectChanges();

    expect(internals().canRefreshEmailMetrics()).toBe(true);
  });

  it('does not offer Refresh when the ownership cache holds no row for this event', STATE_ONLY, () => {
    // Same shape, cache deliberately empty: proves the previous test passes BECAUSE of the entry
    // rather than because the reset happens to leave something else enabled.
    const brief = { eventDetails: { name: 'KubeCon Europe 2026', slug: 'kubecon-eu-2026' } };
    internals().onEmailProceedFromPlanning(brief);
    internals().emailMetricsState.set('idle');
    fixture.detectChanges();

    expect(internals().canRefreshEmailMetrics()).toBe(false);
  });

  it('does not offer Refresh without a foundation slug', STATE_ONLY, () => {
    // `loadEmailMetrics` early-returns to idle on an empty slug, so offering a refresh there is a
    // button whose only possible outcome is the state it started in.
    //
    // Drive the slug empty through the real service rather than assuming the harness leaves it
    // so -- it does not: another suite's `setFoundation` leaks 'foundation-b' through the shared
    // TestBed, and asserting the precondition is what caught that. A blank slug is a real shape
    // (a context that has not resolved), not an artificial one.
    TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-x', slug: '', name: 'Unresolved' } as never, false);
    fixture.detectChanges();
    expect(internals().activeFoundationSlug()).toBe('');
    internals().emailBriefId.set('b-monitor');
    internals().emailMetricsState.set('idle');
    fixture.detectChanges();

    expect(internals().canRefreshEmailMetrics()).toBe(false);
  });

  it('does not offer Refresh while a load is already in flight', STATE_ONLY, () => {
    internals().emailBriefId.set('b-monitor');
    internals().emailMetricsState.set('loading');
    fixture.detectChanges();

    expect(internals().canRefreshEmailMetrics()).toBe(false);
  });
});

/**
 * Recovering a retained Manual bidding choice the deployment cannot confirm yet (#3299), proven at
 * the PAGE level: the real Implementation tab under the real page, with only the service's
 * `persistBrief` and `listBriefCampaigns` replaced. Asserting that the tab EMITTED a retry is not
 * enough — the page must actually read the capability and the tab must then let Create through
 * with the Manual bid intact.
 */
describe('CampaignsComponent — bidding capability recovery (#3299)', () => {
  let fixture: ComponentFixture<CampaignsComponent>;
  let listBriefCampaigns: MockInstance<CampaignService['listBriefCampaigns']>;

  const brief = {
    eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
    totalBudget: 500,
    selectedPlatforms: ['meta-ads'],
    structuredCopy: { google_search: { headlines: ['Attend KubeCon'], descriptions: ['Join us in September'] } },
    metaCopy: {
      variants: [{ primaryText: 'Brief primary', headline: 'Brief meta headline', description: 'Brief description' }],
      recommendedGeos: ['US'],
    },
    keywords: [],
    hsUtm: null,
    driveFolderUrl: '',
  } as unknown as CampaignBriefOutput;

  const capability = (
    biddingEnabled: boolean,
    microsoftScheduleEnabled = false,
    googleAudienceSegmentsEnabled = false,
    googleGeoSearchEnabled = false,
    metaInstagramDsaEnabled = false,
    twitterCreateEnabled = false,
    linkedInDailyCapEnabled = false,
    linkedInVariantCopyEnabled = false,
    linkedInCallToActionEnabled = false,
    linkedInTextAdsEnabled = false
  ): Observable<CampaignListResult> =>
    of({
      campaigns: [],
      possiblyStale: false,
      statusToggleEnabled: false,
      demandGenEnabled: false,
      googleChannelsEnabled: false,
      googleCreativeEnabled: false,
      redditCreativeEnabled: false,
      redditAssetUploadEnabled: false,
      redditConversionPixelEnabled: false,
      googleAssetUploadEnabled: false,
      metaCreativeEnabled: false,
      metaAssetUploadEnabled: false,
      linkedInAssetUploadEnabled: false,
      linkedInTargetingEditEnabled: false,
      linkedInAccountSelectionEnabled: false,
      linkedInDailyCapEnabled,
      linkedInVariantCopyEnabled,
      linkedInCallToActionEnabled,
      linkedInTextAdsEnabled,
      linkedInTargetingEnabled: false,
      microsoftAssetUploadEnabled: false,
      biddingEnabled,
      microsoftScheduleEnabled,
      twitterCreateEnabled,
      metaInstagramDsaEnabled,
      googleAudienceSegmentsEnabled,
      googleGeoSearchEnabled,
    });

  const saved = () => of({ enabled: true, briefId: 'brief-1', etag: '"1"', created: true, approved: true });

  interface PageInternals {
    onProceedToImplementation(b: CampaignBriefOutput): void;
    briefPersistence(): CampaignBriefPersistenceState;
    briefCampaignsBiddingEnabled(): boolean | null;
    briefCampaignsCapabilityRead(): string;
  }
  const page = (): PageInternals => fixture.componentInstance as unknown as PageInternals;
  const tab = (): Record<string, any> => fixture.debugElement.query(By.directive(ImplementationTabComponent)).componentInstance as Record<string, any>;
  const q = (testId: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);

  function selectFoundation(slug: string): void {
    const ctx = TestBed.inject(ProjectContextService);
    ctx.setRouteLensKind('foundation');
    ctx.setFoundation({ uid: `uid-${slug}`, slug, name: slug } as ProjectContext, false);
  }

  /**
   * Two rounds, each draining a macrotask too. The brief save runs on a promise chain the page does
   * not hand to Angular (`persistChain`), so its outcome — the saved id, the capability read it
   * starts, and the in-flight flag it clears last — can land after one round's change detection;
   * the second round carries it into the tab's inputs.
   */
  async function settle(): Promise<void> {
    for (let round = 0; round < 2; round++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
    fixture.detectChanges();
  }

  /** Proceed (which saves the brief), fill the form, and choose Manual for Meta at 1.00. */
  async function proceedWithManualMeta(): Promise<void> {
    page().onProceedToImplementation(brief);
    await settle();
    const t = tab();
    t['campaignForm'].controls['startDate'].setValue('2026-09-01');
    t['campaignForm'].controls['endDate'].setValue('2026-09-30');
    await settle();
    const control = fixture.debugElement.query(By.css('lfx-campaign-bidding-control')).componentInstance;
    control.form.controls.strategy.setValue('manual');
    await settle();
    const input = q('implementation-bidding-meta-ads-amount')?.querySelector('input') as HTMLInputElement;
    input.value = '1';
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();
    const service = TestBed.inject(CampaignService);
    vi.spyOn(service, 'persistBrief').mockReturnValue(saved() as never);
    listBriefCampaigns = vi.spyOn(service, 'listBriefCampaigns').mockReturnValue(capability(true));
    fixture = TestBed.createComponent(campaignsComponentUnderTest());
    TestBed.inject(PersonaService).currentPersona.set('executive-director');
    selectFoundation('tlf');
    await settle();
  });

  /**
   * The Microsoft flight-date capability travels the same path into the tab: the real page reads
   * it, binds it to `microsoftScheduleEnabled`, and the tab swaps its warning for the applied note.
   */
  it.each([
    [true, 'implementation-microsoft-flight', 'implementation-microsoft-no-flight'],
    [false, 'implementation-microsoft-no-flight', 'implementation-microsoft-flight'],
  ])('hands a microsoft schedule capability of %s to the Implementation tab', async (enabled, shown, hidden) => {
    listBriefCampaigns.mockReturnValue(capability(false, enabled));
    const withMicrosoft = { ...brief, selectedPlatforms: ['microsoft-ads'] } as unknown as CampaignBriefOutput;

    page().onProceedToImplementation(withMicrosoft);
    await settle();

    expect(tab()['microsoftScheduleEnabled']()).toBe(enabled);
    expect(q(shown)).not.toBeNull();
    expect(q(hidden)).toBeNull();
  });

  /**
   * The X create capability travels the same path into the tab: the real page reads it and binds
   * it to `twitterCreateEnabled`, and the tab either renders the X fields or holds X behind its block.
   */
  it.each([
    [true, 'implementation-twitter-budget', 'implementation-twitter-create-block-unsupported'],
    [false, 'implementation-twitter-create-block-unsupported', 'implementation-twitter-budget'],
  ])('hands an X create capability of %s to the Implementation tab', async (enabled, shown, hidden) => {
    listBriefCampaigns.mockReturnValue(capability(false, false, false, false, false, enabled));
    const withTwitter = { ...brief, selectedPlatforms: ['twitter-ads'] } as unknown as CampaignBriefOutput;

    page().onProceedToImplementation(withTwitter);
    await settle();

    expect(tab()['twitterCreateEnabled']()).toBe(enabled);
    expect(q(shown)).not.toBeNull();
    expect(q(hidden)).toBeNull();
  });

  /**
   * The LinkedIn daily-cap capability (#5774) and the ad name, description and call to action capabilities (#5764 rows
   * 16–17) travel the same path: the real page reads them and binds each to its input.
   */
  it.each([
    [true, true, false, true],
    [false, false, true, false],
  ])(
    'hands the linkedin daily-cap (%s), ad name and description (%s), call to action (%s) and text ads (%s) capabilities to the Implementation tab',
    async (enabled, copy, callToAction, textAds) => {
      listBriefCampaigns.mockReturnValue(capability(false, false, false, false, false, false, enabled, copy, callToAction, textAds));
      const withLinkedIn = { ...brief, selectedPlatforms: ['linkedin-ads'] } as unknown as CampaignBriefOutput;

      page().onProceedToImplementation(withLinkedIn);
      await settle();

      expect(tab()['linkedInDailyCapEnabled']()).toBe(enabled);
      expect(tab()['linkedInVariantCopyEnabled']()).toBe(copy);
      expect(tab()['linkedInCallToActionEnabled']()).toBe(callToAction);
      expect(tab()['linkedInTextAdsEnabled']()).toBe(textAds);
    }
  );

  /** The Meta Instagram/DSA capability travels the same path: the real page reads it, binds it, and the tab shows the inputs only on a yes. */
  it.each([[true], [false]])('hands a meta instagram/dsa capability of %s to the Implementation tab', async (enabled) => {
    listBriefCampaigns.mockReturnValue(capability(false, false, false, false, enabled));

    page().onProceedToImplementation(brief as unknown as CampaignBriefOutput);
    await settle();

    expect(tab()['metaInstagramDsaEnabled']()).toBe(enabled);
    expect(q('implementation-meta-instagram-dsa') !== null).toBe(enabled);
  });

  // === X fields across a refine ===

  const withTwitter = { ...brief, selectedPlatforms: ['google-ads', 'twitter-ads'] } as unknown as CampaignBriefOutput;
  const tweetAsset = { id: 'asset-x', mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true };

  function chooseTweetImage(): void {
    const input = q('implementation-twitter-image-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array(16)], 'tweet.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
  }

  /** Proceed, then type the two X fields as the operator would. */
  async function proceedAndTypeX(b: CampaignBriefOutput = withTwitter): Promise<void> {
    page().onProceedToImplementation(b);
    await settle();
    tab()['campaignForm'].controls['twitterTweetText'].setValue('Typed tweet');
    tab()['campaignForm'].controls['twitterBudget'].setValue('42');
    await settle();
  }

  /** Back to Planning, which tears the Implementation tab down: the refine round trip. */
  async function leaveForPlanning(): Promise<void> {
    (fixture.componentInstance as unknown as { selectTab(t: string, owner: string): void }).selectTab('planning', 'paid-marketing');
    await settle();
  }

  /**
   * The X fields survive a refine: proceeding again for the SAME event clears the draft for the
   * regenerated copy, but the tweet, budget and image are typed by the operator and nothing the
   * generator produces replaces them. Implement is torn down between proceeds, as a refine from
   * Planning does, so the image is restored from the carry rather than left standing on a live mount.
   * These real-template round trips mount Implementation more than once and drain Angular between
   * each phase; allow headroom beyond the default 5 seconds on shared CI runners (#5638).
   */
  it('keeps the typed X fields and image across a same-event proceed', { timeout: 15_000 }, async () => {
    listBriefCampaigns.mockReturnValue(capability(false, false, false, false, false, true));
    vi.spyOn(TestBed.inject(CampaignService), 'uploadCreativeAsset').mockReturnValue(of(tweetAsset) as never);

    await proceedAndTypeX();
    chooseTweetImage();
    await settle();
    expect(tab()['twitterImageAssetId']()).toBe('asset-x');
    await leaveForPlanning();

    page().onProceedToImplementation({ ...withTwitter } as CampaignBriefOutput);
    await settle();
    expect(tab()['campaignForm'].controls['twitterTweetText'].value).toBe('Typed tweet');
    expect(tab()['campaignForm'].controls['twitterBudget'].value).toBe('42');
    expect(tab()['twitterImageAssetId']()).toBe('asset-x');
    expect(tab()['twitterImageAssetName']()).toBe('tweet.png');
    expect(tab()['twitterImageAssetBriefId']()).toBe('brief-1');
  });

  /** A different event's X fields and image must not follow it onto the next one. */
  it('drops the typed X fields and image when the next proceed is for another event', { timeout: 15_000 }, async () => {
    listBriefCampaigns.mockReturnValue(capability(false, false, false, false, false, true));
    vi.spyOn(TestBed.inject(CampaignService), 'uploadCreativeAsset').mockReturnValue(of(tweetAsset) as never);

    await proceedAndTypeX();
    chooseTweetImage();
    await settle();
    expect(tab()['twitterImageAssetId']()).toBe('asset-x');
    await leaveForPlanning();

    const otherEvent = { ...withTwitter, eventDetails: { ...withTwitter.eventDetails, slug: 'other-event-2026', name: 'Other Event' } } as CampaignBriefOutput;
    page().onProceedToImplementation(otherEvent);
    await settle();
    expect(tab()['campaignForm'].controls['twitterTweetText'].value).toBe('');
    expect(tab()['twitterImageAssetId']()).toBe('');
  });

  /**
   * Start Over discards the brief, so a carry made by an earlier refine must go with it: the carry
   * is what the next proceed reads once Start Over has cleared the draft.
   */
  it('drops a carried X draft on Start Over, even for the same event', { timeout: 15_000 }, async () => {
    listBriefCampaigns.mockReturnValue(capability(false, false, false, false, false, true));
    await proceedAndTypeX();
    await leaveForPlanning();
    page().onProceedToImplementation({ ...withTwitter } as CampaignBriefOutput);
    await settle();
    expect(tab()['campaignForm'].controls['twitterTweetText'].value).toBe('Typed tweet');

    (fixture.componentInstance as unknown as { resetToPlanning(): void }).resetToPlanning();
    await settle();
    page().onProceedToImplementation({ ...withTwitter } as CampaignBriefOutput);
    await settle();
    expect(tab()['campaignForm'].controls['twitterTweetText'].value).toBe('');
    expect(tab()['campaignForm'].controls['twitterBudget'].value).toBe('');
  });

  /** New Brief discards the generated brief too, so the brief generated next is not a refine of it. */
  it('drops the typed X fields after New Brief, even for the same event', { timeout: 15_000 }, async () => {
    listBriefCampaigns.mockReturnValue(capability(false, false, false, false, false, true));
    await proceedAndTypeX();
    await leaveForPlanning();

    // The paid planner, not the email one: both are mounted.
    const planners = fixture.debugElement.queryAll(By.directive(PlanningTabComponent)).map((d) => d.componentInstance as PlanningTabComponent);
    const paid = planners.find((p) => (p as unknown as { deliveryType(): string }).deliveryType() !== 'email');
    expect(paid).toBeDefined();
    (paid as PlanningTabComponent).reset();
    await settle();
    page().onProceedToImplementation({ ...withTwitter } as CampaignBriefOutput);
    await settle();
    expect(tab()['campaignForm'].controls['twitterTweetText'].value).toBe('');
    expect(tab()['campaignForm'].controls['twitterBudget'].value).toBe('');
  });

  /**
   * A restore leaves Planning on its input step without going through `reset()`, so Scrape &
   * Generate for the same event is the only signal that the next proceed is a new generation. The
   * X fields typed over the restored brief must not follow onto it. A real-template round trip
   * (restore, leave, generate, proceed); allow the same CI headroom as its siblings (#5638).
   */
  it('drops the typed X fields when a new brief is generated after a restore, even for the same event', { timeout: 15_000 }, async () => {
    listBriefCampaigns.mockReturnValue(capability(false, false, false, false, false, true));
    vi.spyOn(TestBed.inject(CampaignService), 'generateBrief').mockReturnValue(NEVER as never);
    (
      fixture.componentInstance as unknown as {
        onRestoreSavedBrief(b: CampaignBriefOutput, id: string, etag: string | null, approved: boolean, readAt: number): void;
      }
    ).onRestoreSavedBrief({ ...withTwitter } as CampaignBriefOutput, 'brief-1', null, true, 0);
    await settle();
    tab()['campaignForm'].controls['twitterTweetText'].setValue('Typed tweet');
    tab()['campaignForm'].controls['twitterBudget'].setValue('42');
    await settle();
    await leaveForPlanning();

    const planners = fixture.debugElement.queryAll(By.directive(PlanningTabComponent)).map((d) => d.componentInstance as PlanningTabComponent);
    const paid = planners.find((p) => (p as unknown as { deliveryType(): string }).deliveryType() !== 'email') as unknown as {
      briefForm: { controls: { url: { setValue(v: string): void } } };
      selectedPlatforms: { set(v: Set<string>): void };
      canGenerate(): boolean;
      generate(): void;
    };
    expect(paid).toBeDefined();
    paid.briefForm.controls.url.setValue('https://events.example/kubecon');
    paid.selectedPlatforms.set(new Set(['google-ads', 'twitter-ads']));
    await settle();
    expect(paid.canGenerate()).toBe(true);
    paid.generate();
    await settle();

    page().onProceedToImplementation({ ...withTwitter } as CampaignBriefOutput);
    await settle();
    expect(tab()['campaignForm'].controls['twitterTweetText'].value).toBe('');
    expect(tab()['campaignForm'].controls['twitterBudget'].value).toBe('');
  });

  /**
   * A refine re-saves the brief, and the save clears the brief id until it answers, so the carried
   * pending upload is parked on mount. When the save hands the same id back, the upload must be
   * resumed, holding Create, rather than left parked with Create free to send no image.
   * This real-template round trip mounts Implementation twice and drains Angular between each
   * phase; allow headroom beyond the default 5 seconds on shared CI runners.
   */
  it("resumes a pending X upload once a refine's delayed save returns the same brief id", { timeout: 15_000 }, async () => {
    listBriefCampaigns.mockReturnValue(capability(false, false, false, false, false, true));
    const service = TestBed.inject(CampaignService);
    const upload = new Subject<typeof tweetAsset>();
    vi.spyOn(service, 'uploadCreativeAsset').mockReturnValue(upload as never);
    const resume = vi
      .spyOn(service, 'resumeCreativeAssetUpload')
      .mockImplementation(((owner: string, id: string) => (owner === 'twitter' && id === 'brief-1' ? upload : null)) as never);

    await proceedAndTypeX();
    chooseTweetImage();
    await settle();
    expect(tab()['twitterImageUploadStatus']()).toBe('uploading');
    await leaveForPlanning();

    const save = new Subject<unknown>();
    vi.spyOn(service, 'persistBrief').mockReturnValue(save as never);
    page().onProceedToImplementation({ ...withTwitter } as CampaignBriefOutput);
    await settle();
    expect(tab()['twitterImageUploadPendingName']()).toBe('tweet.png');
    expect(resume).not.toHaveBeenCalled();

    save.next({ enabled: true, briefId: 'brief-1', etag: '"2"', created: false, approved: true });
    save.complete();
    await settle();
    expect(resume).toHaveBeenCalledWith('twitter', 'brief-1');
    expect(tab()['twitterImageUploadStatus']()).toBe('uploading');
    expect(tab()['canSubmit']()).toBe(false);

    upload.next(tweetAsset);
    upload.complete();
    await settle();
    expect(tab()['twitterImageAssetId']()).toBe('asset-x');
  });

  /** The per-caller audience capability travels the same path: the real page reads it and binds it. */
  it.each([[true], [false]])('hands a google audience segments capability of %s to the Implementation tab', async (enabled) => {
    listBriefCampaigns.mockReturnValue(capability(false, false, enabled));

    page().onProceedToImplementation({ ...brief, selectedPlatforms: ['google-ads'] } as unknown as CampaignBriefOutput);
    await settle();

    expect(tab()['googleAudienceSegmentsEnabled']()).toBe(enabled);
  });

  /** #4983 ("ss-3"): where "create another campaign" is offered travels the same path. */
  it('hands the create-another platforms to the Implementation tab', async () => {
    const withGoogle = { ...brief, selectedPlatforms: ['google-ads'] } as unknown as CampaignBriefOutput;
    listBriefCampaigns.mockReturnValue(capability(false).pipe(map((result) => ({ ...result, multiCampaignPlatforms: ['google-ads'] }))));

    page().onProceedToImplementation(withGoogle);
    await settle();
    expect(tab()['multiCampaignPlatforms']()).toEqual(['google-ads']);
  });

  it('hands no create-another platforms when the BFF sends none', async () => {
    const withGoogle = { ...brief, selectedPlatforms: ['google-ads'] } as unknown as CampaignBriefOutput;
    listBriefCampaigns.mockReturnValue(capability(false));

    page().onProceedToImplementation(withGoogle);
    await settle();
    expect(tab()['multiCampaignPlatforms']()).toEqual([]);
  });

  /** The geo-search capability travels the same path: the real page reads it and binds it to the tab. */
  it.each([[true], [false]])('hands a google geo search capability of %s to the Implementation tab', async (enabled) => {
    listBriefCampaigns.mockReturnValue(capability(false, false, false, enabled));
    const withGoogle = { ...brief, selectedPlatforms: ['google-ads'] } as unknown as CampaignBriefOutput;

    page().onProceedToImplementation(withGoogle);
    await settle();

    expect(tab()['googleGeoSearchEnabled']()).toBe(enabled);
  });

  it('after a foundation switch offers no Retry, only "save the brief", and saving recovers the Manual bid', async () => {
    await proceedWithManualMeta();
    expect(tab()['canSubmit']()).toBe(true);

    selectFoundation('cncf');
    await settle();

    expect(page().briefPersistence().briefId).toBeNull();
    expect(page().briefCampaignsCapabilityRead()).toBe('unknown');
    expect(tab()['canSubmit']()).toBe(false);
    expect(q('implementation-bidding-capability-unsaved')?.textContent).toContain("Bidding support can't be checked until this brief is saved.");
    expect(q('implementation-bidding-capability-retry')).toBeNull();

    // Save the brief (Proceed is the save). Its success arm is what reads the capability.
    listBriefCampaigns.mockClear();
    page().onProceedToImplementation(brief);
    await settle();

    // One read: the capability read also files the list for the Implement tab's panel (#4983).
    expect(listBriefCampaigns).toHaveBeenCalledTimes(1);
    expect((page() as unknown as { briefCampaigns(): unknown }).briefCampaigns(), 'the save did not file the campaign list').not.toBeNull();
    expect(page().briefCampaignsBiddingEnabled()).toBe(true);
    expect(q('implementation-bidding-capability-unsaved')).toBeNull();
    expect(tab()['biddingDrafts']()['meta-ads']).toEqual({ strategy: 'manual', bidAmount: 1 });
    expect(tab()['canSubmit']()).toBe(true);
  });

  it('after a failed read with a brief id, Retry reads the capability again and Create unblocks', async () => {
    await proceedWithManualMeta();
    expect(page().briefCampaignsBiddingEnabled()).toBe(true);

    // The next read fails: leave and re-enter the tab so it runs.
    listBriefCampaigns.mockReturnValue(throwError(() => new Error('query service down')));
    (fixture.componentInstance as unknown as { loadCreateCapabilities(): void }).loadCreateCapabilities();
    await settle();

    expect(page().briefPersistence().briefId).toBe('brief-1');
    expect(page().briefCampaignsCapabilityRead()).toBe('failed');
    expect(tab()['canSubmit']()).toBe(false);
    const retry = q('implementation-bidding-capability-retry')?.querySelector('button') as HTMLButtonElement | null;
    expect(retry).not.toBeNull();

    listBriefCampaigns.mockClear();
    listBriefCampaigns.mockReturnValue(capability(true));
    retry!.click();
    await settle();

    expect(listBriefCampaigns).toHaveBeenCalledTimes(1);
    expect(page().briefCampaignsCapabilityRead()).toBe('ready');
    expect(tab()['biddingDrafts']()['meta-ads']).toEqual({ strategy: 'manual', bidAmount: 1 });
    expect(tab()['canSubmit']()).toBe(true);
  });

  it('a retry reached without a brief id reads nothing and leaves the state unknown', STATE_ONLY, async () => {
    (fixture.componentInstance as unknown as { briefCampaignsCapabilityRead: { set(v: string): void } }).briefCampaignsCapabilityRead.set('failed');
    listBriefCampaigns.mockClear();

    (fixture.componentInstance as unknown as { retryCreateCapabilities(): void }).retryCreateCapabilities();

    expect(listBriefCampaigns).not.toHaveBeenCalled();
    expect(page().briefCampaignsCapabilityRead()).toBe('unknown');
  });
});
