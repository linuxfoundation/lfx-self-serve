// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Signal, WritableSignal } from '@angular/core';
import { computed, signal } from '@angular/core';
import type {
  CampaignBriefOutput,
  CampaignBriefPersistResult,
  CampaignBriefPersistenceState,
  CampaignImplementationDraft,
  CampaignDeliveryType,
  CampaignIndexDoc,
  CampaignListResult,
  CampaignProgramType,
  CampaignTab,
  CampaignTabOption,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { provideRouter } from '@angular/router';
import { CampaignService } from '@services/campaign.service';
import { HUBSPOT_TEMPLATE_RENDER_LIMIT } from '@lfx-one/shared/constants';
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

  /** `onRestoreSavedBrief` is protected; the spec drives it as the Planning tab's output would. */
  function restore(b: CampaignBriefOutput, briefId: string, approved = false): void {
    (fixture.componentInstance as unknown as { onRestoreSavedBrief(b: CampaignBriefOutput, id: string, approved: boolean): void }).onRestoreSavedBrief(
      b,
      briefId,
      approved
    );
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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: MessageService, useValue: { add: vi.fn() } }],
    }).compileComponents();
    persistBrief = vi.fn();
    vi.spyOn(TestBed.inject(CampaignService), 'persistBrief').mockImplementation(persistBrief);
    fixture = TestBed.createComponent(CampaignsComponent);
    await fixture.whenStable();
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
   * in every environment where the cutover is dark, which is the default in all of them.
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

    // Not 'saved' with an empty id: the flag being off is the default everywhere, so it has to
    // look like the ordinary case rather than like a save that returned nothing.
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

      // `null` ETag alongside a real id: a restore has no load-time validator to carry
      // (LFXV2-3204), so ownership is proven while the staleness check falls back to the
      // freshly read one until this session's own save returns a validator.
      // `true` — a restore is an explicit decision to work from the stored brief, so its absent
      // validator is permission rather than an unknown. Marking it unknown would refuse the first
      // save after every restore, which is this feature's main path.
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

      it('clears the previous brief campaigns when the foundation changes', async () => {
        const list = vi
          .spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns')
          .mockReturnValue(of({ campaigns: [indexed()], possiblyStale: false, statusToggleEnabled: true }));
        await withSavedBrief();
        load();
        await fixture.whenStable();
        expect(campaigns()).toHaveLength(1);

        list.mockReturnValue(of({ campaigns: [], possiblyStale: false, statusToggleEnabled: true }));
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
        late.next({ campaigns: [indexed()], possiblyStale: false, statusToggleEnabled: true });
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
        vi.spyOn(TestBed.inject(CampaignService), 'listBriefCampaigns').mockReturnValue(of({ campaigns: [], possiblyStale: false, statusToggleEnabled: true }));
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
          .mockReturnValue(of({ campaigns: [indexed({ campaign_name: 'Brief A campaign' })], possiblyStale: false, statusToggleEnabled: true }));
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
        pending.next({ campaigns: [indexed({ id: 'c-2', campaign_name: 'Brief B campaign' })], possiblyStale: false, statusToggleEnabled: true });
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

        list.mockReturnValue(of({ campaigns: [indexed()], possiblyStale: false, statusToggleEnabled: true }));
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
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  function respond(body: { enabled: boolean; error: string | null; possiblyTruncated: boolean; emails: HubSpotMarketingEmail[] }): void {
    const req = httpMock.expectOne((r) => r.url === '/api/campaigns/hubspot/emails');
    req.flush(body);
    fixture.detectChanges();
  }

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
   * reading "Showing the first 100 of 100" would satisfy an existence check while telling the
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
    expect(banner).toBe(`Showing the first ${HUBSPOT_TEMPLATE_RENDER_LIMIT} of ${HUBSPOT_TEMPLATE_RENDER_LIMIT + 37}. Search to narrow the list.`);

    // A screen-reader user cannot see the banner, so the same fact reaches the live region.
    expect(picker().emailTemplatesAnnouncement()).toContain(`Showing the first ${HUBSPOT_TEMPLATE_RENDER_LIMIT} of ${HUBSPOT_TEMPLATE_RENDER_LIMIT + 37}`);

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
