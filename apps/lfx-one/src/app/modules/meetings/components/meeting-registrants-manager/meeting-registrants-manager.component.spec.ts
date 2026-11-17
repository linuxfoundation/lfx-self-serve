// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LiveAnnouncer } from '@angular/cdk/a11y';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import type {
  Committee,
  CommitteeMember,
  MeetingRegistrant,
  MeetingRegistrantWithState,
  MeetingSelfGuest,
  RegistrantPendingChanges,
} from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingInviteResendService } from '@services/meeting-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { SearchService } from '@services/search.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingCommitteeManagerComponent } from '../meeting-committee-manager/meeting-committee-manager.component';
import { MeetingRegistrantsManagerComponent } from './meeting-registrants-manager.component';

it('forwards pending invalidation and only complete roster coverage to the legacy host after retry', async () => {
  const retry = new Subject<CommitteeMember[]>();
  const getCommitteeMembers = vi
    .fn()
    .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502 })))
    .mockReturnValueOnce(retry);
  TestBed.configureTestingModule({
    providers: [
      { provide: MeetingService, useValue: { createRegistrantFormGroup: () => new FormGroup({}), getMeetingRegistrants: () => of([]) } },
      { provide: MeetingInviteResendService, useValue: {} },
      { provide: SearchService, useValue: {} },
      { provide: UserService, useValue: { getMeetingSelfGuest: () => of(null) } },
      { provide: ProjectContextService, useValue: { activeContextUid: () => 'project-1' } },
      {
        provide: CommitteeService,
        useValue: { getCommitteesByProjectOrThrow: () => of([{ uid: 'group-1', name: 'Example Group' } as Committee]), getCommitteeMembers },
      },
      provideNoopAnimations(),
    ],
  });
  const fixture = TestBed.createComponent(MeetingRegistrantsManagerComponent);
  fixture.componentRef.setInput('meetingUid', 'meeting-1');
  fixture.componentRef.setInput('form', new FormGroup({ committees: new FormControl([{ uid: 'group-1' }]), show_meeting_attendees: new FormControl(false) }));
  fixture.componentRef.setInput('registrantUpdates', { toAdd: [], toUpdate: [], toDelete: [] });
  fixture.componentRef.setInput('refresh', new BehaviorSubject<void>(undefined));
  const resolved = vi.fn();
  fixture.componentInstance.committeeMembersResolvedChange.subscribe(resolved);
  await fixture.whenStable();

  expect(resolved).toHaveBeenLastCalledWith(null);
  expect(resolved.mock.calls.every(([value]) => value === null)).toBe(true);
  const picker = fixture.debugElement.query(By.directive(MeetingCommitteeManagerComponent)).componentInstance as MeetingCommitteeManagerComponent;
  expect(picker.membersFetchError()).toBe(true);
  picker.retryCommitteeMembers();
  await fixture.whenStable();
  expect(resolved).toHaveBeenLastCalledWith(null);
  retry.next([]);
  retry.complete();
  await fixture.whenStable();
  expect(resolved).toHaveBeenLastCalledWith(['group-1']);
});

/** "Add myself" (#5798) in the classic editor: offered until the user is listed under any of their emails. */
describe('add myself', () => {
  const SELF_GUEST: MeetingSelfGuest = {
    email: 'pat.doe@example.com',
    first_name: 'Pat',
    last_name: 'Doe',
    job_title: 'Engineer',
    org_name: 'Example Org',
    username: 'pdoe',
    avatar_url: 'https://avatars.example.com/pdoe.png',
    matchEmails: ['pat.doe@example.com', 'pat@example.org'],
  };

  let selfGuest$: BehaviorSubject<MeetingSelfGuest | null>;
  let registrants$: Subject<MeetingRegistrant[]>;
  let announce: ReturnType<typeof vi.fn>;

  const listed = (email: string): MeetingRegistrant =>
    ({ uid: `reg-${email}`, email, first_name: 'Listed', last_name: 'Guest', type: 'direct' }) as MeetingRegistrant;

  const render = async () => {
    const fixture = TestBed.createComponent(MeetingRegistrantsManagerComponent);
    fixture.componentRef.setInput('meetingUid', 'meeting-1');
    fixture.componentRef.setInput('form', new FormGroup({ committees: new FormControl([]), show_meeting_attendees: new FormControl(false) }));
    fixture.componentRef.setInput('registrantUpdates', { toAdd: [], toUpdate: [], toDelete: [] });
    fixture.componentRef.setInput('refresh', new BehaviorSubject<void>(undefined));
    const updates = vi.fn<(changes: RegistrantPendingChanges) => void>();
    fixture.componentInstance.registrantUpdatesChange.subscribe(updates);
    await fixture.whenStable();
    const button = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="add-self-button"]');
    return { fixture, updates, button };
  };

  const load = async (fixture: { whenStable: () => Promise<unknown> }, registrants: MeetingRegistrant[]): Promise<void> => {
    registrants$.next(registrants);
    registrants$.complete();
    await fixture.whenStable();
  };

  beforeEach(() => {
    selfGuest$ = new BehaviorSubject<MeetingSelfGuest | null>(SELF_GUEST);
    registrants$ = new Subject<MeetingRegistrant[]>();
    announce = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () =>
              new FormGroup({
                email: new FormControl(''),
                first_name: new FormControl(''),
                last_name: new FormControl(''),
                job_title: new FormControl(''),
                org_name: new FormControl(''),
              }),
            getMeetingRegistrants: () => registrants$,
            stripMetadata: (meetingUid: string, registrant: MeetingRegistrantWithState) => ({ ...registrant, meeting_id: meetingUid }),
            getChangedFields: () => ({}),
          },
        },
        { provide: MeetingInviteResendService, useValue: { canResend: () => false } },
        { provide: SearchService, useValue: {} },
        { provide: UserService, useValue: { getMeetingSelfGuest: () => selfGuest$ } },
        { provide: LiveAnnouncer, useValue: { announce } },
        { provide: ProjectContextService, useValue: { activeContextUid: () => 'project-1' } },
        { provide: CommitteeService, useValue: { getCommitteesByProjectOrThrow: () => of([]), getCommitteeMembers: () => of([]) } },
        provideNoopAnimations(),
      ],
    });
  });

  it('is hidden while the invitation list is loading, then offered when the user is not on it', async () => {
    const { fixture, button } = await render();
    expect(button()).toBeNull();

    await load(fixture, [listed('someone@example.com')]);

    expect(button()).not.toBeNull();
  });

  it('is hidden when the user is listed under any of their emails, whatever the case', async () => {
    const { fixture, button } = await render();

    await load(fixture, [listed('Pat@Example.org')]);

    expect(button()).toBeNull();
  });

  it('adds the user as a direct, non-host series guest carrying their LFID and avatar', async () => {
    const { fixture, updates, button } = await render();
    await load(fixture, []);

    button()?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({
        toAdd: [
          expect.objectContaining({
            email: 'pat.doe@example.com',
            first_name: 'Pat',
            last_name: 'Doe',
            job_title: 'Engineer',
            org_name: 'Example Org',
            username: 'pdoe',
            avatar_url: 'https://avatars.example.com/pdoe.png',
            host: false,
            type: 'direct',
            occurrence_id: null,
            selfAdded: true,
          }),
        ],
      })
    );
    expect(announce).toHaveBeenCalledWith('You were added to the invitation list.', 'polite');
    expect(button()).toBeNull();
  });

  it('fills the add form instead of adding when a name is missing', async () => {
    selfGuest$.next({ ...SELF_GUEST, first_name: '' });
    const { fixture, updates, button } = await render();
    await load(fixture, []);

    button()?.querySelector('button')?.click();
    await fixture.whenStable();

    const form = fixture.componentInstance.addRegistrantForm;
    expect(form.getRawValue()).toEqual({ email: 'pat.doe@example.com', first_name: '', last_name: 'Doe', job_title: 'Engineer', org_name: 'Example Org' });
    expect(form.dirty).toBe(true);
    expect(updates).not.toHaveBeenCalled();
  });
});
