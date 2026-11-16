// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import type { Committee, CommitteeMember } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingInviteResendService } from '@services/meeting-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { SearchService } from '@services/search.service';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { expect, it, vi } from 'vitest';

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
