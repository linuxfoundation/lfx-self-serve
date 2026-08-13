// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Signal, WritableSignal } from '@angular/core';
import type {
  CampaignBriefOutput,
  CampaignBriefPersistResult,
  CampaignBriefPersistenceState,
  CampaignImplementationDraft,
  CampaignDeliveryType,
  CampaignProgramType,
  CampaignTab,
  CampaignTabOption,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { provideRouter } from '@angular/router';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
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
  function restore(b: CampaignBriefOutput, briefId: string): void {
    (fixture.componentInstance as unknown as { onRestoreSavedBrief(b: CampaignBriefOutput, id: string): void }).onRestoreSavedBrief(b, briefId);
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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
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

    expect(state()).toEqual({ status: 'saved', briefId: 'brief-9', message: null });
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

    expect(state()).toEqual({ status: 'off', briefId: null, message: null });
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
      expect(state()).toEqual({ status: 'off', briefId: null, message: null });
    });

    it('drops a save that resolves after the foundation changed', async () => {
      const late = new Subject<CampaignBriefPersistResult>();
      persistBrief.mockReturnValue(late);

      proceed();
      selectFoundation('cncf');
      await fixture.whenStable();

      late.next({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: true });
      await fixture.whenStable();

      expect(state()).toEqual({ status: 'off', briefId: null, message: null });
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
    implementationDraft: WritableSignal<CampaignImplementationDraft | null>;
    resetToPlanning(): void;
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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
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

  it('does not claim a brief is ready when none has been generated', () => {
    // The Implement tab is directly clickable — no disabled binding — so this panel is reachable
    // before anything has been generated, and "Your brief is ready" is then simply false, told to
    // someone who has not started. The rest of the panel explains what is missing from the
    // channel, which is true either way.
    internals().selectorForm.controls.deliveryType.setValue('email');
    internals().selectTab('implementation', 'email');
    fixture.detectChanges();

    const pending = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-implementation-pending"]');
    expect(pending, 'the pending panel must render').not.toBeNull();
    expect(pending?.textContent).not.toContain('Your brief is ready');
    expect(pending?.textContent).toContain('Staging an email clones');

    internals().onEmailProceedToImplementation({ eventDetails: { name: 'KubeCon', slug: 'kubecon' } } as CampaignBriefOutput);
    internals().selectTab('implementation', 'email');
    fixture.detectChanges();

    const withBrief = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="campaigns-email-implementation-pending"]');
    expect(withBrief?.textContent).toContain('Your brief is ready');
    // The two sentences must stay separated — a review round raised `preserveWhitespaces: false`
    // collapsing the separator between the `@if` block and the following text into
    // `ready.Staging`.
    //
    // It does not happen: Angular keeps a space at that boundary. Stated plainly, this assertion
    // was NOT binding as originally written (`not.toContain('ready.Staging')`) — the compiler
    // normalizes the join either way, so it could not fail. In a suite whose whole purpose is
    // pinning behaviours one line away from silently regressing, an unfailable assertion is worse
    // than none: the next person copies it believing the separation is protected. Asserting the
    // separator POSITIVELY does bind.
    expect(withBrief?.textContent).toMatch(/ready\.\s+Staging an email/);
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
 * `ImplementationTabComponent` stays inside the lazy `@switch` — it resolves ad-account lists in
 * `ngOnInit`, so mounting it eagerly the way LFXV2-3202 mounts the planner would issue that
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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(CampaignsComponent);
    fixture.detectChanges();
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

  it('does not replay one event edits onto a different brief', async () => {
    // The guard that makes the draft safe to hold un-keyed on the parent. Without it, generating
    // a brief for event B and opening Implement would restore event A's copy over it.
    internals().implementationDraft.set({
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

    internals().onProceedToImplementation(briefFor('event-b'));
    internals().selectTab('implementation', 'paid-marketing');
    fixture.detectChanges();
    await fixture.whenStable();

    // Event B's own generated copy stands.
    expect(headlineInput()?.value).toBe('Generated A');
  });
});
