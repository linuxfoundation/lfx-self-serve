// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Committee, PendingActionItem, Vote } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MeetingService } from '@services/meeting.service';
import { SurveyService } from '@services/survey.service';
import { VoteService } from '@services/vote.service';
import { WeeklyBriefService } from '@services/weekly-brief.service';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeOverviewComponent } from './committee-overview.component';

describe('CommitteeOverviewComponent vote navigation', () => {
  let fixture: ComponentFixture<CommitteeOverviewComponent>;
  let navigate: ReturnType<typeof vi.fn>;
  let addMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    navigate = vi.fn().mockResolvedValue(true);
    addMessage = vi.fn();
    TestBed.configureTestingModule({
      imports: [CommitteeOverviewComponent],
      providers: [
        { provide: Router, useValue: { navigate } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: { getMeetingsCountByCommittee: () => of(0), getPastMeetingsByCommittee: () => of([]) } },
        { provide: VoteService, useValue: { getVotesByCommittee: () => of([]), mergeRecentlyOpenedVotes: (votes: Vote[]) => votes } },
        { provide: SurveyService, useValue: { getSurveysByCommittee: () => of([]) } },
        { provide: MessageService, useValue: { add: addMessage } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: WeeklyBriefService, useValue: {} },
        { provide: HiddenActionsService, useValue: { isActionHidden: () => false } },
      ],
    }).overrideComponent(CommitteeOverviewComponent, { set: { template: '', imports: [] } });

    fixture = TestBed.createComponent(CommitteeOverviewComponent);
    fixture.componentRef.setInput('committee', { uid: 'committee-1', name: 'Synthetic Group' } as Committee);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('falls back to the Votes tab without navigating or showing a toast when a pending vote has no uid', () => {
    const tabNavigated = vi.fn();
    fixture.componentInstance.tabNavigated.subscribe(tabNavigated);
    const item: PendingActionItem = {
      type: 'Vote',
      badge: 'Synthetic Group',
      text: 'Synthetic vote',
      icon: 'fa-light fa-check-to-slot',
      severity: 'info',
      buttonText: 'Review and Vote',
      buttonLink: undefined,
    };

    fixture.componentInstance.handlePendingActionClick(item);

    expect(tabNavigated).toHaveBeenCalledExactlyOnceWith('votes');
    expect(navigate).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it.each(['vote-open', 'vote/invalid', 'vote?invalid', 'vote#invalid'])('opens %s as one vote-id segment', (uid) => {
    fixture.componentInstance.openVote(uid);

    expect(navigate).toHaveBeenCalledExactlyOnceWith(['/votes', uid]);
  });
});
