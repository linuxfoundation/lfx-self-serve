// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Signal, WritableSignal } from '@angular/core';
import { computed, signal } from '@angular/core';
import type {
  BriefMetrics,
  BriefMetricsRow,
  CampaignAudience,
  CampaignServiceEmailMetrics,
  EmailBriefCopy,
  CampaignBriefOutput,
  CampaignBriefPersistResult,
  CampaignBriefPersistenceState,
  CampaignImplementationDraft,
  CampaignDeliveryType,
  CampaignIndexDoc,
  CampaignJobOutcome,
  CampaignListResult,
  CampaignProgramType,
  CampaignTab,
  CampaignTabOption,
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
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignsComponent } from './campaigns.component';

/**
 * The controller spec covers what the server does with a brief. What is only observable here is
 * what the USER is told: the handoff to the Implementation tab must happen regardless of the
 * save, and the three outcomes of the save must be distinguishable on screen — saving, saved,
 * and "this is not durable". A save that silently reports nothing is the failure mode this
 * feature exists to prevent.
 */

describe('CampaignsComponent brief persistence', () => {
  const brief = { eventDetails: { slug: 'kubecon-eu-2026' }, selectedPlatforms: ['google-ads'] } as unknown as CampaignBriefOutput;

  let persistBrief: ReturnType<typeof vi.fn>;
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
   * keep asserting exactly the behaviour they were written for. Tests about the carried
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
    (
      fixture.componentInstance as unknown as {
        onRestoreSavedBrief(b: CampaignBriefOutput, id: string, etag: string | null | undefined, approved: boolean): void;
      }
    ).onRestoreSavedBrief(b, briefId, validator, approved);
  }

  function state(): CampaignBriefPersistenceState {
    return (fixture.componentInstance as unknown as { briefPersistence(): CampaignBriefPersistenceState }).briefPersistence();
  }

  /** Whether a save is running — deliberately NOT derivable from `state()`; see the tests below. */
  function inFlight(): boolean {
    return (fixture.componentInstance as unknown as { briefSaveInFlight(): boolean }).briefSaveInFlight();
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
    fixture = TestBed.createComponent(CampaignsComponent);
    TestBed.inject(PersonaService).currentPersona.set('executive-director');
    await fixture.whenStable();
  });

  it('renders a no-access state for a contributor without a campaign_manager FGA grant', async () => {
    TestBed.inject(PersonaService).currentPersona.set('contributor');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-no-access"]')).not.toBeNull();
  });

  it('switches to the Implementation tab before the save resolves', async () => {
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
  it('shows no in-flight banner while the cutover state is still unknown', async () => {
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

  it('renders nothing when the cutover is dark', async () => {
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
  it('drops a save that resolves after the brief was discarded', async () => {
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
  it('does not let a stale disabled response clear the cutover latch', async () => {
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
      fixture = TestBed.createComponent(CampaignsComponent);
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

    it('drops a save that resolves after the foundation changed', async () => {
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
    it('adopts the program of a restored brief instead of leaving the selector wrong', async () => {
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

    it('still resets when the USER switches program, unlike a restore adopt', async () => {
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

    it('sends the LOAD-TIME validator as If-Match, so a concurrent edit is refused not overwritten', async () => {
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

    it('surfaces a concurrent edit as stale-brief, then lets the next Proceed overwrite', async () => {
      // The full chosen behaviour end to end: one honest refusal, then the existing
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

    it('treats an ABSENT etag field like a null one, so a rolling deploy cannot block restores', async () => {
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

    it('does not lend a RESTORED brief id to another event', async () => {
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

    it("still replays an event's own id when that event is proceeded again", async () => {
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
    it('does not record the created id when the save is superseded', async () => {
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
     * A superseded save still created a row, and the next save of that event must be able to
     * name it.
     *
     * Saves are serialised, so a second Proceed while the first is in flight queues behind it.
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

    it('keeps an id recorded by a save that lands after a foundation switch', async () => {
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
      it('loads the demand-gen capability on a first-create Planning to Implementation flow', async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({ campaigns: [], possiblyStale: false, statusToggleEnabled: false, demandGenEnabled: true })
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
      it('sends no capability request when brief persistence is disabled', async () => {
        const list = vi
          .spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns')
          .mockReturnValue(of({ campaigns: [], possiblyStale: true, statusToggleEnabled: false, demandGenEnabled: true }));

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
      it('leaves the capability unknown when the capability read fails', async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(throwError(() => new Error('query service down')));

        await withSavedBrief();
        await fixture.whenStable();

        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBeNull();
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
      it('retries the capability read when the user re-enters Implementation via the tab bar', async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(throwError(() => new Error('query service down')));

        // First create: persist succeeds, capability read fails.
        await withSavedBrief();
        await fixture.whenStable();
        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBeNull();

        // User navigates away and comes back via the tab bar.
        list.mockReturnValue(of({ campaigns: [], possiblyStale: false, statusToggleEnabled: false, demandGenEnabled: true }));
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
      it('keeps a capability answer when an Optimize load races it', async () => {
        const capability = new Subject<CampaignListResult>();
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(capability.asObservable());

        await withSavedBrief();

        // Optimize entry lands on top of the still-open capability request.
        list.mockReturnValue(of({ campaigns: [], possiblyStale: false, statusToggleEnabled: false, demandGenEnabled: true }));
        load();
        await fixture.whenStable();

        // ...and the original request answers only now.
        capability.next({ campaigns: [], possiblyStale: false, statusToggleEnabled: false, demandGenEnabled: true });
        capability.complete();
        await fixture.whenStable();

        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);
      });

      /**
       * The reverse race, and the one a single-reader token cannot close: `loadBriefCampaigns`
       * writes this signal too. An older list read failing AFTER a newer capability read
       * succeeded must not reset a live answer to `null` — a failure has established nothing.
       */
      it('does not let an older failing list read wipe a newer capability answer', async () => {
        const staleList = new Subject<CampaignListResult>();
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(staleList.asObservable());

        await withSavedBrief();
        load();
        await fixture.whenStable();

        // A newer capability read answers while that list request is still open.
        list.mockReturnValue(of({ campaigns: [], possiblyStale: false, statusToggleEnabled: false, demandGenEnabled: true }));
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
      it('loads the capability for a brief restored from campaign-service', async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({ campaigns: [], possiblyStale: false, statusToggleEnabled: false, demandGenEnabled: true })
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
      it('clears a previously known capability when a later read fails', async () => {
        const list = vi
          .spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns')
          .mockReturnValue(of({ campaigns: [], possiblyStale: false, statusToggleEnabled: false, demandGenEnabled: true }));

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
      it('ignores an older capability read that fails after a newer one succeeded', async () => {
        const older = new Subject<CampaignListResult>();
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(older.asObservable());

        await withSavedBrief();

        // A second Implementation entry supersedes the first, and answers first.
        list.mockReturnValue(of({ campaigns: [], possiblyStale: false, statusToggleEnabled: false, demandGenEnabled: true }));
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
        pending.next({ campaigns: [], possiblyStale: false, statusToggleEnabled: false, demandGenEnabled: true });
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
      it('lets a success land after an earlier read has already failed', async () => {
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
        second.next({ campaigns: [], possiblyStale: false, statusToggleEnabled: false, demandGenEnabled: true });
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
      it('does not refetch the capability once it is known', async () => {
        const list = vi
          .spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns')
          .mockReturnValue(of({ campaigns: [], possiblyStale: false, statusToggleEnabled: false, demandGenEnabled: true }));

        await withSavedBrief();
        await fixture.whenStable();
        const afterFirst = list.mock.calls.length;

        // Leave and re-enter Implementation: the answer is already known.
        (fixture.componentInstance as unknown as { selectTab(t: string, o: string): void }).selectTab('planning', 'paid-marketing');
        (fixture.componentInstance as unknown as { selectTab(t: string, o: string): void }).selectTab('implementation', 'paid-marketing');
        await fixture.whenStable();

        expect(list.mock.calls.length).toBe(afterFirst);
        expect((fixture.componentInstance as unknown as { briefCampaignsDemandGenEnabled(): boolean | null }).briefCampaignsDemandGenEnabled()).toBe(true);
      });

      it('clears the previous brief campaigns when the foundation changes', async () => {
        const list = vi
          .spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns')
          .mockReturnValue(of({ campaigns: [indexed()], possiblyStale: false, statusToggleEnabled: true, demandGenEnabled: false }));
        await withSavedBrief();
        load();
        await fixture.whenStable();
        expect(campaigns()).toHaveLength(1);

        list.mockReturnValue(of({ campaigns: [], possiblyStale: false, statusToggleEnabled: true, demandGenEnabled: false }));
        selectFoundation('cncf');
        await fixture.whenStable();

        // Not TLF's campaigns under CNCF: the rows would render against a projectSlug that is
        // now 'cncf' and a briefId that is now '', which is the address a pause is sent to.
        expect(campaigns()).not.toEqual([indexed()]);
      });

      it('drops a campaign list that resolves after the foundation changed', async () => {
        const late = new Subject<CampaignListResult>();
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(late);
        await withSavedBrief();
        load();

        selectFoundation('cncf');
        await fixture.whenStable();

        // The response the switch invalidated. Clearing the signal alone cannot stop this — the
        // request was already in flight and lands afterwards.
        late.next({ campaigns: [indexed()], possiblyStale: false, statusToggleEnabled: true, demandGenEnabled: false });
        await fixture.whenStable();

        expect(campaigns()).toBeNull();
      });

      /**
       * Failure-as-absence. `null` already means "not loaded", so a failed read that also leaves
       * `null` is indistinguishable from a page nobody has asked anything of — no indication and
       * no retry, on campaigns that may still be spending.
       */
      it('marks a failed read as unavailable rather than leaving it as not-loaded', async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(throwError(() => new Error('query service down')));
        await withSavedBrief();
        load();
        await fixture.whenStable();

        expect(campaigns()).toBeNull();
        expect(unavailable()).toBe(true);
      });

      it('does not mark a genuinely empty list as unavailable', async () => {
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(
          of({ campaigns: [], possiblyStale: false, statusToggleEnabled: true, demandGenEnabled: false })
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
        const list = vi
          .spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns')
          .mockReturnValue(
            of({ campaigns: [indexed({ campaign_name: 'Brief A campaign' })], possiblyStale: false, statusToggleEnabled: true, demandGenEnabled: false })
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
        });
        await fixture.whenStable();
        expect(optimizeText()).toContain('Brief B campaign');
        expect(toggleButtonIds()).toEqual(['c-2']);
      });

      it('clears a previous failure when the foundation changes', async () => {
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

      it('clears a stale failure when a later read succeeds', async () => {
        const list = vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(throwError(() => new Error('query service down')));
        await withSavedBrief();
        load();
        await fixture.whenStable();
        expect(unavailable()).toBe(true);

        list.mockReturnValue(of({ campaigns: [indexed()], possiblyStale: false, statusToggleEnabled: true, demandGenEnabled: false }));
        load();
        await fixture.whenStable();

        expect(unavailable()).toBe(false);
        expect(campaigns()).toHaveLength(1);
      });
    });
  });

  /**
   * Two saves of the same event must never be in flight together. Each one's find would come back
   * empty and each would POST, and the create that lands second collides with the partial unique
   * index on `(project_id, event_slug)`. The server cannot resolve that for us: the collision
   * identifies the later ARRIVAL, not the later brief, so retrying it as a replace would
   * sometimes overwrite a newer brief that had already reported success. Ordering them here is
   * what makes the second save a plain replace of the first.
   */
  it('keeps saving after a throw inside a save handler', async () => {
    // The chain IS the queue, so a rejected `persistChain` means every later Proceed in the
    // session silently never sends a request -- no banner, no error, nothing saved. The
    // two-argument `.then(onFulfilled, onRejected)` covers a rejected REQUEST but not a throw in
    // the success handler, and the doc comment claimed a `.catch()` per link that did not exist.
    //
    // A malformed result reaches the success handler and throws there (`briefId` absent makes the
    // ownership write blow up on a null result field), which is the shape a mapping bug takes.
    persistBrief.mockReturnValue(of(null as unknown as CampaignBriefPersistResult));
    proceed();
    await fixture.whenStable();

    // The queue must still be alive.
    persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-2', etag: '"1"', created: true, approved: true }));
    proceed();
    await fixture.whenStable();

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

  it("runs a session's saves one at a time", async () => {
    const first = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValue(first);
    proceed();
    await fixture.whenStable();
    expect(persistBrief).toHaveBeenCalledTimes(1);

    // Back to Planning and Proceed again while the first request is still open. This needs no
    // second user: `selectTab` only sets a signal, so the tab bar is live during a save.
    persistBrief.mockReturnValue(NEVER);
    proceed();
    await fixture.whenStable();

    expect(persistBrief).toHaveBeenCalledTimes(1);

    first.next({ enabled: true, briefId: 'brief-1', etag: 'W/"1"', created: true, approved: true });
    // A macrotask, not `whenStable`: the queue hands over across microtasks that the fixture's
    // stability check does not necessarily drain.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Released only now — and its find will see `brief-1`, so it replaces rather than races.
    expect(persistBrief).toHaveBeenCalledTimes(2);
  });

  it('drops a save that FAILS after the brief was discarded', async () => {
    const late = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValue(late);

    proceed();
    switchProgram();
    await fixture.whenStable();

    late.error(new Error('500'));
    await fixture.whenStable();

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
  it('reports a save as in flight even while the banner still reads off', async () => {
    const pending = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValue(pending);

    proceed();
    await fixture.whenStable();

    expect(inFlight()).toBe(true);
    // The banner is deliberately silent for this first save; that is exactly why the separate
    // signal is needed rather than reading the status.
    expect(state().status).toBe('off');
  });

  /**
   * Two saves queued: the flag must stay true across the seam between them.
   *
   * Saves serialise on `persistChain` and each appends its own clear. With a boolean, both
   * `set(true)` calls ran synchronously at enqueue time while A's clear landed between A finishing
   * and B starting — so the flag went false with a save still pending, and Create re-enabled in
   * exactly the window the guard exists to close. Counting is what closes it.
   */
  it('keeps the in-flight flag set while a second save is still queued', async () => {
    const first = new Subject<CampaignBriefPersistResult>();
    const second = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValueOnce(first).mockReturnValueOnce(second);

    // Two saves for DIFFERENT events, no program switch: switching discards the brief, so that
    // save is dropped rather than queued and its clear never runs — which is a different case.
    proceed();
    proceed(otherBrief);
    await fixture.whenStable();

    // A resolves; B is still outstanding.
    first.next({ enabled: true, briefId: 'brief-a', etag: 'W/"1"', created: true, approved: true });
    first.complete();
    // Drain generously: A's chain link has several `.then` steps before B's request is issued.
    for (let i = 0; i < 6; i++) await fixture.whenStable();

    expect(inFlight()).toBe(true);

    second.next({ enabled: true, briefId: 'brief-b', etag: 'W/"1"', created: true, approved: true });
    second.complete();
    for (let i = 0; i < 6; i++) await fixture.whenStable();

    expect(inFlight()).toBe(false);
  });

  it('clears the in-flight flag when a save FAILS, not only when it succeeds', async () => {
    // The stuck-forever case. Clearing it in the success arm alone would leave Create disabled
    // for the rest of the session after one failed save.
    const failing = new Subject<CampaignBriefPersistResult>();
    persistBrief.mockReturnValue(failing);

    proceed();
    await fixture.whenStable();
    expect(inFlight()).toBe(true);

    failing.error(new Error('500'));
    await fixture.whenStable();
    // A second drain: the clear is chained AFTER the terminal catch, so it settles one
    // microtask-turn later than the banner write does.
    await fixture.whenStable();

    expect(inFlight()).toBe(false);
  });
});

describe('CampaignsComponent — email delivery channel', () => {
  let fixture: ComponentFixture<CampaignsComponent>;

  // The component's members are protected; the tests reach them through one narrow cast rather
  // than exercising the DOM, because what is being pinned is the state machine, not the markup.
  // Reuses the real `CampaignTabOption` and `WritableSignal` rather than hand-rolled shapes, so
  // a retype on the component is at least a type error here instead of a silently-passing test
  // against a shape that no longer exists. The cast still cannot catch a RENAME — that is the
  // cost of reaching protected members, and the reason the assertions below stay behavioural.
  interface Internals {
    /** The rows the picker draws, after type ranking and the render cap. */
    emailTemplatesRendered: Signal<{ id: string }[]>;
    emailTemplatesRenderCapMessage: Signal<string>;
    emailTemplates: WritableSignal<unknown[] | null>;
    selectedDeliveryType: Signal<CampaignDeliveryType>;
    selectedTab: WritableSignal<CampaignTab>;
    selectedEmailTab: WritableSignal<Exclude<CampaignTab, 'optimization'>>;
    briefOutput: WritableSignal<CampaignBriefOutput | null>;
    emailBriefOutput: WritableSignal<CampaignBriefOutput | null>;
    emailTabs: readonly CampaignTabOption[];
    tabs: readonly CampaignTabOption[];
    isEmail: Signal<boolean>;
    selectTab(tab: CampaignTab, owner: CampaignDeliveryType): void;
    onTabKeydown(event: KeyboardEvent, index: number, owner: CampaignDeliveryType): void;
    onProceedToImplementation(brief: CampaignBriefOutput): void;
    onEmailProceedToImplementation(brief: CampaignBriefOutput): void;
    selectedEmailTemplateId: WritableSignal<string>;
    selectedEmailTypeId: WritableSignal<string>;
    emailCopy: WritableSignal<EmailBriefCopy | null>;
    emailAudience: WritableSignal<CampaignAudience | null>;
    emailAudienceState: WritableSignal<'idle' | 'building' | 'error'>;
    emailAudienceMessage: WritableSignal<string>;
    emailBriefId: WritableSignal<string>;
    onBuildAudience(): Promise<void>;
    emailCopyState: WritableSignal<'idle' | 'generating' | 'error'>;
    emailCopyError: WritableSignal<string>;
    canGenerateEmailCopy: Signal<boolean>;
    onGenerateEmailCopy(): Promise<void>;
    emailStaging: WritableSignal<'idle' | 'staging' | 'done' | 'error'>;
    emailStagingMessage: WritableSignal<string>;
    canStageEmail: Signal<boolean>;
    onStageEmailSend(): Promise<void>;
    selectorForm: {
      controls: {
        deliveryType: { setValue(v: CampaignDeliveryType): void };
        programType: { setValue(v: CampaignProgramType): void };
      };
    };
  }

  const internals = (): Internals => fixture.componentInstance as unknown as Internals;

  const selectEmail = (): void => {
    internals().selectorForm.controls.deliveryType.setValue('email');
    fixture.detectChanges();
  };

  const exampleBrief = { eventDetails: { name: 'KubeCon', slug: 'kubecon' } } as CampaignBriefOutput;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: MessageService, useValue: { add: vi.fn() } }],
    }).compileComponents();
    fixture = TestBed.createComponent(CampaignsComponent);
    TestBed.inject(PersonaService).currentPersona.set('executive-director');
    fixture.detectChanges();
  });

  it('offers Optimize on paid marketing but not on email, regardless of which is active', () => {
    // Asserted WITHOUT switching delivery type first, which is the point. Both containers are
    // mounted, so each tablist's list has to be correct at all times — an earlier version keyed
    // this on the ACTIVE delivery type, which left the hidden email tablist rendering the
    // unfiltered four (Optimize included) whenever paid was on screen.
    expect(internals().tabs.map((t) => t.id)).toContain('optimization');

    // Not a "coming soon" omission: HubSpotDispatcher implements no StatusToggler because
    // staging produces a draft a human sends, so there is nothing running to pause. The tab
    // would surface a Pause/Resume the service answers with 400 (`ErrToggleUnsupported`), over
    // keyword and metrics data that is not this channel's to begin with.
    expect(internals().emailTabs.map((t) => t.id)).toEqual(['planning', 'implementation', 'insights']);

    selectEmail();

    // Unchanged by the switch — that is what "per-container" means.
    expect(internals().emailTabs.map((t) => t.id)).not.toContain('optimization');
    expect(internals().tabs.map((t) => t.id)).toContain('optimization');
  });

  /**
   * Regression: the hidden tablist must not write the visible side's tab.
   *
   * Both containers stay mounted, so the hidden one's buttons still dispatch. A handler that
   * inferred its target from `selectedDeliveryType()` would route the hidden email tablist's
   * click into the PAID signal. `display:none` keeps that out of reach of a pointer or Tab
   * press, but not of a programmatic `.click()` — which is what an E2E locator resolving a
   * duplicated testid performs.
   */
  it('routes a tab selection to the container that owns it, not the visible one', () => {
    // Paid is active; the email tablist is mounted but hidden.
    internals().selectTab('implementation', 'email');

    expect(internals().selectedEmailTab()).toBe('implementation');
    expect(internals().selectedTab()).toBe('planning');
  });

  it('keeps each delivery type on its own tab across a round-trip', () => {
    internals().selectTab('insights', 'paid-marketing');
    expect(internals().selectedTab()).toBe('insights');

    selectEmail();
    // Email opens on its own tab rather than inheriting the paid side's.
    expect(internals().selectedEmailTab()).toBe('planning');

    internals().selectTab('implementation', 'email');
    expect(internals().selectedEmailTab()).toBe('implementation');
    // The paid side is untouched — both containers stay mounted, so its tab component and all
    // its local state survive the trip.
    expect(internals().selectedTab()).toBe('insights');

    internals().selectorForm.controls.deliveryType.setValue('paid-marketing');
    fixture.detectChanges();
    expect(internals().selectedTab()).toBe('insights');
  });

  /**
   * Regression: keyboard navigation is bounded by the VISIBLE tabs.
   *
   * Wrapping modulo the full four-tab list would step ArrowRight off the end of the email
   * tablist onto an index with no button — selecting a tab this side does not render, and
   * focusing nothing.
   */
  it('wraps arrow-key navigation within the email tab set', () => {
    selectEmail();
    internals().selectTab('insights', 'email'); // the last email tab, index 2

    internals().onTabKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), 2, 'email');

    expect(internals().selectedEmailTab()).toBe('planning');
  });

  /**
   * The PAID side of the same handler, which the email case above does not cover.
   *
   * `onTabKeydown` picks its bounding list from `owner`, so the two sides share one code path and
   * differ only in list length — paid has four tabs including `optimization`, email has three.
   * A change to the shared bounds could break paid navigation while the email test stays green,
   * which is precisely the regression the `owner` parameter exists to prevent. Proving it on one
   * side only left that guarantee half-tested.
   */
  it('lands End on the last PAID tab, not the last email one', () => {
    internals().selectTab('planning', 'paid-marketing');

    internals().onTabKeydown(new KeyboardEvent('keydown', { key: 'End' }), 3, 'paid-marketing');

    // `optimization` is paid-only. Bounded on the email list this would be `insights`, so the
    // assertion distinguishes the two lists rather than merely exercising End.
    expect(internals().selectedTab()).toBe('optimization');
  });

  it('wraps ArrowLeft backwards within the email tab set', () => {
    selectEmail();
    internals().selectTab('planning', 'email'); // first email tab, index 0

    internals().onTabKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }), 0, 'email');

    // Backwards off index 0 wraps to the LAST email tab. Modulo the four-tab paid list it would
    // land on `optimization`, which this side does not render.
    expect(internals().selectedEmailTab()).toBe('insights');
  });

  /**
   * A program switch discards BOTH sides' briefs.
   *
   * The brief is program-specific — the URL scrape and generated copy differ between Events and
   * Education — and both containers stay mounted, so resetting only the visible one leaves a
   * stale Events brief on the other side, ready to be handed to Implement on the next delivery
   * switch. The email panel renders a placeholder today, which is precisely why this would go
   * unnoticed until the real staging form lands.
   */
  it('clears both delivery types when the program changes', () => {
    const emailBrief = { eventDetails: { name: 'KubeCon', slug: 'kubecon' } } as CampaignBriefOutput;
    internals().onProceedToImplementation(exampleBrief);
    internals().onEmailProceedToImplementation(emailBrief);
    expect(internals().briefOutput()).not.toBeNull();
    expect(internals().emailBriefOutput()).not.toBeNull();

    internals().selectorForm.controls.programType.setValue('education');
    fixture.detectChanges();

    expect(internals().briefOutput()).toBeNull();
    expect(internals().selectedTab()).toBe('planning');
    expect(internals().emailBriefOutput()).toBeNull();
    expect(internals().selectedEmailTab()).toBe('planning');
  });

  it('renders the template picker rather than a not-wired-up notice', () => {
    // REPLACES a test that pinned the old pending panel ("Email staging is not wired up yet" /
    // "Staging an email clones ... an endpoint that is still in review"). That copy was false by
    // the time it was read: /hubspot/emails has been live on main since #1439, and the config
    // builder since #1546. LFXV2-3198 is what removes it.
    //
    // The original test's real concern survives here: the Implement tab is directly clickable, so
    // this panel is reachable before anything has been generated, and it must not claim progress
    // the user has not made. The picker states nothing about the brief at all, which is the
    // strongest form of not-lying available.
    internals().selectorForm.controls.deliveryType.setValue('email');
    internals().selectTab('implementation', 'email');
    fixture.detectChanges();

    const panel = fixture.nativeElement as HTMLElement;
    expect(panel.querySelector('[data-testid="campaigns-email-implementation"]'), 'the picker must render').not.toBeNull();
    expect(panel.querySelector('[data-testid="campaigns-email-implementation-pending"]'), 'the stale pending panel must be gone').toBeNull();
    expect(panel.textContent).not.toContain('not wired up yet');
    expect(panel.textContent).not.toContain('still in review');
    expect(panel.textContent).not.toContain('Your brief is ready');
  });

  // `fixture.nativeElement` is typed `any`, so without the cast the annotation below would be
  // ASSERTED rather than checked — `.style.display` would still compile if it were wrong.
  // Matches the sibling helper and the pre-existing call sites in this file.
  const byTestId = (testid: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`);

  /**
   * The planner's rendered HOST ELEMENT, scoped to its delivery container.
   *
   * Two earlier revisions of this helper were wrong in ways that made these tests pass against
   * the pre-fix template, and both are worth recording because each looks correct:
   *
   * 1. It queried the whole fixture. Both delivery containers are always mounted, so an
   *    unscoped search for `campaigns-planning-tab` also reaches the EMAIL planner — and when
   *    the paid one was destroyed, the query silently returned the email one, so `before` and
   *    `after` matched for a planner that had never been at risk. Hence the container scope.
   * 2. It used `debugElement.query`, which walks Angular's LOGICAL tree and still resolves a
   *    debug node for a component whose element has left the rendered DOM. Verified with a
   *    probe: the panel was gone from `querySelector` while the instance comparison still
   *    passed. `querySelector` is the only view that forgets a destroyed node, so it is the
   *    one that can bind.
   *
   * Comparing the host ELEMENT rather than the panel's display is aimed at a hole the panel
   * assertion alone leaves open: a change that kept the wrapper mounted while recreating
   * `lfx-planning-tab` inside it would reintroduce the state loss this PR fixes, and a display
   * check could not see it.
   *
   * **Honest limit, and it survived two reviewers arguing the opposite — so it is stated as an
   * OBSERVATION, not a mechanism.** These tests are revert-verified against the shape the bug
   * actually had (the panel back inside the `@switch`), and each side fails only its own test.
   * They are NOT verified against the narrower wrapper-kept/planner-recreated shape.
   *
   * Substituting `@if (selectedTab() === 'planning')` on `lfx-planning-tab` — both wrapping the
   * `@for` and nested inside it — leaves the suite green. An instrumented probe at the hidden
   * assertion printed `tab=insights` with the planner element still present, so the element was
   * genuinely not removed at the point the test looks. Do not infer a general rule about `@if`
   * timing from that: the sibling `still mounts the fetch-on-init tabs lazily` test proves one
   * `detectChanges()` DOES remove `@switch`-gated panels in the same pass. Why this particular
   * substitution behaves differently is unresolved, which is exactly why it is recorded as
   * something seen rather than something explained.
   *
   * Pinning that case properly needs a test at the planner's own level, not this one.
   */
  const plannerElement = (container: 'campaigns-paid-marketing' | 'campaigns-email', testid: string): HTMLElement | null =>
    // querySelector, NOT debugElement.query: the rendered DOM is the only view that forgets a
    // destroyed node. Scoped to the container because both are always mounted.
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${container}"] [data-testid="${testid}"]`) ?? null;

  /**
   * LFXV2-3202: leaving the Plan tab must not DESTROY the planner.
   *
   * `PlanningTabComponent` owns its state locally — the generated brief, the edited RSA copy, the
   * resolved HubSpot UTM, the keyword list — and none of it is lifted to this component. A
   * structural `@switch` therefore threw all of it away the moment the user looked at another
   * tab, and a brief is a slow, non-deterministic AI generation: it cannot be reproduced by
   * re-running it. The panel is now visibility-toggled instead, the same treatment the two
   * delivery-type containers already had for the same reason.
   *
   * Asserted on the DOM rather than the tab signal, because the tab signal was never the bug —
   * it changed correctly both before and after this fix.
   */
  it('keeps the paid planner mounted when the user moves to another tab', () => {
    const before = plannerElement('campaigns-paid-marketing', 'campaigns-planning-tab');
    expect(before).not.toBeNull();

    internals().selectTab('insights', 'paid-marketing');
    fixture.detectChanges();

    // Still RENDERED while hidden, and the SAME node — hidden rather than swapped for a fresh
    // one, which would have taken every signal it owned with it.
    const whileHidden = plannerElement('campaigns-paid-marketing', 'campaigns-planning-tab');
    expect(whileHidden).not.toBeNull();
    expect(whileHidden).toBe(before);
    expect(byTestId('campaigns-planning-panel')?.style.display).toBe('none');

    internals().selectTab('planning', 'paid-marketing');
    fixture.detectChanges();

    expect(plannerElement('campaigns-paid-marketing', 'campaigns-planning-tab')).toBe(before);
    expect(byTestId('campaigns-planning-panel')?.style.display).not.toBe('none');
  });

  it('keeps the email planner mounted when the user moves to another tab', () => {
    selectEmail();
    const before = plannerElement('campaigns-email', 'campaigns-email-planning-tab');
    expect(before).not.toBeNull();

    internals().selectTab('implementation', 'email');
    fixture.detectChanges();

    expect(plannerElement('campaigns-email', 'campaigns-email-planning-tab')).toBe(before);
    expect(byTestId('campaigns-email-planning-panel')?.style.display).toBe('none');

    // The return leg, which the paid test above also covers. Without it, a binding typo that
    // hid the email panel PERMANENTLY once left would still pass.
    internals().selectTab('planning', 'email');
    fixture.detectChanges();

    expect(plannerElement('campaigns-email', 'campaigns-email-planning-tab')).toBe(before);
    expect(byTestId('campaigns-email-planning-panel')?.style.display).not.toBe('none');
  });

  it('still mounts the fetch-on-init tabs lazily', () => {
    // The counterpart constraint, and the reason only Planning was hoisted out of the @switch.
    // Implementation, Insights and Optimization all fetch in `ngOnInit` — metrics reads and
    // LinkedIn account lookups — so mounting them eagerly would issue network calls for tabs the
    // user may never open, on every page load. Hoisting all four would trade one bug for a cost
    // regression, so this pins that they are still swapped rather than merely hidden.
    //
    // Asserted on the PANEL ids: `campaigns-insights-tab` is carried by both the nav button and
    // the panel's component, so it cannot distinguish "mounted" from "there is a button for it".
    //
    // Implementation is named explicitly because it is the costliest of the three to mount
    // eagerly — its own ngOnInit resolves ad-account lists — and it was the one an earlier
    // revision of this test left unasserted.
    expect(byTestId('campaigns-implementation-panel')).toBeNull();
    expect(byTestId('campaigns-insights-panel')).toBeNull();
    expect(byTestId('campaigns-optimization-panel')).toBeNull();

    internals().selectTab('insights', 'paid-marketing');
    fixture.detectChanges();

    expect(byTestId('campaigns-insights-panel')).not.toBeNull();
    // Swapped, not stacked: the previous panel is gone from the DOM rather than hidden.
    expect(byTestId('campaigns-optimization-panel')).toBeNull();
    expect(byTestId('campaigns-implementation-panel')).toBeNull();

    // And still REACHABLE. Asserting only that the lazy panels are absent leaves the other
    // direction unpinned: a typo'd `@case ('implementation')` would make the tab permanently
    // blank while every absence assertion above stayed green.
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();

    expect(byTestId('campaigns-implementation-panel')).not.toBeNull();
    expect(byTestId('campaigns-insights-panel')).toBeNull();
  });

  it('still mounts the EMAIL non-planning panels lazily', () => {
    // The email container is where this is most likely to be "tidied" away, because its
    // remaining panels are cheap static placeholders today rather than fetch-on-init
    // components. They stay in the @switch so both containers keep the same structure, and
    // so the paid side's carve-out is not re-litigated one container over.
    selectEmail();

    expect(byTestId('campaigns-email-implementation-panel')).toBeNull();
    expect(byTestId('campaigns-email-insights-panel')).toBeNull();

    internals().selectTab('implementation', 'email');
    fixture.detectChanges();

    expect(byTestId('campaigns-email-implementation-panel')).not.toBeNull();
    expect(byTestId('campaigns-email-insights-panel')).toBeNull();
  });

  it('does not let one delivery type receive the other approved brief', () => {
    internals().onProceedToImplementation(exampleBrief);
    expect(internals().briefOutput()).toEqual(exampleBrief);
    expect(internals().emailBriefOutput()).toBeNull();

    const emailBrief = { eventDetails: { name: 'Open Source Summit', slug: 'oss' } } as CampaignBriefOutput;
    internals().onEmailProceedToImplementation(emailBrief);

    expect(internals().emailBriefOutput()).toEqual(emailBrief);
    // Still the paid brief: a shared signal here would show an email brief under Paid
    // Marketing's Implement tab after a round-trip.
    expect(internals().briefOutput()).toEqual(exampleBrief);
  });

  describe('email content generation (LFXV2-2775 proxy)', () => {
    const emailBrief = {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'https://x.example/' },
    } as unknown as CampaignBriefOutput;

    const copy = { subject: 'Three days in Amsterdam', preheader: 'Sessions and labs', body: '<p>Hello</p>', cta: 'Register' };

    let persist: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      persist = vi.fn().mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(persist);
    });

    it('cannot generate without a brief', () => {
      selectEmail();
      expect(internals().canGenerateEmailCopy()).toBe(false);

      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();
      expect(internals().canGenerateEmailCopy()).toBe(true);
    });

    /**
     * A stage change mid-flight must invalidate the request it started.
     *
     * `onSelectEmailType` clears the copy while a generate may still be running, and the selector
     * stays usable — so the older response resolves afterwards and repopulates the panel with the
     * PREVIOUS stage's copy under the new stage's label. That copy reads plausibly and is simply
     * the wrong kind of email, which `onStageEmailSend` would then clone.
     */
    it('discards copy that arrives after the operator changed the stage', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const late = new Subject<{ enabled: boolean; copy: EmailBriefCopy }>();
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(late.asObservable() as never);

      const pending = internals().onGenerateEmailCopy();
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');
      late.next({ enabled: true, copy });
      late.complete();
      await pending;

      expect(internals().emailCopy()).toBeNull();
      expect(internals().emailCopyState()).toBe('idle');
    });

    /**
     * `emailBriefId` is cleared by `resetEmailBriefDerivedState`, so caching the persisted id only
     * there meant the next save after a Proceed found no owned row and CREATED a second brief for
     * a (project, event) that already had one — while the paid path, reading the same cache, went
     * on addressing the first.
     */
    it('records brief ownership so a later save replaces rather than creating a second row', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));
      await internals().onGenerateEmailCopy();

      // The reset clears `emailBriefId` — which is exactly the path that exposed this: with the id
      // gone and ownership never recorded, the next persist had nothing to address and created a
      // SECOND brief for a (project, event) that already had one.
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      persist.mockClear();

      await internals().onGenerateEmailCopy();
      expect(persist).toHaveBeenCalled();
      // The known id is the third argument: this save REPLACES the row rather than creating one.
      expect(persist.mock.calls[0][2]).toBe('brief-77');
    });

    /** A BUILT audience, which is what `canStageEmail` gates on. */
    const builtAudience: CampaignAudience = {
      id: 'aud-1',
      projectId: 'tlf',
      briefId: 'brief-77',
      platform: 'hubspot',
      inclusionSummary: 'Past registrants',
      status: 'built',
      version: 1,
    };

    /**
     * A late AUDIENCE response is worse than a stale one: `canStageEmail` gates on
     * `emailAudience()?.status === 'built'`, so a build resolving after the reset re-enables
     * staging against a brief the page no longer holds.
     *
     * LIMITATION, stated rather than implied: this test pins the OUTCOME, not the generation
     * guard specifically. Removing the guard's bump from `resetEmailBriefDerivedState` leaves it
     * green, because the reset's own `emailAudience.set(null)` already satisfies the assertion in
     * this harness — the mocked persist resolves in a microtask, so the reset lands before the
     * response and the clear is what the assertion observes. Driving the guard itself needs a
     * fake that suspends INSIDE `ensureEmailBriefId`, which this suite has no seam for. The guard
     * is kept because the write it protects (`emailAudience.set(result.audience)`) is
     * unconditional, and a late response would otherwise overwrite the cleared signal.
     */
    /**
     * A late persist must not clear a NEWER one's in-flight slot.
     *
     * `ensureEmailBriefId` dedups concurrent saves by parking the promise in
     * `emailBriefPersistInFlight`, and its `finally` cleared that field unconditionally. A reset
     * also clears it, so this ordering defeated the dedup: persist A starts, a reset clears the
     * slot, persist B starts and takes it, then A settles and wipes B's slot — leaving a third
     * action free to start a SECOND concurrent save of the same brief.
     *
     * Driven through the service mock, which is the real seam: the component's own
     * `persistEmailBrief` awaits `campaignService.persistBrief`, so controlling that controls when
     * each persist settles.
     */
    it("does not let a late persist clear a newer one's in-flight slot", async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const settleA: ((v: unknown) => void)[] = [];
      const settleB: ((v: unknown) => void)[] = [];
      let call = 0;
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(
        () =>
          new Observable((sub) => {
            const bucket = call++ === 0 ? settleA : settleB;
            bucket.push((v) => {
              sub.next(v);
              sub.complete();
            });
          }) as never
      );

      const c = fixture.componentInstance as unknown as {
        ensureEmailBriefId(brief: unknown, slug: string): Promise<string>;
        resetEmailBriefDerivedState(): void;
        emailBriefPersistInFlight: Promise<string> | null;
      };

      const a = c.ensureEmailBriefId(emailBrief, 'tlf');
      // The reset frees the slot, exactly as it does in the app.
      c.resetEmailBriefDerivedState();
      const b = c.ensureEmailBriefId(emailBrief, 'tlf');
      expect(c.emailBriefPersistInFlight, 'precondition: B holds the slot').not.toBeNull();

      // A settles LAST. Its `finally` must leave B's slot alone.
      settleA.forEach((f) => f({ enabled: true, briefId: 'brief-a', etag: null }));
      await a.catch(() => undefined);

      expect(c.emailBriefPersistInFlight, "a late persist cleared the newer one's slot, so a third action could start a second concurrent save").not.toBeNull();

      settleB.forEach((f) => f({ enabled: true, briefId: 'brief-b', etag: null }));
      await b.catch(() => undefined);
    });

    it('discards an audience that arrives after the brief-derived state reset', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const late = new Subject<{ enabled: boolean; audience: CampaignAudience }>();
      vi.spyOn(TestBed.inject(CampaignService), 'buildAudience').mockReturnValue(late.asObservable() as never);

      const pending = internals().onBuildAudience();
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      late.next({ enabled: true, audience: builtAudience });
      late.complete();
      await pending;

      expect(internals().emailAudience()).toBeNull();
      expect(internals().canStageEmail()).toBe(false);
    });

    /**
     * The same for copy. Carries the same limitation as the audience test above: it pins the
     * outcome, not the generation bump, which the reset's own clear can satisfy in this harness.
     */
    it('discards copy that arrives after the brief-derived state reset', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const late = new Subject<{ enabled: boolean; copy: EmailBriefCopy }>();
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(late.asObservable() as never);

      const pending = internals().onGenerateEmailCopy();
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      late.next({ enabled: true, copy });
      late.complete();
      await pending;

      expect(internals().emailCopy()).toBeNull();
    });

    /**
     * The dedup must not outlive the brief that started it.
     *
     * A caller joining the shared promise AFTER a reset would receive the PREVIOUS brief's id and
     * address every later write to the wrong row — the dedup becoming a correctness bug precisely
     * because it worked. The reset drops the joinable promise; the in-flight request itself is
     * left to finish.
     */
    it('does not hand a joined caller the previous brief id after a reset', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const slow = new Subject<CampaignBriefPersistResult>();
      persist.mockReturnValue(slow.asObservable());
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));

      const first = internals().onGenerateEmailCopy();
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();

      // A second action after the reset must start its OWN persist rather than join the first.
      persist.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-99', etag: null }));
      const second = internals().onGenerateEmailCopy();

      slow.next({ status: 'saved', approved: true, briefId: 'brief-77', etag: null } as unknown as CampaignBriefPersistResult);
      slow.complete();
      await Promise.all([first, second]);

      // Two persists, not one joined call: the second belongs to the new brief.
      expect(persist).toHaveBeenCalledTimes(2);

      // And the ABANDONED persist must not write its id into the shared cache. The call count
      // alone passed while `brief-77` clobbered `emailBriefId`: `persistEmailBrief` short-circuits
      // on a non-empty id, so the next action would then stage against the previous brief --
      // exactly the cross-brief leak the reset exists to prevent.
      expect(internals().emailBriefId(), 'the abandoned persist wrote its id back after the reset').not.toBe('brief-77');
    });

    /**
     * Two email actions started together each found an empty cache and each issued a first-save
     * persist for the same (project, event) — a duplicate brief, or a lost ownership race.
     */
    it('issues one persist when two email actions start concurrently', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));
      vi.spyOn(TestBed.inject(CampaignService), 'buildAudience').mockReturnValue(of({ enabled: true, audience: builtAudience }));
      persist.mockClear();

      await Promise.all([internals().onGenerateEmailCopy(), internals().onBuildAudience()]);

      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('persists the brief first, then generates against that id', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const gen = vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, copy }));
      await internals().onGenerateEmailCopy();

      // Brief-scoped upstream: generation posts to /briefs/{id}/email-copy, so an unpersisted
      // brief has no id to address.
      expect(persist).toHaveBeenCalled();
      // Slug and brief id, in that order. The third argument is the email stage, asserted by its
      // own test -- pinning the whole argv here made this ordering test fail when the stage was
      // added, which is a different claim than the one it exists to make.
      expect(gen.mock.calls[0].slice(0, 2)).toEqual(['tlf', 'brief-77']);
      expect(internals().emailCopy()?.subject).toBe('Three days in Amsterdam');
    });

    it('does NOT generate when the persist returns no brief id', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      persist.mockReturnValue(of({ status: 'saved', briefId: '', etag: null }));
      const gen = vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy');

      await internals().onGenerateEmailCopy();

      // Generating without an id would POST to /briefs//email-copy. Refusing is the safe arm.
      expect(gen).not.toHaveBeenCalled();
      expect(internals().emailCopyState()).toBe('error');
    });

    it('reports a disabled cutover without claiming copy was generated', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: false }));
      await internals().onGenerateEmailCopy();

      expect(internals().emailCopy()).toBeNull();
      expect(internals().emailCopyState()).toBe('error');
    });

    it('surfaces the upstream refusal rather than a generic message', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      // The 503 case: no AI model configured upstream. An operator needs the real reason.
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(
        of({ enabled: true, error: 'The email copy could not be generated. Try again.' })
      );
      await internals().onGenerateEmailCopy();

      expect(internals().emailCopyError()).toBe('The email copy could not be generated. Try again.');
    });
  });

  describe('email send audience', () => {
    const emailBrief = {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'NL', registrationUrl: 'https://x.example/' },
    } as unknown as CampaignBriefOutput;

    const audience: CampaignAudience = {
      id: 'aud-1',
      projectId: 'tlf',
      briefId: 'brief-77',
      platform: 'hubspot',
      inclusionSummary: 'Past registrants of 3 prior editions',
      status: 'built',
      version: 1,
    };

    let persist: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      persist = vi.fn().mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(persist);
    });

    it('persists the brief once and builds against that id', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const build = vi.spyOn(TestBed.inject(CampaignService), 'buildAudience').mockReturnValue(of({ enabled: true, audience }));
      await internals().onBuildAudience();

      expect(build.mock.calls[0]).toEqual(['tlf', 'brief-77']);
      expect(internals().emailAudience()?.inclusionSummary).toBe('Past registrants of 3 prior editions');
    });

    it('does NOT persist a second brief when staging follows an audience build', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      vi.spyOn(TestBed.inject(CampaignService), 'buildAudience').mockReturnValue(of({ enabled: true, audience }));
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onBuildAudience();
      await internals().onStageEmailSend();

      // Two writes for one event is the bug this guards: the id is cached after the first.
      expect(persist).toHaveBeenCalledTimes(1);
    });

    /**
     * A failed HubSpot row must not be announced as a created draft.
     *
     * campaign-service reports a partial outcome as `{ platform: 'hubspot', ok: false, error }`
     * with an EMPTY `errors` array, so checking only the top level said "Draft created in
     * HubSpot" for a staging that failed — sending the operator to look for a draft that is not
     * there.
     */
    it('reports a failed hubspot platform result as an error, not a created draft', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      vi.spyOn(TestBed.inject(CampaignService), 'buildAudience').mockReturnValue(of({ enabled: true, audience }));
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(
        of({
          campaigns: [],
          errors: [],
          platformResults: [{ platform: 'hubspot', ok: false, error: 'the source template could not be cloned' }],
        } as unknown as CampaignJobOutcome)
      );

      await internals().onBuildAudience();
      await internals().onStageEmailSend();
      fixture.detectChanges();

      expect(internals().emailStaging()).toBe('error');
      expect(internals().emailStagingMessage()).toContain('could not be cloned');
    });

    /** An ABSENT platformResults must still succeed — it is optional on the contract. */
    it('still reports success when the service omits platformResults', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      vi.spyOn(TestBed.inject(CampaignService), 'buildAudience').mockReturnValue(of({ enabled: true, audience }));
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(
        of({ campaigns: [{ id: 'c1' }], errors: [] } as unknown as CampaignJobOutcome)
      );

      await internals().onBuildAudience();
      await internals().onStageEmailSend();
      fixture.detectChanges();

      expect(internals().emailStaging()).toBe('done');
    });

    /**
     * A reset landing during the CREATE await must stop the poll and the state writes.
     *
     * LIMITATION, same as the sibling test below: this pins the OUTCOME, not the guard. Removing
     * the post-create `isCurrent()` check leaves it green -- I instrumented the branch and
     * `isCurrent()` reads `true` throughout, because the reset lands before the generation is
     * captured rather than inside the await. Producing a reset that lands strictly BETWEEN the
     * capture and the create's resolution needs a seam this harness does not have.
     *
     * The guard is kept because the window is real in the browser: the request cannot be recalled
     * once sent, but the poll and the state writes after it can be, and those are what an
     * operator sees. I would rather label the test than report coverage I could not demonstrate.
     */
    it('abandons the staging result when the brief resets during the create', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      vi.spyOn(TestBed.inject(CampaignService), 'buildAudience').mockReturnValue(of({ enabled: true, audience }));
      await internals().onBuildAudience();

      // The create hangs, so the reset lands squarely inside its await -- past the entry check.
      const slowCreate = new Subject<{ jobId: string }>();
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(slowCreate.asObservable() as never);
      const poll = vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(of(null));

      void internals().onStageEmailSend();
      await Promise.resolve();
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();

      slowCreate.next({ jobId: 'j1' });
      slowCreate.complete();
      await Promise.resolve();
      await Promise.resolve();

      // The poll belongs to the abandoned brief and must never start.
      expect(poll).not.toHaveBeenCalled();
      expect(internals().emailStaging()).toBe('idle');
    });

    /**
     * A reset during staging must stop the CREATE, not just the poll — that write clones a HubSpot
     * draft and points it at the previous brief's audience, and cancelling the poll afterwards
     * does not undo it.
     *
     * LIMITATION, stated rather than implied: this pins the OUTCOME, not the generation guard.
     * Removing that guard leaves this green, because `resetEmailBriefDerivedState` also clears
     * `emailAudience` and the ENTRY check (`emailAudience()?.status !== 'built'`) returns first.
     * The guard is kept as defence-in-depth for a reset that lands after that check has passed,
     * which this harness has no seam to produce; the entry check is what this test proves.
     */
    it('does not create a campaign when the brief resets mid-stage', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));
      vi.spyOn(TestBed.inject(CampaignService), 'buildAudience').mockReturnValue(of({ enabled: true, audience }));

      // The audience build runs FIRST, on the fast persist -- it also awaits `ensureEmailBriefId`,
      // so slowing the persist before this point hangs the setup rather than the staging call.
      await internals().onBuildAudience();
      create.mockClear();

      // NOW slow the persist, and clear the cached id so staging actually awaits it.
      const slowPersist = new Subject<CampaignBriefPersistResult>();
      persist.mockReturnValue(slowPersist.asObservable());
      internals().emailBriefId.set('');

      // NOT awaited: the guard returns early, and the promise chain settles on its own. Awaiting
      // it here is what timed the first version of this test out.
      void internals().onStageEmailSend();
      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      slowPersist.next({ status: 'saved', approved: true, briefId: 'brief-77', etag: null } as unknown as CampaignBriefPersistResult);
      slowPersist.complete();
      // Two microtask turns: one for the persist to resolve, one for the guard to run after it.
      await Promise.resolve();
      await Promise.resolve();

      expect(create).not.toHaveBeenCalled();
    });

    /**
     * A reset must CANCEL the staging poll, not merely relabel it.
     *
     * Setting `emailStaging` back to `idle` leaves the subscription running, so a job settling
     * after a new brief or a foundation switch still writes `done` — announcing a HubSpot draft
     * that belongs to the PREVIOUS brief as though it were this one's.
     */
    it('stops the staging poll when the brief-derived state resets', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-1');
      fixture.detectChanges();

      const late = new Subject<CampaignJobOutcome | null>();
      vi.spyOn(TestBed.inject(CampaignService), 'buildAudience').mockReturnValue(of({ enabled: true, audience }));
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(late.asObservable());

      await internals().onBuildAudience();
      await internals().onStageEmailSend();

      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      // The job settles AFTER the reset. With the poll still subscribed this writes 'done'.
      late.next({ campaigns: [{ id: 'c1' }], errors: [] } as unknown as CampaignJobOutcome);
      late.complete();
      fixture.detectChanges();

      expect(internals().emailStaging()).toBe('idle');
      expect(internals().emailStagingMessage()).toBe('');
    });

    it('reports a disabled cutover as a steady state, not an error', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      vi.spyOn(TestBed.inject(CampaignService), 'buildAudience').mockReturnValue(of({ enabled: false }));
      await internals().onBuildAudience();

      expect(internals().emailAudienceState()).toBe('idle');
      expect(internals().emailAudience()).toBeNull();
    });
  });

  describe('email preview', () => {
    const copy = {
      subject: 'Three days in Amsterdam',
      preheader: 'Sessions and labs',
      body: '<p>Body</p>',
      cta: 'Register',
    };

    it('shows nothing until copy exists', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      // An empty preview frame would suggest the email exists and is blank.
      expect(host.querySelector('[data-testid="campaigns-email-preview"]')).toBeNull();

      internals().emailCopy.set(copy);
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="campaigns-email-preview"]')).not.toBeNull();
    });

    it('warns that a multi-widget template keeps its own body', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailCopy.set(copy);
      fixture.detectChanges();

      // Pinned because it is a REAL upstream limitation, not a temporary gap: the dispatcher
      // applies bodyHtml only when the draft has exactly one rich-text widget, and silently
      // leaves a multi-widget template alone. An operator who is not told this discovers it on
      // a send. If the upstream rule changes, this test should fail and the note be reworded.
      const note = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-preview-note"]');
      expect(note?.textContent).toContain('more than one text block');
    });
  });

  describe('email staging trigger (LFXV2-3201)', () => {
    // Scoped to THIS block: the outer `persistBrief` spy belongs to the first describe and is
    // not in scope here.
    let persistBrief: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      persistBrief = vi.fn();
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(persistBrief);
    });

    // A brief shaped like the email planner's output. `eventDetails` is what the create request
    // is built FROM, so the fields asserted below must come from here and not from a spread.
    const emailBrief = {
      eventDetails: {
        name: 'KubeCon EU 2026',
        slug: 'kubecon-eu-2026',
        countryCode: 'NL',
        registrationUrl: 'https://events.linuxfoundation.org/kubecon-eu-2026/',
      },
    } as unknown as CampaignBriefOutput;

    it('renders the button inside the email Implement panel, disabled with a reason', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      fixture.detectChanges();

      const host: HTMLElement = fixture.nativeElement;
      const panel = host.querySelector('[data-testid="campaigns-email-implementation-panel"]');
      const btn = panel?.querySelector('[data-testid="campaigns-email-stage-btn"]');

      // PLACEMENT is the claim: the button must live under the EMAIL implement panel, not the
      // paid one. Querying from the panel rather than the document proves containment.
      expect(btn).not.toBeNull();

      // With no brief and no template the control must be disabled AND say why — a disabled
      // button with no reason reads as a broken panel.
      const hint = panel?.querySelector('[data-testid="campaigns-email-stage-hint"]');
      expect(hint?.textContent?.trim()).toContain('Generate a brief');
    });

    it('cannot stage without a brief, a template, an audience, and a project', () => {
      selectEmail();
      expect(internals().canStageEmail()).toBe(false);

      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();
      // A brief alone is not enough: `hubspot.go` refuses a blank sourceEmailId.
      expect(internals().canStageEmail()).toBe(false);

      internals().selectedEmailTemplateId.set('hs-123');
      fixture.detectChanges();
      // Still not enough. campaign-service's `resolveBuiltAudience` refuses to stage a brief with
      // no BUILT audience, so enabling here would start the HubSpot draft work only to have the
      // send refused afterwards -- which is what the panel's own copy promises it will not do.
      expect(internals().canStageEmail()).toBe(false);

      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(true);
    });

    it('refuses to stage on an audience that is not BUILT', () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');

      // Upstream's three states are building | built | failed, and a build that ENDS in `failed`
      // still returns an audience object. Gating on existence alone re-admits exactly the
      // dispatcher refusal the gate exists to prevent.
      internals().emailAudience.set({ id: 'aud-1', status: 'failed' } as never);
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(false);

      internals().emailAudience.set({ id: 'aud-1', status: 'building' } as never);
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(false);

      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();
      expect(internals().canStageEmail()).toBe(true);
    });

    it('does not announce a failed audience as built', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().emailAudience.set({ id: 'aud-1', status: 'failed' } as never);
      fixture.detectChanges();

      const panel = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-built"]');
      // A green check beside the word "failed" tells the operator the opposite of what happened.
      expect(panel?.textContent).toContain('Audience build failed');
      expect(panel?.textContent).not.toContain('Audience built');
    });

    it('counts suppression lists, not the characters of an encoded one', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().emailAudience.set({ id: 'aud-1', status: 'built', suppressionListIds: ['sup-1'] } as never);
      fixture.detectChanges();

      const panel = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-built"]');
      // Upstream declares ArrayOf(String). If it ever arrived JSON-encoded, `.length` would read
      // the STRING length and report "9 suppression list(s)" for a single list -- a
      // compliance-facing number on a send list, wrong by a factor of nine.
      expect(panel?.textContent).toContain('1 suppression list(s) applied');
    });

    it('refuses to stage if the audience stops being built before the await', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'failed' } as never);
      // A cached brief id, so `ensureEmailBriefId` cannot be what stops this. Without it the
      // default `persistBrief` stub NEVER emits and the test would pass on the hang instead of
      // on the guard -- which is exactly how it survived its first mutation run.
      internals().emailBriefId.set('brief-77');
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign');

      await internals().onStageEmailSend();

      // The re-check exists because a signal can change between the guard and the await. Leaving
      // the audience out of it let the enumeration drift from `canStageEmail`, so the refusal
      // would come back from HubSpot after the draft work had begun.
      expect(create).not.toHaveBeenCalled();
    });

    it("sends the selected type's STAGE, not its id", async () => {
      selectEmail();
      const gen = vi
        .spyOn(TestBed.inject(CampaignService), 'generateEmailCopy')
        .mockReturnValue(of({ enabled: true, copy: { subject: 's', preheader: 'p', body: '<p>b</p>', cta: 'c' } }) as never);

      // The type is chosen BEFORE the brief id is cached, deliberately. An earlier revision set
      // `emailBriefId` first and then switched to a different stage, which pinned the id across a
      // stage change -- the exact desync `onSelectEmailType` now clears, so that ordering asserted
      // the bug rather than the contract. Selecting first, then caching, keeps this test about the
      // stage-vs-type-id distinction it is named for.
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');
      // BOTH set after the type change: it now clears the brief output as well as the id, since
      // the previous stage's CONTENT would otherwise be persisted under the new stage.
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-77');

      await internals().onGenerateEmailCopy();

      // campaign-service enumerates STAGES, not type ids -- sending 'thank-you-survey' would be
      // refused by its enum. Several types share a stage, which is why the two are distinct.
      expect(gen).toHaveBeenCalledWith('tlf', 'brief-77', 'Post-Event');
    });

    it('ranks templates matching the selected type first, without removing any', () => {
      selectEmail();
      const templates = [
        { id: '1', name: 'Registration reminder', subject: 'Register now' },
        { id: '2', name: 'Post-event thank you', subject: 'Survey inside' },
        { id: '3', name: 'Unrelated newsletter', subject: 'Monthly update' },
      ];
      internals().emailTemplates.set(templates as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      const rendered = internals().emailTemplatesRendered();

      // The match rises...
      expect(rendered[0].id).toBe('2');
      // ...but NOTHING is removed. A filter would hide a template the operator may know is right
      // and the keywords do not describe, and cloning writes a real HubSpot draft.
      expect(rendered.map((t: { id: string }) => t.id).sort()).toEqual(['1', '2', '3']);
    });

    it('leaves the order untouched when nothing matches', () => {
      selectEmail();
      const templates = [
        { id: '1', name: 'Alpha', subject: 'One' },
        { id: '2', name: 'Beta', subject: 'Two' },
      ];
      internals().emailTemplates.set(templates as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      // Ties keep the server's newest-first order, so an unmatched list is identical to what the
      // picker showed before ranking existed.
      expect(
        internals()
          .emailTemplatesRendered()
          .map((t: { id: string }) => t.id)
      ).toEqual(['1', '2']);
    });

    it('ranks before the render cap, so a match beyond it can still surface', () => {
      selectEmail();
      // 600 unmatched rows, then the match -- comfortably past HUBSPOT_TEMPLATE_RENDER_LIMIT.
      const templates = Array.from({ length: 600 }, (_, i) => ({ id: `u${i}`, name: 'Unrelated', subject: 'Monthly update' }));
      templates.push({ id: 'match', name: 'Post-event thank you', subject: 'Survey inside' });
      internals().emailTemplates.set(templates as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      // Ranking AFTER the slice could only reorder the first HUBSPOT_TEMPLATE_RENDER_LIMIT
      // rows -- the one template the operator was looking for would have been cut before it
      // could rise.
      expect(internals().emailTemplatesRendered()[0].id).toBe('match');
    });

    /**
     * Name and subject are searched INDEPENDENTLY, never concatenated.
     *
     * Every other fixture puts each keyword wholly inside one field, so an implementation that
     * joined the two would score identically and pass them all. This is the case that separates
     * them: `thank you` is a multi-word type keyword, and a template whose name ends "Thank" and
     * whose subject begins "you" must NOT score for it -- a match across the boundary between two
     * unrelated fields is a coincidence of adjacency, not a description of the template.
     */
    it('does not score a keyword split across the name and subject boundary', () => {
      selectEmail();
      internals().emailTemplates.set([
        // The SPLIT row is listed FIRST by the server, so the server order and the correct order
        // disagree. That is what makes this test able to fail: with the real match listed first,
        // `['real','split']` holds under a concatenating scorer too, and the assertion proved
        // nothing.
        //
        // Splits `thank you` across the two fields. Scores 0 independently, 1 under concatenation
        // -- and 1 is enough to hold its incoming position ahead of a row that scores 0.
        { id: 'split', name: 'Speaker Thank', subject: 'you are invited' },
        // A REAL match, listed second: it must rise to the top on score alone.
        { id: 'real', name: 'Post-event survey', subject: 'Share feedback' },
      ] as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      // ORDER is the observable, and the fixture is built so it changes: 'real' matches three
      // keywords, 'split' matches none -- unless the fields are joined, when it matches one. Two
      // rows that both score 0 would keep the server's order under either implementation, which
      // is why an earlier version of this test could not fail.
      expect(
        internals()
          .emailTemplatesRendered()
          .map((t) => t.id)
      ).toEqual(['real', 'split']);
      // The split row must not have scored at all. With a concatenating scorer it scores 1, and
      // a row scoring 1 sorts above every 0-scoring row -- so a THIRD, unmatched row makes the
      // difference visible in the ordering rather than only in an internal number.
      internals().emailTemplates.set([
        { id: 'zero', name: 'Quarterly update', subject: 'Newsletter' },
        { id: 'split', name: 'Speaker Thank', subject: 'you are invited' },
      ] as never);
      expect(
        internals()
          .emailTemplatesRendered()
          .map((t) => t.id),
        'the split phrase scored, so the fields were concatenated'
      ).toEqual(['zero', 'split']);
    });

    /**
     * The type score must COUNT matched keywords, not merely report that one matched.
     *
     * Every prior case compared a multi-keyword match against zero-score rows, so collapsing the
     * reduce to a boolean left them all green — ranking would silently stop distinguishing a
     * three-keyword match from a one-keyword one, which is the whole point of scoring.
     */
    it('ranks a template matching more type keywords above one matching fewer', () => {
      selectEmail();
      // `final-countdown` carries seven keywords. The first row matches one, the second several,
      // and BOTH are non-zero — so only a counting score can order them.
      internals().emailTemplates.set([
        { id: 'one', name: 'Deadline reminder', subject: 'Sign up' },
        { id: 'many', name: 'Final countdown: last chance, closing soon', subject: 'Deadline' },
      ] as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('final-countdown');

      expect(
        internals()
          .emailTemplatesRendered()
          .map((t) => t.id)
      ).toEqual(['many', 'one']);
    });

    /**
     * The index tie-break at a NON-ZERO score. Testing it only at score 0 leaves the comparator's
     * `|| a.index - b.index` unverified for the case it exists for: several templates matching the
     * type equally, where the server's newest-first order must survive the sort.
     */
    it('keeps the server order among templates that score equally above zero', () => {
      selectEmail();
      // All three carry the same type keyword, so they score identically and only `index` orders
      // them. Ids are deliberately NOT alphabetical, so a comparator falling back to any other
      // key would reorder them visibly.
      internals().emailTemplates.set([
        { id: 'zebra', name: 'Post-event thank you', subject: 'Survey inside' },
        { id: 'alpha', name: 'Post-event thank you', subject: 'Survey inside' },
        { id: 'mike', name: 'Post-event thank you', subject: 'Survey inside' },
      ] as never);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      expect(
        internals()
          .emailTemplatesRendered()
          .map((t) => t.id)
      ).toEqual(['zebra', 'alpha', 'mike']);
    });

    /**
     * The cap banner must not claim "the FIRST 100" once a spliced row is among them — that is
     * false in exactly the case the splice exists for.
     */
    it('does not claim the drawn rows are the first N when a selection was spliced in', () => {
      selectEmail();
      const templates: { id: string; name: string; subject: string }[] = [{ id: 'chosen', name: 'Bespoke', subject: 'Nothing' }];
      for (let i = 0; i < 600; i++) {
        templates.push({ id: `t${i}`, name: 'Post-event thank you', subject: 'Survey inside' });
      }
      internals().emailTemplates.set(templates as never);
      (internals() as unknown as { onSelectEmailTemplate(id: string): void }).onSelectEmailTemplate('chosen');
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      // Present but NOT promoted: the spliced row takes the last slot, so the first row remains a
      // genuine ranking result. That is what makes the banner's "Showing N of M" honest.
      const drawn = internals().emailTemplatesRendered();
      expect(drawn[drawn.length - 1].id).toBe('chosen');
      expect(internals().emailTemplatesRenderCapMessage()).not.toContain('first');
    });

    /**
     * Reranking must never HIDE the operator's current choice.
     *
     * Ranking depends on the chosen type, so switching type reorders the list under a selection
     * already made: with enough matches for the new type the selected row drops below the render
     * cap and disappears. Nothing else notices — `canStageEmail` stays enabled and staging still
     * clones that now-invisible template, so the operator stages a clone of something they can no
     * longer see or change.
     */
    it('keeps the selected template visible after a type change reranks the list', () => {
      selectEmail();
      // The operator's pick names no type keyword, so reranking sinks it; the 600 rows that follow
      // all match the new type and crowd it out of the first 100 drawn.
      const templates: { id: string; name: string; subject: string }[] = [{ id: 'chosen', name: 'Bespoke template', subject: 'Nothing in particular' }];
      for (let i = 0; i < 600; i++) {
        templates.push({ id: `t${i}`, name: 'Post-event thank you', subject: 'Survey inside' });
      }
      internals().emailTemplates.set(templates as never);
      (internals() as unknown as { onSelectEmailTemplate(id: string): void }).onSelectEmailTemplate('chosen');
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      const rendered = internals().emailTemplatesRendered();
      expect(rendered.some((t) => t.id === 'chosen')).toBe(true);
      // In the LAST slot, not the first. Promoting it kept the row visible but put a zero-scoring
      // template above every matching one, which contradicts the ranking invariant: the first row
      // is meant to be the best suggestion. Visible-but-not-promoted satisfies both.
      expect(rendered[rendered.length - 1].id).toBe('chosen');
      // And the first row is still a genuine match, which is the invariant that was broken.
      expect(rendered[0].id).not.toBe('chosen');
      // The cap is still honoured — the splice replaces a row rather than appending one.
      expect(rendered.length).toBe(HUBSPOT_TEMPLATE_RENDER_LIMIT);
    });

    it('renders the selector defaulted to the registration push type', () => {
      selectEmail();
      fixture.detectChanges();

      // The picker lives above the PLANNER now, not on Implement. It moved because the stage it
      // resolves to is part of a brief's identity upstream, so it has to be answered before the
      // lookup rather than after a brief already exists.
      // `data-test`, not `data-testid`: that is the attribute `lfx-select` renders from its
      // `dataTest` input. Querying `data-testid` matched the <lfx-select> HOST element instead of
      // the control, so this passed for the wrong reason — the same trap the sibling test below
      // documents.
      const sel = (fixture.nativeElement as HTMLElement).querySelector('[data-test="campaigns-email-stage-select"]');
      expect(sel, 'the email-type selector is not rendered above the planner').not.toBeNull();

      // The RENDERED label, not the signal, and not the form value either. The raw <select> this
      // replaced ignored a `[value]` binding applied before its options existed and fell back to
      // the FIRST option -- so the signal read "main-registration-push" while the control showed
      // CFP Launch, and an operator who never touched the selector silently got CFP copy. Reading
      // the control's own text is the only assertion that can see that class of bug; driving the
      // handler, or reading the FormControl, cannot.
      expect(sel?.textContent).toContain('Main Registration Push');
      expect(sel?.textContent).not.toContain('CFP Launch');

      // The signal the rest of the component reads must agree with what is on screen.
      expect(internals().selectedEmailTypeId()).toBe('main-registration-push');
    });

    // Implement DISPLAYS the type; it must not offer a second control for it. Two selectors bound
    // to the same `emailType` control is what the bots caught: only the planner's lookup follows a
    // change, so switching type on Implement moved the stage while `emailBriefId` still named the
    // previous stage's brief, and generation then sent the new stage against the old brief's id.
    it('shows the chosen type on implement without a second selector', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const display = host.querySelector('[data-testid="campaigns-email-type-display"]');
      expect(display, 'implement does not show which email type is selected').not.toBeNull();
      expect(display?.textContent).toContain('Main Registration Push');

      // `data-test`, not `data-testid`: that is the attribute `lfx-select` renders from its
      // `dataTest` input, and querying the wrong one returns null on a control that IS present --
      // which would make this assertion pass for the wrong reason.
      expect(
        host.querySelector('[data-test="campaigns-email-type-select"]'),
        'implement still renders a second email-type selector; changing it there desyncs the loaded brief'
      ).toBeNull();
    });

    it('drops copy written for the previous type when the type changes', () => {
      selectEmail();
      internals().emailCopy.set({ subject: 'CFP copy', preheader: '', body: '<p>x</p>', cta: '' } as never);

      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      // The copy on screen was written for the PREVIOUS stage -- its subject, tone and CTA all
      // belong to it. `onStageEmailSend` reads `emailCopy()` unconditionally, so leaving it makes
      // mismatched copy stageable under the new type's label.
      expect(internals().emailCopy()).toBeNull();
    });

    it('drops the previous copy when a regeneration fails', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-77');
      internals().emailCopy.set({ subject: 'Old subject', preheader: '', body: '<p>Old</p>', cta: '' } as never);
      vi.spyOn(TestBed.inject(CampaignService), 'generateEmailCopy').mockReturnValue(of({ enabled: true, error: 'upstream refused' }) as never);

      await internals().onGenerateEmailCopy();

      // `onStageEmailSend` reads `emailCopy()` unconditionally, so stale copy left here is
      // stageable -- the operator would send the OLD subject and body while the panel says the
      // regeneration failed.
      expect(internals().emailCopy()).toBeNull();
    });

    it('does not call an unconfirmed build "building"', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().emailAudience.set({ id: 'aud-1', status: 'building' } as never);
      fixture.detectChanges();

      const card = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-built"]');
      // The whole argument for this state is that "building" tells the operator the wrong thing:
      // the row is not in flight, it is a finished build whose outcome upstream could not
      // confirm, and the ids in the summary may need reconciling.
      expect(card?.textContent).toContain('unconfirmed');
      expect(card?.textContent).not.toContain('Audience built');
    });

    it('does NOT offer a rebuild while the outcome is unconfirmed', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().emailAudience.set({ id: 'aud-1', status: 'building' } as never);
      fixture.detectChanges();

      // Upstream keeps a row BUILDING when a HubSpot list may already exist, and records the ids
      // to reconcile. Observed live: "HubSpot lists ALREADY CREATED (reconcile these before
      // retrying): 30779". A rebuild here creates the duplicate contact list that state exists
      // to prevent -- so the control must be absent, not merely disabled.
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-btn"]')).toBeNull();
    });

    it('says why staging is blocked while the outcome is unconfirmed', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'building' } as never);
      fixture.detectChanges();

      const hint = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-stage-hint"]');
      // With no retry offered, the copy is the ONLY thing telling the operator what to do next.
      expect(hint?.textContent).toContain('reconcile');
    });

    it('keeps a rebuild control when the audience build failed', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().emailAudience.set({ id: 'aud-1', status: 'failed' } as never);
      fixture.detectChanges();

      // Without this the panel is a DEAD END: the status card replaces the button, canStageEmail
      // refuses anything but `built`, and there is no poll and no re-read route -- so the only
      // escape was re-running the Plan-tab scrape.
      const btn = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-audience-btn"]');
      expect(btn).not.toBeNull();
    });

    it('explains a disabled Stage button when the audience is present but not built', () => {
      selectEmail();
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'failed' } as never);
      fixture.detectChanges();

      // The hint chain tested PRESENCE while the guard tested STATUS, so this state fell through
      // every branch and rendered an empty span -- a disabled button with no reason, which the
      // panel's own comment says it exists to prevent.
      const hint = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-stage-hint"]');
      expect(hint?.textContent?.trim()).toBeTruthy();
      expect(hint?.textContent).toContain('failed');
    });

    it('says the audience is what is missing when only it is missing', () => {
      selectEmail();
      // The hint lives in the Implement panel; without this the panel never renders and the
      // query below would be vacuously undefined rather than asserting anything.
      internals().selectedEmailTab.set('implementation');
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      fixture.detectChanges();

      const hint = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-stage-hint"]');
      // A disabled button with no reason reads as a broken panel -- the same standard the
      // no-brief case above is held to.
      expect(hint?.textContent?.trim()).toContain('Build the send audience');
    });

    it('drops the previous brief id when a new brief arrives', () => {
      selectEmail();
      internals().emailBriefId.set('brief-old');
      internals().emailAudience.set({ id: 'aud-old', status: 'built' } as never);

      internals().onEmailProceedToImplementation(emailBrief);

      // `ensureEmailBriefId` returns the cached id when it is set, so a stale one silently points
      // the audience build, the copy generation and the staged draft at the PREVIOUS event's row.
      expect(internals().emailBriefId()).toBe('');
      expect(internals().emailAudience()).toBeNull();
    });

    it('persists the brief FIRST, then creates with the returned brief id', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      // Staging requires a BUILT audience upstream; these predate that gate.
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: 'W/"1"' }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1', result: undefined, error: undefined }));

      await internals().onStageEmailSend();

      // The ORDER is the point: creation posts to /briefs/{id}/campaigns, so a create issued
      // before the persist resolved would have no id to address.
      expect(persistBrief).toHaveBeenCalled();
      const [request, slug, briefId] = create.mock.calls[0];
      expect(briefId).toBe('brief-77');
      expect(slug).toBe('tlf');
      // Asserts the VALUE and where it came from, not merely that create ran.
      expect(request.platforms).toEqual(['hubspot']);
      expect(request.hubspotConfig).toEqual({ sourceEmailId: 'hs-123' });
      expect(request.eventSlug).toBe('kubecon-eu-2026');
      expect(request.eventName).toBe('KubeCon EU 2026');
      // 'staging', NOT 'done'. The create answers 202 with a job id and the HubSpot clone, the
      // audience resolution and the copy application all run in the background job -- so the ack
      // alone is not a created draft. This assertion said 'done' before polling landed, which is
      // exactly the claim that made a dispatcher failure read as success.
      expect(internals().emailStaging()).toBe('staging');
    });

    it('drops the brief-derived state when the foundation changes', async () => {
      selectEmail();
      internals().emailBriefId.set('brief-from-old-foundation');
      internals().emailAudience.set({ id: 'aud-old', status: 'built' } as never);

      TestBed.inject(ProjectContextService).setFoundation({ uid: 'f-b', slug: 'foundation-b', name: 'Foundation B' }, false);
      await fixture.whenStable();
      fixture.detectChanges();

      // `emailBriefId` names a row in the PREVIOUS foundation, and `ensureEmailBriefId` returns
      // the cached id when set -- so carrying it across would point the audience build, the copy
      // generation and the staged draft at the old foundation's brief while the page says the new
      // one. Silently, because every call still succeeds against that row.
      expect(internals().emailBriefId()).toBe('');
      expect(internals().emailAudience()).toBeNull();
    });

    it('does not cache a brief id that never reached approved', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockReturnValue(of({ enabled: true, briefId: 'brief-77', approved: false }) as never);

      const id = await (internals() as unknown as { ensureEmailBriefId(b: unknown, p: string): Promise<string> }).ensureEmailBriefId(emailBrief, 'tlf');

      // campaign-service gates build-audience AND campaign creation on `approved`, so a cached
      // unapproved id makes every downstream call fail against a brief this session believes is
      // ready -- and the cache short-circuits, so a retry never re-attempts the approval.
      expect(id).toBe('');
      expect(internals().emailBriefId()).toBe('');
    });

    it('reuses a brief this session already owns instead of trying to create a second', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      const persist = vi
        .spyOn(TestBed.inject(CampaignService), 'persistBrief')
        .mockReturnValue(of({ enabled: true, approved: true, briefId: 'brief-77' }) as never);
      // The ownership record the PAID save writes when it generates or restores a brief.
      (internals() as unknown as { knownBriefIds: Map<string, unknown> }).knownBriefIds.set(
        (internals() as unknown as { ownershipKey(p: string, b: unknown): string }).ownershipKey('tlf', emailBrief),
        { id: 'brief-77', etag: 'W/"3"' }
      );

      await (internals() as unknown as { ensureEmailBriefId(b: unknown, p: string): Promise<string> }).ensureEmailBriefId(emailBrief, 'tlf');

      // A first-save call sends no brief_id and is refused as `unowned-brief-exists` against a row
      // this session actually owns. Reusing the recorded id is what keeps a second save on the
      // same brief from looking like an attempt to create a duplicate.
      const [, , knownId, knownEtag] = persist.mock.calls[0] as unknown as [unknown, string, string | null, string | null];
      expect(knownId).toBe('brief-77');
      expect(knownEtag).toBe('W/"3"');
    });

    // The ownership map is keyed on the SAME four parts campaign-service keys a brief on. Under
    // the old two-part key (project, event) an event's paid brief and every stage of its email
    // series shared one entry, so recording one overwrote the others -- and the next save of a
    // sibling sent that other brief's id and was refused as `unowned-brief-exists`. That is the
    // exact failure the reuse test above depends on NOT happening.
    // The stage IS the brief's identity upstream, so changing the type changes WHICH brief the
    // Implement tab is working on. Moving the picker above the planner re-pointed the planner's
    // LOOKUP, but the parent's cached `emailBriefId` is separate state and survived the change --
    // so generate and stage ran the new stage against the previous stage's row. Staging is the
    // one that writes: it clones a HubSpot draft against that brief's audience.
    it('drops the cached brief id when the type change moves the stage', () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-cfp');

      // 'main-registration-push' -> 'thank-you-survey' is a real STAGE change
      // (Registration Push -> Post-Event), not merely a label change.
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      expect(internals().emailBriefId(), 'the previous stage brief id survived a type change; generate and stage would address the wrong row').toBe('');
    });

    // The other half of the gate, and the one a wholesale reset would break. Twelve types collapse
    // onto six stages -- `cfp-launch` and `colocated-cfp-reminder` are both CFP Launch -- so
    // switching between two types that share a stage addresses the SAME brief upstream. Discarding
    // the loaded brief there would make the operator re-fetch and re-generate for no reason, and
    // would silently drop a built audience. Resetting only when the STAGE moves is what separates
    // the two cases; without this test, a reset on every type change passes just as happily.
    // Clearing the cached ID alone is not enough. `emailBriefOutput` holds the CONTENT of the
    // previous stage's brief, and `ensureEmailBriefId` persists whatever it is handed — so with an
    // empty id it creates a NEW row for the new stage carrying the OLD stage's copy, which is the
    // wrong-brief association the id clearing exists to prevent, reached one step later.
    it('drops the previous stage brief output, not just its id', () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().emailBriefId.set('brief-cfp');

      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      expect(internals().emailBriefId()).toBe('');
      expect(internals().emailBriefOutput(), "the previous stage's brief content survived; a persist would file it under the new stage").toBeNull();
    });

    // An UNAPPROVED restore must not cache the id. `ensureEmailBriefId` short-circuits on a
    // non-empty `emailBriefId`, so caching an unapproved brief's id means the persist -- which is
    // what approves -- never runs again, and audience, copy and staging keep failing against a
    // brief campaign-service will not create from. `persistEmailBrief` already applies this exact
    // rule at its own call site ("caching that id would make every downstream call fail"); the
    // restore path is the other way in.
    it('does not cache the restored brief id when the stored brief is unapproved', () => {
      selectEmail();

      (
        internals() as unknown as {
          onRestoreSavedEmailBrief(b: unknown, id: string, etag: string | null, approved: boolean): void;
        }
      ).onRestoreSavedEmailBrief(emailBrief, 'brief-unapproved', 'W/"2"', false);

      expect(internals().emailBriefId(), 'an unapproved brief id was cached; ensureEmailBriefId will short-circuit and never retry approval').toBe('');
    });

    it('caches the restored brief id when the stored brief IS approved', () => {
      selectEmail();

      (
        internals() as unknown as {
          onRestoreSavedEmailBrief(b: unknown, id: string, etag: string | null, approved: boolean): void;
        }
      ).onRestoreSavedEmailBrief(emailBrief, 'brief-approved', 'W/"2"', true);

      expect(internals().emailBriefId()).toBe('brief-approved');
    });

    // A live staging POLL must be cancelled by a stage change, not merely counted past.
    // `pollStagingJob` never reads `emailStagingGeneration`, so bumping it only guards the awaits
    // BEFORE the poll starts. A subscription already running keeps writing `done`/`error` — and
    // announces "Draft created" for the PREVIOUS send under the newly selected stage.
    // `resetEmailBriefDerivedState` cancels it for exactly this reason; the stage-change path has
    // the same hazard and had none of the protection.
    it('cancels a live staging poll when the type change moves the stage', () => {
      selectEmail();
      internals().emailStaging.set('staging');
      const sub = { unsubscribe: vi.fn(), closed: false };
      (internals() as unknown as { stagingJobSubscription: unknown }).stagingJobSubscription = sub;

      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('thank-you-survey');

      expect(sub.unsubscribe, 'the previous stage poll kept running and can still report against the new stage').toHaveBeenCalled();
      expect((internals() as unknown as { stagingJobSubscription: unknown }).stagingJobSubscription).toBeNull();
      expect(internals().emailStaging()).toBe('idle');
    });

    // `conflictMessages` is SHARED with the paid persist banner, so the email-only "re-select this
    // email type" step must not live in it -- paid has no type selector, and an earlier revision
    // told paid users to use one. The step belongs to `emailSaveFailureMessage`, the one caller
    // that knows a stage is involved.
    it('keeps the email re-select step out of the shared conflict copy', () => {
      selectEmail();
      const shared = (internals() as unknown as { conflictMessages: Record<string, string> }).conflictMessages;

      expect(shared['unowned-brief-exists'], 'the shared copy names a control the paid surface does not have').not.toContain('email type');

      const priv = internals() as unknown as {
        emailBriefConflict: string | null;
        emailSaveFailureMessage(c: string): string;
      };
      priv.emailBriefConflict = 'unowned-brief-exists';
      const emailCopy = priv.emailSaveFailureMessage('so no audience was built.');
      expect(emailCopy, 'the email path dropped the re-select step').toContain('Re-select this email type');
    });

    // `stale-brief` and `unverified-validator` return a NON-EMPTY briefId with approved:false, so
    // recording the conflict only when the id is empty dropped it — and the operator got the
    // generic "Try again" copy for a refusal that retrying alone cannot clear. That is the exact
    // gap `emailBriefConflict` was added to close.
    it.each([['stale-brief'], ['unverified-validator']])('records the %s conflict even though the server returned a brief id', async (conflict) => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockReturnValue(
        of({ enabled: true, briefId: 'brief-77', etag: null, created: false, approved: false, conflict }) as never
      );

      await (internals() as unknown as { ensureEmailBriefId(b: unknown, p: string): Promise<string> }).ensureEmailBriefId(emailBrief, 'tlf');

      const priv = internals() as unknown as { emailBriefConflict: string | null; emailSaveFailureMessage(c: string): string };
      expect(priv.emailBriefConflict, 'the conflict was dropped because the server returned an id').toBe(conflict);
      expect(priv.emailSaveFailureMessage('so no audience was built.')).not.toContain('The brief could not be saved,');
    });

    // Ownership is what `onRestoreSavedEmailBrief`'s own JSDoc calls "the part that matters", and
    // no test asserted it: removing the `rememberBriefId` block left the restore tests green.
    // Without the record, the next save arrives with no `knownBriefId` and is refused as
    // `unowned-brief-exists` — against a row this session demonstrably just opened.
    //
    // The UNAPPROVED case is the one that needs it most: `emailBriefId` deliberately stays empty
    // there, so ownership is the ONLY thing carrying the restore forward.
    it.each([
      ['an approved brief', true, 'brief-approved'],
      ['an unapproved brief', false, 'brief-unapproved'],
    ])('records ownership when restoring %s', (_label, approved, id) => {
      selectEmail();

      (
        internals() as unknown as {
          onRestoreSavedEmailBrief(b: unknown, id: string, etag: string | null, approved: boolean): void;
        }
      ).onRestoreSavedEmailBrief(emailBrief, id, 'W/"4"', approved);

      const priv = internals() as unknown as {
        ownershipKey(p: string, b: unknown): string | null;
        knownBriefIds: Map<string, { id: string; etag: string | null }>;
        activeFoundationSlug(): string;
      };
      // The handler keys on `activeFoundationSlug()`, so the test must read the same source rather
      // than hardcode a slug -- a mismatch here would look like "no ownership recorded".
      const key = priv.ownershipKey(priv.activeFoundationSlug(), emailBrief);
      expect(key).not.toBeNull();
      expect(priv.knownBriefIds.get(key as string), 'the restore recorded no ownership; the next save will be refused as unowned').toEqual(
        expect.objectContaining({ id, etag: 'W/"4"' })
      );
    });

    it('keeps the loaded brief when two types share one stage', () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('cfp-launch');
      internals().emailBriefId.set('brief-cfp');

      (internals() as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('colocated-cfp-reminder');

      expect(internals().emailBriefId(), 'a same-stage type change discarded the loaded brief; it addresses the same row upstream').toBe('brief-cfp');
    });

    it('keys ownership per delivery type and stage, not per event', () => {
      const key = (b: unknown): string => (internals() as unknown as { ownershipKey(p: string, b: unknown): string }).ownershipKey('tlf', b);

      const paid = { ...emailBrief, deliveryType: 'paid-marketing', emailStage: undefined };
      const cfp = { ...emailBrief, deliveryType: 'email', emailStage: 'CFP Launch' };
      const countdown = { ...emailBrief, deliveryType: 'email', emailStage: 'Final Countdown' };

      const keys = [key(paid), key(cfp), key(countdown)];
      expect(new Set(keys).size, `siblings of one event collapsed onto the same ownership key: ${JSON.stringify(keys)}`).toBe(3);

      // A brief with no delivery type is a pre-000030 row, and every one of those was paid. It
      // must land on the SAME key as an explicit paid brief, or restoring a legacy brief would
      // orphan the ownership record written for the same row under its explicit identity.
      const legacy = { ...emailBrief, deliveryType: undefined, emailStage: undefined };
      expect(key(legacy)).toBe(key(paid));
    });

    it('reports an error when the staging job FAILS after the ack', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailBriefId.set('brief-77');
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1', result: undefined, error: undefined }) as never);
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(of({ campaigns: [], errors: ['hubspot refused the clone'] }) as never);

      await internals().onStageEmailSend();

      // The failure the ack hid: the draft was never created, and saying "Draft created in
      // HubSpot" would send the operator looking for something that does not exist.
      expect(internals().emailStaging()).toBe('error');
      expect(internals().emailStagingMessage()).toContain('hubspot refused the clone');
    });

    it('reports done once the staging job settles successfully', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailBriefId.set('brief-77');
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'job-1', result: undefined, error: undefined }) as never);
      vi.spyOn(TestBed.inject(CampaignService), 'getCreateResult').mockReturnValue(of({ campaigns: [], errors: [] }) as never);

      await internals().onStageEmailSend();

      expect(internals().emailStaging()).toBe('done');
    });

    it('carries the generated copy into hubspotConfig when copy exists', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      // Staging requires a BUILT audience upstream; these predate that gate.
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      internals().emailCopy.set({ subject: 'Three days in Amsterdam', preheader: 'P', body: '<p>Join us</p>', cta: 'Register' });
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // The VALUES, not merely that the keys exist: a staging call that sent the template id but
      // dropped the copy would look identical in a shape-only assertion.
      expect(create.mock.calls[0][0].hubspotConfig).toEqual({
        sourceEmailId: 'hs-123',
        subject: 'Three days in Amsterdam',
        bodyHtml: '<p>Join us</p>',
      });
    });

    it('omits subject and bodyHtml entirely when no copy was generated', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      // Staging requires a BUILT audience upstream; these predate that gate.
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(of({ jobId: 'j1' }));

      await internals().onStageEmailSend();

      // Empty strings would be wrong, not merely untidy: upstream reads a blank subject as
      // "leave the template's own", so sending '' claims copy that does not exist.
      expect(create.mock.calls[0][0].hubspotConfig).toEqual({ sourceEmailId: 'hs-123' });
    });

    it('does NOT create when the persist returns no brief id', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      // Staging requires a BUILT audience upstream; these predate that gate.
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', briefId: '', etag: null }));
      const create = vi.spyOn(TestBed.inject(CampaignService), 'createCampaign');

      await internals().onStageEmailSend();

      // Creating without an id would post to /briefs//campaigns; refusing is the safe arm.
      expect(create).not.toHaveBeenCalled();
      expect(internals().emailStaging()).toBe('error');
      expect(internals().emailStagingMessage()).not.toBe('');
    });

    it('reports a create failure rather than claiming the draft was staged', async () => {
      selectEmail();
      internals().emailBriefOutput.set(emailBrief);
      internals().selectedEmailTemplateId.set('hs-123');
      // Staging requires a BUILT audience upstream; these predate that gate.
      internals().emailAudience.set({ id: 'aud-1', status: 'built' } as never);
      fixture.detectChanges();

      persistBrief.mockReturnValue(of({ status: 'saved', approved: true, briefId: 'brief-77', etag: null }));
      vi.spyOn(TestBed.inject(CampaignService), 'createCampaign').mockReturnValue(
        of({ jobId: '', result: undefined, error: 'platform campaign creation failed' })
      );

      await internals().onStageEmailSend();

      expect(internals().emailStaging()).toBe('error');
      expect(internals().emailStagingMessage()).toBe('platform campaign creation failed');
    });
  });
});

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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: MessageService, useValue: { add: vi.fn() } }],
    }).compileComponents();
    fixture = TestBed.createComponent(CampaignsComponent);
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
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    const slider = budgetSlider();
    expect(slider).not.toBeNull();

    // Drag the split to 30% search / 70% display.
    slider!.value = '30';
    slider!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(budgetLabel()).toContain('Search 30%');
    expect(budgetLabel()).toContain('Display 70%');

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
    expect(budgetLabel()).toContain('Display 70%');
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
  }
  const picker = (): PickerInternals => fixture.componentInstance as unknown as PickerInternals;

  beforeEach(async () => {
    ctx = signal<ProjectContext | null>({ uid: 'u1', name: 'The Linux Foundation', slug: 'tlf', logoUrl: '' } as ProjectContext);
    await TestBed.configureTestingModule({
      imports: [CampaignsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext: ctx, activeContextUid: computed(() => ctx()?.uid ?? '') } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CampaignsComponent);
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
   * weak signal is NOT turned into a confident pre-selection.
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
     * A pending search must release a SUGGESTED selection at dispatch, not only when it answers.
     *
     * Every arm that clears the template list also released the suggestion, but all of them run
     * after the response lands. In between, the loading branch hides the list while
     * `canStageEmail` still reads only `selectedEmailTemplateId` -- and `onStageEmailSend`
     * snapshots that id before its first await. So the operator could stage a suggestion the
     * in-flight search was about to remove, with the row that justified it already off screen:
     * a silent wrong clone, which is the exact failure this feature exists to prevent.
     *
     * Asserts the state DURING the flight -- the request is deliberately left unanswered, because
     * flushing it is what the old code needed in order to look correct.
     */
    it('releases a suggested selection when a new search is dispatched, before it answers', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('KubeCon Europe 2026', 'kubecon-eu-2026'));
      picker().searchEmailTemplates('kubecon');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'k26', name: 'KubeCon Europe 2026 announcement', subject: 'Register now' }] as HubSpotMarketingEmail[],
      });

      // The suggestion took, and it is SYSTEM-owned -- the precondition for the release.
      expect(picker().selectedEmailTemplateId()).toBe('k26');
      expect(picker().emailTemplateSuggestionId()).toBe('k26');

      // Dispatch a narrower search and leave it IN FLIGHT.
      picker().searchEmailTemplates('workshop');
      fixture.detectChanges();

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
     * An UN-LISTED generic long word still pre-selects, and that is the known trade-off.
     *
     * `EVENT_TERM_GENERIC` is a vocabulary, so a generic word nobody has added yet -- `developer`
     * -- still scores the double weight and clears the threshold alone. This test pins the
     * CURRENT behaviour rather than asserting it is correct: the honest statement of the limit is
     * that the deny-list closes words someone has noticed, and the next un-noticed one is a fresh
     * false positive.
     *
     * It is here so the limit is visible and measured. If the scoring ever becomes structural --
     * corroboration, or evidence weighted by rarity -- this test flips to `toBe('')` and the
     * change is deliberate rather than silent.
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

    it('still pre-selects on an un-enumerated generic long word (known limit)', () => {
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
      expect(picker().selectedEmailTemplateId()).toBe('current');
    });

    it('pre-selects the template whose name carries the event, and says what it matched', () => {
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
      expect(picker().selectedEmailTemplateId()).toBe('mcp');
      // The REASON must be visible; a suggestion nobody can check is one nobody should trust.
      expect(picker().emailTemplateSuggestionTerms()).toContain('nairobi');
      expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-template-suggestion"]')).not.toBeNull();
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

    it('stops calling the selection system-chosen once the operator picks it themselves', () => {
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

      const c = fixture.componentInstance as unknown as { onSelectEmailTemplate(id: string): void };
      // Override to another row, then deliberately pick the suggested one BACK.
      c.onSelectEmailTemplate('kc');
      c.onSelectEmailTemplate('mcp');
      fixture.detectChanges();

      // The ids coincide again -- an equality check would still say "system chose this".
      expect(picker().emailTemplateSuggestionId()).toBe('mcp');
      expect(picker().selectedEmailTemplateId()).toBe('mcp');

      expect(
        fixture.nativeElement.querySelector('[data-testid="campaigns-email-template-suggestion"]'),
        "the banner called the operator's own re-pick a pre-selection"
      ).toBeNull();
      expect(
        (fixture.componentInstance as unknown as { emailTemplateSuggestionAnnouncement(): string }).emailTemplateSuggestionAnnouncement(),
        "the screen-reader announcement called the operator's own re-pick a pre-selection"
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
      expect(picker().selectedEmailTemplateId()).toBe('mcp');

      picker().onSelectEmailTemplate('other');
      picker().searchEmailTemplates('');
      respond({ enabled: true, error: null, possiblyTruncated: false, emails });

      expect(picker().selectedEmailTemplateId()).toBe('other');
    });

    /**
     * The worst state this feature can reach: a banner announcing a pre-selected template while no
     * VISIBLE row carries it.
     *
     * Ranking and the suggestion agree on the event half but not the type half, and a tie falls to
     * the server's original order — so a genuinely-suggested template can rank below enough
     * type-keyword matches to be cut by the 100-row render limit. The operator would then be told
     * something was chosen for them with no way to see or change it. The selected row is spliced
     * back in at the top for exactly this reason.
     *
     * Built to reproduce it: 150 rows that match six keywords of the seven-keyword
     * `final-countdown` type, plus one true KubeCon template that matches none of them.
     */
    it('always draws the selected row, even when ranking would cut it past the render limit', () => {
      showPicker();
      picker().selectedEmailTypeId.set('final-countdown');
      picker().emailBriefOutput.set(briefFor('KubeCon North America', 'kubecon-na-2026'));
      picker().searchEmailTemplates('');

      const noise = Array.from({ length: 150 }, (_, i) => ({
        id: `noise-${i}`,
        name: `Final countdown: last chance, closing deadline, closes soon #${i}`,
      })) as HubSpotMarketingEmail[];
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [...noise, { id: 'kc', name: 'KubeCon NA 2026 Modern Template' } as HubSpotMarketingEmail],
      });

      expect(picker().emailTemplateSuggestionId()).toBe('kc');
      expect(picker().selectedEmailTemplateId()).toBe('kc');
      // The assertion that matters: it is actually DRAWN, not merely selected.
      expect(
        picker()
          .emailTemplatesRendered()
          .some((t) => t.id === 'kc')
      ).toBe(true);
      // And the render cap is still honoured — the splice replaces a row, it does not append.
      expect(picker().emailTemplatesRendered().length).toBe(HUBSPOT_TEMPLATE_RENDER_LIMIT);
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
     * event in the same foundation — where it is both wrong AND silently suppresses the new
     * suggestion, since the derivation only fills an empty selection. The feature would fail
     * precisely on the second event.
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
      expect(picker().selectedEmailTemplateId()).toBe('mcp');

      (fixture.componentInstance as unknown as { resetEmailBriefDerivedState(): void }).resetEmailBriefDerivedState();
      expect(picker().selectedEmailTemplateId()).toBe('');
    });

    /**
     * The banner asserts what is SELECTED, so it must not survive an override. Keyed on the
     * suggestion merely existing, it read "pre-selected ... for this event" beside a template the
     * derivation never chose.
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
      // behaviour where a city could be presented as a reason.
      expect(picker().emailTemplateSuggestionTerms()).toContain('kubecon');
    });

    /** The banner is one sentence; an @if between text nodes rendered "event . Pick a different". */
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
      expect(text).toContain('. Pick a different one to override it.');
    });

    /**
     * The type is the tie-break, so it must be re-applied when the type CHANGES. A suggestion made
     * under Registration Push is the wrong answer once the operator switches to CFP Launch — and
     * left alone the stale template stayed selected and would have been the one staged.
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
      expect(picker().selectedEmailTemplateId()).toBe('reg');

      (fixture.componentInstance as unknown as { onSelectEmailType(id: string): void }).onSelectEmailType('cfp-launch');
      expect(picker().selectedEmailTemplateId()).toBe('cfp');
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
     * not reliably announced — so a screen-reader user could miss that a template was chosen for
     * them and that it is the one staging will use.
     */
    it('announces the auto-selection through the existing live region', () => {
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
      expect(live).toContain('MCP Dev Summit Nairobi registration');
      expect(live).toContain('nairobi');

      // Silent once the operator overrides — it no longer describes what is selected.
      picker().onSelectEmailTemplate('mcp-other');
      fixture.detectChanges();
      const after = fixture.nativeElement.querySelector('[data-testid="campaigns-email-templates-live"]')?.textContent ?? '';
      expect(after).not.toContain('Template selected for this event');
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
     * A search that drops the auto-selected row must release it.
     *
     * Only the suggestion id was cleared, not the selection — so after a narrowed search the id
     * stayed selected while the banner hid (it renders only while the suggestion IS the
     * selection), and staging would clone a template no longer in the list. The same
     * silent-wrong-clone the feature exists to prevent, reached from the other direction.
     */
    it('releases an auto-selected template when a search no longer returns it', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'mcp', name: 'MCP Dev Summit Nairobi registration' }] as HubSpotMarketingEmail[],
      });
      expect(picker().selectedEmailTemplateId()).toBe('mcp');

      // A narrowed search that no longer returns the auto-selected row.
      picker().searchEmailTemplates('newsletter');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'other', name: 'Monthly newsletter' }] as HubSpotMarketingEmail[],
      });

      expect(picker().selectedEmailTemplateId()).toBe('');
    });

    /**
     * ID equality cannot establish provenance.
     *
     * After suggestion A the operator can pick B, then deliberately pick A again — the ids
     * coincide, so an equality check treats their explicit choice as system-owned and silently
     * releases it on the next search. Provenance is a fact about how the value was SET.
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
      expect(picker().selectedEmailTemplateId()).toBe('mcp');

      // Away and deliberately back to the SAME id — now the operator's choice, not the system's.
      picker().onSelectEmailTemplate('other');
      picker().onSelectEmailTemplate('mcp');

      picker().searchEmailTemplates('newsletter');
      respond({ enabled: true, error: null, possiblyTruncated: false, emails: [{ id: 'n', name: 'Monthly newsletter' }] as HubSpotMarketingEmail[] });

      expect(picker().selectedEmailTemplateId()).toBe('mcp');
    });

    /**
     * A FAILED search must release a system-owned selection too.
     *
     * `applyEventTemplateSuggestion` runs only after a successful listing, so the error arms set
     * `emailTemplates` to null while leaving the auto-selected id in place — invisible, since
     * there is no list to show it in, and still stageable.
     */
    it('releases an auto-selected template when the search fails', () => {
      showPicker();
      picker().emailBriefOutput.set(briefFor('MCP Dev Summit Nairobi', 'mcp-dev-summit-nairobi'));
      picker().searchEmailTemplates('');
      respond({
        enabled: true,
        error: null,
        possiblyTruncated: false,
        emails: [{ id: 'mcp', name: 'MCP Dev Summit Nairobi registration' }] as HubSpotMarketingEmail[],
      });
      expect(picker().selectedEmailTemplateId()).toBe('mcp');

      picker().searchEmailTemplates('anything');
      respond({ enabled: true, error: 'HubSpot refused the search', possiblyTruncated: false, emails: [] });

      expect(picker().selectedEmailTemplateId()).toBe('');
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
     * "Template selected for this event: . Choose another" — which tells a screen-reader user
     * nothing about what was chosen for them.
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
    // The only other searchEmailTemplates call site is onEmailProceedToImplementation, so
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

  it('lists the templates a search returned, dropping any row with no id', () => {
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
  it('leaves the list NULL when the search fails, rather than empty', () => {
    picker().searchEmailTemplates('kubecon');
    const req = httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails');
    req.flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(picker().emailTemplates()).toBeNull();
    expect(picker().emailTemplatesError()).toBeTruthy();
  });

  it('leaves the list NULL when the service reports an upstream error', () => {
    picker().searchEmailTemplates('');
    respond({ enabled: true, error: 'HubSpot refused the request', possiblyTruncated: false, emails: [] });

    expect(picker().emailTemplates()).toBeNull();
    expect(picker().emailTemplatesError()).toBe('HubSpot refused the request');
  });

  // Not an error: the steady state wherever HubSpot is not connected for the foundation.
  it('reports a disconnected channel without rendering it as a failure', () => {
    picker().searchEmailTemplates('');
    respond({ enabled: false, error: null, possiblyTruncated: false, emails: [] });

    expect(picker().emailChannelEnabled()).toBe(false);
    expect(picker().emailTemplatesError()).toBeNull();
    expect(picker().emailTemplates()).toBeNull();
  });

  it('distinguishes a successful empty search from a failure', () => {
    picker().searchEmailTemplates('nothing-matches');
    respond({ enabled: true, error: null, possiblyTruncated: false, emails: [] });

    expect(picker().emailTemplates()).toEqual([]);
    expect(picker().emailTemplatesError()).toBeNull();
  });

  // possiblyTruncated is only meaningful for an EMPTY query. Telling someone to narrow a search
  // that was already exhaustive sends them hunting for a template that does not exist.
  it('carries the truncation warning through', () => {
    picker().searchEmailTemplates('');
    respond({ enabled: true, error: null, possiblyTruncated: true, emails: [{ id: '1', name: 'One' }] });

    expect(picker().emailTemplatesTruncated()).toBe(true);
  });

  it('refuses to search without a foundation rather than listing another portal', () => {
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
   * that does not exist (`campaign.interface.ts:1223-1226`), so this copy is the only place a
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
  it('clears the picker when the foundation changes', () => {
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

  it('records the chosen template id, which is what sourceEmailId takes', () => {
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
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext: ctx, activeContextUid: computed(() => ctx()?.uid ?? '') } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CampaignsComponent);
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
  it('ignores a stale response that lands after a newer search', () => {
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
   * WCAG 1.4.1: the selected row must not be distinguished by colour alone.
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
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(true), providerReady: signal(true) } },
      ],
    }).compileComponents();
    fgaFixture = TestBed.createComponent(CampaignsComponent);
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
    onEmailProceedToImplementation(brief: unknown): void;
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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: MessageService, useValue: { add: vi.fn() } }],
    }).compileComponents();
    fixture = TestBed.createComponent(CampaignsComponent);
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
  it('does not offer Refresh when no brief id is resolvable', () => {
    internals().emailBriefId.set('');
    internals().emailBriefOutput.set(null);
    internals().emailMetricsState.set('idle');
    fixture.detectChanges();

    expect(internals().canRefreshEmailMetrics()).toBe(false);
  });

  it('offers Refresh in the recoverable idle state a reset leaves behind', () => {
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

    internals().onEmailProceedToImplementation(brief);
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

  it('picks up an ownership entry recorded AFTER the computed was first read', () => {
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
    internals().onEmailProceedToImplementation(brief);
    internals().emailMetricsState.set('idle');
    fixture.detectChanges();

    // First read: no entry yet, so this caches `false`.
    expect(internals().canRefreshEmailMetrics()).toBe(false);

    const key = internals().ownershipKey(internals().activeFoundationSlug(), brief);
    internals().rememberBriefId(key as string, { id: 'b-late', etag: null });
    fixture.detectChanges();

    expect(internals().canRefreshEmailMetrics()).toBe(true);
  });

  it('does not offer Refresh when the ownership cache holds no row for this event', () => {
    // Same shape, cache deliberately empty: proves the previous test passes BECAUSE of the entry
    // rather than because the reset happens to leave something else enabled.
    const brief = { eventDetails: { name: 'KubeCon Europe 2026', slug: 'kubecon-eu-2026' } };
    internals().onEmailProceedToImplementation(brief);
    internals().emailMetricsState.set('idle');
    fixture.detectChanges();

    expect(internals().canRefreshEmailMetrics()).toBe(false);
  });

  it('does not offer Refresh without a foundation slug', () => {
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

  it('does not offer Refresh while a load is already in flight', () => {
    internals().emailBriefId.set('b-monitor');
    internals().emailMetricsState.set('loading');
    fixture.detectChanges();

    expect(internals().canRefreshEmailMetrics()).toBe(false);
  });
});
