// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Which existing invitations block a new one in the Add Member dialog. Synthetic data only.

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  AddMemberDialogMode,
  Committee,
  CommitteeInvite,
  CommitteeMember,
  DecoratedCommitteeSearchResult,
  MeetingRegistrant,
} from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { SearchService } from '@services/search.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddMemberDialogComponent } from './add-member-dialog.component';

const EXPIRED = {
  uid: 'invite-expired',
  invitee_email: 'expired.invitee@example.com',
  status: 'pending',
  expires_at: '2020-01-01T00:00:00Z',
} as CommitteeInvite;
const LIVE = { uid: 'invite-live', invitee_email: 'live.invitee@example.com', status: 'pending', expires_at: '2999-01-01T00:00:00Z' } as CommitteeInvite;
const LEGACY = { uid: 'invite-legacy', invitee_email: 'legacy.invitee@example.com', status: 'pending' } as CommitteeInvite;

describe('AddMemberDialogComponent existing invitations', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function categorize(emails: string[]) {
    await TestBed.configureTestingModule({
      imports: [AddMemberDialogComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: {} },
        { provide: SearchService, useValue: {} },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              mode: 'invite',
              committee: { uid: 'committee-1', name: 'Docs Working Group' } as Committee,
              existingMembers: [],
              existingInvites: [EXPIRED, LIVE, LEGACY],
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AddMemberDialogComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.get('emails')!.setValue(emails.join('\n'));
    fixture.detectChanges();
    return fixture.componentInstance.categorized();
  }

  it('lets an expired invitation be invited again', async () => {
    const result = await categorize(['expired.invitee@example.com']);

    expect(result.toInvite).toEqual(['expired.invitee@example.com']);
    expect(result.alreadyInvited).toEqual([]);
  });

  it('still flags a live invitation and a legacy one without an expiry as already invited', async () => {
    const result = await categorize(['live.invitee@example.com', 'legacy.invitee@example.com']);

    expect(result.alreadyInvited).toEqual(['live.invitee@example.com', 'legacy.invitee@example.com']);
    expect(result.toInvite).toEqual([]);
  });
});

describe('AddMemberDialogComponent member names', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function setup(mode: AddMemberDialogMode = 'direct-add', collectOnly = false) {
    const committeeService = {
      createCommitteeMember: vi.fn(() => of({} as CommitteeMember)),
      createCommitteeInvite: vi.fn(() => of({} as CommitteeInvite)),
      revokeCommitteeInvite: vi.fn(() => of(undefined)),
    };
    const meetingService = { getMeetingRegistrants: vi.fn(() => of([] as MeetingRegistrant[])) };
    const close = vi.fn();
    const message = vi.fn();
    await TestBed.configureTestingModule({
      imports: [AddMemberDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: message } },
        { provide: CommitteeService, useValue: committeeService },
        { provide: MeetingService, useValue: meetingService },
        { provide: SearchService, useValue: { searchUsers: vi.fn(() => of([])) } },
        { provide: DynamicDialogRef, useValue: { close } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              mode,
              collectOnly,
              committee: { uid: 'committee-1', name: 'Example Group' },
              existingMembers: [{ email: 'existing@example.com' }],
              existingInvites: [{ uid: 'invite-1', invitee_email: 'first.last@example.com', status: 'pending', expires_at: '2999-01-01T00:00:00Z' }],
            },
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AddMemberDialogComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, committeeService, meetingService, close, message };
  }

  it.each([
    ['', ''],
    ['', 'Last'],
    ['First', ''],
    [' \t\u00a0', 'Last'],
    ['First', '\n\u2003'],
  ])('blocks missing or blank names (%j, %j) before any request', async (first, last) => {
    const { component, fixture, committeeService } = await setup();
    component.form.controls.emails.setValue('first.last@example.com');
    component.memberNamesForm.at(0).patchValue({ first_name: first, last_name: last });
    fixture.detectChanges();
    expect(component.canSubmit()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="add-member-submit"] button').disabled).toBe(true);
    component.onSubmit();
    expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
    expect(component.memberNamesForm.at(0).controls.first_name.touched).toBe(true);
  });

  it('sends distinct trimmed names for each person and preserves pending-invitation cleanup', async () => {
    const { component, fixture, committeeService, close } = await setup();
    component.form.controls.emails.setValue(' First.Last@Example.com\nsecond.member@example.com\nexisting@example.com\nFIRST.LAST@example.com');
    expect(component.memberNamesForm.length).toBe(2);
    component.memberNamesForm.at(0).patchValue({ first_name: ' First ', last_name: ' Last ' });
    component.memberNamesForm.at(1).patchValue({ first_name: 'Second', last_name: 'Member' });
    fixture.detectChanges();
    expect(component.canSubmit()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="add-member-submit"] button').disabled).toBe(false);
    component.onSubmit();
    expect(committeeService.createCommitteeMember.mock.calls).toEqual([
      ['committee-1', { email: 'first.last@example.com', first_name: 'First', last_name: 'Last' }, { skipNotification: true }],
      ['committee-1', { email: 'second.member@example.com', first_name: 'Second', last_name: 'Member' }, { skipNotification: true }],
    ]);
    expect(committeeService.revokeCommitteeInvite).toHaveBeenCalledWith('committee-1', 'invite-1');
    expect(close).toHaveBeenCalledWith(2);
  });

  it('keeps names with the matching email when addresses are reordered or removed', async () => {
    const { component } = await setup();
    component.form.controls.emails.setValue('first.last@example.com\nsecond.member@example.com');
    component.memberNamesForm.at(0).patchValue({ first_name: 'First', last_name: 'Last' });
    component.form.controls.emails.setValue('second.member@example.com\nfirst.last@example.com');
    expect(component.memberNamesForm.at(1).controls.first_name.value).toBe('First');
    expect(component.memberNamesForm.at(0).controls.first_name.value).toBe('');
    component.form.controls.emails.setValue('first.last@example.com');
    expect(component.canSubmit()).toBe(true);
    component.form.controls.emails.setValue('third.member@example.com');
    expect(component.memberNamesForm.at(0).controls.first_name.value).toBe('');
    expect(component.canSubmit()).toBe(false);
  });

  it('prefills search names and requires completing a partial search profile', async () => {
    const { component, fixture } = await setup();
    component.addEmail({ email: 'first.last@example.com', first_name: ' First ', last_name: '' } as DecoratedCommitteeSearchResult);
    fixture.detectChanges();
    expect(component.memberNamesForm.at(0).controls.first_name.value).toBe('First');
    expect(component.canSubmit()).toBe(false);
    component.memberNamesForm.at(0).controls.last_name.setValue('Last');
    expect(component.canSubmit()).toBe(true);
    const input = fixture.nativeElement.querySelector('[data-test="add-member-first-name"]');
    expect(input.id).toBe('add-member-first-name-0');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(fixture.nativeElement.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
  });

  it('preserves meeting names without overwriting reviewed names on re-import', async () => {
    const { component, meetingService } = await setup();
    meetingService.getMeetingRegistrants.mockReturnValue(
      of([
        { email: 'first.last@example.com', first_name: 'First', last_name: 'Last' },
        { email: 'second.member@example.com', first_name: 'Second', last_name: '' },
      ] as MeetingRegistrant[])
    );
    component.importForm.controls.meeting.setValue('meeting-1');
    component.onImportFromMeeting();
    expect(component.memberNamesForm.at(0).getRawValue()).toEqual({ email: 'first.last@example.com', first_name: 'First', last_name: 'Last' });
    expect(component.canSubmit()).toBe(false);
    component.memberNamesForm.at(1).patchValue({ first_name: 'Reviewed', last_name: 'Member' });
    component.importForm.controls.meeting.setValue('meeting-1');
    component.onImportFromMeeting();
    expect(component.memberNamesForm.at(1).controls.first_name.value).toBe('Reviewed');
    expect(component.canSubmit()).toBe(true);
  });

  it('limits names by Unicode code points rather than UTF-16 units', async () => {
    const { component } = await setup();
    component.form.controls.emails.setValue('first.last@example.com');
    component.memberNamesForm.at(0).patchValue({ first_name: '😀'.repeat(100), last_name: 'Last' });
    expect(component.canSubmit()).toBe(true);
    component.memberNamesForm.at(0).controls.first_name.setValue('😀'.repeat(101));
    expect(component.canSubmit()).toBe(false);
  });

  it('keeps names editable and shows upstream validation errors when creation fails', async () => {
    const { component, committeeService, close, message } = await setup();
    component.form.controls.emails.setValue('first.last@example.com');
    component.memberNamesForm.at(0).patchValue({ first_name: 'First', last_name: 'Last' });
    committeeService.createCommitteeMember.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'last_name is required' } }))
    );
    component.onSubmit();
    expect(close).not.toHaveBeenCalled();
    expect(component.canSubmit()).toBe(true);
    expect(message).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('last_name is required') }));
    expect(committeeService.revokeCommitteeInvite).not.toHaveBeenCalled();
  });

  it.each([false, true])('leaves email-only invitations unchanged (collectOnly=%j)', async (collectOnly) => {
    const { component, fixture, committeeService, close } = await setup('invite', collectOnly);
    component.form.controls.emails.setValue('new.invitee@example.com');
    fixture.detectChanges();
    expect(component.canSubmit()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="add-member-names"]')).toBeNull();
    component.onSubmit();
    expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
    if (collectOnly) {
      expect(committeeService.createCommitteeInvite).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledWith([{ invitee_email: 'new.invitee@example.com', role: null, organization: null }]);
    } else {
      expect(committeeService.createCommitteeInvite).toHaveBeenCalledWith('committee-1', {
        invitee_email: 'new.invitee@example.com',
        role: null,
        organization: undefined,
      });
    }
  });
});
