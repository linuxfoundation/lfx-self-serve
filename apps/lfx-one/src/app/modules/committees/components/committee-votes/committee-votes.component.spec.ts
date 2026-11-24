// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, NO_ERRORS_SCHEMA, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { PollType } from '@lfx-one/shared/enums';
import { Committee, Vote } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeVotesComponent } from './committee-votes.component';

/** Stands in for lfx-votes-table so the spec drives the real template bindings through its outputs. */
@Component({ selector: 'lfx-votes-table', template: '' })
class VotesTableStubComponent {
  public readonly canCancelVotes = input<boolean>(false);
  public readonly viewVote = output<string>();
  public readonly viewResults = output<string>();
  public readonly voteClosed = output<Vote>();
}

/** Stands in for lfx-vote-create-menu: the spec plays the user's row pick through its output. */
@Component({ selector: 'lfx-vote-create-menu', template: '' })
class VoteCreateMenuStubComponent {
  public readonly methodSelected = output<PollType>();
  public readonly isOpen = signal(false);
  public toggle = vi.fn();
}

describe('CommitteeVotesComponent', () => {
  let fixture: ComponentFixture<CommitteeVotesComponent>;
  let navigate: ReturnType<typeof vi.fn>;
  let fetchCommittee: ReturnType<typeof vi.fn>;

  const table = () => fixture.debugElement.query(By.directive(VotesTableStubComponent)).componentInstance as VotesTableStubComponent;
  const createMenu = () => fixture.debugElement.query(By.directive(VoteCreateMenuStubComponent)).componentInstance as VoteCreateMenuStubComponent;

  beforeEach(() => {
    navigate = vi.fn().mockResolvedValue(true);
    fetchCommittee = vi.fn();

    TestBed.configureTestingModule({
      imports: [CommitteeVotesComponent],
      providers: [
        { provide: Router, useValue: { navigate } },
        { provide: CommitteeService, useValue: { fetchCommittee } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).overrideComponent(CommitteeVotesComponent, {
      set: { imports: [ButtonComponent, VotesTableStubComponent, VoteCreateMenuStubComponent], schemas: [NO_ERRORS_SCHEMA] },
    });

    fixture = TestBed.createComponent(CommitteeVotesComponent);
    fixture.componentRef.setInput('committee', { uid: 'committee-1', project_slug: 'synthetic-project' } as Committee);
    fixture.detectChanges();
  });

  it.each(['vote-open', 'vote/invalid', 'vote?invalid', 'vote#invalid'])('opens a row with %s as one vote-id segment', (uid) => {
    table().viewVote.emit(uid);

    expect(navigate).toHaveBeenLastCalledWith(['/votes', uid]);
  });

  it('opts the group Votes tab into row-menu Cancel vote (#5968)', () => {
    expect(table().canCancelVotes()).toBe(true);
  });

  it('relays a row-menu close to the parent so it can hold the ended status (#4744)', () => {
    const closed = vi.fn();
    fixture.componentInstance.voteClosed.subscribe(closed);
    const vote = { uid: 'vote-1', status: 'ended' } as Vote;

    table().voteClosed.emit(vote);

    expect(closed).toHaveBeenCalledWith(vote);
  });

  it.each(['vote-ended', 'vote/invalid', 'vote?invalid', 'vote#invalid'])('opens Results with %s as one vote-id segment', (uid) => {
    table().viewResults.emit(uid);

    expect(navigate).toHaveBeenLastCalledWith(['/votes', uid], { queryParams: { tab: 'results' } });
  });

  describe('Create Vote dropdown (#2921)', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('canEdit', true);
      fixture.componentRef.setInput('votesLoading', false);
      fixture.detectChanges();
    });

    it('turns the Create Vote button into a menu button that toggles the dropdown', () => {
      const trigger = fixture.nativeElement.querySelector('[data-testid="committee-votes-empty-create-btn"] button') as HTMLButtonElement;

      expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
      trigger.click();
      expect(createMenu().toggle).toHaveBeenCalledTimes(1);
    });

    it('re-checks write access, then opens the form for this group with the chosen method', () => {
      fetchCommittee.mockReturnValue(of({ uid: 'committee-1', writer: true }));

      createMenu().methodSelected.emit(PollType.CONDORCET_IRV);

      expect(fetchCommittee).toHaveBeenCalledWith('committee-1');
      expect(navigate).toHaveBeenLastCalledWith(['/votes', 'create'], {
        queryParams: { committee_uid: 'committee-1', project: 'synthetic-project', poll_type: 'condorcet_irv' },
      });
    });

    it('still sends a user without write access back to the overview', () => {
      fetchCommittee.mockReturnValue(of({ uid: 'committee-1', writer: false }));

      createMenu().methodSelected.emit(PollType.GENERIC);

      expect(navigate).toHaveBeenLastCalledWith(['/project/overview'], { queryParams: { _notice: 'votes', project: 'synthetic-project' } });
    });
  });
});
