// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MailingListAudienceAccess, MailingListSyncMode } from '@lfx-one/shared/enums';
import type { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MailingListService } from '@services/mailing-list.service';
import { MessageService } from 'primeng/api';
import { asapScheduler, delay, dematerialize, materialize, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MailingListSyncSettingsComponent } from './mailing-list-sync-settings.component';

const baseList: GroupsIOMailingList = {
  uid: 'list-1',
  group_name: 'maintainers',
  public: true,
  source: 'api',
  type: 'discussion_open' as GroupsIOMailingList['type'],
  audience_access: MailingListAudienceAccess.PUBLIC,
  description: 'A test mailing list description long enough to pass validation.',
  title: 'Maintainers List',
  service_uid: 'service-1',
  project_uid: 'project-1',
  project_name: 'Test Project',
  project_slug: 'test-project',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  subscriber_count: 10,
  writer: true,
  committees: [{ uid: 'committee-1', name: 'Technical Steering Committee' }],
};

describe('MailingListSyncSettingsComponent', () => {
  let fixture: ComponentFixture<MailingListSyncSettingsComponent>;
  let updateMailingList: ReturnType<typeof vi.fn>;
  let getMailingListsByCommittee: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  const render = async (
    mailingList: GroupsIOMailingList,
    options: {
      flagEnabled?: boolean;
      siblingLists?: GroupsIOMailingList[];
      siblingCandidates?: GroupsIOMailingList[];
      updateResult?: GroupsIOMailingList | 'error';
      updateDeferred?: boolean;
      committeeUid?: string;
    } = {}
  ): Promise<void> => {
    TestBed.resetTestingModule();
    updateMailingList = options.updateDeferred
      ? vi.fn(() => new Subject<GroupsIOMailingList>())
      : vi.fn(() =>
          // materialize/delay(0, asapScheduler)/dematerialize so a failed save's catchError revert
          // lands asynchronously, matching the real network round-trip — letting tests observe the
          // optimistic toggle state before it reverts (#4880 review regression test). A bare delay(0)
          // does NOT delay error notifications (RxJS passes errors through `delay` immediately, only
          // `next`/`complete` are queued), so the error is materialized into a `next` notification
          // first to force it through the delay queue. asapScheduler (microtask-based) rather than
          // the default async (real-timer) scheduler so `await fixture.whenStable()` — which only
          // flushes microtasks/the Angular zone, not real timers — actually observes the revert.
          options.updateResult === 'error'
            ? throwError(() => new Error('upstream rejected')).pipe(materialize(), delay(0, asapScheduler), dematerialize())
            : of(options.updateResult ?? mailingList)
        );
    getMailingListsByCommittee = vi.fn(() => of(options.siblingLists ?? []));
    messageAdd = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MailingListSyncSettingsComponent],
      providers: [
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(options.flagEnabled ?? true)) } },
        { provide: MailingListService, useValue: { updateMailingList, getMailingListsByCommittee } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MailingListSyncSettingsComponent);
    fixture.componentRef.setInput('mailingList', mailingList);
    if (options.siblingCandidates) {
      fixture.componentRef.setInput('siblingCandidates', options.siblingCandidates);
    }
    if (options.committeeUid) {
      fixture.componentRef.setInput('committeeUid', options.committeeUid);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('renders the section for a committee writer when the flag is on', async () => {
    await render(baseList);

    expect(fixture.nativeElement.querySelector('[data-testid="mailing-list-sync-settings"]')).toBeTruthy();
  });

  it('hides the section when the viewer is not a writer on the mailing list', async () => {
    await render({ ...baseList, writer: false });

    expect(fixture.nativeElement.querySelector('[data-testid="mailing-list-sync-settings"]')).toBeFalsy();
  });

  it('hides the section when the feature flag is off', async () => {
    await render(baseList, { flagEnabled: false });

    expect(fixture.nativeElement.querySelector('[data-testid="mailing-list-sync-settings"]')).toBeFalsy();
  });

  it('sends the full resource payload (not just sync_mode) so upstream does not reject the write', async () => {
    await render(baseList);

    fixture.componentInstance['onToggleChange'](true);

    expect(updateMailingList).toHaveBeenCalledWith(
      'list-1',
      expect.objectContaining({
        name: baseList.group_name,
        service_id: baseList.service_uid,
        committee_uid: 'committee-1',
        sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
      })
    );
  });

  it('scopes to the committeeUid input, not committees[0], when a list is linked to more than one committee (#4899 review)', async () => {
    const multiCommitteeList: GroupsIOMailingList = {
      ...baseList,
      committees: [
        { uid: 'committee-1', name: 'Technical Steering Committee' },
        { uid: 'committee-2', name: 'Marketing Committee' },
      ],
    };
    await render(multiCommitteeList, { committeeUid: 'committee-2' });

    fixture.componentInstance['onToggleChange'](true);

    // Reverting to `committees?.[0]` would write committee-1 here and still pass every other test
    // in this file, since they all use a single-committee fixture (dealako #4899 review).
    expect(updateMailingList).toHaveBeenCalledWith('list-1', expect.objectContaining({ committee_uid: 'committee-2' }));
  });

  it('disables the toggle when another mailing list already syncs with this committee', async () => {
    await render(baseList, { siblingLists: [{ ...baseList, uid: 'list-2', sync_mode: MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE }] });

    const toggle = fixture.debugElement.query((el) => el.name === 'lfx-toggle')?.componentInstance;
    expect(toggle?.disabled()).toBe(true);
  });

  it('logs and shows an error toast when the save fails', async () => {
    await render(baseList, { updateResult: 'error' });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    fixture.componentInstance['onToggleChange'](false);
    await fixture.whenStable();

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    consoleErrorSpy.mockRestore();
  });

  it('flips the toggle immediately on click, then reverts it if the save fails (#4899 review)', async () => {
    // baseList needs sync_mode already set so the attempted "off" click actually moves syncOn — with
    // no sync_mode set, the pre-click and post-revert states are both false and a broken revert
    // (e.g. reverting to the wrong value, or not reverting at all) couldn't fail this test.
    // updateDeferred holds the PUT open on a Subject instead of resolving synchronously — a
    // synchronous throwError (as plain updateResult: 'error' produces) completes save()'s
    // catchError before onToggleChange() even returns, so the "immediately" assertion below would
    // already be observing the post-revert state instead of the optimistic one.
    const syncedList = { ...baseList, sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST };
    await render(syncedList, { updateDeferred: true });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    fixture.componentInstance['onToggleChange'](false);
    expect(fixture.componentInstance['syncOn']()).toBe(false);

    const pendingUpdate = updateMailingList.mock.results[0].value as Subject<GroupsIOMailingList>;
    pendingUpdate.error(new Error('upstream rejected'));
    await fixture.whenStable();

    // The persisted state is "on" — the revert should land back there, not stay stuck at the
    // optimistically-set "off" value from the failed click.
    expect(fixture.componentInstance['syncOn']()).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  it('reuses siblingCandidates instead of fetching getMailingListsByCommittee when provided (#4899 review)', async () => {
    const sibling = { ...baseList, uid: 'list-2', sync_mode: MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE };
    await render(baseList, { siblingCandidates: [baseList, sibling] });

    expect(getMailingListsByCommittee).not.toHaveBeenCalled();
    const toggle = fixture.debugElement.query((el) => el.name === 'lfx-toggle')?.componentInstance;
    expect(toggle?.disabled()).toBe(true);
  });

  it("syncs the toggle to a newly-displayed list even while a previous list's save is still in flight (#4899 review)", async () => {
    // This component can be reused across a route navigation from one mailing list's page to
    // another (take(1), not takeUntilDestroyed, so a save survives the input swap). A guard keyed
    // on a bare `saving` boolean would wrongly skip syncing the toggle to list-2's own persisted
    // state because *some* save is still in flight — even though it belongs to list-1, not list-2.
    const listOne = { ...baseList, uid: 'list-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST };
    await render(listOne, { updateDeferred: true });

    fixture.componentInstance['onToggleChange'](false);
    expect(fixture.componentInstance['syncOn']()).toBe(false);

    const listTwo = { ...baseList, uid: 'list-2', sync_mode: MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE };
    fixture.componentRef.setInput('mailingList', listTwo);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['syncOn']()).toBe(true);
  });

  it('emits savingChange while a save is in flight (#4899 review)', async () => {
    await render(baseList, { updateDeferred: true });
    const savingChanges: boolean[] = [];
    fixture.componentInstance.savingChange.subscribe((v) => savingChanges.push(v));

    fixture.componentInstance['onToggleChange'](true);
    await fixture.whenStable();

    expect(savingChanges).toContain(true);
  });

  it('emits the submitted sync_mode when the save response omits it (#4899 review)', async () => {
    // Guards the stale-merge fix in save(): the indexed record `updateMailingList` resolves with
    // doesn't carry `sync_mode` yet (upstream lfx-v2-mailing-list-service #101/#104 gap), so
    // `{ ...ml, ...result }` alone would silently re-emit the pre-save mode. Without the explicit
    // `sync_mode: syncMode` override this test would still pass, because `updateResult` here (like
    // every other case in this file) defaults to a full `GroupsIOMailingList`, which already carries
    // the correct value — it has to omit `sync_mode` from the mocked response to exercise the gap.
    const synced = { ...baseList, sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional strip, not a read
    const { sync_mode: _omit, ...response } = synced;
    await render(synced, { updateResult: response as GroupsIOMailingList });
    const emitted: GroupsIOMailingList[] = [];
    fixture.componentInstance.updated.subscribe((v) => emitted.push(v));

    fixture.componentInstance['onToggleChange'](false);
    await fixture.whenStable();

    expect(emitted[0]?.sync_mode).toBe(MailingListSyncMode.MANUAL);
  });

  it('reverts the toggle to the persisted state when a sync-settings save fails', async () => {
    await render(baseList, { updateResult: 'error' });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const toggle = (): boolean | undefined => fixture.debugElement.query((el) => el.name === 'lfx-toggle')?.componentInstance?.checked();

    // baseList has no sync_mode, so the persisted (pre-click) state is off.
    fixture.componentInstance['onToggleChange'](true);
    fixture.detectChanges();
    expect(fixture.componentInstance['syncOn']()).toBe(true);
    expect(toggle()).toBe(true);

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['syncOn']()).toBe(false);
    expect(toggle()).toBe(false);
    consoleErrorSpy.mockRestore();
  });

  it('looks up sibling mailing lists once the feature flag flips on after initial render', async () => {
    TestBed.resetTestingModule();
    const flagEnabled = signal(false);
    updateMailingList = vi.fn(() => of(baseList));
    getMailingListsByCommittee = vi.fn(() => of([]));
    messageAdd = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MailingListSyncSettingsComponent],
      providers: [
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => flagEnabled) } },
        { provide: MailingListService, useValue: { updateMailingList, getMailingListsByCommittee } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MailingListSyncSettingsComponent);
    fixture.componentRef.setInput('mailingList', baseList);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getMailingListsByCommittee).not.toHaveBeenCalled();

    flagEnabled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getMailingListsByCommittee).toHaveBeenCalledWith('committee-1');
  });

  it('disables the toggle and surfaces a retry affordance when the sibling lookup fails', async () => {
    TestBed.resetTestingModule();
    updateMailingList = vi.fn(() => of(baseList));
    getMailingListsByCommittee = vi.fn(() => throwError(() => new Error('upstream down')));
    messageAdd = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [MailingListSyncSettingsComponent],
      providers: [
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: MailingListService, useValue: { updateMailingList, getMailingListsByCommittee } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MailingListSyncSettingsComponent);
    fixture.componentRef.setInput('mailingList', baseList);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['siblingLookupFailed']()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="sibling-lookup-failed-notice"]')).toBeTruthy();
    const toggle = fixture.debugElement.query((el) => el.name === 'lfx-toggle')?.componentInstance;
    expect(toggle?.disabled()).toBe(true);

    // Retry re-runs the lookup against the same committee uid — once it succeeds, the failure
    // state clears and the toggle re-enables (#4880 review).
    getMailingListsByCommittee.mockReturnValue(of([]));
    fixture.componentInstance['retrySiblingLookup']();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['siblingLookupFailed']()).toBe(false);
    expect(toggle?.disabled()).toBe(false);
    expect(getMailingListsByCommittee).toHaveBeenCalledTimes(2);
    consoleErrorSpy.mockRestore();
  });

  it('keeps the toggle disabled while the sibling lookup is in flight, even once it resolves to no sibling', async () => {
    TestBed.resetTestingModule();
    updateMailingList = vi.fn(() => of(baseList));
    // getMailingListsByCommittee's real signature returns Observable<GroupsIOMailingList[]>, and the
    // component pipes directly off that return value (`.pipe(catchError(...), switchMap(...))`) — a
    // mocked Promise has no `.pipe` and throws. A manually-controlled Subject keeps the lookup "in
    // flight" until resolveLookup() fires, without breaking the Observable contract.
    const lookupSubject = new Subject<GroupsIOMailingList[]>();
    getMailingListsByCommittee = vi.fn(() => lookupSubject.asObservable());
    const resolveLookup = (): void => {
      lookupSubject.next([]);
      lookupSubject.complete();
    };
    messageAdd = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MailingListSyncSettingsComponent],
      providers: [
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: MailingListService, useValue: { updateMailingList, getMailingListsByCommittee } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MailingListSyncSettingsComponent);
    fixture.componentRef.setInput('mailingList', baseList);
    fixture.detectChanges();

    let toggle = fixture.debugElement.query((el) => el.name === 'lfx-toggle')?.componentInstance;
    expect(toggle?.disabled()).toBe(true);

    resolveLookup();
    await fixture.whenStable();
    fixture.detectChanges();

    toggle = fixture.debugElement.query((el) => el.name === 'lfx-toggle')?.componentInstance;
    expect(toggle?.disabled()).toBe(false);
  });

  it('emits the pre-save enriched resource with the submitted sync_mode, not the raw PUT response', async () => {
    // updateMailingList's indexed response lacks GET-only enrichment (writer, committee names) and
    // hasn't caught up to the submitted sync_mode yet — the parent must still receive both (#4880
    // review / see also #4899).
    await render(baseList, {
      updateResult: { uid: 'list-1', group_name: 'maintainers', committees: [{ uid: 'committee-1' }] } as GroupsIOMailingList,
    });
    const emitted = vi.fn();
    fixture.componentInstance.updated.subscribe(emitted);

    fixture.componentInstance['onToggleChange'](true);
    await fixture.whenStable();

    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ writer: true, sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }));
    // The raw PUT response's `committees` entry is uid-only (no `name`) — asserting the emitted
    // entry still carries the enriched name proves the result is no longer spread on top of `ml`
    // (lfx-one review: a plain `...result` spread would let this less-enriched copy win).
    expect(emitted.mock.calls[0][0].committees[0].name).toBe('Technical Steering Committee');
  });

  it('does not emit a save result after the component has been destroyed', async () => {
    // The save is fire-and-forget (take(1), not takeUntilDestroyed — see save()'s comment), so a
    // real network round-trip can resolve after the user has already navigated away. Use an
    // asynchronous response (asapScheduler) so the destroy below happens before the result lands,
    // matching that race rather than the synchronous `of()` used elsewhere in this file (#4880
    // review).
    TestBed.resetTestingModule();
    updateMailingList = vi.fn(() => of(baseList).pipe(delay(0, asapScheduler)));
    getMailingListsByCommittee = vi.fn(() => of([]));
    messageAdd = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MailingListSyncSettingsComponent],
      providers: [
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: MailingListService, useValue: { updateMailingList, getMailingListsByCommittee } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MailingListSyncSettingsComponent);
    fixture.componentRef.setInput('mailingList', baseList);
    fixture.detectChanges();
    await fixture.whenStable();

    const emitted = vi.fn();
    fixture.componentInstance.updated.subscribe(emitted);

    fixture.componentInstance['onToggleChange'](true);
    fixture.destroy();
    await fixture.whenStable();

    expect(emitted).not.toHaveBeenCalled();
  });

  it('disables the direction selector and toggle while lockedBySibling is true (#4899 review)', async () => {
    const syncedList = { ...baseList, sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST };
    await render(syncedList, { siblingCandidates: [syncedList] });

    fixture.componentRef.setInput('lockedBySibling', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['form'].controls.direction.disabled).toBe(true);
    const toggle = fixture.debugElement.query((el) => el.name === 'lfx-toggle')?.componentInstance;
    expect(toggle?.disabled()).toBe(true);

    fixture.componentRef.setInput('lockedBySibling', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['form'].controls.direction.disabled).toBe(false);
  });

  it('does not re-fetch sibling lists when a standalone instance receives a new object for the same list (#4899 review)', async () => {
    // A parent re-render (e.g. a route re-resolve) can hand this standalone instance a fresh
    // `mailingList` object with the same uid/committee — `lastFetchKey` should short-circuit the
    // network fetch rather than treating the new object identity as a reason to refetch.
    await render(baseList);
    expect(getMailingListsByCommittee).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('mailingList', { ...baseList });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getMailingListsByCommittee).toHaveBeenCalledTimes(1);
  });
});
