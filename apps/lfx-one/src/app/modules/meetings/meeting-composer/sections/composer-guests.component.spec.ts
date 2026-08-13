// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import type { CommitteeMember, MeetingRegistrantWithState } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { ComposerGuestsComponent } from './composer-guests.component';

/**
 * Covers guest reconciliation against group membership. The committee manager emits on mount and on
 * every fetch, and the consumer must not read an emission it can't trust as "nobody is in a group" —
 * that would queue every saved group guest for deletion behind the organizer's back.
 */
describe('ComposerGuestsComponent — committee member reconciliation', () => {
  let fixture: ComponentFixture<ComposerGuestsComponent>;
  let component: ComposerGuestsComponent;
  let formService: MeetingComposerFormService;

  const savedGroupGuest: MeetingRegistrantWithState = {
    uid: 'registrant-1',
    meeting_id: 'meeting-1',
    occurrence_id: null,
    email: 'member@example.com',
    first_name: 'Member',
    last_name: 'One',
    job_title: null,
    org_name: null,
    host: false,
    org_is_member: false,
    org_is_project_member: false,
    avatar_url: null,
    username: null,
    linkedin_profile: null,
    created_at: '',
    updated_at: '',
    type: 'committee',
    invite_accepted: null,
    attended: null,
    state: 'existing',
  };

  const member = { email: 'member@example.com', first_name: 'Member', last_name: 'One' } as CommitteeMember;

  const reconcile = (members: CommitteeMember[]): void => component['onCommitteeMembersChange'](members);

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () => new FormGroup({ email: new FormControl('') }),
            stripMetadata: (meetingUid: string, guest: MeetingRegistrantWithState) => ({ ...guest, meeting_id: meetingUid }),
            getChangedFields: () => ({}),
          },
        },
      ],
    });
    TestBed.overrideComponent(ComposerGuestsComponent, { set: { template: '', imports: [] } });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerGuestsComponent);
    fixture.componentRef.setInput('form', formService.form());
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('queues a saved group guest for deletion once they leave every selected group', () => {
    formService.setGuests([savedGroupGuest]);

    reconcile([]);

    expect(formService.guests().map((guest) => guest.state)).toEqual(['deleted']);
  });

  it('restores a guest queued for deletion when they turn up in a selected group again', () => {
    formService.setGuests([savedGroupGuest]);

    reconcile([]);
    reconcile([member]);

    expect(formService.guests()).toHaveLength(1);
    expect(formService.guests()[0].state).toBe('existing');
    expect(formService.guests()[0].uid).toBe('registrant-1');
  });

  it('leaves direct guests untouched', () => {
    formService.setGuests([{ ...savedGroupGuest, type: 'direct' }]);

    reconcile([]);

    expect(formService.guests()[0].state).toBe('existing');
  });

  it('does not re-add a group guest the organizer just removed', () => {
    reconcile([member]);
    const added = formService.guests()[0];
    component['onRemoveGuest'](added);

    reconcile([member]);

    expect(formService.guests()).toHaveLength(0);
  });
});
