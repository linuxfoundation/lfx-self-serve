// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AcceptInviteOrganizationDialogComponent } from '@components/accept-invite-organization-dialog/accept-invite-organization-dialog.component';
import { JoinApplicationDialogComponent } from '@components/join-application-dialog/join-application-dialog.component';
import { GroupJoinStateChange, GroupJoinTarget, JoinMode } from '@lfx-one/shared/interfaces';
import { CommitteeJoinApplicationSessionService } from '@services/committee-join-application-session.service';
import { CommitteeService } from '@services/committee.service';
import { InvitationAcceptFlowService } from '@services/invitation-accept-flow.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupJoinButtonComponent } from './group-join-button.component';

describe('GroupJoinButtonComponent', () => {
  let authenticated: WritableSignal<boolean>;
  let pendingCommitteeUids: WritableSignal<ReadonlySet<string>>;
  let markPending: ReturnType<typeof vi.fn>;
  let joinCommittee: ReturnType<typeof vi.fn>;
  let submitApplication: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;
  let openDialog: ReturnType<typeof vi.fn>;
  let emitted: GroupJoinStateChange[];

  const group = (joinMode: JoinMode | undefined, extra: Partial<GroupJoinTarget> = {}): GroupJoinTarget => ({
    uid: 'group-1',
    name: 'Technical Steering',
    join_mode: joinMode,
    enable_voting: false,
    ...extra,
  });

  /** A dialog ref whose close emits `result`; `NEVER` keeps it open. */
  const dialogRef = (result: Observable<unknown>) => ({ onClose: result, onDestroy: NEVER, close: vi.fn() });

  async function render(target: GroupJoinTarget | null, inputs: Record<string, unknown> = {}): Promise<ComponentFixture<GroupJoinButtonComponent>> {
    const fixture = TestBed.createComponent(GroupJoinButtonComponent);
    fixture.componentRef.setInput('group', target);
    fixture.componentRef.setInput('testIdPrefix', 'committee-view');
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.componentInstance.stateChange.subscribe((change) => emitted.push(change));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  const testIds = (fixture: ComponentFixture<GroupJoinButtonComponent>): string[] =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid') ?? '');

  beforeEach(async () => {
    authenticated = signal(true);
    pendingCommitteeUids = signal<ReadonlySet<string>>(new Set());
    markPending = vi.fn((uid: string) => pendingCommitteeUids.update((uids) => new Set([...uids, uid])));
    joinCommittee = vi.fn(() => of({}));
    submitApplication = vi.fn(() => of({}));
    messageAdd = vi.fn();
    openDialog = vi.fn();
    emitted = [];

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [GroupJoinButtonComponent],
      providers: [
        { provide: CommitteeService, useValue: { joinCommittee, submitApplication } },
        { provide: CommitteeJoinApplicationSessionService, useValue: { pendingCommitteeUids, markPending } },
        { provide: InvitationAcceptFlowService, useValue: { resolveCurrentEmployer: vi.fn(() => of({ name: 'Acme Motors', id: 'org-1' })) } },
        { provide: UserService, useValue: { authenticated } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    })
      .overrideComponent(GroupJoinButtonComponent, { set: { providers: [{ provide: DialogService, useValue: { open: openDialog } }] } })
      .compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('join_mode: open', () => {
    it('renders Join Group with the host test id prefix', async () => {
      const fixture = await render(group('open'));
      expect(testIds(fixture)).toEqual(['committee-view-join-btn']);
    });

    it('joins directly and emits joined when no organization is required', async () => {
      const fixture = await render(group('open'));

      await fixture.componentInstance.requestJoin();

      expect(openDialog).not.toHaveBeenCalled();
      expect(joinCommittee).toHaveBeenCalledWith('group-1', undefined);
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Joined' }));
      expect(emitted).toEqual([{ group_uid: 'group-1', state: 'joined' }]);
      expect(fixture.componentInstance.busy()).toBe(false);
    });

    it('asks for the organization first when the group requires one, and joins with it', async () => {
      openDialog.mockReturnValue(dialogRef(of({ organization: { name: 'Acme Motors', id: 'org-1' } })));
      const fixture = await render(group('open', { enable_voting: true }));

      await fixture.componentInstance.requestJoin();

      expect(openDialog).toHaveBeenCalledWith(AcceptInviteOrganizationDialogComponent, expect.objectContaining({ header: 'Confirm Organization' }));
      expect(joinCommittee).toHaveBeenCalledWith('group-1', { name: 'Acme Motors', id: 'org-1' });
      expect(emitted).toEqual([{ group_uid: 'group-1', state: 'joined' }]);
    });

    it('does not join when the organization dialog is dismissed', async () => {
      openDialog.mockReturnValue(dialogRef(of(null)));
      const fixture = await render(group('open', { business_email_required: true }));

      await fixture.componentInstance.requestJoin();

      expect(joinCommittee).not.toHaveBeenCalled();
      expect(fixture.componentInstance.resolvingOrg()).toBe(false);
      expect(emitted).toEqual([]);
    });

    it('drops the flow when the host swaps the group while the organization dialog is open', async () => {
      const closed = new Subject<unknown>();
      openDialog.mockReturnValue(dialogRef(closed));
      const fixture = await render(group('open', { enable_voting: true }));

      const pending = fixture.componentInstance.requestJoin();
      await vi.waitFor(() => expect(openDialog).toHaveBeenCalled());
      fixture.componentRef.setInput('group', null);
      closed.next({ organization: { name: 'Acme Motors', id: 'org-1' } });
      await pending;

      expect(joinCommittee).not.toHaveBeenCalled();
    });

    it('surfaces an error toast and emits nothing when the join fails', async () => {
      joinCommittee.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      const fixture = await render(group('open'));

      await fixture.componentInstance.requestJoin();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Unable to Join' }));
      expect(emitted).toEqual([]);
      expect(fixture.componentInstance.joining()).toBe(false);
    });

    it('prompts an anonymous viewer to sign in with returnTo instead of joining', async () => {
      authenticated.set(false);
      const location = { pathname: '/meetings/m-1', search: '?occurrence=2', href: '' };
      vi.spyOn(window, 'location', 'get').mockReturnValue(location as unknown as Location);
      const fixture = await render(group('open'));

      await fixture.componentInstance.requestJoin();

      expect(location.href).toBe(`/login?returnTo=${encodeURIComponent('/meetings/m-1?occurrence=2')}`);
      expect(joinCommittee).not.toHaveBeenCalled();
    });
  });

  describe('join_mode: application', () => {
    it('renders Apply to Join', async () => {
      const fixture = await render(group('application'));
      expect(testIds(fixture)).toEqual(['committee-view-apply-btn']);
    });

    it('submits the message from the application dialog, marks it pending and emits application_pending', async () => {
      openDialog.mockReturnValue(dialogRef(of({ message: 'Hello' })));
      const fixture = await render(group('application'));

      await fixture.componentInstance.requestJoin();
      fixture.detectChanges();

      expect(openDialog).toHaveBeenCalledWith(JoinApplicationDialogComponent, expect.objectContaining({ data: { committeeName: 'Technical Steering' } }));
      expect(submitApplication).toHaveBeenCalledWith('group-1', 'Hello', undefined);
      expect(markPending).toHaveBeenCalledWith('group-1');
      expect(emitted).toEqual([{ group_uid: 'group-1', state: 'application_pending' }]);
      expect(testIds(fixture)).toEqual([]);
    });

    it('drops the submission when the host swaps the group while the application dialog is open', async () => {
      const closed = new Subject<unknown>();
      openDialog.mockReturnValue(dialogRef(closed));
      const fixture = await render(group('application'));

      await fixture.componentInstance.requestJoin();
      fixture.componentRef.setInput('group', group('application', { uid: 'group-2', name: 'Other Group' }));
      closed.next({ message: 'Hello' });

      expect(submitApplication).not.toHaveBeenCalled();
      expect(markPending).not.toHaveBeenCalled();
      expect(fixture.componentInstance.busy()).toBe(false);
    });

    it('treats a 409 as an existing pending application', async () => {
      openDialog.mockReturnValue(dialogRef(of({ message: undefined })));
      submitApplication.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
      const fixture = await render(group('application'));

      await fixture.componentInstance.requestJoin();

      expect(markPending).toHaveBeenCalledWith('group-1');
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: 'You already have a pending application for this group.' }));
      expect(emitted).toEqual([{ group_uid: 'group-1', state: 'application_pending' }]);
    });

    it('resets the busy state when the application dialog is dismissed', async () => {
      openDialog.mockReturnValue(dialogRef(of(null)));
      const fixture = await render(group('application'));

      await fixture.componentInstance.requestJoin();

      expect(submitApplication).not.toHaveBeenCalled();
      expect(fixture.componentInstance.busy()).toBe(false);
    });

    it('hides the button and ignores requests while an application is pending this session', async () => {
      pendingCommitteeUids.set(new Set(['group-1']));
      const fixture = await render(group('application'));

      await fixture.componentInstance.requestJoin();

      expect(testIds(fixture)).toEqual([]);
      expect(openDialog).not.toHaveBeenCalled();
    });

    it('prompts an anonymous viewer to sign in instead of applying', async () => {
      authenticated.set(false);
      const location = { pathname: '/groups/group-1', search: '', href: '' };
      vi.spyOn(window, 'location', 'get').mockReturnValue(location as unknown as Location);
      const fixture = await render(group('application'));

      await fixture.componentInstance.requestJoin();

      expect(location.href).toBe(`/login?returnTo=${encodeURIComponent('/groups/group-1')}`);
      expect(openDialog).not.toHaveBeenCalled();
    });
  });

  describe('join_mode: closed', () => {
    it('renders Contact Admin, which shows the contact-admin toast', async () => {
      const fixture = await render(group('closed'));

      expect(testIds(fixture)).toEqual(['committee-view-contact-admin-btn']);
      await fixture.componentInstance.requestJoin();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info', summary: 'Contact Admin' }));
      expect(joinCommittee).not.toHaveBeenCalled();
    });
  });

  describe('join_mode: invite_only', () => {
    it('renders no action', async () => {
      const fixture = await render(group('invite_only'));
      expect(testIds(fixture)).toEqual([]);
    });

    it('falls back to the contact-admin toast when a host CTA requests a join', async () => {
      const fixture = await render(group('invite_only'));

      await fixture.componentInstance.requestJoin();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Contact Admin' }));
      expect(joinCommittee).not.toHaveBeenCalled();
      expect(openDialog).not.toHaveBeenCalled();
    });
  });

  describe('host control', () => {
    it('renders nothing when showButton is false but still runs the flow for host CTAs', async () => {
      const fixture = await render(group('open'), { showButton: false });

      expect(testIds(fixture)).toEqual([]);
      await fixture.componentInstance.requestJoin();

      expect(joinCommittee).toHaveBeenCalledWith('group-1', undefined);
    });

    it('is inert without a group', async () => {
      const fixture = await render(null);

      await fixture.componentInstance.requestJoin();

      expect(testIds(fixture)).toEqual([]);
      expect(messageAdd).not.toHaveBeenCalled();
    });
  });
});
