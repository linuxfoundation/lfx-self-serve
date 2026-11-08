// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MailingListAudienceAccess, MailingListSyncMode } from '@lfx-one/shared/enums';
import type { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MailingListService } from '@services/mailing-list.service';
import { MessageService } from 'primeng/api';
import { asapScheduler, delay, dematerialize, materialize, of, throwError } from 'rxjs';
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
    options: { flagEnabled?: boolean; siblingLists?: GroupsIOMailingList[]; updateResult?: GroupsIOMailingList | 'error' } = {}
  ): Promise<void> => {
    TestBed.resetTestingModule();
    updateMailingList = vi.fn(() =>
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
    let resolveLookup: (() => void) | undefined;
    getMailingListsByCommittee = vi.fn(
      () =>
        new Promise<GroupsIOMailingList[]>((resolve) => {
          resolveLookup = () => resolve([]);
        })
    );
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

    resolveLookup?.();
    await fixture.whenStable();
    fixture.detectChanges();

    toggle = fixture.debugElement.query((el) => el.name === 'lfx-toggle')?.componentInstance;
    expect(toggle?.disabled()).toBe(false);
  });

  it('emits the pre-save enriched resource with the submitted sync_mode, not the raw PUT response', async () => {
    // updateMailingList's indexed response lacks GET-only enrichment (writer, committee names) and
    // hasn't caught up to the submitted sync_mode yet — the parent must still receive both (#4880
    // review / see also #4899).
    await render(baseList, { updateResult: { uid: 'list-1', group_name: 'maintainers' } as GroupsIOMailingList });
    const emitted = vi.fn();
    fixture.componentInstance.updated.subscribe(emitted);

    fixture.componentInstance['onToggleChange'](true);
    await fixture.whenStable();

    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ writer: true, sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }));
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
});
