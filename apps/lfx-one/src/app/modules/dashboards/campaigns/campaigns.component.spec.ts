// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CampaignBriefOutput, CampaignBriefPersistResult, CampaignBriefPersistenceState, ProjectContext } from '@lfx-one/shared/interfaces';
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
    it('does not lend a RESTORED brief id to another event', async () => {
      persistBrief.mockReturnValue(NEVER);
      restore(brief, 'restored-a');
      await fixture.whenStable();

      // Back to Planning by clicking the tab — no reset runs — then proceed with a brief for a
      // different event.
      (fixture.componentInstance as unknown as { selectTab(t: string): void }).selectTab('planning');
      proceed(otherBrief);
      await fixture.whenStable();

      expect(persistBrief).toHaveBeenLastCalledWith(otherBrief, expect.anything(), null, null);
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
      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), 'restored-a', null);
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
      // first — so the message must say the work is intact and reloading shows their version.
      // Sharing one sentence would tell a user who CAN save that they cannot.
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: null, created: false, approved: false, conflict: 'stale-brief' }));

      proceed();
      await fixture.whenStable();

      expect(state().status).toBe('error');
      expect(state().message).toContain('Someone else changed this brief');
      expect(state().message).not.toContain('was not opened here');
      // DOES advise a reload on this branch, unlike the base. LFXV2-3108 adds the read path, so
      // a reload re-looks-up the stored brief and offers it for restore — the user sees the other
      // writer's version instead of losing their own ownership state, which is what made the same
      // sentence harmful while nothing could read a brief back.
      expect(state().message).toContain('Reload and re-enter the event URL to see their changes');
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
    it('forgets the brief id when the program changes', async () => {
      persistBrief.mockReturnValue(of({ enabled: true, briefId: 'b-1', etag: '"1"', created: true, approved: true }));
      proceed();
      await fixture.whenStable();

      switchProgram();
      proceed();
      await fixture.whenStable();

      expect(persistBrief).toHaveBeenLastCalledWith(brief, expect.anything(), null, null, false);
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
