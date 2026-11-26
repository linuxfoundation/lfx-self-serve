// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type {
  CampaignBriefApproveResult,
  CampaignBriefEditRequest,
  CampaignBriefLoadResult,
  CampaignBriefOutput,
  CampaignBriefPersistResult,
  CampaignBriefPersistenceState,
  CampaignDeliveryType,
  CampaignIndexDoc,
  CampaignListResult,
  CampaignSavedBriefOffer,
  CampaignTab,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { provideRouter } from '@angular/router';
import { CampaignNegativeKeywordsService } from '@services/campaign-negative-keywords.service';
import { CampaignRemovedKeywordsService } from '@services/campaign-removed-keywords.service';
import { CampaignService } from '@services/campaign.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';
import { CAMPAIGN_PAID_UNOWNED_BRIEF_MESSAGE } from '@lfx-one/shared/constants';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { CampaignsComponent } from './campaigns.component';
import { STATE_ONLY, campaignsComponentUnderTest, trackStateOnlyTests } from './campaigns.spec-helper';

/**
 * The controller spec covers what the server does with a brief. What is only observable here is
 * what the USER is told: the handoff to the Implementation tab must happen regardless of the
 * save, and the three outcomes of the save must be distinguishable on screen — saving, saved,
 * and "this is not durable". A save that silently reports nothing is the failure mode this
 * feature exists to prevent.
 */

trackStateOnlyTests();

describe('CampaignsComponent brief persistence', () => {
  const brief = { eventDetails: { slug: 'kubecon-eu-2026' }, selectedPlatforms: ['google-ads'] } as unknown as CampaignBriefOutput;

  let persistBrief: Mock;
  // Restoring an unapproved brief approves the stored row. Mocked like `persistBrief` so every
  // restore test keeps a stub instead of leaving a real request pending, and defaulted to a
  // successful approval so the tests written before the approve existed still read as before.
  let approveBrief: Mock;
  let fixture: ComponentFixture<CampaignsComponent>;

  /** A brief for a DIFFERENT event, to prove ownership is not shared across events. */
  const otherBrief = { eventDetails: { slug: 'oss-na-2026' }, selectedPlatforms: ['google-ads'] } as unknown as CampaignBriefOutput;

  /** `onProceedToImplementation` is protected; the spec drives it as the Planning tab's output would. */
  function proceed(b: CampaignBriefOutput = brief): void {
    (fixture.componentInstance as unknown as { onProceedToImplementation(b: CampaignBriefOutput): void }).onProceedToImplementation(b);
  }

  /**
   * `onRestoreSavedBrief` is protected; the spec drives it as the Planning tab's output would.
   *
   * OMITTING `etag` means the validator-less restore, so the tests written before LFXV2-3204
   * keep asserting exactly the behavior they were written for. Tests about the carried
   * validator pass one explicitly. It is a rest parameter rather than a defaulted one — see
   * the note in the body for why that distinction is load-bearing.
   */
  function restore(b: CampaignBriefOutput, briefId: string, approved = false, ...etag: (string | null | undefined)[]): void {
    // A REST parameter, not a default. A TS default fires on `undefined`, so
    // `restore(b, id, true, undefined)` would silently become `null` — collapsing the
    // absent-field case into the null case and making the rolling-deploy test pass against
    // code that mishandles `undefined`. The rest form distinguishes "not passed" (length 0,
    // legacy callers -> null) from "passed as undefined" (length 1, value preserved).
    const validator = etag.length === 0 ? null : etag[0];
    // `readAt: 0` is the value a page's FIRST lookup carries, which is what every test above
    // means by a restore: Planning read the row before this session wrote anything to it. A
    // restore whose read post-dates a write here goes through `restoreAt` instead, and the two
    // must stay distinct — defaulting these to the live token would make every cached-replay
    // test silently assert the fresh-read path.
    restoreAt(0, b, briefId, approved, validator);
  }

  /**
   * The same restore, with the refresh token Planning's lookup was DISPATCHED under stated
   * explicitly — the provenance stamp the adopt branch compares against its own record.
   */
  function restoreAt(readAt: number, b: CampaignBriefOutput, briefId: string, approved: boolean, etag: string | null | undefined): void {
    (
      fixture.componentInstance as unknown as {
        onRestoreSavedBrief(b: CampaignBriefOutput, id: string, etag: string | null | undefined, approved: boolean, readAt: number): void;
      }
    ).onRestoreSavedBrief(b, briefId, etag, approved, readAt);
  }

  /** The invalidation channel to the Planning tab; protected, and bound only on the paid planner. */
  function refreshToken(): number {
    return (fixture.componentInstance as unknown as { savedBriefRefreshToken(): number }).savedBriefRefreshToken();
  }

  function state(): CampaignBriefPersistenceState {
    return (fixture.componentInstance as unknown as { briefPersistence(): CampaignBriefPersistenceState }).briefPersistence();
  }

  /**
   * `selectorForm` is protected; a program switch is the real path that discards a brief. The
   * value matters: `resetToPlanning` runs only when the control CHANGES, so switching twice to
   * the same program is a no-op and would leave a test believing it had discarded a brief.
   */
  function switchProgram(value: 'events' | 'education' = 'education'): void {
    (
      fixture.componentInstance as unknown as { selectorForm: { controls: { programType: { setValue(v: string): void } } } }
    ).selectorForm.controls.programType.setValue(value);
  }

  function tab(): string {
    return (fixture.componentInstance as unknown as { selectedTab(): string }).selectedTab();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      // The REAL CampaignService against the testing HTTP backend, with only `persistBrief`
      // replaced. The tabs this component mounts call a dozen other service methods on init; a
      // hand-written stub would have to list them all and would silently break the day a tab
      // calls a new one. Their requests simply stay pending here, which is the loading state.
      // A router is needed because a child tab renders a RouterLink — stubbing the children
      // instead would stop this spec from proving the handoff really mounts the tab.
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        // `providerReady: signal(true)` so `hasCampaignAccess` evaluates the real persona/flag
        // check instead of deferring (its SSR/pre-hydration fast path, see campaigns.component.ts)
        // — every test here runs in the browser and expects an immediate verdict. `getBooleanFlag`
        // stays `false`, matching the real service's default before a provider ever initializes,
        // so this changes nothing for the tests that don't care about the flag.
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false), providerReady: signal(true) } },
      ],
    }).compileComponents();
    persistBrief = vi.fn();
    vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(persistBrief);
    approveBrief = vi.fn().mockReturnValue(of({ enabled: true, briefId: '', etag: null, approved: true }));
    vi.spyOn(TestBed.inject(CampaignService), 'approveBrief').mockImplementation(approveBrief);
    fixture = TestBed.createComponent(campaignsComponentUnderTest());
    TestBed.inject(PersonaService).currentPersona.set('executive-director');
    await fixture.whenStable();
  });

  it('renders a no-access state for a contributor without a campaign_manager FGA grant', async () => {
    TestBed.inject(PersonaService).currentPersona.set('contributor');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-no-access"]')).not.toBeNull();
  });

  // The Optimize tab is destroyed whenever another tab is open, so the page (which stays mounted)
  // is what scopes the root negative-keyword results: it reports its (project, brief), and leaving
  // the page releases them.
  it('scopes negative-keyword results to the page, and releases them when the page is destroyed', STATE_ONLY, () => {
    const service = TestBed.inject(CampaignNegativeKeywordsService);
    const setScope = vi.spyOn(service, 'setScope');
    const releaseScope = vi.spyOn(service, 'releaseScope');
    // A page mounted after the spies, so its first report is observed.
    const page = TestBed.createComponent(campaignsComponentUnderTest());
    page.detectChanges();
    TestBed.tick();

    expect(setScope).toHaveBeenCalled();
    const [projectSlug, briefId] = setScope.mock.calls[setScope.mock.calls.length - 1];
    const component = page.componentInstance as unknown as { activeFoundationSlug(): string; briefPersistence(): { briefId: string | null } };
    expect(projectSlug).toBe(component.activeFoundationSlug());
    expect(briefId).toBe(component.briefPersistence().briefId ?? '');

    page.destroy();
    expect(releaseScope).toHaveBeenCalledTimes(1);
  });

  // A Proceed save sets the brief id to `null` while it runs (and a failed save leaves it `null`).
  // The page reports it as the empty brief; the services read that as the same project's brief
  // (see their specs), and removed keywords are scoped by the project alone.
  it("reports the save's empty brief id to the services, and removed keywords by project only", STATE_ONLY, () => {
    const negatives = vi.spyOn(TestBed.inject(CampaignNegativeKeywordsService), 'setScope');
    const removed = vi.spyOn(TestBed.inject(CampaignRemovedKeywordsService), 'setScope');
    const page = TestBed.createComponent(campaignsComponentUnderTest());
    const persistence = (page.componentInstance as unknown as { briefPersistence: WritableSignal<CampaignBriefPersistenceState> }).briefPersistence;
    page.detectChanges();
    TestBed.tick();

    persistence.set({ status: 'saved', briefId: 'b-1', message: null, approved: false });
    TestBed.tick();
    persistence.set({ status: 'saving', briefId: null, message: null, approved: false });
    TestBed.tick();

    expect(negatives.mock.calls.at(-2)?.[1]).toBe('b-1');
    expect(negatives.mock.calls.at(-1)?.[1]).toBe('');
    expect(removed.mock.calls.every((call) => call.length === 1)).toBe(true);
    page.destroy();
  });

  // A foundation switch from a saved brief: the old brief id can still be on the signal when the
  // project changes, and the clear that follows must not read as a same-project save.
  it('scopes a foundation switch from a saved brief to the new project with no brief', STATE_ONLY, async () => {
    const service = TestBed.inject(CampaignNegativeKeywordsService);
    const setScope = vi.spyOn(service, 'setScope');
    const page = TestBed.createComponent(campaignsComponentUnderTest());
    const persistence = (page.componentInstance as unknown as { briefPersistence: WritableSignal<CampaignBriefPersistenceState> }).briefPersistence;
    page.detectChanges();
    persistence.set({ status: 'saved', briefId: 'b-old', message: null, approved: false });
    TestBed.tick();

    TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-b', slug: 'foundation-b', name: 'Foundation B' }, false);
    TestBed.tick();
    await page.whenStable();
    TestBed.tick();

    expect(setScope.mock.calls.at(-1)).toEqual(['foundation-b', '']);
    page.destroy();
  });

  /**
   * #4756. The paid planner keeps the event URL in `?event=` and prefills it on creation. A program
   * switch recreates that planner precisely so one program's brief cannot carry into the other, so
   * the switch must drop the parameter before the new planner reads it.
   */
  describe('the event URL in the page address on a program switch', () => {
    const EVENT_URL = 'https://events.example.com/kubecon-eu-2026';

    function eventParam(): string | null {
      return new URL(TestBed.inject(Location).path(), 'https://app.example').searchParams.get('event');
    }

    beforeEach(() => {
      TestBed.inject(Location).replaceState(`/campaigns?project=foundation-a&event=${encodeURIComponent(EVENT_URL)}`);
    });

    it('drops ?event= when the user switches program, keeping the other parameters', STATE_ONLY, () => {
      switchProgram('education');

      expect(eventParam()).toBeNull();
      expect(TestBed.inject(Location).path()).toContain('project=foundation-a');
    });

    it('keeps the #fragment when it drops ?event=', STATE_ONLY, () => {
      TestBed.inject(Location).replaceState(`/campaigns?project=foundation-a&event=${encodeURIComponent(EVENT_URL)}#plan`);

      switchProgram('education');

      expect(TestBed.inject(Location).path(true)).toBe('/campaigns?project=foundation-a#plan');
    });

    it("keeps ?event= when a restore adopts the brief's own program", STATE_ONLY, () => {
      restore({ ...brief, programType: 'education' } as CampaignBriefOutput, 'b-1', true, 'W/"1"');

      expect(eventParam()).toBe(EVENT_URL);
    });
  });

  it('switches to the Implementation tab before the save resolves', STATE_ONLY, async () => {
    // Never completes: the point is that the handoff does not wait on the network. If this ever
    // starts gating on the response, a campaign-service outage strands the user on Planning.
    persistBrief.mockReturnValue(NEVER);

    proceed();

    expect(tab()).toBe('implementation');
  });

  /**
   * The flag lives on the server and there is no channel that tells the browser its value before
   * a request is made. So the first save cannot know whether the cutover is on — and rendering
   * "Saving this brief…" while it finds out would put a persistence banner in front of every user
   * in an environment where the cutover is dark — no longer the chart default since #1881, but
   * still any override or un-rolled deployment.
   */
  it('shows no in-flight banner while the cutover state is still unknown', STATE_ONLY, async () => {
    persistBrief.mockReturnValue(NEVER);

    proceed();

    expect(state().status).toBe('off');
  });

  it("does not show a failed save's banner over the next attempt", async () => {
    // A first save that FAILS leaves an error banner and does not flip `briefPersistenceEnabled`,
    // so the retry re-enters the flag-unknown branch. That branch used to set nothing, leaving the
    // previous brief's failure on screen over the new save until its own request finished.
    persistBrief.mockReturnValue(throwError(() => new Error('network down')));
    proceed();
    await fixture.whenStable();
    expect(state().status).toBe('error');

    persistBrief.mockReturnValue(NEVER);
    proceed();
    await fixture.whenStable();

    // Idle, not `saving`: with the flag still unknown a spinner would appear for every user in an
    // environment where nothing is being saved at all — the reason this branch is quiet.
    expect(state().status).toBe('off');
    expect(state().message).toBeNull();
  });

  it('shows the in-flight banner on a later save, once a response has confirmed the cutover is on', async () => {
    persistBrief.mockReturnValue(
      new Observable<CampaignBriefPersistResult>((s) => s.next({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: true }))
    );
    proceed();
    await fixture.whenStable();

    switchProgram();
    await fixture.whenStable();
    persistBrief.mockReturnValue(NEVER);
    proceed();

    expect(state().status).toBe('saving');
  });

  it('records the brief id once the save succeeds', async () => {
    persistBrief.mockReturnValue(
      new Observable<CampaignBriefPersistResult>((s) => s.next({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: true }))
    );

    proceed();
    await fixture.whenStable();

    expect(state()).toEqual({ status: 'saved', briefId: 'brief-9', message: null, approved: true });
  });

  it('renders nothing when the cutover is dark', STATE_ONLY, async () => {
    persistBrief.mockReturnValue(
      new Observable<CampaignBriefPersistResult>((s) => s.next({ enabled: false, briefId: '', etag: null, created: false, approved: false }))
    );

    proceed();
    await fixture.whenStable();

    // Not 'saved' with an empty id: the flag being off is an ordinary deployment state, not a
    // fault, so it has to look like the ordinary case rather than like a save that returned
    // nothing.
    expect(state().status).toBe('off');
    expect(tab()).toBe('implementation');
  });

  it('tells the user the brief is not durable when the save fails', async () => {
    persistBrief.mockReturnValue(throwError(() => new Error('500')));

    proceed();
    await fixture.whenStable();

    expect(state().status).toBe('error');
    // The text must be about durability, not about HTTP — the user can act on "it will be lost",
    // not on a status code.
    expect(state().message).toContain('could not be saved');
    // Still handed off: the failure costs persistence, not the campaign setup flow.
    expect(tab()).toBe('implementation');
  });

  /**
   * The save is deliberately not cancelled, so its response can arrive after the user has moved
   * on. It must not be applied then: `saved` would claim durability for whatever brief is on
   * screen now, and `briefId` would be the id of a different one.
   */
  it('drops a save that resolves after the brief was discarded', STATE_ONLY, async () => {
    const late = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValue(late);

    proceed();

    // The real reset path: switching program type abandons the brief and returns to Planning.
    switchProgram();
    await fixture.whenStable();
    expect(state().status).toBe('off');

    late.next({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: true });
    await fixture.whenStable();

    expect(state()).toEqual({ status: 'off', briefId: null, message: null, approved: false });
    expect(tab()).toBe('planning');
  });

  /**
   * The other half of the rule above: a superseded response must not write the brief's state, but
   * it still carries one fact that outlives the brief — whether the cutover is on. Drop that with
   * the rest and a session whose first save happened to land after a program switch spends the
   * rest of its life withholding the in-flight banner, for no reason the user can see.
   */
  it('still learns the cutover is on from a save that resolved after the brief was discarded', async () => {
    const late = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValue(late);

    proceed();
    switchProgram();
    await fixture.whenStable();

    late.next({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: true });
    await fixture.whenStable();

    // Nothing on screen changed — that part stays guarded.
    expect(state().status).toBe('off');

    persistBrief.mockReturnValue(NEVER);
    proceed();

    // …but the next save knows to show the banner, which it could only have learned from the
    // response it dropped.
    expect(state().status).toBe('saving');
  });

  /**
   * The latch only ever turns on. During a rollout the two answers come from different replicas,
   * so an `enabled: false` is evidence about one handler, not about the deployment — and a
   * superseded one is the stalest evidence there is. Let it clear the latch and the session goes
   * back to withholding the in-flight banner permanently, for a cutover that is on.
   */
  it('does not let a stale disabled response clear the cutover latch', STATE_ONLY, async () => {
    const late = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValue(late);
    proceed();
    switchProgram();
    await fixture.whenStable();

    persistBrief.mockReturnValue(
      new Observable<CampaignBriefPersistResult>((s) => s.next({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: true }))
    );
    proceed();
    await fixture.whenStable();

    // The superseded request finally answers, from a replica that had not been rolled yet.
    late.next({ enabled: false, briefId: '', etag: null, created: false, approved: false });
    await fixture.whenStable();

    switchProgram('events');
    await fixture.whenStable();
    // Really discarded, so the assertion below is about the NEW save rather than the leftover
    // banner from the one before it.
    expect(state().status).toBe('off');

    persistBrief.mockReturnValue(NEVER);
    proceed();

    expect(state().status).toBe('saving');
  });

  /**
   * `/foundation/campaigns` survives a foundation switch — the sidebar only navigates on a lens
   * change or off an entity page, and this is neither, so `setFoundation` moves `?project=` with
   * `Location.replaceState` and leaves the component mounted. The brief id on screen belongs to
   * one foundation's brief table; it must not stay there under another one.
   */
  describe('when the selected foundation changes underneath the page', () => {
    function selectFoundation(slug: string): void {
      const ctx = TestBed.inject(ProjectContextService);
      ctx.setRouteLensKind('foundation');
      // `syncUrl: false` — the URL sync is the sidebar's job and needs a live router URL; what
      // this spec is about is the context change it leaves behind.
      ctx.setFoundation({ uid: `uid-${slug}`, slug, name: slug } as ProjectContext, false);
    }

    beforeEach(async () => {
      // `projectQueryParamGuard` seeds the context BEFORE the component is created, so every
      // change this component observes is a real switch. Re-create the fixture with a foundation
      // already selected rather than letting the initial seed masquerade as one.
      selectFoundation('tlf');
      fixture = TestBed.createComponent(campaignsComponentUnderTest());
      await fixture.whenStable();
    });

    it('clears a banner that already landed for the previous foundation', async () => {
      persistBrief.mockReturnValue(
        new Observable<CampaignBriefPersistResult>((s) => s.next({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: true }))
      );
      proceed();
      await fixture.whenStable();
      expect(state().briefId).toBe('brief-9');

      selectFoundation('cncf');
      await fixture.whenStable();

      // Not 'saved' with tlf's id: that id names a row in tlf's table, and CNCF is selected now.
      expect(state()).toEqual({ status: 'off', briefId: null, message: null, approved: false });
    });

    it('drops a save that resolves after the foundation changed', STATE_ONLY, async () => {
      const late = new Subject<CampaignBriefPersistResult>();
      persistBrief.mockReturnValue(late);

      proceed();
      selectFoundation('cncf');
      await fixture.whenStable();

      late.next({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: true });
      await fixture.whenStable();

      expect(state()).toEqual({ status: 'off', briefId: null, message: null, approved: false });
    });

    /**
     * A REFUSED save must never render as a saved one.
     *
     * `conflict` arrives with `enabled: true` — the flag is on and the request was served — so a
     * banner keyed on `enabled` alone reports "Brief saved." over work that was never written.
     * That is the single worst outcome this feature can produce: the user closes the tab believing
     * their afternoon is durable.
     */
    it('reports a refused save as an error, not as saved', async () => {
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: null, created: false, approved: false, conflict: 'unowned-brief-exists' }));

      proceed();
      await fixture.whenStable();

      expect(state().status).toBe('error');
      expect(state().message).toContain('already has a saved brief');
    });
    /**
     * The SECOND Proceed of a session must update the brief the first one created.
     *
     * The ownership guard refuses a save that cannot name the stored row, so without handing the
     * created id back the second save is refused — telling a user editing and re-proceeding that
     * their own brief belongs to someone else. Creating a brief is the strongest proof of
     * ownership there is; this pins that the page keeps it.
     */
    /**
     * Ownership belongs to a BRIEF, not to a session or a foundation.
     *
     * `selectTab` sets the tab directly, so clicking back to Planning recreates the planning form
     * without going through `resetToPlanning`. Save event A, click Planning, generate a brief for
     * event B: an ownership key naming only the foundation would hand B's save the id of A's row,
     * and the server — given a name it recognises — would accept an overwrite of a brief that was
     * never approved as B. A key too coarse to tell A from B disarms the guard it feeds.
     */
    it('refuses an email-only tab id on the paid flow', STATE_ONLY, async () => {
      // `CampaignTab` typed both flows' selection, so `selectTab('audience', 'paid-marketing')`
      // compiled — and left the paid flow selected on a tab it renders no panel for. The unions
      // are now split so that call is a type error; this pins the runtime half, since the paid
      // tablist is built from CAMPAIGN_TABS and a caller iterating the wrong list would still
      // arrive here.
      const internals = fixture.componentInstance as unknown as {
        selectTab(t: string, owner: string): void;
        selectedTab(): string;
      };
      const before = internals.selectedTab();

      internals.selectTab('audience', 'paid-marketing');

      expect(internals.selectedTab(), 'the paid flow selected a tab it renders no panel for').toBe(before);
    });

    it('does not lend a CREATED brief id to another event', async () => {
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-a', etag: '"1"', created: true, approved: true }));
      proceed();
      await fixture.whenStable();

      // Back to Planning by clicking the tab — no reset runs — then proceed with another event.
      (fixture.componentInstance as unknown as { selectTab(t: string): void }).selectTab('planning');
      persistBrief.mockReturnValue(NEVER);
      proceed(otherBrief);
      await fixture.whenStable();

      expect(persistBrief).toHaveBeenLastCalledWith(otherBrief, expect.anything(), null, null, false);
    });

    /**
     * The same hazard reached through the OTHER ownership source this branch adds.
     *
     * `selectTab` sets the tab directly, so clicking back to Planning recreates the planning form
     * without going through `resetToPlanning`. Restore event A, click Planning, generate a brief
     * for event B: an ownership key that names only the foundation would hand B's save the id of
     * A's row, and the server — being given a name it recognises — would accept an overwrite of a
     * brief this session never loaded. That is exactly the case LFXV2-3200's guard exists to
     * refuse, so a key too coarse to tell A from B disarms it.
     */
    it('adopts the program of a restored brief instead of leaving the selector wrong', STATE_ONLY, async () => {
      // The lookup is keyed on `(event_slug, project)` with no program type, so an Events brief
      // can be offered while the page sits on Education. Leaving the selector wrong is not merely
      // cosmetic: correcting it runs `resetToPlanning`, which clears the brief AND the ownership
      // map, so the row just restored becomes unowned and the next save is refused.
      const internals = fixture.componentInstance as unknown as {
        selectorForm: { controls: { programType: { setValue(v: string): void } } };
        selectedProgramType(): string;
        briefOutput(): CampaignBriefOutput | null;
      };
      internals.selectorForm.controls.programType.setValue('education');
      await fixture.whenStable();
      expect(internals.selectedProgramType()).toBe('education');

      const eventsBrief = { ...brief, programType: 'events' } as CampaignBriefOutput;
      persistBrief.mockReturnValue(NEVER);
      restore(eventsBrief, 'restored-a');
      await fixture.whenStable();

      // The selector followed the brief...
      expect(internals.selectedProgramType()).toBe('events');
      // ...and both the brief and its ownership survived. Note what this does NOT prove: the
      // adopt runs before the ownership write and before `onProceedToImplementation`, so a reset
      // triggered by it is undone by both, and this test passes with `adoptingRestoredProgram`
      // ignored. The flag is defence against that ordering being changed, not something a test
      // in the current arrangement can pin.
      expect(internals.briefOutput()).toEqual(eventsBrief);

      proceed(eventsBrief);
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(eventsBrief, expect.anything(), 'restored-a', null, true);
    });

    it('still resets when the USER switches program, unlike a restore adopt', STATE_ONLY, async () => {
      // The flag that stops a restore-adopt resetting must not disarm the ordinary case. A user
      // choosing a different program is discarding the brief on purpose, and `resetToPlanning`
      // clearing `briefOutput` is exactly right there.
      const internals = fixture.componentInstance as unknown as {
        selectorForm: { controls: { programType: { setValue(v: string): void } } };
        briefOutput(): CampaignBriefOutput | null;
      };

      persistBrief.mockReturnValue(NEVER);
      restore(brief, 'restored-a');
      await fixture.whenStable();
      expect(internals.briefOutput()).not.toBeNull();

      // A real program switch by the user.
      internals.selectorForm.controls.programType.setValue('education');
      await fixture.whenStable();
      expect(internals.briefOutput()).toBeNull();

      // Ownership does NOT go with it, and that is deliberate on the base branch: the row still
      // exists upstream, so dropping its id would refuse the next Proceed for that event as
      // unowned. What this test pins is that the RESET ran at all — `briefOutput` above — which
      // is what distinguishes a user switch from a restore-adopt.
      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', null, true);
    });

    it('sends the LOAD-TIME validator as If-Match, so a concurrent edit is refused not overwritten', STATE_ONLY, async () => {
      // LFXV2-3204. The hazard: two people load the same brief, the other one saves first, and
      // this page's save silently replaces their work. `replaceBrief` prefers a caller-supplied
      // validator over the one its own find reads, so the refusal can only happen if the restore
      // actually CARRIES the ETag it was shown. That carry is what this pins.
      //
      // Asserted at argument 4 (`knownEtag`) rather than through a mocked HTTP layer, because
      // that is the boundary this change moves: everything downstream of it — If-Match, the 412,
      // the `stale-brief` mapping — already shipped and is covered in the service spec.
      persistBrief.mockReturnValue(NEVER);
      restore(brief, 'restored-a', true, 'W/"v1"');
      await fixture.whenStable();

      proceed();
      await fixture.whenStable();

      // The validator the user was SHOWN, and no fallback licence. Passing `true` here would let
      // the server substitute its own fresh read, which is the overwrite this ticket closes.
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', 'W/"v1"', false);
    });

    it('surfaces a concurrent edit as stale-brief, then lets the next Proceed overwrite', STATE_ONLY, async () => {
      // The full chosen behavior end to end: one honest refusal, then the existing
      // proceed-again path. Both halves matter — a fix that produced the 412 but stranded the
      // user would break a shipped flow, and a fix that kept proceeding silently would not be a
      // fix at all.
      //
      // The concurrent edit is simulated at the seam the component owns: the stored row moved
      // since this page loaded it, so the server answers the carried validator with 412 and the
      // BFF maps it to `stale-brief`.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: null, created: false, approved: false, conflict: 'stale-brief' }));
      restore(brief, 'restored-a', true, 'W/"v1"');
      await fixture.whenStable();

      proceed();
      await fixture.whenStable();

      // Refused, and SAID so — not a generic failure and not a silent overwrite.
      expect(state().status).toBe('error');
      expect(state().message).toContain('Someone else changed this brief while you were working');

      // The promotion: the refusal granted this session explicit overwrite permission, so the
      // next Proceed carries the fallback licence and replaces whatever is stored. This is the
      // deliberate product choice (option 1) — the 412 is a speed bump, not a wall.
      persistBrief.mockReturnValue(NEVER);
      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', null, true);
    });

    it('treats an ABSENT etag field like a null one, so a rolling deploy cannot block restores', STATE_ONLY, async () => {
      // `etag` crosses an HTTP boundary, so its declared `string | null` is a claim about the
      // CURRENT server. Mid-rolling-deploy an older pod omits the field and JSON yields
      // `undefined` — a value the type system says cannot occur and the wire produces anyway.
      //
      // A strict `=== null` test would call that "present", withhold the overwrite licence, and
      // refuse the first save after every restore as `unverified-validator` for the length of the
      // deploy. Absence has one meaning regardless of how it is spelled.
      persistBrief.mockReturnValue(NEVER);
      restore(brief, 'restored-a', true, undefined);
      await fixture.whenStable();

      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', null, true);
    });

    it('still grants the overwrite licence when the read produced NO validator', async () => {
      // The absence case, kept as it was — and the name has to say which way it goes, because
      // the assertion below grants the licence (`allowEtagFallback: true`) rather than
      // withholding it.
      //
      // A restore whose read returned no ETag is still a DECISION — the user saw the content and
      // chose it — so it stays `'overwrite'` rather than refusing the first save after every such
      // restore. What changed in LFXV2-3204 is only that the licence is no longer handed out for
      // free when a validator IS available; the test above pins that half.
      //
      // Is `true` RIGHT here, or merely preserved? Right. `allowEtagFallback` separates an
      // absence someone DECIDED from an absence that is UNKNOWN. A restore is a decision — the
      // stored content was displayed and chosen — whereas an indeterminate write displayed
      // nothing and decided nothing, which is why that path records `absence: 'unknown'` and is
      // refused. Nobody was WARNED here, but the warning was never what the flag asserted.
      //
      // The contract comments used to say otherwise, describing `'overwrite'` as the stale-brief
      // warning path alone; this test previously had to note that they did not cover it. They
      // now document both explicit sources — see `knownBriefIds` in the component, and the
      // matching comments on `persistBrief`, the controller and `saveBrief`.
      //
      // The cost is bounded and worth naming: this save takes the server's freshly read
      // validator, so a concurrent editor who moved the row is overwritten rather than refused —
      // exactly the hazard LFXV2-3204 closes for the case where a validator EXISTS. It is
      // accepted only because the alternative refuses every restore whose read returned no ETag,
      // which is this feature's main path, over a conflict the user cannot act on. If reads ever
      // reliably carry an ETag, this branch should become `absence: 'unknown'`.
      persistBrief.mockReturnValue(NEVER);
      restore(brief, 'restored-a', true, null);
      await fixture.whenStable();

      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', null, true);
    });

    it('drops a save that resolves after the user restored a different brief', async () => {
      // `onProceedToImplementation(brief, true)` bumps `briefPersistenceGeneration` precisely so a
      // save still in flight for the brief the user just REPLACED cannot write its `saved` state
      // and briefId onto the restored one — attributing one brief's id to another. The restore
      // tests all used NEVER, so that bump was never exercised.
      const inFlight = new Subject<CampaignBriefPersistResult>();
      persistBrief.mockReturnValue(inFlight);
      proceed();
      await fixture.whenStable();

      // The user restores a DIFFERENT brief while that save is still open.
      restore(otherBrief, 'restored-b');
      await fixture.whenStable();

      // The earlier save now answers. Its outcome belongs to a brief no longer on screen.
      inFlight.next({ enabled: true, briefId: 'stale-a', etag: '"1"', created: true, approved: true });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // It must NOT paint `saved` over the restored brief, nor hand it `stale-a`.
      expect(state().briefId).not.toBe('stale-a');
      expect(state().status).not.toBe('saved');
    });

    /**
     * Restoring an UNAPPROVED stored brief approves the stored row, writing nothing.
     *
     * The dead end these cover: campaign-service stores every brief as `draft` and resets an
     * existing one to `draft` on every PUT, campaign creation refuses an unapproved brief, and the
     * restore path deliberately suppresses the save that would otherwise retry the approval. So a
     * restore used to end with Create Campaign disabled and no action anywhere in the product that
     * could enable it.
     */
    describe('approving a restored brief', () => {
      it('approves the stored row and leaves Create enabled, without re-saving it', STATE_ONLY, async () => {
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true }));

        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        // The carried validator is sent as the If-Match, so an approve cannot land on a row that
        // moved since the restore read it.
        expect(approveBrief).toHaveBeenCalledWith(expect.anything(), 'restored-a', 'W/"v1"');
        // `off` because nothing was written -- the id is provenance, not progress -- and
        // `approved` is what the Implementation tab gates Create on.
        expect(state().status).toBe('off');
        expect(state().briefId).toBe('restored-a');
        expect(state().approved).toBe(true);
        // The whole point of approving instead of re-saving: the stored bytes are untouched.
        expect(persistBrief).not.toHaveBeenCalled();
      });

      it('re-records the validator the approval returned, so the next save is not refused', STATE_ONLY, async () => {
        // Approval bumps the row's `version` upstream, so the restore's own ETag is stale the
        // moment it succeeds. Replaying it would 412 the next Proceed for something the user did
        // not do.
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true }));
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        persistBrief.mockReturnValue(NEVER);
        proceed();
        await fixture.whenStable();

        expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', 'W/"v2"', false);
      });

      it('does not license an overwrite the user was never warned about', STATE_ONLY, async () => {
        // The restore's own read DID carry a validator, and the approval came back without one.
        // Licensing the ETag fallback here would let the next Proceed send `etag_fallback=1`, and
        // `replaceBrief` then PUTs with the validator it reads itself inside that save — so an
        // editor who replaced the brief in between is overwritten with no conflict ever shown.
        // The approve wrote nothing, but the marker licenses the next WRITE, not this request.
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: null, approved: true }));
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        persistBrief.mockReturnValue(NEVER);
        proceed();
        await fixture.whenStable();

        // The trailing `false` withholds the fallback licence: this save is refused
        // `unverified-validator`, the banner says proceeding again replaces what is stored, and
        // the conflict handler then promotes the record to `'overwrite'` — one warned click away,
        // which is the whole point of refusing here.
        expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', null, false);
      });

      it('carries through an overwrite permission the restore already held', STATE_ONLY, async () => {
        // The other half of the same default. This restore's read carried NO validator, which
        // records `absence: 'overwrite'` — no validator BY CHOICE, against content the user was
        // shown. An approval that returns no validator must not downgrade that: nothing about
        // this request withdraws a permission the restore legitimately established.
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: null, approved: true }));
        restore(brief, 'restored-a', false, null);
        await fixture.whenStable();

        persistBrief.mockReturnValue(NEVER);
        proceed();
        await fixture.whenStable();

        // The trailing `true` is the fallback licence, carried, not newly granted.
        expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', null, true);
      });

      // Blank is what an unresolved foundation reads as, and the server refuses it — a brief is
      // approved inside one project. Returning silently would leave Create disabled under the
      // restore's own untroubled banner, which is the no-reason dead end this path replaces.
      it('says why, rather than going quiet, when no foundation is resolved', STATE_ONLY, async () => {
        TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-x', slug: '', name: 'Unresolved' } as never, false);
        // Settled BEFORE the restore. The foundation-switch subscription resets the banner to
        // idle asynchronously, so restoring first would let that reset land on top of the error
        // this test is about and report `off` for the wrong reason.
        await fixture.whenStable();

        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        expect(approveBrief).not.toHaveBeenCalled();
        expect(state().status).toBe('error');
        expect(state().approved).toBe(false);
        expect(state().message).toContain('No foundation is selected');
      });

      it('sends no approve for a brief that is already approved', STATE_ONLY, async () => {
        restore(brief, 'restored-a', true, 'W/"v1"');
        await fixture.whenStable();

        expect(approveBrief).not.toHaveBeenCalled();
        expect(state().approved).toBe(true);
      });

      it('leaves Create disabled with a real reason when the stored brief moved under it', STATE_ONLY, async () => {
        // A 412 the BFF maps to `stale-brief`. Saying nothing here would leave Create disabled
        // with the banner still reporting the restore as fine -- the exact silence this fix
        // exists to end.
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: null, approved: false, conflict: 'stale-brief' }));

        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        expect(state().status).toBe('error');
        expect(state().approved).toBe(false);
        expect(state().message).toContain('changed while you were working');
      });

      it('reports a failed approve request rather than claiming the brief is ready', STATE_ONLY, async () => {
        approveBrief.mockReturnValue(throwError(() => new Error('network down')));

        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        expect(state().status).toBe('error');
        expect(state().approved).toBe(false);
        expect(state().message).toContain('could not be confirmed as approved');
      });

      /**
       * The objective-table defect of #3565, one feature across. `approveConflictMessages` is a
       * plain object literal, so it inherits `Object.prototype`, and `conflict` is read off a JSON
       * response rather than produced here -- the declared union is a compile-time claim the wire
       * does not honour. Indexed raw, each of these resolved to a truthy INHERITED member and put
       * `[object Object]`, or a function's source, into the banner the user reads. The assertion
       * that matters is the `unknown` sentence: an unclassifiable conflict is exactly what it
       * describes. `Object.hasOwn` is easy to "simplify" back into a truthiness test, so the keys
       * are pinned by name.
       */
      it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
        'falls back to the unknown message for an inherited %s conflict',
        STATE_ONLY,
        async (conflict) => {
          approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: null, approved: false, conflict } as CampaignBriefApproveResult));

          restore(brief, 'restored-a', false, 'W/"v1"');
          await fixture.whenStable();

          expect(state().status).toBe('error');
          expect(state().message).toBe(
            'This saved brief could not be confirmed as approved. Reload and try again from the Plan tab (enter the event URL there if it is not already filled in).'
          );
        }
      );

      it('names the mixed rollout when the approve lands on a pod that has not cut over', STATE_ONLY, async () => {
        // `enabled: false` cannot mean a dark deployment on this path. `loadBrief` is gated on the
        // same flag and answers a dark one with no brief id at all, so no restore would have been
        // offered -- reaching the approve proves one pod has the flag and this answer proves
        // another does not. Staying on the restore's `off` state (which renders nothing) would
        // leave Create disabled with no reason, the dead end this path exists to remove.
        approveBrief.mockReturnValue(of({ enabled: false, briefId: '', etag: null, approved: false }));

        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        expect(state().status).toBe('error');
        expect(state().approved).toBe(false);
        expect(state().message).toContain('still being updated');
      });

      it('drops an approval that resolves after the user restored a different brief', async () => {
        const pending = new Subject<CampaignBriefApproveResult>();
        approveBrief.mockReturnValue(pending);
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        approveBrief.mockReturnValue(NEVER);
        restore(otherBrief, 'restored-b', true, 'W/"v9"');
        await fixture.whenStable();

        pending.next({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true });
        await new Promise((resolve) => setTimeout(resolve, 0));

        // The first brief's approval must not stamp its id over the brief now on screen.
        expect(state().briefId).toBe('restored-b');
      });

      /**
       * A second Restore of a row this session already approved must not replay the PRE-approval
       * pair Planning still has cached.
       *
       * Planning caches its lookup and is visibility-toggled rather than destroyed, so after the
       * approve below it still holds `etag: W/"v1"` and `approved: false`. Taking the offer
       * verbatim would file a validator the server has already superseded — a 412 on the next
       * save — and re-run an approval against an already-approved row. This session's own record
       * is the newer account of that id, so it wins.
       */
      it('prefers its own record over a stale restore offer for the same brief id', STATE_ONLY, async () => {
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true }));
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();
        expect(approveBrief).toHaveBeenCalledTimes(1);
        expect(state().approved).toBe(true);

        // Planning hands the same row over again, still describing it as it was before the approve.
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        // No second approve: the session knows this row is approved.
        expect(approveBrief).toHaveBeenCalledTimes(1);
        expect(state().approved).toBe(true);

        // And the save that follows carries the POST-approval validator, not the replayed one.
        persistBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v3"', created: false, approved: true }));
        proceed();
        await fixture.whenStable();
        expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', 'W/"v2"', false);
      });

      /**
       * The other half of the rule above, and the one the id guard cannot reach on its own.
       *
       * A matching id proves the two accounts describe the same row; it says nothing about which
       * is NEWER. After this session approves version 2, another editor can PUT version 3 — which
       * campaign-service writes as `draft` — and a Planning lookup dispatched after that returns
       * the draft. Preferring the record there would skip the approval and enable Create against
       * a row upstream refuses. The offer's `readAt` is above the record's, so it wins.
       */
      it('takes a restore offer that was read after its own record was written', STATE_ONLY, async () => {
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true }));
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();
        expect(approveBrief).toHaveBeenCalledTimes(1);

        // The approval bumped the token, so a lookup dispatched under the bumped value saw the
        // row after it — here, after a third party replaced it with an unapproved version 3.
        const afterApproval = refreshToken();
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v4"', approved: true }));
        restoreAt(afterApproval, brief, 'restored-a', false, 'W/"v3"');
        await fixture.whenStable();

        // Approved again, against the validator the FRESH read carried — not skipped on the
        // strength of an approval that belongs to a version that no longer exists.
        expect(approveBrief).toHaveBeenCalledTimes(2);
        expect(approveBrief).toHaveBeenLastCalledWith(expect.anything(), 'restored-a', 'W/"v3"');
        expect(state().approved).toBe(true);
      });

      /**
       * The replay in the middle is the whole point. Between a write and the re-lookup it triggers
       * landing, the Restore button still offers the pair Planning read BEFORE the write — and the
       * record rightly outranks it. What must not happen is the record taking the live token as its
       * own date on the way back into the map: that is strictly above its real one, and it would
       * disqualify the very lookup the bump went out to trigger.
       */
      it('does not re-date its own record when a stale offer is replayed before the fresh read lands', STATE_ONLY, async () => {
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true }));
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();
        expect(approveBrief).toHaveBeenCalledTimes(1);

        const afterApproval = refreshToken();

        // The pre-approval pair, replayed while the re-lookup is still in flight. The record wins.
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();
        expect(approveBrief).toHaveBeenCalledTimes(1);

        // Now the re-lookup answers, carrying an unapproved version a third party wrote. It was
        // dispatched after the approval, so it outranks the record — the replay above must not
        // have moved the record's date up to meet it.
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v4"', approved: true }));
        restoreAt(afterApproval, brief, 'restored-a', false, 'W/"v3"');
        await fixture.whenStable();

        expect(approveBrief).toHaveBeenCalledTimes(2);
        expect(approveBrief).toHaveBeenLastCalledWith(expect.anything(), 'restored-a', 'W/"v3"');
      });

      /**
       * A save that replaced the stored brief and could not re-approve it leaves the row a draft
       * and files `approved: false`; the cached offer still says `true`, because it was read
       * before that save. Taking the offer's word there skips the approval and enables Create
       * against a draft campaign-service refuses.
       *
       * Two guards shut that door, and the OUTER one answers first. The content stamp this save
       * files sits above every offer read before it, so the replay below is refused as superseded
       * before `record.approved ?? approved` is ever consulted — no approval is carried, Create
       * stays disabled, and the bump re-reads the row. The `??` precedence behind it still
       * matters for a record whose content never moved (a restore's own, or an approval's) and is
       * covered by the tests above; here the stale pair never gets that far.
       */
      it('refuses a cached offer that says approved when its own save left the row unapproved', async () => {
        persistBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v3"', created: false, approved: false }));
        proceed();
        await fixture.whenStable();
        expect(state().approved).toBe(false);
        const afterSave = refreshToken();

        // The offer Planning holds, carrying the approval state from before that save.
        approveBrief.mockClear();
        restore(brief, 'restored-a', true, 'W/"v3"');
        await fixture.whenStable();

        expect(state().status).toBe('error');
        expect(state().message).toContain('Create Campaign stays disabled');
        expect(state().approved).toBe(false);
        // Nothing was approved on the strength of the offer, and the row is being re-read.
        expect(approveBrief).not.toHaveBeenCalled();
        expect(refreshToken()).toBe(afterSave + 1);
      });

      /**
       * A restore hands the Implement tab the OFFER's content while the metadata comes from
       * whichever account won. Once this session has saved over the row, those two describe
       * different versions: the screen shows what Planning cached, and the id, validator and
       * approval all describe what is stored. Create builds from the stored row, so carrying the
       * approval through would create a campaign from a brief the user never saw.
       */
      it('refuses to pair a cached brief with metadata from a version saved over it', STATE_ONLY, async () => {
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true }));
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();
        expect(state().approved).toBe(true);

        // A save REPLACES the content. Everything this session knows now describes that version.
        persistBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v3"', created: false, approved: true }));
        proceed();
        await fixture.whenStable();
        const afterSave = refreshToken();

        // Planning's re-read has not landed, so Restore still offers the pre-save content.
        approveBrief.mockClear();
        restore(brief, 'restored-a', true, 'W/"v1"');
        await fixture.whenStable();

        // Opened, because it is the only copy of that content anyone has -- but not create-ready,
        // and with the id kept so the next save still replaces the row instead of creating a second.
        expect(state().status).toBe('error');
        expect(state().approved).toBe(false);
        expect(state().briefId).toBe('restored-a');
        // No approval either: approving would succeed and flip Create back on against the mismatch.
        expect(approveBrief).not.toHaveBeenCalled();
        // The remedy is the re-read, which makes the next Restore offer a pair whose halves agree.
        expect(refreshToken()).toBe(afterSave + 1);
      });

      /**
       * The session's record is keyed by `(project, event, delivery, stage)`, but what it describes
       * is one ROW. A different brief id under that same key is a different row, and nothing this
       * session learned about the previous occupant — its validator or its approval state — may be
       * carried onto it. The offer is then the only account there is.
       */
      it('does not carry a previous row approval onto a different brief id', STATE_ONLY, async () => {
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true }));
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();
        expect(approveBrief).toHaveBeenCalledTimes(1);

        // A different row arrives under the same key, offered as unapproved.
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-b', etag: 'W/"b2"', approved: true }));
        restore(brief, 'restored-b', false, 'W/"b1"');
        await fixture.whenStable();

        // It is approved on its own merits rather than inheriting `restored-a`'s approval...
        expect(approveBrief).toHaveBeenCalledTimes(2);
        expect(approveBrief).toHaveBeenLastCalledWith(expect.anything(), 'restored-b', 'W/"b1"');

        // ...and the save that follows carries ITS validator, not the previous row's.
        persistBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-b', etag: 'W/"b3"', created: false, approved: true }));
        proceed();
        await fixture.whenStable();
        expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-b', 'W/"b2"', false);
      });

      /**
       * A refused approval must leave a way forward. The save path promotes `stale-brief` to
       * `absence: 'overwrite'` for exactly this reason — the user has now BEEN WARNED — and this
       * path did not, so every retry re-sent the validator the server had just rejected and was
       * refused identically, while the banner said to try again. A reload was the only exit.
       */
      it('licenses the next save after an approval was refused', STATE_ONLY, async () => {
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: null, approved: false, conflict: 'stale-brief' }));
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();
        expect(state().status).toBe('error');

        persistBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: '"2"', created: false, approved: true }));
        proceed();
        await fixture.whenStable();

        // No validator, and `allowFallback` true: the rejected ETag is not replayed, and the
        // server may use the one it reads itself.
        expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', null, true);
      });

      /**
       * ...and ONLY after a conflict the user was actually shown. A 5xx, a timeout or a reset
       * comes back `approved: false` with no `conflict` at all, because the approval may in fact
       * have landed, and the banner says only that it could not be confirmed. Granting the
       * overwrite licence there would let the next Proceed replace an editor nobody was warned
       * about — the silent overwrite the carried validator exists to prevent.
       */
      it('does not license an overwrite when the approval outcome is indeterminate', STATE_ONLY, async () => {
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: null, approved: false }));
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();
        expect(state().status).toBe('error');

        persistBrief.mockReturnValue(NEVER);
        proceed();
        await fixture.whenStable();

        // The validator the user was shown, and no fallback licence: a save that lands on a row
        // someone else moved is refused rather than overwriting it.
        expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', 'W/"v1"', false);
      });

      /**
       * And it has to invalidate Planning's cache as well, for the reason the save path's conflict
       * branch does: the refusal says the stored row MOVED, so the offer still on screen describes
       * the row this approval lost to, and the next Restore would replay it.
       */
      it('re-reads the planning lookup when an approval is refused', STATE_ONLY, async () => {
        const before = refreshToken();
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: null, approved: false, conflict: 'stale-brief' }));

        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        expect(state().status).toBe('error');
        expect(refreshToken()).toBe(before + 1);
      });

      /**
       * An approve is NOT on the save queue — queueing it behind an unrelated save is what the
       * queue's own docblock argues against — so a concurrent save for the same row could read
       * `knownBriefIds` before the approval filed its new validator and send the stale one.
       */
      it('waits for a pending approval of the same row before reading its validator', STATE_ONLY, async () => {
        const pending = new Subject<CampaignBriefApproveResult>();
        approveBrief.mockReturnValue(pending);
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        persistBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: '"9"', created: false, approved: true }));
        proceed();
        await fixture.whenStable();

        // Still blocked on the approval, so nothing has been sent with the pre-approval validator.
        expect(persistBrief).not.toHaveBeenCalled();

        pending.next({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await fixture.whenStable();

        expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', 'W/"v2"', false);
      });

      /** A save for a DIFFERENT event must not queue behind an approval it has nothing to do with. */
      it('does not hold a save of another event behind a pending approval', STATE_ONLY, async () => {
        approveBrief.mockReturnValue(NEVER);
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-other', etag: '"1"', created: true, approved: true }));
        proceed(otherBrief);
        await fixture.whenStable();

        expect(persistBrief).toHaveBeenCalledTimes(1);
      });

      /**
       * And the approval has to tell Planning its cache is stale, or the second Restore above is
       * served from the pre-approval answer in the first place.
       */
      it('invalidates the planning lookup after approving a restored brief', STATE_ONLY, async () => {
        const before = refreshToken();
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true }));
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        expect(refreshToken()).toBe(before + 1);
      });

      /**
       * #3801 through a second door. A `stale-brief` conflict means another writer's PUT landed,
       * and campaign-service's replace resets the row to `status='draft', approved_by=NULL` — so
       * the `approved: true` this session recorded is a claim about a row that no longer exists.
       * Carrying it through the conflict promotion made the next restore hand
       * `onProceedToImplementation` an approval it never verified, which skipped the approve
       * entirely and enabled Create Campaign against a draft.
       */
      it('does not carry a stale approval through a conflict, so Create is not enabled against a draft', STATE_ONLY, async () => {
        approveBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true }));
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();
        expect(state().approved).toBe(true);

        const before = refreshToken();
        persistBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: null, created: false, approved: false, conflict: 'stale-brief' }));
        proceed();
        await fixture.whenStable();
        expect(state().status).toBe('error');
        // Planning's cached offer describes the row that LOST, so dropping the flag alone would
        // only fall back on an answer that is stale in the same way and by the same event.
        expect(refreshToken()).toBe(before + 1);

        // The next restore must ask the server again rather than replay what this session knew.
        //
        // Stamped with the token the bump above produced, because that is what this offer IS: the
        // answer to the re-read the conflict triggered, carrying a validator (`v3`) no earlier
        // lookup could have seen. A first-lookup stamp would describe a cached replay of the row
        // as it was before the conflict -- which the adopt branch rightly refuses to pair with
        // this session's metadata, and which is covered by its own test above.
        approveBrief.mockClear();
        approveBrief.mockReturnValue(NEVER);
        restoreAt(refreshToken(), brief, 'restored-a', false, 'W/"v3"');
        await fixture.whenStable();

        expect(approveBrief).toHaveBeenCalledTimes(1);
        expect(state().approved).toBe(false);
      });

      /**
       * The equality case, which every test above masks by approving first.
       *
       * An approve bumps the token, so a restore that triggers one leaves the record's date below
       * the live value and any later write stamps strictly above the cached offer. Restoring an
       * ALREADY-APPROVED brief fires no approve and no bump — so the save that follows takes the
       * very same token Planning's cached offer was dispatched under. With the content stamp
       * defaulted to that token the guard compares `T < T`, waves the replay through, and pairs
       * the bytes Planning read BEFORE the save with this write's ETag and approval: Create stays
       * enabled against a brief the screen never showed. The stamp lands one above for exactly
       * this sequence.
       */
      it('refuses a replay of the offer read before a save, when the restore before it approved nothing', STATE_ONLY, async () => {
        // Already approved, so no approve POST and no bump: the record is filed at the page's
        // first-lookup token, and the token is still that value when the save below reads it.
        restore(brief, 'restored-a', true, 'W/"v1"');
        await fixture.whenStable();
        expect(approveBrief).not.toHaveBeenCalled();
        const beforeSave = refreshToken();

        persistBrief.mockReturnValue(of({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', created: false, approved: true }));
        proceed();
        await fixture.whenStable();
        expect(state().status).toBe('saved');
        expect(refreshToken()).toBe(beforeSave + 1);

        // The replay: the pair Planning cached before that save, offered again while the re-read
        // the bump triggered is still in flight. Same id, same first-lookup stamp, stale bytes.
        restoreAt(beforeSave, brief, 'restored-a', true, 'W/"v1"');
        await fixture.whenStable();

        expect(state().status).toBe('error');
        expect(state().message).toContain('Create Campaign stays disabled');
        expect(state().approved).toBe(false);
        // And no approve was fired on the way: a superseded restore approves nothing.
        expect(approveBrief).not.toHaveBeenCalled();
      });

      /**
       * Planning is visibility-toggled rather than destroyed, so until the approval resolves and
       * bumps the refresh token it still offers the PRE-approval pair — and a second Restore hands
       * the same id and the same validator over again. `approveBriefQuery` is version-gated, so a
       * second POST cannot succeed once the first has moved the version: the user was left with
       * "could not be approved" for a row that was, in fact, approved.
       */
      it('shares one approve request when a brief is restored twice before it resolves', STATE_ONLY, async () => {
        const pending = new Subject<CampaignBriefApproveResult>();
        approveBrief.mockReturnValue(pending);

        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();
        restore(brief, 'restored-a', false, 'W/"v1"');
        await fixture.whenStable();

        // One POST, not two. The second caller joined the first request instead of racing it.
        expect(approveBrief).toHaveBeenCalledTimes(1);

        pending.next({ enabled: true, briefId: 'restored-a', etag: 'W/"v2"', approved: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await fixture.whenStable();

        // The caller the user is actually looking at applies the answer under its own snapshots.
        expect(state().status).toBe('off');
        expect(state().approved).toBe(true);

        // And the validator the approval returned is the one the next save carries.
        persistBrief.mockReturnValue(NEVER);
        proceed();
        await fixture.whenStable();
        expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', 'W/"v2"', false);
      });
    });

    /**
     * The other half of the dead end: Planning looked the row up, found nothing, and cached that.
     * The save then CREATED the row and told the user to go restore it — against a component that
     * would never look again, because its key had not changed. The bump is what makes the banner's
     * instruction performable.
     */
    it('invalidates the planning lookup after a save whose approval did not land', async () => {
      const before = refreshToken();
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: '"1"', created: true, approved: false }));
      proceed();
      await fixture.whenStable();

      expect(refreshToken()).toBe(before + 1);
      // And the message no longer names an action that could not be performed: `onUrlInput` emits
      // nothing for an unchanged url, so "re-enter the event URL" was never followed by a lookup.
      //
      // It names New Brief for the same class of reason. Proceeding leaves Planning on its
      // `review` step, and the restore offer renders only under `@if (step() === 'input')`, so
      // "go back and restore" alone pointed at a button that is not on the screen the user lands
      // on. `reset()` — the New Brief button — returns to the input step and keeps the offer.
      expect(state().message).toContain('Go back to Planning, select New Brief, then restore the saved brief');
      expect(state().message).not.toContain('re-enter the event URL');
    });

    it('reports a saved brief whose approval did not land as saved-but-unapproved', async () => {
      // `saved` is honest -- the write landed. But approval is a SECOND call, and a row that
      // never reached `approved` cannot create campaigns or build audiences. Dropping the flag
      // made this session say only "Brief saved." for exactly the row the LOAD path warns about
      // on the next visit: the same defect, one reload apart.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: '"1"', created: true, approved: false }));
      proceed();
      await fixture.whenStable();

      // Still `saved` -- calling a durable write a failure would be its own lie.
      expect(state().status).toBe('saved');
      expect(state().message).toContain('not approved');
    });

    it('carries no message when the approval landed', async () => {
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: '"1"', created: true, approved: true }));
      proceed();
      await fixture.whenStable();

      expect(state().status).toBe('saved');
      expect(state().message).toBeNull();
    });

    it('reports an error when the success handler throws, instead of stranding on saving', async () => {
      // The terminal catch keeps the queue usable -- a rejected chain would make every later
      // Proceed silently never send. But absorbing the throw must not also leave the banner on
      // "Saving this brief..." for the rest of the session while the brief is not durable.
      // One successful save first, so `briefPersistenceEnabled` is known and the NEXT save shows
      // the in-flight banner. The first save of a session deliberately shows none -- the flag
      // lives on the server, so a spinner then would appear in every environment where the
      // cutover is still dark.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-0', etag: '"1"', created: true, approved: true }));
      proceed();
      await fixture.whenStable();

      const thrower = new Subject<CampaignBriefPersistResult>();
      persistBrief.mockReturnValue(thrower);
      proceed();
      await fixture.whenStable();
      expect(state().status).toBe('saving');

      // An unexpected shape: reading `result.conflict` off null throws inside the success handler,
      // which skips BOTH `.then` arms and rejects the chain.
      thrower.next(null as unknown as CampaignBriefPersistResult);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(state().status).toBe('error');
    });

    it('does not let a restore of one event invalidate a queued save of another', async () => {
      // `ownershipEpochs` is keyed by `(project, event)`, not a single session counter. A save of
      // event B that is queued behind its own predecessor must still pick up the id that
      // predecessor created, even if event A is restored while B waits.
      //
      // With one session-wide counter, restoring A bumps it, B's queued save sees the mismatch,
      // discards the id its OWN predecessor filed, and sends null -- which the server answers with
      // `unowned-brief-exists`. That is exactly the failure the late lookup exists to prevent, so
      // a session-wide epoch would reintroduce it for every event but the restored one.
      const blocker = new Subject<CampaignBriefPersistResult>();
      persistBrief.mockReturnValue(blocker);
      proceed(otherBrief);
      await fixture.whenStable();

      // A second save of the SAME event (B), queued behind the first.
      persistBrief.mockReturnValue(NEVER);
      proceed(otherBrief);
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenCalledTimes(1);

      // Meanwhile the user restores a stored brief for a DIFFERENT event (A).
      restore(brief, 'restored-a');
      await fixture.whenStable();

      // B's first save lands and files ownership for B.
      blocker.next({ enabled: true, briefId: 'b-1', etag: '"1"', created: true, approved: true });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // B's queued save must send B's own id, not null.
      expect(persistBrief).toHaveBeenCalledTimes(2);
      expect(persistBrief.mock.calls[1][2]).toBe('b-1');
    });

    it('does not let a queued save inherit an id that arrived from a restore', async () => {
      // Ownership is resolved when the queue REACHES a save, not when Proceed enqueues it. That
      // lateness is deliberate -- it lets a queued save pick up the id its predecessor created --
      // but a RESTORE writes an id under the same `(project, event)` key from a source the queued
      // payload never saw. `ownershipEpochs` refuses an id that arrived that way.
      //
      // This case asserts the SAME-event half. It does not fail when the guard is removed, because
      // `restore()` synchronously calls `onProceedToImplementation`, which replaces the on-screen
      // brief before the queued save resolves its key -- the component cannot hold the two apart.
      // The cross-event half above IS binding and pins the keying that makes this guard safe.
      const blocker = new Subject<CampaignBriefPersistResult>();
      persistBrief.mockReturnValue(blocker);
      proceed();
      await fixture.whenStable();

      persistBrief.mockReturnValue(NEVER);
      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenCalledTimes(1);

      restore(brief, 'restored-a');
      await fixture.whenStable();

      blocker.next({ enabled: true, briefId: 'b-1', etag: '"1"', created: true, approved: true });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(persistBrief).toHaveBeenCalledTimes(2);
      expect(persistBrief.mock.calls[1][2]).not.toBe('restored-a');
    });

    it('does not lend a RESTORED brief id to another event', STATE_ONLY, async () => {
      persistBrief.mockReturnValue(NEVER);
      restore(brief, 'restored-a');
      await fixture.whenStable();

      // Back to Planning by clicking the tab — no reset runs — then proceed with a brief for a
      // different event.
      (fixture.componentInstance as unknown as { selectTab(t: string): void }).selectTab('planning');
      proceed(otherBrief);
      await fixture.whenStable();

      expect(persistBrief).toHaveBeenLastCalledWith(otherBrief, expect.anything(), null, null, false);
    });

    it("still replays an event's own id when that event is proceeded again", STATE_ONLY, async () => {
      // The other half of the same key: narrowing it must not break the case it exists to serve.
      persistBrief.mockReturnValue(NEVER);
      restore(brief, 'restored-a');
      await fixture.whenStable();

      (fixture.componentInstance as unknown as { selectTab(t: string): void }).selectTab('planning');
      proceed(brief);
      await fixture.whenStable();

      // `null` ETag alongside a real id: this restore was driven WITHOUT a load-time validator,
      // which is the case where the read produced no ETag. Ownership is still proven, while the
      // staleness check falls back to the freshly read validator until this session's own save
      // returns one. A restore that DOES carry a validator sends it instead and can 412 —
      // see the LFXV2-3204 tests above.
      // `true` — a restore is an explicit decision to work from the stored brief, so an absent
      // validator is permission rather than an unknown. Marking it unknown would refuse the first
      // save after every validator-less restore, which is this feature's main path.
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', null, true);
    });

    it('sends the created brief id on the next save of the same session', async () => {
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: '"1"', created: true, approved: true }));

      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), null, null, false);

      proceed();
      await fixture.whenStable();

      // Now owned: the id the first save returned goes back with the second.
      // The ETag rides with the id: it is this caller's last-seen version, and sending it is
      // what makes the server's If-Match a real precondition rather than one re-derived from
      // the save's own read.
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'b-1', '"1"', false);
    });

    /**
     * A SUPERSEDED save must NOT record the row it created.
     *
     * The opposite of this was asserted for one round, and it was wrong. A brief id is the most
     * brief-specific thing the response carries, so it belongs behind the generation check with
     * the banner — not latched early like `enabled`, which is a fact about the deployment. Left
     * early, a response landing after `resetToPlanning` re-assigns the id and the NEXT brief, a
     * different event, inherits ownership of the previous one's row.
     *
     * Nothing is lost by forgetting it: the next save for that event finds the row and is
     * refused, which is the correct answer for a caller that can no longer name it.
     */
    it('does not record the created id when the save is superseded', STATE_ONLY, async () => {
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: '"1"', created: true, approved: true }));

      proceed();
      // Supersede it before the response is applied.
      switchProgram();
      await fixture.whenStable();

      proceed();
      await fixture.whenStable();

      // No inherited ownership: the new brief must prove its own. What clears it here is
      // `resetToPlanning` emptying the map, NOT the response being superseded — the record now
      // happens before the generation check, because ownership does not expire when the user
      // navigates away. See the queued-save test below for the case that distinction protects.
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), null, null, false);
    });

    /**
     * #4731. A regenerated brief for an event that already has a saved one is refused as
     * `unowned-brief-exists`, and Restore was the only escape — it discards the brief on screen, so
     * its generated callouts and sitelinks could never be saved. Replace reads the stored row's id
     * and ETag and re-saves the brief on screen as its owner, with the ETag as `If-Match`.
     */
    describe('Replace saved brief', () => {
      let loadBrief: Mock;

      function replace(): void {
        (fixture.componentInstance as unknown as { onReplaceSavedBrief(): void }).onReplaceSavedBrief();
      }

      /**
       * Saves run on a promise chain, so a save a guard failed to stop reaches the service only
       * once that chain drains. Every "no save was sent" assertion waits for it, or it passes
       * whether the guard exists or not.
       */
      async function drainSaves(): Promise<void> {
        await (fixture.componentInstance as unknown as { persistChain: Promise<void> }).persistChain;
      }

      function loaded(briefId: string | null, etag: string | null, status: CampaignBriefLoadResult['status'] = 'loaded'): CampaignBriefLoadResult {
        return { status, briefId, brief: null, etag, approved: false } as unknown as CampaignBriefLoadResult;
      }

      beforeEach(async () => {
        TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-a', slug: 'foundation-a', name: 'Foundation A' } as ProjectContext, false);
        TestBed.tick();
        await fixture.whenStable();
        loadBrief = vi.fn();
        vi.spyOn(TestBed.inject(CampaignService), 'loadBrief').mockImplementation(loadBrief);
        persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: '', etag: null, created: false, approved: false, conflict: 'unowned-brief-exists' }));
        proceed();
        await fixture.whenStable();
      });

      it('marks the unowned refusal so the Implementation tab can offer Replace', STATE_ONLY, () => {
        expect(state().status).toBe('error');
        expect(state().conflict).toBe('unowned-brief-exists');
      });

      it('re-saves the brief on screen as the owner of the stored row, with its ETag as the precondition', STATE_ONLY, async () => {
        loadBrief.mockReturnValue(of(loaded('stored-1', 'W/"5"')));
        persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: 'stored-1', etag: 'W/"6"', created: false, approved: true }));

        replace();
        await fixture.whenStable();

        expect(loadBrief).toHaveBeenCalledWith('kubecon-eu-2026', 'foundation-a', 'paid-marketing', '');
        // A validator was read, so no overwrite licence is granted: the save is a real If-Match.
        expect(persistBrief).toHaveBeenLastCalledWith(brief, 'foundation-a', 'stored-1', 'W/"5"', false);
        expect(state()).toMatchObject({ status: 'saved', briefId: 'stored-1', approved: true });
        expect(state().conflict).toBeUndefined();
      });

      it('replaces with fallback permission when the read returned no ETag', STATE_ONLY, async () => {
        loadBrief.mockReturnValue(of(loaded('stored-1', null)));
        persistBrief.mockReturnValueOnce(NEVER);

        replace();
        await fixture.whenStable();

        expect(persistBrief).toHaveBeenLastCalledWith(brief, 'foundation-a', 'stored-1', null, true);
      });

      it('replaces a stored brief this build cannot open', STATE_ONLY, async () => {
        loadBrief.mockReturnValue(of(loaded('stored-1', 'W/"5"', 'unreadable')));
        persistBrief.mockReturnValueOnce(NEVER);

        replace();
        await fixture.whenStable();

        expect(persistBrief).toHaveBeenLastCalledWith(brief, 'foundation-a', 'stored-1', 'W/"5"', false);
      });

      it('creates when the stored brief has gone since the refusal', STATE_ONLY, async () => {
        loadBrief.mockReturnValue(of(loaded(null, null, 'none')));
        persistBrief.mockReturnValueOnce(NEVER);

        replace();
        await fixture.whenStable();

        expect(persistBrief).toHaveBeenLastCalledWith(brief, 'foundation-a', null, null, false);
      });

      it('warns rather than overwrites when the stored brief moved after the read', STATE_ONLY, async () => {
        loadBrief.mockReturnValue(of(loaded('stored-1', 'W/"5"')));
        persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: 'stored-1', etag: null, created: false, approved: false, conflict: 'stale-brief' }));

        replace();
        await fixture.whenStable();

        expect(state().status).toBe('error');
        expect(state().conflict).toBe('stale-brief');
        expect(state().message).toContain('Someone else changed this brief');
      });

      it('keeps Replace on offer when the stored brief cannot be read', STATE_ONLY, async () => {
        loadBrief.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
        const savesBefore = persistBrief.mock.calls.length;
        const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        replace();
        await fixture.whenStable();
        await drainSaves();

        expect(logged).toHaveBeenCalledWith('[campaigns] Failed to read the saved brief to replace it', expect.any(HttpErrorResponse));
        logged.mockRestore();

        expect(persistBrief.mock.calls.length).toBe(savesBefore);
        // '' as the refusal carries it: a null id would re-open Create for a brief still unsaved.
        expect(state()).toMatchObject({ status: 'error', briefId: '', conflict: 'unowned-brief-exists' });
        expect(state().message).toContain('was not replaced');
      });

      it('marks an older Restore offer superseded when the replacing save fails', STATE_ONLY, async () => {
        // The read may see a version newer than the offer Planning cached. If the replace then
        // fails, restoring that offer must not pair its older content and approval with the newer
        // ETag this read recorded -- that would enable Create against content never shown.
        loadBrief.mockReturnValue(of({ ...loaded('stored-1', 'W/"5"'), approved: true }));
        persistBrief.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
        const tokenBefore = refreshToken();

        replace();
        await fixture.whenStable();
        expect(refreshToken(), 'Planning was not told to re-read the row').toBeGreaterThan(tokenBefore);

        const approvalsBefore = approveBrief.mock.calls.length;
        // Read under the SAME token the replace's record took: the case a plain stamp waves through.
        restoreAt(tokenBefore, brief, 'stored-1', true, 'W/"4"');
        await fixture.whenStable();

        expect(state().approved).toBe(false);
        expect(state().message).toContain('changed after the copy shown here was read');
        expect(approveBrief.mock.calls.length).toBe(approvalsBefore);
      });

      it('drops a read answered after a foundation switch but before the page reacts to it', STATE_ONLY, async () => {
        // The switch bumps the counters only once the `activeFoundationSlug` subscription runs, so
        // the read is answered here BEFORE `TestBed.tick()`: only the slug check stands in that gap.
        const read = new Subject<CampaignBriefLoadResult>();
        loadBrief.mockReturnValue(read);
        const savesBefore = persistBrief.mock.calls.length;

        replace();
        TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-b', slug: 'foundation-b', name: 'Foundation B' } as ProjectContext, false);
        read.next(loaded('stored-1', 'W/"5"'));
        TestBed.tick();
        await fixture.whenStable();
        await drainSaves();

        expect(persistBrief.mock.calls.length).toBe(savesBefore);
      });

      it('drops the read when the foundation changes while it is out', STATE_ONLY, async () => {
        const read = new Subject<CampaignBriefLoadResult>();
        loadBrief.mockReturnValue(read);
        const savesBefore = persistBrief.mock.calls.length;

        replace();
        TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-b', slug: 'foundation-b', name: 'Foundation B' } as ProjectContext, false);
        TestBed.tick();
        read.next(loaded('stored-1', 'W/"5"'));
        await fixture.whenStable();
        await drainSaves();

        expect(persistBrief.mock.calls.length).toBe(savesBefore);
      });

      it('does not hand the adopted id to a save queued before the replace', STATE_ONLY, async () => {
        // Saves are serialized and read ownership when they START. A save queued before the replace
        // adopted the stored row must not inherit that id: it was never sent with it. The epoch bump
        // is what refuses it, as a restore's does.
        const first = new Subject<CampaignBriefPersistResult>();
        persistBrief.mockReturnValueOnce(first).mockReturnValueOnce(NEVER).mockReturnValueOnce(NEVER);
        proceed();
        proceed();
        await fixture.whenStable();
        loadBrief.mockReturnValue(of(loaded('stored-1', 'W/"5"')));
        const callsBefore = persistBrief.mock.calls.length;

        // Driven directly: the button is hidden while a save is in flight, so this is the guard
        // behind that, not a path a click reaches.
        replace();
        first.next({ enabled: true, briefId: '', etag: null, created: false, approved: false, conflict: 'unowned-brief-exists' });
        first.complete();
        await fixture.whenStable();

        expect(persistBrief.mock.calls[callsBefore]).toEqual([brief, 'foundation-a', null, null, false]);
      });

      it('cancels the read when the page is destroyed', STATE_ONLY, () => {
        const read = new Subject<CampaignBriefLoadResult>();
        loadBrief.mockReturnValue(read);
        const savesBefore = persistBrief.mock.calls.length;

        replace();
        fixture.destroy();

        expect(read.observed).toBe(false);
        read.next(loaded('stored-1', 'W/"5"'));
        expect(persistBrief.mock.calls.length).toBe(savesBefore);
      });

      it('drops the read when the brief is discarded while it is out', STATE_ONLY, async () => {
        const read = new Subject<CampaignBriefLoadResult>();
        loadBrief.mockReturnValue(read);
        const savesBefore = persistBrief.mock.calls.length;

        replace();
        switchProgram();
        read.next(loaded('stored-1', 'W/"5"'));
        await fixture.whenStable();
        await drainSaves();

        expect(persistBrief.mock.calls.length).toBe(savesBefore);
      });

      it('returns to idle when brief persistence turns out to be off', STATE_ONLY, async () => {
        loadBrief.mockReturnValue(of(loaded(null, null, 'off')));
        const savesBefore = persistBrief.mock.calls.length;

        replace();
        await fixture.whenStable();
        await drainSaves();

        expect(persistBrief.mock.calls.length).toBe(savesBefore);
        expect(state()).toMatchObject({ status: 'off', briefId: null });
      });

      it('treats an ETag omitted mid-rolling-deploy as absent, not as a validator', STATE_ONLY, async () => {
        // An older pod omits the field, so JSON yields `undefined` where the type says null. Left
        // un-normalised it reads as "a validator was sent", withholding the overwrite licence and
        // refusing the very save Replace exists for -- the case `onRestoreSavedBrief` normalises.
        loadBrief.mockReturnValue(of({ status: 'loaded', briefId: 'stored-1', brief: null, approved: false } as unknown as CampaignBriefLoadResult));
        persistBrief.mockReturnValueOnce(NEVER);

        replace();
        await fixture.whenStable();

        expect(persistBrief).toHaveBeenLastCalledWith(brief, 'foundation-a', 'stored-1', null, true);
      });
    });

    /**
     * A superseded save still created a row, and the next save of that event must be able to
     * name it.
     *
     * Saves are serialized, so a second Proceed while the first is in flight queues behind it.
     * When the record sat AFTER the generation check, the first response — discarded for display
     * because the user had moved on — never filed its id, so the queued save captured null, found
     * the row the first one had just created, and was deterministically refused as
     * `unowned-brief-exists`. The user is told their own brief belongs to someone else.
     *
     * Recording before the check is safe because the KEY is `(project, event)`: a late response
     * files its id under the event it actually saved, and cannot reach another event's brief.
     */
    it('reports a stale-brief conflict distinctly from an unowned one', async () => {
      // The two conflicts are different situations. `unowned-brief-exists` means this session may
      // not replace that brief at all; `stale-brief` means it may — another writer just got there
      // first — so the message must say the work is intact and can be saved by proceeding again.
      // Sharing one sentence would tell a user who CAN save that they cannot.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: null, created: false, approved: false, conflict: 'stale-brief' }));

      proceed();
      await fixture.whenStable();

      expect(state().status).toBe('error');
      expect(state().message).toContain('Someone else changed this brief');
      expect(state().message).not.toContain('was not opened here');
      // Must NOT advise a reload, even though this branch adds the read path that would make one
      // work. A stale-brief refusal PROMOTES this session to explicit overwrite permission, so the
      // next Proceed saves the work on screen — telling the user to reload throws that work away
      // to reach a state they can already get to by clicking Proceed again.
      expect(state().message).toContain('Proceed again to save your version');
      expect(state().message).not.toContain('Reload');
    });

    it('keeps ownership of a row it wrote but could not approve', async () => {
      // `superseded-after-write` is the one conflict where the write COMMITTED — only the approval
      // was refused — so the returned id is the row THIS request created, not the row that
      // blocked it. Dropping it left the next Proceed with no brief_id: it finds that row and is
      // permanently refused as unowned, with no read path in this phase to recover.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: null, created: true, approved: false, conflict: 'superseded-after-write' }));
      proceed();
      await fixture.whenStable();
      expect(state().status).toBe('error');

      persistBrief.mockReturnValue(NEVER);
      proceed();
      await fixture.whenStable();

      // The id is kept, and the retry carries fallback permission. The user has now been SHOWN
      // that the write may have been overtaken, which is what converts the unknown validator into
      // a decision — without it they are blocked once on the very save the warning invites.
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'b-1', null, true);
    });

    it('does not confirm a write that was superseded before it could be approved', async () => {
      // The write landed, but the approval's If-Match was refused: another writer replaced the
      // brief in between, so the row may no longer hold this content. The component renders any
      // non-conflict result as "Brief saved.", which would confirm durability for content that is
      // gone — the one thing this banner must never say.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: null, created: true, approved: false, conflict: 'superseded-after-write' }));

      proceed();
      await fixture.whenStable();

      expect(state().status).toBe('error');
      // Nor does it say "not saved": the write DID land. The honest message is that it may have
      // been overtaken since.
      expect(state().message).toContain('saved, but someone else changed it');
      // Must also say what proceeding does: this conflict now promotes the session to overwrite,
      // so a message that only reports the collision leaves the user authorising a replacement
      // they were never told about.
      expect(state().message).toContain('Proceed again to replace theirs');
    });

    it('does not hand a queued save a clean slate when the 412 was never shown', async () => {
      // A is refused with a 412 while B is already queued. Clearing the validator early would
      // suppress A's warning as superseded AND hand B an empty slate — the server would then fall
      // back to its own fresh read and B would overwrite the competing writer with nobody told.
      // The permission to overwrite must not outrun the warning that earns it.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: '"1"', created: true, approved: true }));
      proceed();
      await fixture.whenStable();

      // A leaves, and is refused — but only after B has queued behind it.
      const a = new Subject<CampaignBriefPersistResult>();
      persistBrief.mockReturnValue(a);
      proceed();
      await fixture.whenStable();

      persistBrief.mockReturnValue(NEVER);
      proceed();
      await fixture.whenStable();

      a.next({ enabled: true, briefId: 'b-1', etag: null, created: false, approved: false, conflict: 'stale-brief' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // B must still carry the last-seen validator, so the server can refuse it too. A repeated
      // refusal is recoverable and visible; a silent overwrite of someone else's work is neither.
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'b-1', '"1"', false);
    });

    it('says what proceeding again will do, not just that it can be retried', async () => {
      // The warning PROMOTES this session to explicit overwrite permission, so the next Proceed
      // replaces whatever is stored -- including a version this page has never seen. A message
      // that says only "try again" makes the user authorise that by clicking a button whose
      // label implies a retry.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: null, created: false, approved: false, conflict: 'unverified-validator' }));

      proceed();
      await fixture.whenStable();

      expect(state().status).toBe('error');
      expect(state().message).toContain('replace whatever is currently saved');
    });

    it('lets a retry through after an unverified-validator refusal', async () => {
      // The refusal exists because nobody had been warned. The banner has now warned them, so the
      // retry is a decision — without promoting the marker, every retry re-sends `'unknown'` and
      // is refused identically while the banner says trying again will work.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: null, created: true, approved: false }));
      proceed();
      await fixture.whenStable();
      // The write returned no validator: recorded as unknown, so the next save carries no
      // fallback permission.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: null, created: false, approved: false, conflict: 'unverified-validator' }));
      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'b-1', null, false);
      expect(state().status).toBe('error');

      // Warned. The retry may now fall back.
      persistBrief.mockReturnValue(NEVER);
      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'b-1', null, true);
    });

    it('lets a retry through after a stale-brief conflict instead of dead-ending', async () => {
      // First save records id + ETag.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: '"1"', created: true, approved: true }));
      proceed();
      await fixture.whenStable();

      // Another writer moves the row: the save is refused with the stale validator.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: null, created: false, approved: false, conflict: 'stale-brief' }));
      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'b-1', '"1"', false);

      // The retry must NOT re-send the rejected ETag. Keeping it would make every attempt fail
      // identically — a permanent dead end for a save this session is entitled to make. Ownership
      // is untouched, because the 412 disputed the version, not who owns the row.
      persistBrief.mockReturnValue(NEVER);
      proceed();
      await fixture.whenStable();
      // `true` — this is the EXPLICIT overwrite path. The user was shown the stale-brief warning
      // and proceeded, so the absent validator is a decision rather than an unknown, and the
      // server may fall back to the one it reads. An unwarned null must NOT reach this state.
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'b-1', null, true);
    });

    it('treats a padded slug as a different brief from the unpadded one', async () => {
      // `deriveEventSlug` trims only to TEST emptiness — it returns the untrimmed original, and
      // that exact string goes on the wire as `event_slug`, which campaign-service compares
      // exactly. So `' kubecon-eu-2026 '` and `'kubecon-eu-2026'` are two separate stored briefs.
      // Keying ownership on a trimmed slug collapsed them into one entry, and after the second
      // replaced the first, saving the other sent the wrong brief_id and was refused as unowned.
      const padded = { eventDetails: { slug: ' kubecon-eu-2026 ' }, selectedPlatforms: ['google-ads'] } as unknown as CampaignBriefOutput;

      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-unpadded', etag: '"1"', created: true, approved: true }));
      proceed();
      await fixture.whenStable();

      persistBrief.mockReturnValue(NEVER);
      proceed(padded);
      await fixture.whenStable();

      // Must NOT inherit the unpadded brief's id: it names a different row.
      expect(persistBrief).toHaveBeenLastCalledWith(padded, expect.anything(), null, null, false);
    });

    it('keeps an id recorded by a save that lands after a foundation switch', STATE_ONLY, async () => {
      // The switch clears the BANNER but deliberately keeps `knownBriefIds` — the map is keyed by
      // foundation, so each one's ids stay valid for it. An in-flight save that finishes after
      // the switch must therefore still record: it created a real row under TLF, and dropping its
      // id means returning to TLF and proceeding again is refused as unowned for a row this very
      // session made.
      const first = new Subject<CampaignBriefPersistResult>();
      persistBrief.mockReturnValue(first);
      proceed();
      await fixture.whenStable();

      selectFoundation('cncf');
      await fixture.whenStable();
      first.next({ enabled: true, briefId: 'tlf-1', etag: 'W/"1"', created: true, approved: true });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Back to TLF and proceed the same event again: the id from that late response must be
      // there to name the row it created.
      selectFoundation('tlf');
      await fixture.whenStable();
      persistBrief.mockReturnValue(NEVER);
      proceed();
      await fixture.whenStable();

      expect(persistBrief).toHaveBeenLastCalledWith(brief, 'tlf', 'tlf-1', 'W/"1"', false);
    });

    it('hands a queued save the id its predecessor created for the same event', async () => {
      const first = new Subject<CampaignBriefPersistResult>();
      persistBrief.mockReturnValue(first);
      proceed();
      await fixture.whenStable();

      // Proceed again for the SAME event while the first request is still open. The second save
      // queues; its ownership must be resolved when it STARTS, not now.
      persistBrief.mockReturnValue(NEVER);
      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenCalledTimes(1);

      first.next({ enabled: true, briefId: 'b-1', etag: 'W/"1"', created: true, approved: true });
      // A macrotask, not `whenStable`: the queue hands over across microtasks the fixture's
      // stability check does not necessarily drain.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(persistBrief).toHaveBeenCalledTimes(2);
      // The ETag rides with the id: it is this caller's last-seen version, and sending it is
      // what makes the server's If-Match a real precondition rather than one re-derived from
      // the save's own read.
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'b-1', 'W/"1"', false);
    });

    /**
     * ...and a program switch drops it. The next brief is a different event, so inheriting the
     * previous one's id would let it claim ownership of a row it has nothing to do with.
     */
    it('keeps the brief id when the program changes', async () => {
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: '"1"', created: true, approved: true }));
      proceed();
      await fixture.whenStable();

      switchProgram();
      proceed();
      await fixture.whenStable();

      // The id SURVIVES a program switch. resetToPlanning discards the brief on screen, but the
      // row it created upstream still exists — dropping the id would refuse the next Proceed for
      // that event as unowned, with no read path in this phase to recover. The keys are
      // (project, event) so nothing else can inherit it, and ownershipGeneration already stops a
      // late response re-filing after the discard.
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'b-1', '"1"', false);
    });

    it('files the brief under the foundation selected at save time', async () => {
      persistBrief.mockReturnValue(NEVER);
      selectFoundation('cncf');
      await fixture.whenStable();

      proceed();
      // The request now leaves on the save queue rather than inside `proceed`, so the assertion
      // has to let the queue turn over. The slug is still the one selected at Proceed time.
      await fixture.whenStable();

      // The third argument is the known brief id, null here: this brief was generated rather
      // than restored, so the page can claim no ownership and the save must CREATE. Asserted
      // rather than relaxed to `expect.anything()` — a generated brief silently carrying an id
      // would let it replace a stored brief nobody looked at (LFXV2-3200).
      // The third argument is the known brief id, null here: nothing has been saved yet in this
      // session, so the page can claim no ownership and the save must CREATE.
      expect(persistBrief).toHaveBeenCalledWith(brief, 'cncf', null, null, false);
    });

    it("never replays one foundation's brief id against another foundation", async () => {
      // Save under TLF: this session now owns TLF's row and records its id.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'tlf-1', etag: '"1"', created: true, approved: true }));
      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(brief, 'tlf', null, null, false);

      // Switch to CNCF and save. The brief survives the switch by design, but the OWNERSHIP does
      // not: `tlf-1` names a row in a different project, so this must create rather than replace.
      selectFoundation('cncf');
      await fixture.whenStable();
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'cncf-1', etag: '"1"', created: true, approved: true }));
      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(brief, 'cncf', null, null, false);

      // Back to TLF. A single scalar would now hold `cncf-1` and send it here, and the server
      // would refuse an update against a row this session genuinely owns. The id TLF issued is
      // the only one that may be replayed to TLF.
      selectFoundation('tlf');
      await fixture.whenStable();
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'tlf-1', etag: '"2"', created: false, approved: true }));
      proceed();
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(brief, 'tlf', 'tlf-1', '"1"', false);
    });

    /**
     * The campaign list is per-(foundation, brief), and Optimize stays mounted across a switch.
     *
     * Same defect class as the email picker's: a signal written by a load and cleared by nothing,
     * on a component a foundation switch does not re-create. The consequence here is worse than a
     * stale list — `projectSlug` and `briefId` are the address every row's pause/resume is sent
     * to, and after a switch those name the NEW context while the rows describe the old one.
     */
    describe('the Optimize campaign list', () => {
      function campaigns(): CampaignIndexDoc[] | null {
        return (fixture.componentInstance as unknown as { briefCampaigns(): CampaignIndexDoc[] | null }).briefCampaigns();
      }

      function unavailable(): boolean {
        return (fixture.componentInstance as unknown as { briefCampaignsUnavailable(): boolean }).briefCampaignsUnavailable();
      }

      function load(): void {
        (fixture.componentInstance as unknown as { loadBriefCampaigns(): void }).loadBriefCampaigns();
      }

      const indexed = (over: Partial<CampaignIndexDoc> = {}): CampaignIndexDoc =>
        ({
          id: 'c-1',
          project_id: 'tlf',
          brief_id: 'brief-9',
          platform: 'google-ads',
          campaign_name: 'KubeCon EU',
          status: 'created',
          version: 1,
          etag: '"1"',
          ...over,
        }) as CampaignIndexDoc;

      /**
       * Enter Optimize the way the tab bar does — `selectTab`, which is what calls
       * `loadBriefCampaigns` on entry. Driving `loadBriefCampaigns` directly would skip the
       * transition and, more importantly, never render the panel these assertions read.
       */
      function openOptimize(): void {
        (fixture.componentInstance as unknown as { selectTab(t: CampaignTab, owner: CampaignDeliveryType): void }).selectTab('optimization', 'paid-marketing');
        fixture.detectChanges();
      }

      /** The Optimize panel's rendered text — what the operator can actually read. */
      function optimizeText(): string {
        return (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-optimization-panel"]')?.textContent ?? '';
      }

      /**
       * The campaign ids that currently have a LIVE toggle button. The stale-render bug is only
       * expensive because these exist: each one posts its id against whatever `briefId` the parent
       * is binding at the time.
       */
      function toggleButtonIds(): string[] {
        return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid^="optimization-campaign-toggle-"]')).map((el) =>
          (el.getAttribute('data-testid') ?? '').replace('optimization-campaign-toggle-', '')
        );
      }

      /** Put a real brief id on the component so `loadBriefCampaigns` gets past its own guard. */
      async function withSavedBrief(): Promise<void> {
        persistBrief.mockReturnValue(of({ enabled: true, briefId: 'brief-9', etag: '"1"', created: true, approved: true }));
        proceed();
        await fixture.whenStable();
      }

      /**
       * The first-create path, which is the one that was broken.
       *
       * `onProceedToImplementation` sets the tab DIRECTLY rather than through `selectTab`, so the
       * Optimize-entry load never ran and the capability stayed `null` — the Implementation tab
       * then withheld Demand Gen on every deployment, including ones that support it.
       *
       * Asserted through the PARENT rather than by setting the tab's input, because the input
       * always worked; nothing populated it. A test that sets `demandGenEnabled` by hand passes
       * against exactly the bug this covers.
       */
      it('loads the demand-gen capability on a first-create Planning to Implementation flow', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: false,
            demandGenEnabled: true,
            googleChannelsEnabled: false,
            googleCreativeEnabled: false,
            redditCreativeEnabled: false,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );

        await withSavedBrief();
        await fixture.whenStable();

        // The real value, not `null`: the tab renders the control only on an explicit `true`.
        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);
      });

      /**
       * The disabled-persist path deliberately does NOT dispatch a capability read.
       *
       * It is tempting to send one: `result.briefId` is `''` there, and the service really does
       * return `demandGenEnabled` for a blank brief id. But the HTTP path never reaches that
       * branch — `campaign.controller.ts` 400s on a blank `brief_id` first, which
       * `campaign.controller.spec.ts` pins. Dispatching would spend a request per Implementation
       * entry to receive an error, land in the error arm, and set the capability to `null`; the
       * control stays hidden either way, with a spurious 400 added.
       *
       * So the assertion is that NOTHING was sent, and the capability stays unknown. Fixing this
       * properly needs a capability read that does not require a brief id at all.
       */
      it('sends no capability request when brief persistence is disabled', STATE_ONLY, async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: true,
            statusToggleEnabled: false,
            demandGenEnabled: true,
            googleChannelsEnabled: false,
            googleCreativeEnabled: false,
            redditCreativeEnabled: false,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );

        persistBrief.mockReturnValue(of({ enabled: false, briefId: '', etag: null, created: false, approved: false }));
        proceed();
        await fixture.whenStable();

        expect(list).not.toHaveBeenCalled();
        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBeNull();
      });

      /**
       * A failed read leaves the capability `null`, never `false` — because the tab's draft restore
       * clears a saved Demand Gen selection on an explicit `false`, and a failed read has
       * established nothing.
       */
      it('leaves the capability unknown when the capability read fails', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(throwError(() => new Error('query service down')));

        await withSavedBrief();
        await fixture.whenStable();

        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBeNull();
      });

      /**
       * The google-channels capability rides the SAME response and the same six set-sites, and is asserted
       * with the OPPOSITE value to the demand-gen flag on the same payload.
       *
       * That opposition is the test. The two capabilities are derived by inverse rules upstream —
       * `demandGenEnabled` is true while the create cutover is dark, `googleChannelsEnabled` is
       * false there — so a component that mirrored one signal onto the other, or read the wrong
       * key, would pass every demand-gen test above and fail here.
       */
      it('loads the google-channels capability alongside the demand-gen one', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: false,
            demandGenEnabled: false,
            googleChannelsEnabled: true,
            googleCreativeEnabled: true,
            redditCreativeEnabled: true,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );

        await withSavedBrief();
        await fixture.whenStable();

        const c = fixture.componentInstance as unknown as {
          briefCampaignsDemandGenEnabled(): boolean | null;
          briefCampaignsGoogleChannelsEnabled(): boolean | null;
        };
        expect(c.briefCampaignsGoogleChannelsEnabled()).toBe(true);
        expect(c.briefCampaignsDemandGenEnabled()).toBe(false);
      });

      /**
       * The Bidding capability (#3299) rides on the same read, and is asserted with every OTHER
       * capability set the opposite way, so a component that read the wrong key would fail here.
       * A failed read leaves it `null`, which the tab treats as off.
       */
      it('loads the bidding capability from its own key', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
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
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: true,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );

        await withSavedBrief();
        await fixture.whenStable();

        const c = fixture.componentInstance as unknown as { briefCampaignsBiddingEnabled(): boolean | null; briefCampaignsCapabilityRead(): string };
        expect(c.briefCampaignsBiddingEnabled()).toBe(true);
        expect(c.briefCampaignsCapabilityRead()).toBe('ready');
      });

      /**
       * The Microsoft flight-date capability rides on the same read, asserted the same way: every
       * other capability set the opposite way, so a component that read the wrong key would fail.
       */
      it('loads the microsoft schedule capability from its own key', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
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
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: true,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: true,
            googleGeoSearchEnabled: false,
          })
        );

        await withSavedBrief();
        await fixture.whenStable();

        const c = fixture.componentInstance as unknown as {
          briefCampaignsMicrosoftScheduleEnabled(): boolean | null;
          briefCampaignsBiddingEnabled(): boolean | null;
          briefCampaignsGoogleAudienceSegmentsEnabled(): boolean | null;
        };
        expect(c.briefCampaignsMicrosoftScheduleEnabled()).toBe(true);
        expect(c.briefCampaignsBiddingEnabled()).toBe(false);
        // Per caller, read from the same answer: a root caller's yes reaches the Implement tab.
        expect(c.briefCampaignsGoogleAudienceSegmentsEnabled()).toBe(true);
      });

      /** The LinkedIn upload capability, read from its own key on the same terms as the one above. */
      it('loads the linkedin upload capability from its own key, and leaves it unknown when the read fails', STATE_ONLY, async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
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
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: true,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            googleAudienceSegmentsEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );

        await withSavedBrief();
        await fixture.whenStable();

        const c = fixture.componentInstance as unknown as {
          briefCampaignsLinkedInAssetUploadEnabled(): boolean | null;
          briefCampaignsMetaAssetUploadEnabled(): boolean | null;
          retryCreateCapabilities(): void;
        };
        expect(c.briefCampaignsLinkedInAssetUploadEnabled()).toBe(true);
        expect(c.briefCampaignsMetaAssetUploadEnabled()).toBe(false);

        list.mockReturnValue(throwError(() => new Error('query service down')));
        c.retryCreateCapabilities();
        await fixture.whenStable();
        expect(c.briefCampaignsLinkedInAssetUploadEnabled()).toBeNull();
      });

      /** The LinkedIn targeting-edit capability (#5546), read from its own key on the same terms as the one above. */
      it('loads the linkedin targeting-edit capability from its own key, and leaves it unknown when the read fails', STATE_ONLY, async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
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
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: true,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            googleAudienceSegmentsEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );

        await withSavedBrief();
        await fixture.whenStable();

        const c = fixture.componentInstance as unknown as {
          briefCampaignsLinkedInTargetingEditEnabled(): boolean | null;
          briefCampaignsLinkedInAssetUploadEnabled(): boolean | null;
          retryCreateCapabilities(): void;
        };
        expect(c.briefCampaignsLinkedInTargetingEditEnabled()).toBe(true);
        expect(c.briefCampaignsLinkedInAssetUploadEnabled()).toBe(false);

        list.mockReturnValue(throwError(() => new Error('query service down')));
        c.retryCreateCapabilities();
        await fixture.whenStable();
        expect(c.briefCampaignsLinkedInTargetingEditEnabled()).toBeNull();
      });

      /** The Microsoft upload capability, read from its own key on the same terms as the one above. */
      it('loads the microsoft upload capability from its own key, and leaves it unknown when the read fails', STATE_ONLY, async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
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
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: true,
            googleAudienceSegmentsEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );

        await withSavedBrief();
        await fixture.whenStable();

        const c = fixture.componentInstance as unknown as {
          briefCampaignsMicrosoftAssetUploadEnabled(): boolean | null;
          briefCampaignsMetaAssetUploadEnabled(): boolean | null;
          retryCreateCapabilities(): void;
        };
        expect(c.briefCampaignsMicrosoftAssetUploadEnabled()).toBe(true);
        expect(c.briefCampaignsMetaAssetUploadEnabled()).toBe(false);

        list.mockReturnValue(throwError(() => new Error('query service down')));
        c.retryCreateCapabilities();
        await fixture.whenStable();
        expect(c.briefCampaignsMicrosoftAssetUploadEnabled()).toBeNull();
      });

      it('marks the bidding read pending only while a read is out, and unknown when none is', async () => {
        const c = fixture.componentInstance as unknown as { briefCampaignsCapabilityRead(): string };
        // Nothing has been asked yet: unknown, not "checking".
        expect(c.briefCampaignsCapabilityRead()).toBe('unknown');

        const inFlight = new Subject<CampaignListResult>();
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(inFlight);
        await withSavedBrief();

        expect(c.briefCampaignsCapabilityRead()).toBe('pending');
      });

      it('leaves the bidding capability unknown when the capability read fails', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(throwError(() => new Error('query service down')));

        await withSavedBrief();
        await fixture.whenStable();

        const c = fixture.componentInstance as unknown as {
          briefCampaignsBiddingEnabled(): boolean | null;
          briefCampaignsMicrosoftScheduleEnabled(): boolean | null;
          briefCampaignsGoogleAudienceSegmentsEnabled(): boolean | null;
          briefCampaignsCapabilityRead(): string;
        };
        expect(c.briefCampaignsBiddingEnabled()).toBeNull();
        // Unknown too, which the tab treats as off: no Microsoft dates, and the warning stays.
        expect(c.briefCampaignsMicrosoftScheduleEnabled()).toBeNull();
        // Unknown, so the tab hides the audience section and blocks a draft that holds segments.
        expect(c.briefCampaignsGoogleAudienceSegmentsEnabled()).toBeNull();
        // `failed`, not `pending`: the tab offers a Retry for a retained Manual choice rather than
        // saying it is still checking.
        expect(c.briefCampaignsCapabilityRead()).toBe('failed');
      });

      /**
       * `null`, never `false`, for the same reason the demand-gen sibling above insists on it: the
       * tab's draft restore CLEARS a saved selection on an explicit `false`, and a failed read has
       * established nothing. Collapsing the two here would destroy a user's saved channel
       * selection because a query service was briefly down.
       */
      it('leaves the google-channels capability unknown when the capability read fails', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(throwError(() => new Error('query service down')));

        await withSavedBrief();
        await fixture.whenStable();

        expect(
          (fixture.componentInstance as unknown as { briefCampaignsGoogleChannelsEnabled(): boolean | null }).briefCampaignsGoogleChannelsEnabled()
        ).toBeNull();
      });

      /**
       * The return-entry trigger — the second of the two triggers at lines 947-949.
       *
       * A first-create persist calls `loadCreateCapabilitiesFor` on success, but if that read
       * fails the user has no way to retry except by leaving and re-entering the tab. That
       * re-entry goes through `selectTab`, which is the path under test here. Removing the
       * `tab === 'implementation'` branch from `selectTab` leaves the tests above green — the
       * persist-success path still fires its own read — but this case stays broken.
       */
      it('retries the capability read when the user re-enters Implementation via the tab bar', STATE_ONLY, async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(throwError(() => new Error('query service down')));

        // First create: persist succeeds, capability read fails.
        await withSavedBrief();
        await fixture.whenStable();
        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBeNull();

        // User navigates away and comes back via the tab bar.
        list.mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: false,
            demandGenEnabled: true,
            googleChannelsEnabled: false,
            googleCreativeEnabled: false,
            redditCreativeEnabled: false,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );
        (fixture.componentInstance as unknown as { selectTab(t: CampaignTab, owner: CampaignDeliveryType): void }).selectTab('planning', 'paid-marketing');
        (fixture.componentInstance as unknown as { selectTab(t: CampaignTab, owner: CampaignDeliveryType): void }).selectTab(
          'implementation',
          'paid-marketing'
        );
        await fixture.whenStable();

        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);
      });

      /**
       * An Optimize visit landing on top of a capability read must not lose the answer.
       *
       * The guard shared Optimize's list counter at first, which `loadBriefCampaigns` increments
       * on every entry — so an ordinary Optimize click discarded an in-flight capability response
       * and left the control hidden.
       *
       * Both mocked responses return `true`. What is asserted is that the answer SURVIVES the
       * overlap — whichever of the two requests delivers it first, a `true` lands on the signal
       * rather than being overwritten to `null` by the later arrival.
       *
       * NOT that the two reads must agree. They can disagree: during a rolling deployment
       * identical `/list` calls land on pods with different flag values, which is the pod-local
       * hazard recorded on #1885. This pins ordering, never agreement.
       */
      it('keeps a capability answer when an Optimize load races it', STATE_ONLY, async () => {
        const capability = new Subject<CampaignListResult>();
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(capability.asObservable());

        await withSavedBrief();

        // Optimize entry lands on top of the still-open capability request.
        list.mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: false,
            demandGenEnabled: true,
            googleChannelsEnabled: false,
            googleCreativeEnabled: false,
            redditCreativeEnabled: false,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );
        load();
        await fixture.whenStable();

        // ...and the original request answers only now.
        capability.next({
          campaigns: [],
          possiblyStale: false,
          statusToggleEnabled: false,
          demandGenEnabled: true,
          googleChannelsEnabled: false,
          googleCreativeEnabled: false,
          redditCreativeEnabled: false,
          redditAssetUploadEnabled: false,
          redditConversionPixelEnabled: false,
          redditConversionEventEnabled: false,
          googleAssetUploadEnabled: false,
          metaCreativeEnabled: false,
          metaAssetUploadEnabled: false,
          linkedInAssetUploadEnabled: false,
          linkedInTargetingEditEnabled: false,
          linkedInAccountSelectionEnabled: false,
          linkedInDailyCapEnabled: false,
          linkedInVariantCopyEnabled: false,
          linkedInCallToActionEnabled: false,
          linkedInTextAdsEnabled: false,
          linkedInVideoAdsEnabled: false,
          linkedInTargetCostEnabled: false,
          linkedInTargetingEnabled: false,
          linkedInConversionsEnabled: false,
          linkedInLeadGenEnabled: false,
          linkedInCarouselEnabled: false,
          linkedInDocumentEnabled: false,
          microsoftAssetUploadEnabled: false,
          biddingEnabled: false,
          microsoftScheduleEnabled: false,
          twitterCreateEnabled: false,
          metaInstagramDsaEnabled: false,
          googleAudienceSegmentsEnabled: false,
          googleGeoSearchEnabled: false,
        });
        capability.complete();
        await fixture.whenStable();

        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);
      });

      /**
       * The reverse race, and the one a single-reader token cannot close: `loadBriefCampaigns`
       * writes this signal too. An older list read failing AFTER a newer capability read
       * succeeded must not reset a live answer to `null` — a failure has established nothing.
       */
      it('does not let an older failing list read wipe a newer capability answer', STATE_ONLY, async () => {
        const staleList = new Subject<CampaignListResult>();
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(staleList.asObservable());

        await withSavedBrief();
        load();
        await fixture.whenStable();

        // A newer capability read answers while that list request is still open.
        list.mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: false,
            demandGenEnabled: true,
            googleChannelsEnabled: false,
            googleCreativeEnabled: false,
            redditCreativeEnabled: false,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );
        (fixture.componentInstance as unknown as { loadCreateCapabilities(): void }).loadCreateCapabilities();
        await fixture.whenStable();
        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);

        // The superseded list read now fails. It must not touch the newer answer.
        staleList.error(new Error('query service down'));
        await fixture.whenStable();

        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);
      });

      /**
       * The RESTORE path, which knows its brief id and still missed the capability.
       *
       * `onProceedToImplementation` originally asked for the capability before the
       * `alreadyPersisted` branch wrote the restored id onto `briefPersistence`, so the read saw
       * the PREVIOUS id and guarded itself out. Unlike a first create there is no persist to
       * follow, so nothing retried and the capability stayed unknown for the whole session.
       */
      it('loads the capability for a brief restored from campaign-service', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: false,
            demandGenEnabled: true,
            googleChannelsEnabled: false,
            googleCreativeEnabled: false,
            redditCreativeEnabled: false,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );

        restore(brief, 'brief-9', true);
        await fixture.whenStable();

        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);
      });

      /**
       * A read that starts failing must not leave the previous answer standing.
       *
       * The error arm wrote nothing at first, which reads as "left null" only on the FIRST read.
       * Once a successful read had set `true`, a later failure kept offering the control on the
       * strength of a read that no longer succeeds. Asserts the value, not merely that the arm ran.
       */
      it('clears a previously known capability when a later read fails', STATE_ONLY, async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: false,
            demandGenEnabled: true,
            googleChannelsEnabled: false,
            googleCreativeEnabled: false,
            redditCreativeEnabled: false,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );

        await withSavedBrief();
        await fixture.whenStable();
        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);

        list.mockReturnValue(throwError(() => new Error('query service down')));
        (fixture.componentInstance as unknown as { loadCreateCapabilities(): void }).loadCreateCapabilities();
        await fixture.whenStable();

        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBeNull();
      });

      /**
       * Out-of-order completion WITHIN one foundation — the case a foundation-only guard misses.
       *
       * The first version of this guard shared Optimize's counter and dropped valid responses.
       * The second guarded on the foundation alone, which drops nothing valid but imposes no
       * ORDER: two Implementation entries in the same foundation can complete in either order,
       * and an older request failing after a newer one succeeded would wipe a live `true` back
       * to `null`, hiding Demand Gen on a deployment that had just confirmed it.
       */
      it('ignores an older capability read that fails after a newer one succeeded', STATE_ONLY, async () => {
        const older = new Subject<CampaignListResult>();
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(older.asObservable());

        await withSavedBrief();

        // A second Implementation entry supersedes the first, and answers first.
        list.mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: false,
            demandGenEnabled: true,
            googleChannelsEnabled: false,
            googleCreativeEnabled: false,
            redditCreativeEnabled: false,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );
        (fixture.componentInstance as unknown as { loadCreateCapabilities(): void }).loadCreateCapabilities();
        await fixture.whenStable();
        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);

        // The superseded request now fails. It must not touch the newer answer.
        older.error(new Error('query service down'));
        await fixture.whenStable();

        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);
      });

      /**
       * The half the generation counter cannot cover.
       *
       * A foundation switch clears the capability but dispatches no capability read of its own,
       * so it never bumps `capabilityGeneration`. An in-flight read from the previous
       * foundation therefore still looks current BY GENERATION, and only the slug check stops it
       * writing foundation A's answer onto foundation B — a stale answer for a slug the user
       * is no longer viewing.
       */
      it('drops a capability answer that arrives after the foundation changed', async () => {
        const pending = new Subject<CampaignListResult>();
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(pending.asObservable());

        await withSavedBrief();

        selectFoundation('cncf');
        await fixture.whenStable();

        // The previous foundation's read answers only now.
        pending.next({
          campaigns: [],
          possiblyStale: false,
          statusToggleEnabled: false,
          demandGenEnabled: true,
          googleChannelsEnabled: false,
          googleCreativeEnabled: false,
          redditCreativeEnabled: false,
          redditAssetUploadEnabled: false,
          redditConversionPixelEnabled: false,
          redditConversionEventEnabled: false,
          googleAssetUploadEnabled: false,
          metaCreativeEnabled: false,
          metaAssetUploadEnabled: false,
          linkedInAssetUploadEnabled: false,
          linkedInTargetingEditEnabled: false,
          linkedInAccountSelectionEnabled: false,
          linkedInDailyCapEnabled: false,
          linkedInVariantCopyEnabled: false,
          linkedInCallToActionEnabled: false,
          linkedInTextAdsEnabled: false,
          linkedInVideoAdsEnabled: false,
          linkedInTargetCostEnabled: false,
          linkedInTargetingEnabled: false,
          linkedInConversionsEnabled: false,
          linkedInLeadGenEnabled: false,
          linkedInCarouselEnabled: false,
          linkedInDocumentEnabled: false,
          microsoftAssetUploadEnabled: false,
          biddingEnabled: false,
          microsoftScheduleEnabled: false,
          twitterCreateEnabled: false,
          metaInstagramDsaEnabled: false,
          googleAudienceSegmentsEnabled: false,
          googleGeoSearchEnabled: false,
        });
        pending.complete();
        await fixture.whenStable();

        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBeNull();
      });

      /**
       * A failure must not take the success ordering with it.
       *
       * Stamping the shared token on the ERROR arm looked symmetrical and was wrong: two reads
       * dispatched together, the first failing, would advance the token and make the second's
       * valid answer fail its own write check — a failure suppressing a success, which is the one
       * thing the ordering exists to prevent.
       */
      it('lets a success land after an earlier read has already failed', STATE_ONLY, async () => {
        const first = new Subject<CampaignListResult>();
        const second = new Subject<CampaignListResult>();
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(first.asObservable());

        await withSavedBrief();

        // A second read dispatches while the first is still open.
        list.mockReturnValue(second.asObservable());
        (fixture.componentInstance as unknown as { loadCreateCapabilities(): void }).loadCreateCapabilities();
        await fixture.whenStable();

        // The FIRST fails...
        first.error(new Error('query service down'));
        await fixture.whenStable();

        // ...and the second still succeeds. Its answer must land.
        second.next({
          campaigns: [],
          possiblyStale: false,
          statusToggleEnabled: false,
          demandGenEnabled: true,
          googleChannelsEnabled: false,
          googleCreativeEnabled: false,
          redditCreativeEnabled: false,
          redditAssetUploadEnabled: false,
          redditConversionPixelEnabled: false,
          redditConversionEventEnabled: false,
          googleAssetUploadEnabled: false,
          metaCreativeEnabled: false,
          metaAssetUploadEnabled: false,
          linkedInAssetUploadEnabled: false,
          linkedInTargetingEditEnabled: false,
          linkedInAccountSelectionEnabled: false,
          linkedInDailyCapEnabled: false,
          linkedInVariantCopyEnabled: false,
          linkedInCallToActionEnabled: false,
          linkedInTextAdsEnabled: false,
          linkedInVideoAdsEnabled: false,
          linkedInTargetCostEnabled: false,
          linkedInTargetingEnabled: false,
          linkedInConversionsEnabled: false,
          linkedInLeadGenEnabled: false,
          linkedInCarouselEnabled: false,
          linkedInDocumentEnabled: false,
          microsoftAssetUploadEnabled: false,
          biddingEnabled: false,
          microsoftScheduleEnabled: false,
          twitterCreateEnabled: false,
          metaInstagramDsaEnabled: false,
          googleAudienceSegmentsEnabled: false,
          googleGeoSearchEnabled: false,
        });
        second.complete();
        await fixture.whenStable();

        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);
      });

      /**
       * The capability is a DEPLOYMENT fact, so re-entering Implementation must not re-read it.
       *
       * Without the `null` guard this spent a full `listBriefCampaigns` round trip per tab entry
       * to learn the same boolean. Asserted as a CALL COUNT rather than a value, because the
       * value is identical either way — only the number of requests distinguishes them.
       */
      it('does not refetch the capability once it is known', STATE_ONLY, async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: false,
            demandGenEnabled: true,
            googleChannelsEnabled: false,
            googleCreativeEnabled: false,
            redditCreativeEnabled: false,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );

        await withSavedBrief();
        await fixture.whenStable();
        const afterFirst = list.mock.calls.length;

        // Leave and re-enter Implementation: the answer is already known.
        (fixture.componentInstance as unknown as { selectTab(t: string, o: string): void }).selectTab('planning', 'paid-marketing');
        (fixture.componentInstance as unknown as { selectTab(t: string, o: string): void }).selectTab('implementation', 'paid-marketing');
        await fixture.whenStable();

        // One more read: the Implement tab's list-only re-read of the campaigns already created
        // (#4983). The capability is neither cleared nor read again by it.
        expect(list.mock.calls.length).toBe(afterFirst + 1);
        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);
        expect((fixture.componentInstance as unknown as { briefCampaignsCapabilityRead(): string }).briefCampaignsCapabilityRead()).toBe('ready');
      });

      /**
       * #4983. The Implement tab's list read (its Retry, and after a create settles) reports a failure
       * as unavailable for the panel, and leaves the capabilities that tab gates its controls on alone.
       */
      /** #4983: a switch invalidates the pending read, so it must also end the "checking" state itself. */
      it("ends the Implement list's checking state when the foundation switches during a read", async () => {
        persistBrief.mockReturnValue(of({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: true }));
        const pending = new Subject<CampaignListResult>();
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(pending);
        proceed();
        await fixture.whenStable();
        const loading = (): boolean => (fixture.componentInstance as unknown as { briefCampaignsLoading(): boolean }).briefCampaignsLoading();
        expect(loading()).toBe(true);

        selectFoundation('cncf');
        await fixture.whenStable();

        expect(loading(), 'the panel would say "Checking…" for good').toBe(false);
      });

      it('marks the Implement list unavailable on a failed re-read without blanking the capability', STATE_ONLY, async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({
            enabled: true,
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: false,
            demandGenEnabled: true,
            googleChannelsEnabled: false,
            googleCreativeEnabled: false,
            redditCreativeEnabled: false,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );
        await withSavedBrief();
        await fixture.whenStable();

        list.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
        (fixture.componentInstance as unknown as { refreshImplementCampaigns(): void }).refreshImplementCampaigns();
        await fixture.whenStable();

        const page = fixture.componentInstance as unknown as {
          briefCampaignsUnavailable(): boolean;
          briefCampaignsDemandGenEnabled(): boolean | null;
          briefCampaignsCapabilityRead(): string;
        };
        expect(page.briefCampaignsUnavailable()).toBe(true);
        expect(page.briefCampaignsDemandGenEnabled(), 'a list-only read blanked the create capability').toBe(true);
        expect(page.briefCampaignsCapabilityRead()).toBe('ready');
      });

      /**
       * #4983. Proceeding with a newly generated brief drops the PREVIOUS brief's campaign list at once,
       * so the Implement tab never shows another brief's campaigns while (or instead of, on a refused
       * save) this brief's own read.
       */
      it('drops the previous brief campaigns when a new brief is proceeded', STATE_ONLY, async () => {
        const campaigns = (): unknown => (fixture.componentInstance as unknown as { briefCampaigns(): unknown }).briefCampaigns();
        (fixture.componentInstance as unknown as { briefCampaigns: { set(v: unknown): void } }).briefCampaigns.set([
          { id: 'old', platform: 'google-ads', status: 'active' },
        ]);
        persistBrief.mockReturnValue(NEVER);

        proceed(otherBrief);

        expect(campaigns(), "the previous brief's campaigns stayed on Implement").toBeNull();
      });

      it('clears the previous brief campaigns when the foundation changes', STATE_ONLY, async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({
            campaigns: [indexed()],
            possiblyStale: false,
            statusToggleEnabled: true,
            demandGenEnabled: false,
            googleChannelsEnabled: false,
            googleCreativeEnabled: true,
            redditCreativeEnabled: true,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );
        await withSavedBrief();
        load();
        await fixture.whenStable();
        expect(campaigns()).toHaveLength(1);

        list.mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: true,
            demandGenEnabled: false,
            googleChannelsEnabled: false,
            googleCreativeEnabled: true,
            redditCreativeEnabled: true,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );
        selectFoundation('cncf');
        await fixture.whenStable();

        // Not TLF's campaigns under CNCF: the rows would render against a projectSlug that is
        // now 'cncf' and a briefId that is now '', which is the address a pause is sent to.
        expect(campaigns()).not.toEqual([indexed()]);
      });

      /**
       * A foundation switch clears the bidding capability WITHOUT starting a read (#3299). It must
       * read `unknown`, not `pending`: the tab answers `unknown` with a Retry and Switch to Automatic,
       * while `pending` would say "Checking…" for a read that never comes.
       */
      it('leaves the bidding read unknown, not pending, after a foundation switch', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({
            campaigns: [indexed()],
            possiblyStale: false,
            statusToggleEnabled: true,
            demandGenEnabled: false,
            googleChannelsEnabled: false,
            googleCreativeEnabled: true,
            redditCreativeEnabled: true,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: true,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );
        await withSavedBrief();
        load();
        await fixture.whenStable();
        const c = fixture.componentInstance as unknown as { briefCampaignsBiddingEnabled(): boolean | null; briefCampaignsCapabilityRead(): string };
        expect(c.briefCampaignsCapabilityRead()).toBe('ready');

        selectFoundation('cncf');
        await fixture.whenStable();

        expect(c.briefCampaignsBiddingEnabled()).toBeNull();
        expect((c as unknown as { briefCampaignsMicrosoftScheduleEnabled(): boolean | null }).briefCampaignsMicrosoftScheduleEnabled()).toBeNull();
        // Per caller AND per foundation: a root answer for one foundation must not carry to the next.
        expect((c as unknown as { briefCampaignsGoogleAudienceSegmentsEnabled(): boolean | null }).briefCampaignsGoogleAudienceSegmentsEnabled()).toBeNull();
        expect(c.briefCampaignsCapabilityRead()).toBe('unknown');
      });

      it('drops a campaign list that resolves after the foundation changed', STATE_ONLY, async () => {
        const late = new Subject<CampaignListResult>();
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(late);
        await withSavedBrief();
        load();

        selectFoundation('cncf');
        await fixture.whenStable();

        // The response the switch invalidated. Clearing the signal alone cannot stop this — the
        // request was already in flight and lands afterwards.
        late.next({
          campaigns: [indexed()],
          possiblyStale: false,
          statusToggleEnabled: true,
          demandGenEnabled: false,
          googleChannelsEnabled: false,
          googleCreativeEnabled: true,
          redditCreativeEnabled: true,
          redditAssetUploadEnabled: false,
          redditConversionPixelEnabled: false,
          redditConversionEventEnabled: false,
          googleAssetUploadEnabled: false,
          metaCreativeEnabled: false,
          metaAssetUploadEnabled: false,
          linkedInAssetUploadEnabled: false,
          linkedInTargetingEditEnabled: false,
          linkedInAccountSelectionEnabled: false,
          linkedInDailyCapEnabled: false,
          linkedInVariantCopyEnabled: false,
          linkedInCallToActionEnabled: false,
          linkedInTextAdsEnabled: false,
          linkedInVideoAdsEnabled: false,
          linkedInTargetCostEnabled: false,
          linkedInTargetingEnabled: false,
          linkedInConversionsEnabled: false,
          linkedInLeadGenEnabled: false,
          linkedInCarouselEnabled: false,
          linkedInDocumentEnabled: false,
          microsoftAssetUploadEnabled: false,
          biddingEnabled: false,
          microsoftScheduleEnabled: false,
          twitterCreateEnabled: false,
          metaInstagramDsaEnabled: false,
          googleAudienceSegmentsEnabled: false,
          googleGeoSearchEnabled: false,
        });
        await fixture.whenStable();

        expect(campaigns()).toBeNull();
      });

      /**
       * Failure-as-absence. `null` already means "not loaded", so a failed read that also leaves
       * `null` is indistinguishable from a page nobody has asked anything of — no indication and
       * no retry, on campaigns that may still be spending.
       */
      it('marks a failed read as unavailable rather than leaving it as not-loaded', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(throwError(() => new Error('query service down')));
        await withSavedBrief();
        load();
        await fixture.whenStable();

        expect(campaigns()).toBeNull();
        expect(unavailable()).toBe(true);
      });

      it('does not mark a genuinely empty list as unavailable', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({
            campaigns: [],
            possiblyStale: false,
            statusToggleEnabled: true,
            demandGenEnabled: false,
            googleChannelsEnabled: false,
            googleCreativeEnabled: true,
            redditCreativeEnabled: true,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );
        await withSavedBrief();
        load();
        await fixture.whenStable();

        expect(campaigns()).toEqual([]);
        expect(unavailable()).toBe(false);
      });

      /**
       * A BRIEF switch inside ONE foundation. The foundation-switch effect is the only other
       * clear, so nothing cleared this state on the path a user actually takes to change briefs:
       * restore a saved brief → proceed → enter Optimize.
       *
       * Asserted on the RENDERED tab, not on the signal. `briefCampaigns` being null is a means;
       * what makes the bug expensive is that the previous brief's rows stay on screen with live
       * toggle buttons while the parent has already re-bound `briefId` to the new brief — so a
       * click in that window sends brief A's campaignId to brief B's address. A signal-only
       * assertion passes even if the template still paints the old rows.
       */
      it('stops rendering the previous brief campaigns while the next brief is still loading', async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({
            campaigns: [indexed({ campaign_name: 'Brief A campaign' })],
            possiblyStale: false,
            statusToggleEnabled: true,
            demandGenEnabled: false,
            googleChannelsEnabled: false,
            googleCreativeEnabled: true,
            redditCreativeEnabled: true,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );
        await withSavedBrief();
        openOptimize();
        await fixture.whenStable();
        // The precondition the assertion below depends on: brief A really did render clickable
        // rows. Without this the test would pass on a tab that never renders anything.
        expect(optimizeText()).toContain('Brief A campaign');
        expect(toggleButtonIds()).toEqual(['c-1']);

        // Brief B, same foundation. The response is withheld so the assertion lands INSIDE the
        // round trip — the window the fix is about.
        const pending = new Subject<CampaignListResult>();
        list.mockReturnValue(pending);
        restore(otherBrief, 'brief-b');
        await fixture.whenStable();
        openOptimize();
        await fixture.whenStable();

        // Brief B's id is already the address on screen; brief A's rows must not be beside it.
        expect(state().briefId).toBe('brief-b');
        expect(optimizeText()).not.toContain('Brief A campaign');
        expect(toggleButtonIds()).toEqual([]);
        expect(campaigns()).toBeNull();

        // And the new brief's own answer still lands, so the clear is a window, not a wipe.
        pending.next({
          campaigns: [indexed({ id: 'c-2', campaign_name: 'Brief B campaign' })],
          possiblyStale: false,
          statusToggleEnabled: true,
          demandGenEnabled: false,
          googleChannelsEnabled: false,
          googleCreativeEnabled: true,
          redditCreativeEnabled: true,
          redditAssetUploadEnabled: false,
          redditConversionPixelEnabled: false,
          redditConversionEventEnabled: false,
          googleAssetUploadEnabled: false,
          metaCreativeEnabled: false,
          metaAssetUploadEnabled: false,
          linkedInAssetUploadEnabled: false,
          linkedInTargetingEditEnabled: false,
          linkedInAccountSelectionEnabled: false,
          linkedInDailyCapEnabled: false,
          linkedInVariantCopyEnabled: false,
          linkedInCallToActionEnabled: false,
          linkedInTextAdsEnabled: false,
          linkedInVideoAdsEnabled: false,
          linkedInTargetCostEnabled: false,
          linkedInTargetingEnabled: false,
          linkedInConversionsEnabled: false,
          linkedInLeadGenEnabled: false,
          linkedInCarouselEnabled: false,
          linkedInDocumentEnabled: false,
          microsoftAssetUploadEnabled: false,
          biddingEnabled: false,
          microsoftScheduleEnabled: false,
          twitterCreateEnabled: false,
          metaInstagramDsaEnabled: false,
          googleAudienceSegmentsEnabled: false,
          googleGeoSearchEnabled: false,
        });
        await fixture.whenStable();
        expect(optimizeText()).toContain('Brief B campaign');
        expect(toggleButtonIds()).toEqual(['c-2']);
      });

      it('clears a previous failure when the foundation changes', STATE_ONLY, async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(throwError(() => new Error('query service down')));
        await withSavedBrief();
        load();
        await fixture.whenStable();
        expect(unavailable()).toBe(true);

        selectFoundation('cncf');
        await fixture.whenStable();

        // The banner belongs to the read that produced it. Leaving it set would report TLF's
        // outage against CNCF, which was never queried.
        expect(unavailable()).toBe(false);
      });

      /**
       * `take(1)` satisfies the repo's stated convention (frontend-checklist §6 lists it beside
       * `takeUntilDestroyed`), so this is not a rule violation — it is a correctness one. `take(1)`
       * unsubscribes after the FIRST emission, which on a request that never answers is never: the
       * subscription outlives the component and its handler writes into a destroyed instance.
       *
       * Asserted through the subscription's teardown rather than through a signal, because a write
       * to a destroyed component's signal is not observable from here — the teardown running on
       * destroy IS the mechanism, and `take(1)` alone does not run it.
       */
      it('tears down an unanswered campaign list read when the component is destroyed', async () => {
        let torndown = false;
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          new Observable<CampaignListResult>(() => {
            return () => {
              torndown = true;
            };
          })
        );
        await withSavedBrief();
        load();
        expect(torndown).toBe(false);

        fixture.destroy();

        expect(torndown).toBe(true);
      });

      it('clears a stale failure when a later read succeeds', STATE_ONLY, async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(throwError(() => new Error('query service down')));
        await withSavedBrief();
        load();
        await fixture.whenStable();
        expect(unavailable()).toBe(true);

        list.mockReturnValue(
          of({
            campaigns: [indexed()],
            possiblyStale: false,
            statusToggleEnabled: true,
            demandGenEnabled: false,
            googleChannelsEnabled: false,
            googleCreativeEnabled: true,
            redditCreativeEnabled: true,
            redditAssetUploadEnabled: false,
            redditConversionPixelEnabled: false,
            redditConversionEventEnabled: false,
            googleAssetUploadEnabled: false,
            metaCreativeEnabled: false,
            metaAssetUploadEnabled: false,
            linkedInAssetUploadEnabled: false,
            linkedInTargetingEditEnabled: false,
            linkedInAccountSelectionEnabled: false,
            linkedInDailyCapEnabled: false,
            linkedInVariantCopyEnabled: false,
            linkedInCallToActionEnabled: false,
            linkedInTextAdsEnabled: false,
            linkedInVideoAdsEnabled: false,
            linkedInTargetCostEnabled: false,
            linkedInTargetingEnabled: false,
            linkedInConversionsEnabled: false,
            linkedInLeadGenEnabled: false,
            linkedInCarouselEnabled: false,
            linkedInDocumentEnabled: false,
            microsoftAssetUploadEnabled: false,
            biddingEnabled: false,
            microsoftScheduleEnabled: false,
            twitterCreateEnabled: false,
            metaInstagramDsaEnabled: false,
            googleAudienceSegmentsEnabled: false,
            googleGeoSearchEnabled: false,
          })
        );
        load();
        await fixture.whenStable();

        expect(unavailable()).toBe(false);
        expect(campaigns()).toHaveLength(1);
      });
    });
  });

  /**
   * #4983. The saved brief can be reopened in the Plan editor and saved back over its own row, from
   * the restore offer, from the unowned refusal on Implement, or from Edit brief on Implement.
   */
  describe('open the saved brief to edit', () => {
    const offer = (readAt = 0, etag: string | null = 'W/"3"'): CampaignSavedBriefOffer => ({ brief, briefId: 'stored-1', etag, approved: true, readAt });

    function openFromOffer(o: CampaignSavedBriefOffer): void {
      (fixture.componentInstance as unknown as { onOpenSavedBriefToEdit(o: CampaignSavedBriefOffer): void }).onOpenSavedBriefToEdit(o);
    }

    function editRequest(): CampaignBriefEditRequest | null {
      return (fixture.componentInstance as unknown as { planningEditRequest(): CampaignBriefEditRequest | null }).planningEditRequest();
    }

    // The foundation is persisted to a cookie, which outlives this TestBed; put back whatever was
    // there so the suites after this one read the foundation they were written against.
    let previousFoundation: ProjectContext | null = null;

    beforeEach(async () => {
      const context = TestBed.inject(ProjectContextService);
      previousFoundation = context.selectedFoundation();
      context.setFoundation({ uid: 'f-a', slug: 'foundation-a', name: 'Foundation A' } as ProjectContext, false);
      TestBed.tick();
      await fixture.whenStable();
    });

    afterEach(() => {
      const context = TestBed.inject(ProjectContextService);
      if (previousFoundation === null) {
        context.clearFoundation(false);
      } else {
        context.setFoundation(previousFoundation, false);
      }
    });

    it('records ownership from the offer, so the edited brief is saved over the stored row with its ETag as If-Match', async () => {
      openFromOffer(offer());
      expect(editRequest()?.brief).toBe(brief);
      expect(tab()).toBe('planning');

      // The edited brief comes back through Proceed, exactly as Planning emits it.
      const edited = { ...brief, keywords: [{ term: 'edited', matchType: 'Exact', intentLevel: 'High', notes: '' }] } as CampaignBriefOutput;
      persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: 'stored-1', etag: 'W/"4"', created: false, approved: true }));
      proceed(edited);
      await fixture.whenStable();

      // A replace of THIS row, conditioned on the version the user opened. `saveBrief` approves it
      // in the same call, which is what re-enables Create.
      expect(persistBrief).toHaveBeenLastCalledWith(edited, 'foundation-a', 'stored-1', 'W/"3"', false);
      expect(state()).toMatchObject({ status: 'saved', briefId: 'stored-1', approved: true });
      expect(tab()).toBe('implementation');
    });

    it('grants the overwrite licence only when the offer carried no validator, as a restore does', async () => {
      openFromOffer(offer(0, null));
      persistBrief.mockReturnValueOnce(NEVER);
      proceed();
      await fixture.whenStable();

      expect(persistBrief).toHaveBeenLastCalledWith(brief, 'foundation-a', 'stored-1', null, true);
    });

    it('keeps a newer validator this session holds for the same content (an approval moved only the ETag)', STATE_ONLY, async () => {
      // This session restored the row and approved it: same bytes, newer ETag.
      approveBrief.mockReturnValueOnce(of({ enabled: true, briefId: 'stored-1', etag: 'W/"4"', approved: true }));
      restore(brief, 'stored-1', false, 'W/"3"');
      await fixture.whenStable();

      // Planning still offers its cached pre-approval read.
      openFromOffer(offer(0, 'W/"3"'));
      persistBrief.mockReturnValueOnce(NEVER);
      proceed();
      await fixture.whenStable();

      expect(persistBrief).toHaveBeenLastCalledWith(brief, 'foundation-a', 'stored-1', 'W/"4"', false);
    });

    it("re-reads the row instead of opening an offer older than this session's last save", STATE_ONLY, async () => {
      persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: 'stored-1', etag: 'W/"9"', created: false, approved: true }));
      restore(brief, 'stored-1', true, 'W/"3"');
      proceed();
      await fixture.whenStable();

      // Planning's offer was read BEFORE that save, so it holds bytes this session already replaced.
      const current = { ...brief, keywords: [{ term: 'current', matchType: 'Exact', intentLevel: 'High', notes: '' }] } as CampaignBriefOutput;
      const loadBrief = vi
        .spyOn(TestBed.inject(CampaignService), 'loadBrief')
        .mockReturnValue(of({ status: 'loaded', brief: current, briefId: 'stored-1', etag: 'W/"9"', approved: true }));
      openFromOffer(offer(0, 'W/"3"'));
      await fixture.whenStable();

      expect(loadBrief).toHaveBeenCalledWith('kubecon-eu-2026', 'foundation-a', 'paid-marketing', '');
      expect(editRequest()?.brief, 'the stale offer was opened instead of the stored brief').toBe(current);

      persistBrief.mockReturnValueOnce(NEVER);
      proceed(current);
      await fixture.whenStable();
      expect(persistBrief).toHaveBeenLastCalledWith(current, 'foundation-a', 'stored-1', 'W/"9"', false);
    });

    it('waits for a save still running, then re-reads, rather than opening the offer under it', STATE_ONLY, async () => {
      const save = new Subject<CampaignBriefPersistResult>();
      persistBrief.mockReturnValueOnce(save);
      proceed();
      const current = { ...brief, keywords: [{ term: 'current', matchType: 'Exact', intentLevel: 'High', notes: '' }] } as CampaignBriefOutput;
      const loadBrief = vi
        .spyOn(TestBed.inject(CampaignService), 'loadBrief')
        .mockReturnValue(of({ status: 'loaded', brief: current, briefId: 'b-new', etag: 'W/"1"', approved: true }));

      openFromOffer(offer(0, 'W/"0"'));
      await fixture.whenStable();
      expect(loadBrief, 'the row was read before the running save landed').not.toHaveBeenCalled();
      expect(editRequest()).toBeNull();

      save.next({ enabled: true, briefId: 'b-new', etag: 'W/"1"', created: true, approved: true });
      save.complete();
      await fixture.whenStable();
      await (fixture.componentInstance as unknown as { persistChain: Promise<void> }).persistChain;
      await fixture.whenStable();

      expect(loadBrief).toHaveBeenCalledTimes(1);
      expect(editRequest()?.brief).toBe(current);
    });

    it('keeps an approval still in flight for the same row, so its new ETag is the precondition', STATE_ONLY, async () => {
      const approval = new Subject<CampaignBriefApproveResult>();
      approveBrief.mockReturnValueOnce(approval);
      restore(brief, 'stored-1', false, 'W/"3"');
      await fixture.whenStable();

      // Open to edit on the same, unchanged content while the approval is out.
      openFromOffer(offer(0, 'W/"3"'));
      approval.next({ enabled: true, briefId: 'stored-1', etag: 'W/"4"', approved: true });
      approval.complete();
      await fixture.whenStable();

      persistBrief.mockReturnValueOnce(NEVER);
      proceed();
      await fixture.whenStable();
      expect(persistBrief, "the approval's ETag was dropped").toHaveBeenLastCalledWith(brief, 'foundation-a', 'stored-1', 'W/"4"', false);
    });

    it('drops a pending re-read when Planning discards its brief meanwhile', STATE_ONLY, async () => {
      const save = new Subject<CampaignBriefPersistResult>();
      persistBrief.mockReturnValueOnce(save);
      proceed();
      const loadBrief = vi
        .spyOn(TestBed.inject(CampaignService), 'loadBrief')
        .mockReturnValue(of({ status: 'loaded', brief, briefId: 'b-new', etag: 'W/"1"', approved: true }));
      openFromOffer(offer(0, 'W/"0"'));

      // New Brief / Generate in Planning while the read waits on the running save.
      (fixture.componentInstance as unknown as { onPlanningBriefDiscarded(): void }).onPlanningBriefDiscarded();
      save.next({ enabled: true, briefId: 'b-new', etag: 'W/"1"', created: true, approved: true });
      save.complete();
      await (fixture.componentInstance as unknown as { persistChain: Promise<void> }).persistChain;
      await fixture.whenStable();

      expect(loadBrief).toHaveBeenCalled();
      expect(editRequest(), 'the late read replaced what Planning holds now').toBeNull();
    });

    it('re-reads the row on Edit brief once ownership moved past the brief on Implement', async () => {
      // Implement holds a brief handed over earlier...
      persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: 'stored-1', etag: 'W/"2"', created: false, approved: true }));
      proceed();
      await fixture.whenStable();
      // ...then Open to edit records a newer account of the same row.
      openFromOffer(offer(5, 'W/"8"'));
      const current = { ...brief, keywords: [{ term: 'current', matchType: 'Exact', intentLevel: 'High', notes: '' }] } as CampaignBriefOutput;
      const loadBrief = vi
        .spyOn(TestBed.inject(CampaignService), 'loadBrief')
        .mockReturnValue(of({ status: 'loaded', brief: current, briefId: 'stored-1', etag: 'W/"8"', approved: true }));

      (fixture.componentInstance as unknown as { onEditBriefFromImplement(): void }).onEditBriefFromImplement();
      await fixture.whenStable();

      expect(loadBrief).toHaveBeenCalledTimes(1);
      expect(editRequest()?.brief, "Implement's older copy was reopened under the newer validator").toBe(current);
    });

    it('says why Edit brief opened nothing when its re-read fails, rather than reopening the older copy', async () => {
      persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: 'stored-1', etag: 'W/"2"', created: false, approved: true }));
      proceed();
      await fixture.whenStable();
      openFromOffer(offer(5, 'W/"8"'));
      (fixture.componentInstance as unknown as { planningEditRequest: { set(v: unknown): void } }).planningEditRequest.set(null);
      vi.spyOn(TestBed.inject(CampaignService), 'loadBrief').mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      (fixture.componentInstance as unknown as { onEditBriefFromImplement(): void }).onEditBriefFromImplement();
      await fixture.whenStable();
      logged.mockRestore();

      expect(editRequest(), "Implement's older copy was opened under the newer validator").toBeNull();
      expect((fixture.componentInstance as unknown as { editBriefError(): string | null }).editBriefError()).toContain('could not be read');
    });

    it('does not re-read on Edit brief after the brief on Implement was itself saved over the row', STATE_ONLY, async () => {
      persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: 'stored-1', etag: 'W/"2"', created: false, approved: true }));
      proceed();
      await fixture.whenStable();
      // An Open to edit bumped the epoch, then Implement's own brief was saved over the row again
      // (as Replace saved brief does), so the row holds exactly Implement's bytes.
      openFromOffer(offer(5, 'W/"8"'));
      persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: 'stored-1', etag: 'W/"9"', created: false, approved: true }));
      (fixture.componentInstance as unknown as { persistBrief(b: CampaignBriefOutput): void }).persistBrief(
        (fixture.componentInstance as unknown as { briefOutput(): CampaignBriefOutput }).briefOutput()
      );
      await (fixture.componentInstance as unknown as { persistChain: Promise<void> }).persistChain;
      await fixture.whenStable();
      const loadBrief = vi
        .spyOn(TestBed.inject(CampaignService), 'loadBrief')
        .mockReturnValue(of({ status: 'loaded', brief, briefId: 'stored-1', etag: 'W/"9"', approved: true }));

      (fixture.componentInstance as unknown as { onEditBriefFromImplement(): void }).onEditBriefFromImplement();
      // A re-read would start only once the save queue drains, so wait for it before asserting none ran.
      await (fixture.componentInstance as unknown as { persistChain: Promise<void> }).persistChain;
      await fixture.whenStable();

      expect(loadBrief, 'Edit brief re-read a row that holds exactly the brief on Implement').not.toHaveBeenCalled();
      expect(editRequest()?.brief).toEqual(brief);
    });

    it('drops a pending Edit brief re-read once a create job starts, so it cannot leave the running job', async () => {
      persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: 'stored-1', etag: 'W/"2"', created: false, approved: true }));
      proceed();
      await fixture.whenStable();
      openFromOffer(offer(5, 'W/"8"'));
      (
        fixture.componentInstance as unknown as { planningEditRequest: { set(v: unknown): void }; selectedTab: { set(v: string): void } }
      ).planningEditRequest.set(null);
      (fixture.componentInstance as unknown as { selectedTab: { set(v: string): void } }).selectedTab.set('implementation');
      const read = new Subject<CampaignBriefLoadResult>();
      vi.spyOn(TestBed.inject(CampaignService), 'loadBrief').mockReturnValue(read);

      (fixture.componentInstance as unknown as { onEditBriefFromImplement(): void }).onEditBriefFromImplement();
      await (fixture.componentInstance as unknown as { persistChain: Promise<void> }).persistChain;
      (fixture.componentInstance as unknown as { onCreateStarted(): void }).onCreateStarted();
      read.next({ status: 'loaded', brief, briefId: 'stored-1', etag: 'W/"8"', approved: true });
      read.complete();
      await fixture.whenStable();

      expect(editRequest(), 'the late read opened Planning over a running create').toBeNull();
      expect(tab()).toBe('implementation');
    });

    it('says why Edit brief opened nothing when there is no foundation to read under', STATE_ONLY, async () => {
      // No foundation resolved for the whole flow: the handover and the Open to edit file under the same
      // foundation-less key, so the epoch moves and Edit brief must re-read, which it cannot do.
      vi.spyOn(fixture.componentInstance as unknown as { activeFoundationSlug(): string }, 'activeFoundationSlug').mockReturnValue('');
      persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: 'stored-1', etag: 'W/"2"', created: false, approved: true }));
      proceed();
      await (fixture.componentInstance as unknown as { persistChain: Promise<void> }).persistChain;
      await fixture.whenStable();
      openFromOffer(offer(5, 'W/"8"'));
      (fixture.componentInstance as unknown as { planningEditRequest: { set(v: unknown): void } }).planningEditRequest.set(null);

      (fixture.componentInstance as unknown as { onEditBriefFromImplement(): void }).onEditBriefFromImplement();

      expect((fixture.componentInstance as unknown as { editBriefError(): string | null }).editBriefError()).not.toBeNull();
    });

    it('drops the X fields typed on Implement, which belong to the brief that was there', STATE_ONLY, () => {
      const flag = (): boolean => (fixture.componentInstance as unknown as { twitterCarryDiscarded: boolean }).twitterCarryDiscarded;
      persistBrief.mockReturnValueOnce(NEVER);
      // A proceed clears the flag, so the next one would carry the X fields over.
      proceed();
      expect(flag()).toBe(false);

      openFromOffer(offer());
      expect(flag(), 'the X draft of the brief on Implement would ride onto the stored brief').toBe(true);
    });

    it('drops the edit request when Planning discards its brief, and on a restore', STATE_ONLY, () => {
      openFromOffer(offer());
      (fixture.componentInstance as unknown as { onPlanningBriefDiscarded(): void }).onPlanningBriefDiscarded();
      expect(editRequest()).toBeNull();

      openFromOffer(offer());
      restore(brief, 'stored-1', true, 'W/"3"');
      expect(editRequest()).toBeNull();
    });

    it('reopens the Implement brief in the editor on Edit brief, with a fresh request each time', STATE_ONLY, () => {
      proceed();
      (fixture.componentInstance as unknown as { onEditBriefFromImplement(): void }).onEditBriefFromImplement();
      const first = editRequest();
      expect(first?.brief).toEqual(brief);
      expect(tab()).toBe('planning');

      (fixture.componentInstance as unknown as { onEditBriefFromImplement(): void }).onEditBriefFromImplement();
      expect(editRequest()?.requestId).not.toBe(first?.requestId);
    });

    describe('from the unowned refusal on Implement', () => {
      let loadBrief: Mock;
      const stored = { ...brief, keywords: [{ term: 'stored', matchType: 'Exact', intentLevel: 'High', notes: '' }] } as CampaignBriefOutput;

      function openFromImplement(): void {
        (fixture.componentInstance as unknown as { onOpenSavedBriefFromImplement(): void }).onOpenSavedBriefFromImplement();
      }

      beforeEach(async () => {
        loadBrief = vi.fn();
        vi.spyOn(TestBed.inject(CampaignService), 'loadBrief').mockImplementation(loadBrief);
        persistBrief.mockReturnValueOnce(of({ enabled: true, briefId: '', etag: null, created: false, approved: false, conflict: 'unowned-brief-exists' }));
        proceed();
        await fixture.whenStable();
      });

      it('words the refusal around the two buttons under it', STATE_ONLY, () => {
        expect(state().conflict).toBe('unowned-brief-exists');
        expect(state().message).toBe(CAMPAIGN_PAID_UNOWNED_BRIEF_MESSAGE);
        expect(state().message).toContain('Open the saved brief to edit it');
      });

      it('reads the stored brief, takes ownership of it, and opens it in the editor', STATE_ONLY, async () => {
        loadBrief.mockReturnValue(of({ status: 'loaded', brief: stored, briefId: 'stored-1', etag: 'W/"5"', approved: true }));

        openFromImplement();
        await fixture.whenStable();

        expect(loadBrief).toHaveBeenCalledWith('kubecon-eu-2026', 'foundation-a', 'paid-marketing', '');
        expect(editRequest()?.brief).toBe(stored);
        expect(tab()).toBe('planning');

        persistBrief.mockReturnValueOnce(NEVER);
        proceed(stored);
        await fixture.whenStable();
        expect(persistBrief).toHaveBeenLastCalledWith(stored, 'foundation-a', 'stored-1', 'W/"5"', false);
      });

      it('keeps the refusal, and Create blocked, when the open cannot even start', STATE_ONLY, async () => {
        // No foundation to read under: a failed open, not persistence going dark.
        vi.spyOn(fixture.componentInstance as unknown as { activeFoundationSlug(): string }, 'activeFoundationSlug').mockReturnValue('');

        openFromImplement();
        await fixture.whenStable();

        expect(loadBrief).not.toHaveBeenCalled();
        expect(state(), 'the unowned refusal was cleared and Create re-enabled').toMatchObject({
          status: 'error',
          briefId: '',
          conflict: 'unowned-brief-exists',
        });
        expect(state().message).toContain('could not be read');
      });

      it('keeps Replace on offer when the stored brief cannot be opened', STATE_ONLY, async () => {
        loadBrief.mockReturnValue(of({ status: 'unreadable', brief: null, briefId: 'stored-1', etag: 'W/"5"', approved: false }));

        openFromImplement();
        await fixture.whenStable();

        expect(editRequest()).toBeNull();
        expect(state()).toMatchObject({ status: 'error', briefId: '', conflict: 'unowned-brief-exists' });
        expect(state().message).toContain('could not be opened');
      });
    });
  });
});

describe('CampaignsComponent brief persistence — queue state', () => {
  const brief = { eventDetails: { slug: 'kubecon-eu-2026' }, selectedPlatforms: ['google-ads'] } as unknown as CampaignBriefOutput;
  const otherBrief = { eventDetails: { slug: 'oss-na-2026' }, selectedPlatforms: ['google-ads'] } as unknown as CampaignBriefOutput;
  let persistBrief: Mock;
  let fixture: ComponentFixture<CampaignsComponent>;

  beforeEach(async () => {
    // These cases assert only the page's save queue/signals, so each is STATE_ONLY: the real
    // component, forms, effects and HTTP-backed CampaignService, on the empty-template subclass
    // (no child tabs), which compiles once instead of an override recompiling every test.
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false), providerReady: signal(true) } },
      ],
    }).compileComponents();
    persistBrief = vi.fn();
    vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(persistBrief);
    fixture = TestBed.createComponent(campaignsComponentUnderTest());
    TestBed.inject(PersonaService).currentPersona.set('executive-director');
    await fixture.whenStable();
  });

  function proceed(b: CampaignBriefOutput = brief): void {
    (fixture.componentInstance as unknown as { onProceedToImplementation(b: CampaignBriefOutput): void }).onProceedToImplementation(b);
  }

  function switchProgram(): void {
    (
      fixture.componentInstance as unknown as { selectorForm: { controls: { programType: { setValue(v: string): void } } } }
    ).selectorForm.controls.programType.setValue('education');
  }

  function state(): CampaignBriefPersistenceState {
    return (fixture.componentInstance as unknown as { briefPersistence(): CampaignBriefPersistenceState }).briefPersistence();
  }

  /** Whether a save is running — deliberately NOT derivable from `state()`. */
  function inFlight(): boolean {
    return (fixture.componentInstance as unknown as { briefSaveInFlight(): boolean }).briefSaveInFlight();
  }

  async function settleQueue(): Promise<void> {
    // Without child-template renders, Angular can already be stable while persistChain still
    // has promise handlers to run. Yield a task so the queue drains independently of rendering.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }

  /**
   * Two saves of the same event must never be in flight together. Each one's find would come back
   * empty and each would POST, and the create that lands second collides with the partial unique
   * index on `(project_id, event_slug)`. The server cannot resolve that for us: the collision
   * identifies the later ARRIVAL, not the later brief, so retrying it as a replace would
   * sometimes overwrite a newer brief that had already reported success. Ordering them here is
   * what makes the second save a plain replace of the first.
   */
  it('keeps saving after a throw inside a save handler', STATE_ONLY, async () => {
    // The chain IS the queue, so a rejected `persistChain` means every later Proceed in the
    // session silently never sends a request -- no banner, no error, nothing saved. The
    // two-argument `.then(onFulfilled, onRejected)` covers a rejected REQUEST but not a throw in
    // the success handler, and the doc comment claimed a `.catch()` per link that did not exist.
    //
    // A malformed result reaches the success handler and throws there (`briefId` absent makes the
    // ownership write blow up on a null result field), which is the shape a mapping bug takes.
    persistBrief.mockReturnValue(of(null as unknown as CampaignBriefPersistResult));
    proceed();
    await settleQueue();

    // The queue must still be alive.
    persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-2', etag: '"1"', created: true, approved: true }));
    proceed();
    await settleQueue();

    // TWO calls is the property: the second request was actually sent. Without the terminal
    // catch the chain stays rejected and this is 1, with no error surfaced anywhere.
    expect(persistBrief).toHaveBeenCalledTimes(2);
    // `saved`, and the route there is worth naming. The throwing first save now reports `error`
    // rather than being swallowed silently, which flips `briefPersistenceEnabled` -- so the retry
    // takes the flag-KNOWN path and reports its own outcome. This assertion read `off` while the
    // throw was absorbed without a banner: the first save stayed quiet, the flag never flipped,
    // and the second save inherited that silence. Surfacing the throw is what changed it, and
    // `saved` is the honest end state -- the second request really did succeed.
    expect(state().status).toBe('saved');
  });

  it("runs a session's saves one at a time", STATE_ONLY, async () => {
    const first = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValue(first);
    proceed();
    await settleQueue();
    expect(persistBrief).toHaveBeenCalledTimes(1);

    // Back to Planning and Proceed again while the first request is still open. This needs no
    // second user: `selectTab` only sets a signal, so the tab bar is live during a save.
    persistBrief.mockReturnValue(NEVER);
    proceed();
    await settleQueue();

    expect(persistBrief).toHaveBeenCalledTimes(1);

    first.next({ enabled: true, briefId: 'brief-1', etag: 'W/"1"', created: true, approved: true });
    // A macrotask, not `whenStable`: the queue hands over across microtasks that the fixture's
    // stability check does not necessarily drain.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Released only now — and its find will see `brief-1`, so it replaces rather than races.
    expect(persistBrief).toHaveBeenCalledTimes(2);
  });

  it('drops a save that FAILS after the brief was discarded', STATE_ONLY, async () => {
    const late = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValue(late);

    proceed();
    switchProgram();
    await settleQueue();

    late.error(new Error('500'));
    await settleQueue();

    // Not 'error': there is no brief on screen to warn about, and the amber banner would be
    // about work the user already abandoned.
    expect(state().status).toBe('off');
  });

  /**
   * `briefSaveInFlight` exists because the BANNER state cannot answer "is a save running".
   *
   * The first save of a session shows no banner — the persistence flag lives on the server and is
   * unknown until the response lands, so `briefPersistence` stays `off` throughout. The
   * Implementation tab needs the difference: a create issued in that window carries an empty
   * brief id and is terminally refused with the cutover on.
   */
  it('reports a save as in flight even while the banner still reads off', STATE_ONLY, async () => {
    const pending = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValue(pending);

    proceed();
    await settleQueue();

    expect(inFlight()).toBe(true);
    // The banner is deliberately silent for this first save; that is exactly why the separate
    // signal is needed rather than reading the status.
    expect(state().status).toBe('off');
  });

  /**
   * Two saves queued: the flag must stay true across the seam between them.
   *
   * Saves serialize on `persistChain` and each appends its own clear. With a boolean, both
   * `set(true)` calls ran synchronously at enqueue time while A's clear landed between A finishing
   * and B starting — so the flag went false with a save still pending, and Create re-enabled in
   * exactly the window the guard exists to close. Counting is what closes it.
   */
  it('keeps the in-flight flag set while a second save is still queued', STATE_ONLY, async () => {
    const first = new Subject<CampaignBriefPersistResult>();
    const second = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValueOnce(first).mockReturnValueOnce(second);

    // Two saves for DIFFERENT events, no program switch: switching discards the brief, so that
    // save is dropped rather than queued and its clear never runs — which is a different case.
    proceed();
    proceed(otherBrief);
    await settleQueue();

    // A resolves; B is still outstanding.
    first.next({ enabled: true, briefId: 'brief-a', etag: 'W/"1"', created: true, approved: true });
    first.complete();
    // Drain generously: A's chain link has several `.then` steps before B's request is issued.
    for (let i = 0; i < 6; i++) await settleQueue();

    expect(inFlight()).toBe(true);

    second.next({ enabled: true, briefId: 'brief-b', etag: 'W/"1"', created: true, approved: true });
    second.complete();
    for (let i = 0; i < 6; i++) await settleQueue();

    expect(inFlight()).toBe(false);
  });

  it('clears the in-flight flag when a save FAILS, not only when it succeeds', STATE_ONLY, async () => {
    // The stuck-forever case. Clearing it in the success arm alone would leave Create disabled
    // for the rest of the session after one failed save.
    const failing = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValue(failing);

    proceed();
    await settleQueue();
    expect(inFlight()).toBe(true);

    failing.error(new Error('500'));
    await settleQueue();
    // A second drain: the clear is chained AFTER the terminal catch, so it settles one
    // microtask-turn later than the banner write does.
    await settleQueue();

    expect(inFlight()).toBe(false);
  });
});
