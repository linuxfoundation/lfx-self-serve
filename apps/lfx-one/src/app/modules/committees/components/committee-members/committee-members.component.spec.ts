// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Members tab entry points for adding people, including the CSV import (GH-3849). Synthetic data only.

import { HttpParams } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CommitteeMemberVisibility } from '@lfx-one/shared/enums';
import { Committee, CommitteeEngagementResponse, CommitteeInvite, CommitteeMember, MemberImportDialogResult } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddMemberDialogComponent } from '../add-member-dialog/add-member-dialog.component';
import { ImportMembersDialogComponent } from '../import-members-dialog/import-members-dialog.component';
import { CommitteeMembersComponent } from './committee-members.component';

const WRITER_GROUP = { uid: 'committee-1', name: 'Docs Working Group', writer: true, member_visibility: 'basic_profile' } as Committee;
const MEMBERS = [{ uid: 'member-1', email: 'ada@example.com', first_name: 'Ada', last_name: 'Example' }] as CommitteeMember[];
const INVITES = [{ uid: 'invite-1', invitee_email: 'grace@example.com', status: 'pending' }] as CommitteeInvite[];

describe('CommitteeMembersComponent add-people actions', () => {
  let fixture: ComponentFixture<CommitteeMembersComponent>;
  let component: CommitteeMembersComponent;
  let dialogClose: Subject<unknown>;
  let dialogService: { open: ReturnType<typeof vi.fn> };
  let committeeService: {
    getCommitteeMembers: ReturnType<typeof vi.fn>;
    getCommitteeInvites: ReturnType<typeof vi.fn>;
    createCommitteeInvite: ReturnType<typeof vi.fn>;
  };
  let refreshes: number;

  async function setup(committee: Committee | null, inputs: Record<string, unknown> = {}): Promise<void> {
    dialogClose = new Subject<unknown>();
    dialogService = { open: vi.fn(() => ({ onClose: dialogClose })) };
    committeeService = {
      getCommitteeMembers: vi.fn().mockReturnValue(of(MEMBERS)),
      getCommitteeInvites: vi.fn().mockReturnValue(of(INVITES)),
      createCommitteeInvite: vi.fn().mockReturnValue(of({})),
    };

    await TestBed.configureTestingModule({
      imports: [CommitteeMembersComponent],
      providers: [provideNoopAnimations(), MessageService, { provide: CommitteeService, useValue: committeeService }],
    })
      .overrideComponent(CommitteeMembersComponent, {
        set: { providers: [ConfirmationService, { provide: DialogService, useValue: dialogService }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CommitteeMembersComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', committee);
    fixture.componentRef.setInput('members', MEMBERS);
    fixture.componentRef.setInput('membersLoading', false);
    fixture.componentRef.setInput('membersReady', true);
    fixture.componentRef.setInput('invites', INVITES);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    refreshes = 0;
    component.refresh.subscribe(() => refreshes++);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function expectManagerToolbar(): void {
    const toolbar = query('members-toolbar');
    const actions = query('members-toolbar-actions');
    expect(toolbar).not.toBeNull();
    expect(actions?.parentElement).toBe(toolbar);
    expect(Array.from(actions!.children).map((child) => child.getAttribute('data-testid'))).toEqual(['add-member-btn', 'import-members-csv-btn']);
    for (const testId of ['add-member-btn', 'import-members-csv-btn']) {
      expect(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`)).toHaveLength(1);
      expect(query(testId)?.closest('[data-testid="members-search-filters"]')).toBeNull();
    }
    expect(query('import-members-csv-btn')?.textContent).toContain('Import Members');
    expect(query('import-members-csv-btn')?.textContent).not.toContain('CSV');
    expect(query('invite-member-btn')).toBeNull();
  }

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  describe('as a group manager', () => {
    beforeEach(async () => setup(WRITER_GROUP));

    it('places member pills and Add then Import in the toolbar above search filters', () => {
      expectManagerToolbar();
      const toolbar = query('members-toolbar')!;
      expect(query('members-filter-chips')?.parentElement).toBe(toolbar);
      expect(toolbar.firstElementChild).toBe(query('members-filter-chips'));
      expect(toolbar.nextElementSibling).toBe(query('members-search-filters'));
      expect(query('members-search-filters')?.querySelector('lfx-input-text')).not.toBeNull();
      expect(query('members-search-filters')?.querySelectorAll('lfx-select')).toHaveLength(3);
    });

    it('retains the single action pair on Pending without chips, engagement, or an empty search row', async () => {
      fixture.componentRef.setInput('engagementEnabled', true);
      fixture.componentRef.setInput('engagementAccessible', true);
      component.onTabChange('pending');
      await fixture.whenStable();

      expectManagerToolbar();
      expect(query('members-tab-bar')).not.toBeNull();
      expect(query('members-filter-chips')).toBeNull();
      expect(query('members-engagement-controls')).toBeNull();
      expect(query('members-search-filters')).toBeNull();
    });

    it('restores the All toolbar and filters when pending invitations disappear', async () => {
      component.onTabChange('pending');
      await fixture.whenStable();
      fixture.componentRef.setInput('invites', []);
      await fixture.whenStable();

      expect(component.activeTab()).toBe('all');
      expectManagerToolbar();
      expect(query('members-tab-bar')).toBeNull();
      expect(query('members-filter-chips')).not.toBeNull();
      expect(query('members-search-filters')).not.toBeNull();
    });

    it('disables only Import while invitations load with a ready roster', async () => {
      fixture.componentRef.setInput('invitesLoading', true);
      await fixture.whenStable();

      expect((query('import-members-csv-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
      expect((query('add-member-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
    });

    it('opens the import dialog with the group snapshot and only its own close controls', () => {
      query('import-members-csv-btn')?.querySelector('button')?.click();

      expect(dialogService.open).toHaveBeenCalledWith(
        ImportMembersDialogComponent,
        expect.objectContaining({
          closable: false,
          closeOnEscape: false,
          dismissableMask: false,
          data: { committee: WRITER_GROUP, existingMembers: MEMBERS, existingInvites: INVITES },
        })
      );
    });

    it.each(['membersLoading', 'invitesLoading'])('waits for %s before opening with the current group snapshot', async (loadingInput) => {
      fixture.componentRef.setInput('committee', { ...WRITER_GROUP, uid: 'committee-2' });
      fixture.componentRef.setInput(loadingInput, true);
      await fixture.whenStable();

      const button = query('import-members-csv-btn')?.querySelector('button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      button.click();
      component.openImportMembersDialog();
      expect(dialogService.open).not.toHaveBeenCalled();

      const members = [{ uid: 'member-2', email: 'lin@example.com' }] as CommitteeMember[];
      const invites = [{ uid: 'invite-2', invitee_email: 'new@example.com', status: 'pending' }] as CommitteeInvite[];
      fixture.componentRef.setInput('members', members);
      fixture.componentRef.setInput('invites', invites);
      fixture.componentRef.setInput(loadingInput, false);
      await fixture.whenStable();
      committeeService.getCommitteeMembers.mockReturnValue(of(members));
      committeeService.getCommitteeInvites.mockReturnValue(of(invites));

      expect(button.disabled).toBe(false);
      button.click();
      expect(dialogService.open).toHaveBeenCalledExactlyOnceWith(
        ImportMembersDialogComponent,
        expect.objectContaining({ data: { committee: component.committee(), existingMembers: members, existingInvites: invites } })
      );
    });

    it('unsubscribes from import close when the host is destroyed', () => {
      vi.useFakeTimers();
      component.openImportMembersDialog();
      expect(dialogClose.observed).toBe(true);
      fixture.destroy();

      expect(dialogClose.observed).toBe(false);
      dialogClose.next({ added: 2, conflicts: 0 } satisfies MemberImportDialogResult);
      vi.advanceTimersByTime(3000);
      expect(refreshes).toBe(0);
      expect(committeeService.getCommitteeMembers).toHaveBeenCalledTimes(1);
    });

    it('refreshes and polls for the cumulative added count after an import', () => {
      vi.useFakeTimers();
      committeeService.getCommitteeMembers.mockReturnValueOnce(of(MEMBERS)).mockReturnValue(of([...MEMBERS, { uid: 'member-2' }, { uid: 'member-3' }]));
      component.openImportMembersDialog();
      dialogClose.next({ added: 2, conflicts: 1 } satisfies MemberImportDialogResult);

      expect(refreshes).toBe(1);
      vi.advanceTimersByTime(400);
      expect(committeeService.getCommitteeMembers).toHaveBeenCalledWith('committee-1');
      // 1 member before + 2 added = 3 — the poll stops and refreshes once more.
      expect(refreshes).toBe(2);
    });

    it('refreshes without polling after a conflict-only result', () => {
      vi.useFakeTimers();
      component.openImportMembersDialog();
      dialogClose.next({ added: 0, conflicts: 2 } satisfies MemberImportDialogResult);
      vi.advanceTimersByTime(3000);

      expect(refreshes).toBe(1);
      expect(committeeService.getCommitteeMembers).toHaveBeenCalledTimes(1);
    });

    it('refreshes without inventing an addition count when an import outcome is unknown', () => {
      vi.useFakeTimers();
      component.openImportMembersDialog();
      dialogClose.next({ added: 0, conflicts: 0, uncertain: true } satisfies MemberImportDialogResult);
      vi.advanceTimersByTime(3000);

      expect(refreshes).toBe(1);
      expect(committeeService.getCommitteeMembers).toHaveBeenCalledTimes(1);
    });

    it('does nothing after a cancelled preview', () => {
      component.openImportMembersDialog();
      dialogClose.next({ added: 0, conflicts: 0 } satisfies MemberImportDialogResult);
      expect(refreshes).toBe(0);
    });

    it('ignores the result when the page has moved to a different group', async () => {
      component.openImportMembersDialog();
      fixture.componentRef.setInput('committee', { ...WRITER_GROUP, uid: 'committee-2' });
      await fixture.whenStable();
      dialogClose.next({ added: 3, conflicts: 0 } satisfies MemberImportDialogResult);

      expect(refreshes).toBe(0);
      expect(committeeService.getCommitteeMembers).toHaveBeenCalledTimes(1);
    });

    describe('import confirmation', () => {
      let toast: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        vi.useFakeTimers();
        toast = vi.spyOn(TestBed.inject(MessageService), 'add');
      });

      // Let the post-import roster poll finish while the host is still alive.
      afterEach(() => vi.advanceTimersByTime(3000));

      it('confirms how many members were added and that they may take a moment to appear', () => {
        component.openImportMembersDialog();
        dialogClose.next({ added: 2, conflicts: 1 } satisfies MemberImportDialogResult);

        expect(toast).toHaveBeenCalledExactlyOnceWith({
          severity: 'success',
          summary: 'Members Added',
          detail: '2 members added to Docs Working Group. New members may take a moment to appear.',
          life: 6000,
        });
      });

      it('uses the singular for one added member', () => {
        component.openImportMembersDialog();
        dialogClose.next({ added: 1, conflicts: 0 } satisfies MemberImportDialogResult);

        expect(toast).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ detail: '1 member added to Docs Working Group. New members may take a moment to appear.' })
        );
      });

      it('still confirms the imported group after the page moved to another group', async () => {
        component.openImportMembersDialog();
        fixture.componentRef.setInput('committee', { ...WRITER_GROUP, uid: 'committee-2', name: 'Other Group' });
        await fixture.whenStable();
        dialogClose.next({ added: 3, conflicts: 0 } satisfies MemberImportDialogResult);

        expect(toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ detail: expect.stringContaining('3 members added to Docs Working Group.') }));
        expect(refreshes).toBe(0);
      });

      it.each([
        ['conflicts only', { added: 0, conflicts: 2 }],
        ['an unknown outcome', { added: 0, conflicts: 0, uncertain: true }],
        ['a cancelled preview', { added: 0, conflicts: 0 }],
        ['no result', undefined],
      ] satisfies [string, MemberImportDialogResult | undefined][])('shows no confirmation after %s', (_label, result) => {
        component.openImportMembersDialog();
        dialogClose.next(result);

        expect(toast).not.toHaveBeenCalled();
      });
    });

    it.each([{ membersReady: false }, { membersError: true }, { membersLoading: true }])(
      'blocks direct Add and Import calls while roster is unavailable: %j',
      async (inputs) => {
        for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
        await fixture.whenStable();
        expect((query('add-member-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
        expect((query('import-members-csv-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
        component.openAddMemberDialog();
        component.openImportMembersDialog();
        expect(dialogService.open).not.toHaveBeenCalled();
        expect(committeeService.getCommitteeMembers).not.toHaveBeenCalled();
      }
    );

    it('keeps a persistent roster alert with pending invitations and emits Retry', async () => {
      fixture.componentRef.setInput('membersError', true);
      fixture.componentRef.setInput('membersReady', false);
      const retry = vi.fn();
      component.retryMembers.subscribe(retry);
      await fixture.whenStable();
      expect(query('committee-members-load-error')?.getAttribute('role')).toBe('alert');
      expect(query('committee-members-load-error')?.textContent).toContain('complete member list');
      query('committee-members-load-retry')?.querySelector('button')?.click();
      expect(retry).toHaveBeenCalledTimes(1);
    });

    it('does not present failure as an empty roster, and restores empty-success actions', async () => {
      fixture.componentRef.setInput('members', []);
      fixture.componentRef.setInput('invites', []);
      fixture.componentRef.setInput('membersError', true);
      fixture.componentRef.setInput('membersReady', false);
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).not.toContain('No members found');
      expect(fixture.nativeElement.textContent).not.toContain('Add the first member');
      fixture.componentRef.setInput('membersError', false);
      fixture.componentRef.setInput('membersReady', true);
      await fixture.whenStable();
      expect(query('committee-members-load-error')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('No members found');
      expect(fixture.nativeElement.textContent).toContain('Add the first member');
      expect((query('add-member-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
      expect((query('import-members-csv-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
      expectManagerToolbar();
    });

    it('keeps Add Member opening the existing direct-add dialog', () => {
      query('add-member-btn')?.querySelector('button')?.click();
      expect(dialogService.open).toHaveBeenCalledWith(
        AddMemberDialogComponent,
        expect.objectContaining({ data: expect.objectContaining({ mode: 'direct-add' }) })
      );
    });

    it('waits for both fresh snapshots, disables duplicate opens, and uses fetched rather than fallback arrays', async () => {
      const members = new Subject<CommitteeMember[]>();
      const invites = new Subject<CommitteeInvite[]>();
      committeeService.getCommitteeMembers.mockReturnValue(members);
      committeeService.getCommitteeInvites.mockReturnValue(invites);
      fixture.componentRef.setInput('members', []);
      fixture.componentRef.setInput('invites', []);
      component.openImportMembersDialog();
      await fixture.whenStable();
      expect((query('import-members-csv-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
      expect((query('add-member-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
      component.openImportMembersDialog();
      expect(committeeService.getCommitteeMembers).toHaveBeenCalledExactlyOnceWith(WRITER_GROUP.uid, expect.any(HttpParams));
      expect(committeeService.getCommitteeInvites).toHaveBeenCalledExactlyOnceWith(WRITER_GROUP.uid, expect.any(HttpParams));
      expect(committeeService.getCommitteeMembers.mock.calls[0][1].get('require_complete')).toBe('true');
      expect(committeeService.getCommitteeInvites.mock.calls[0][1].get('require_complete')).toBe('true');
      members.next(MEMBERS);
      members.complete();
      expect(dialogService.open).not.toHaveBeenCalled();
      invites.next(INVITES);
      invites.complete();
      expect(dialogService.open.mock.calls[0][1].data).toEqual({ committee: WRITER_GROUP, existingMembers: MEMBERS, existingInvites: INVITES });
      expect(component.importSnapshotsLoading()).toBe(false);
    });

    it.each(['members', 'invites'])('blocks import if the fresh %s snapshot fails and permits retry', async (failedSnapshot) => {
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const response = new Subject<CommitteeMember[] & CommitteeInvite[]>();
        const method = failedSnapshot === 'members' ? 'getCommitteeMembers' : 'getCommitteeInvites';
        committeeService[method].mockReturnValue(response);
        fixture.componentRef.setInput('members', []);
        fixture.componentRef.setInput('invites', []);
        component.openImportMembersDialog();
        response.error({ status: 503, error: { message: 'private@example.com' } });
        expect(dialogService.open).not.toHaveBeenCalled();
        expect(component.importSnapshotsLoading()).toBe(false);
        expect(errorLog).toHaveBeenCalledExactlyOnceWith('Failed to load CSV import snapshots', { status: 503 });
        committeeService.getCommitteeMembers.mockReturnValue(of(MEMBERS));
        committeeService.getCommitteeInvites.mockReturnValue(of(INVITES));
        component.openImportMembersDialog();
        expect(dialogService.open).toHaveBeenCalledTimes(1);
      } finally {
        errorLog.mockRestore();
      }
    });

    it.each(['navigation', 'lost access', 'destruction'])('does not open from a late snapshot after %s', async (change) => {
      const response = new Subject<CommitteeInvite[]>();
      committeeService.getCommitteeInvites.mockReturnValue(response);
      component.openImportMembersDialog();
      if (change === 'destruction') {
        fixture.destroy();
        expect(response.observed).toBe(false);
      } else {
        fixture.componentRef.setInput('committee', {
          ...WRITER_GROUP,
          uid: change === 'navigation' ? 'committee-2' : WRITER_GROUP.uid,
          writer: change !== 'lost access',
        });
      }
      response.next(INVITES);
      response.complete();
      expect(dialogService.open).not.toHaveBeenCalled();
    });
  });

  it('hides the import from members who can only send invitations', async () => {
    await setup({ ...WRITER_GROUP, writer: false }, { canSendMemberInvites: true });

    expect(query('invite-member-btn')).not.toBeNull();
    expect(query('import-members-csv-btn')).toBeNull();
    expect(query('add-member-btn')).toBeNull();
    expect(query('members-toolbar-actions')).toBeNull();
    expect(query('invite-member-btn')?.closest('[data-testid="members-search-filters"]')).toBe(query('members-search-filters'));
    component.openImportMembersDialog();
    expect(dialogService.open).not.toHaveBeenCalled();
  });

  it('hides every add action from read-only viewers', async () => {
    await setup({ ...WRITER_GROUP, writer: false });

    expect(query('add-member-btn')).toBeNull();
    expect(query('import-members-csv-btn')).toBeNull();
    expect(query('invite-member-btn')).toBeNull();
    expect(query('members-toolbar-actions')).toBeNull();
  });

  it('preserves the hidden-roster invitation flow without exposing the toolbar', async () => {
    await setup({ ...WRITER_GROUP, writer: false, member_visibility: CommitteeMemberVisibility.HIDDEN }, { canSendMemberInvites: true });

    expect(query('members-invite-only')).not.toBeNull();
    expect(query('members-toolbar')).toBeNull();
    expect(query('add-member-btn')).toBeNull();
    expect(query('import-members-csv-btn')).toBeNull();
    query('invite-member-btn')?.querySelector('button')?.click();
    expect(dialogService.open).toHaveBeenCalledWith(AddMemberDialogComponent, expect.objectContaining({ header: 'Invite Someone' }));
  });

  it.each([
    { engagementEnabled: false, engagementAccessible: false },
    { engagementEnabled: false, engagementAccessible: true },
    { engagementEnabled: true, engagementAccessible: false },
  ])('hides engagement controls unless both gates allow access: %j', async (inputs) => {
    await setup(WRITER_GROUP, inputs);

    expect(query('members-engagement-controls')).toBeNull();
    expectManagerToolbar();
  });

  it('keeps allowed engagement controls in a separate row between the toolbar and search', async () => {
    await setup(WRITER_GROUP, {
      engagementEnabled: true,
      engagementAccessible: true,
      engagement: {
        members: [],
        summary: { attendance_rate: 0, active_count: 0, eligible_count: 0, total_count: 0, at_risk_count: 0 },
        computed_at: null,
        data_available: true,
        data_source: 'mock',
      } satisfies CommitteeEngagementResponse,
    });

    const controls = query('members-engagement-controls')!;
    expect(query('members-toolbar')?.nextElementSibling).toBe(controls);
    expect(controls.nextElementSibling).toBe(query('members-search-filters'));
    expect(controls.querySelector('lfx-filter-pills')).not.toBeNull();
    expect(query('members-engagement-mock-tag')?.textContent).toContain('Sample data');
    expect(query('members-engagement-freshness')?.textContent).toBe(component.engagementFreshnessLabel());
    expectManagerToolbar();
  });
  describe('invitation expiry and resend', () => {
    const EXPIRED = {
      uid: 'invite-expired',
      invitee_email: 'expired.invitee@example.com',
      status: 'pending',
      expires_at: '2020-01-01T00:00:00Z',
    } as CommitteeInvite;
    const LIVE = { uid: 'invite-live', invitee_email: 'live.invitee@example.com', status: 'pending', expires_at: '2999-01-01T00:00:00Z' } as CommitteeInvite;
    const LEGACY = { uid: 'invite-legacy', invitee_email: 'legacy.invitee@example.com', status: 'pending' } as CommitteeInvite;
    let messageService: MessageService;

    async function openPending(invites: CommitteeInvite[]): Promise<void> {
      await setup(WRITER_GROUP, { invites });
      messageService = TestBed.inject(MessageService);
      component.onTabChange('pending');
      await fixture.whenStable();
    }

    function menuLabels(invite: CommitteeInvite): string[] {
      component.toggleInviteActionMenu(new Event('click'), invite, { toggle: vi.fn() } as never);
      return component.inviteActionMenuItems.map((item) => item.label as string);
    }

    it('shows an expired tag and the expired date only for an invite past its expiry', async () => {
      await openPending([EXPIRED]);

      expect(query('invite-expired-tag')).not.toBeNull();
      expect(query('invite-expiry')?.textContent).toContain('Expired');
    });

    it('shows when a live invite expires and no expired tag', async () => {
      await openPending([LIVE]);

      expect(query('invite-expired-tag')).toBeNull();
      expect(query('invite-expiry')?.textContent).toContain('Expires');
    });

    it('flips a live invite to expired when its expiry passes while the tab stays open', async () => {
      // Only the clock and intervals are faked, so the async setup still resolves.
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      await openPending([{ ...LIVE, expires_at: '2030-01-01T00:00:30Z' }]);
      expect(query('invite-expired-tag')).toBeNull();
      expect(query('invite-expiry')?.textContent).toContain('Expires');

      vi.advanceTimersByTime(60_000);
      await fixture.whenStable();

      expect(query('invite-expired-tag')).not.toBeNull();
      expect(query('invite-expiry')?.textContent).toContain('Expired');
    });

    it('says there is no expiration for a legacy invite without expires_at', async () => {
      await openPending([LEGACY]);

      expect(query('invite-expired-tag')).toBeNull();
      expect(query('invite-expiry')?.textContent?.trim()).toBe('No expiration');
    });

    it('offers Resend invitation only for an expired invite', async () => {
      await openPending([EXPIRED, LIVE, LEGACY]);

      expect(menuLabels(EXPIRED)).toEqual(['Resend invitation', 'Revoke invitation']);
      expect(menuLabels(LIVE)).toEqual(['Revoke invitation']);
      expect(menuLabels(LEGACY)).toEqual(['Revoke invitation']);
    });

    it('resends with only the email so the stored role and organization are kept, then refreshes', async () => {
      await openPending([EXPIRED]);
      vi.useFakeTimers();
      committeeService.getCommitteeInvites.mockReturnValue(of([{ ...EXPIRED, expires_at: '2999-01-01T00:00:00Z' }]));
      const toast = vi.spyOn(messageService, 'add');

      component.resendInvite(EXPIRED);

      expect(committeeService.createCommitteeInvite).toHaveBeenCalledExactlyOnceWith('committee-1', { invitee_email: 'expired.invitee@example.com' });
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Invitation Sent' }));
      expect(component.resendingInviteUid()).toBeNull();
      vi.advanceTimersByTime(400);
      expect(refreshes).toBeGreaterThan(0);
    });

    it('reports a failed resend and does not poll or refresh', async () => {
      await openPending([EXPIRED]);
      vi.useFakeTimers();
      committeeService.createCommitteeInvite.mockReturnValue(throwError(() => ({ status: 409 })));
      const toast = vi.spyOn(messageService, 'add');
      const invitesCalls = committeeService.getCommitteeInvites.mock.calls.length;
      const refreshesBefore = refreshes;

      component.resendInvite(EXPIRED);
      vi.advanceTimersByTime(3000);

      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Unable to Resend' }));
      expect(component.resendingInviteUid()).toBeNull();
      expect(committeeService.getCommitteeInvites.mock.calls.length).toBe(invitesCalls);
      expect(refreshes).toBe(refreshesBefore);
    });

    it('disables Revoke while a resend is in flight', async () => {
      await openPending([EXPIRED]);
      committeeService.createCommitteeInvite.mockReturnValue(new Subject());

      component.resendInvite(EXPIRED);
      menuLabels(EXPIRED);

      expect(component.inviteActionMenuItems.find((item) => item.label === 'Revoke invitation')?.disabled).toBe(true);
    });

    it('does not poll or refresh another group when the page switches groups before the response', async () => {
      await openPending([EXPIRED]);
      vi.useFakeTimers();
      const created = new Subject<unknown>();
      committeeService.createCommitteeInvite.mockReturnValue(created);

      component.resendInvite(EXPIRED);
      fixture.componentRef.setInput('committee', { ...WRITER_GROUP, uid: 'committee-2' });
      fixture.detectChanges();
      const invitesCalls = committeeService.getCommitteeInvites.mock.calls.length;
      const refreshesBefore = refreshes;
      created.next({});
      created.complete();
      vi.advanceTimersByTime(3000);

      expect(committeeService.getCommitteeInvites.mock.calls.length).toBe(invitesCalls);
      expect(refreshes).toBe(refreshesBefore);
    });

    it('ignores a second resend while one is in flight', async () => {
      await openPending([EXPIRED]);
      committeeService.createCommitteeInvite.mockReturnValue(new Subject());

      component.resendInvite(EXPIRED);
      component.resendInvite(EXPIRED);

      expect(committeeService.createCommitteeInvite).toHaveBeenCalledTimes(1);
      expect(component.resendingInviteUid()).toBe('invite-expired');
    });
  });
});
