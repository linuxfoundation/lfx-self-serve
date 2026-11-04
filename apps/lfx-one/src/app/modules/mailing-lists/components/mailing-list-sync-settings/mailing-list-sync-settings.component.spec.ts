// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MailingListAudienceAccess, MailingListSyncMode } from '@lfx-one/shared/enums';
import type { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MailingListService } from '@services/mailing-list.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
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
    } = {}
  ): Promise<void> => {
    TestBed.resetTestingModule();
    updateMailingList = options.updateDeferred
      ? vi.fn(() => new Subject<GroupsIOMailingList>())
      : vi.fn(() => (options.updateResult === 'error' ? throwError(() => new Error('upstream rejected')) : of(options.updateResult ?? mailingList)));
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
});
