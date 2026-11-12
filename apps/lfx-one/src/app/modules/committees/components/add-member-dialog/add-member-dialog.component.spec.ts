// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Which existing invitations block a new one in the Add Member dialog. Synthetic data only.

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Committee, CommitteeInvite } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { SearchService } from '@services/search.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
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
