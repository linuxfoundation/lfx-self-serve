// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, NO_ERRORS_SCHEMA, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { VOTE_DETAIL_PAGE_DEFAULT, VOTE_DETAIL_PAGE_FLAG } from '@lfx-one/shared/constants';
import { Committee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeVotesComponent } from './committee-votes.component';

/** Stands in for lfx-votes-table so the spec drives the real template bindings through its outputs. */
@Component({ selector: 'lfx-votes-table', template: '' })
class VotesTableStubComponent {
  public readonly viewVote = output<string>();
  public readonly viewResults = output<string>();
}

describe('CommitteeVotesComponent', () => {
  let fixture: ComponentFixture<CommitteeVotesComponent>;
  let navigate: ReturnType<typeof vi.fn>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  const voteDetailPageEnabled = signal(false);

  const component = () => fixture.componentInstance;
  const table = () => fixture.debugElement.query(By.directive(VotesTableStubComponent)).componentInstance as VotesTableStubComponent;

  beforeEach(() => {
    voteDetailPageEnabled.set(false);
    navigate = vi.fn().mockResolvedValue(true);
    getBooleanFlag = vi.fn().mockReturnValue(voteDetailPageEnabled);

    TestBed.configureTestingModule({
      imports: [CommitteeVotesComponent],
      providers: [
        { provide: Router, useValue: { navigate } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag } },
        { provide: CommitteeService, useValue: { fetchCommittee: vi.fn() } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).overrideComponent(CommitteeVotesComponent, { set: { imports: [VotesTableStubComponent], schemas: [NO_ERRORS_SCHEMA] } });

    fixture = TestBed.createComponent(CommitteeVotesComponent);
    fixture.componentRef.setInput('committee', { uid: 'committee-1', project_slug: 'synthetic-project' } as Committee);
    fixture.detectChanges();
  });

  describe('vote detail page flag', () => {
    it('reads the vote detail page flag with the shared default', () => {
      expect(getBooleanFlag).toHaveBeenCalledWith(VOTE_DETAIL_PAGE_FLAG, VOTE_DETAIL_PAGE_DEFAULT);
    });

    it('opens the vote page from a row and from View results when the flag is on', () => {
      voteDetailPageEnabled.set(true);

      table().viewVote.emit('vote-open');
      expect(navigate).toHaveBeenLastCalledWith(['/votes', 'vote-open'], {});

      table().viewResults.emit('vote-ended');
      expect(navigate).toHaveBeenLastCalledWith(['/votes', 'vote-ended'], { queryParams: { tab: 'results' } });
      expect(component().resultsDrawerVisible()).toBe(false);
      expect(component().selectedVoteId()).toBeNull();
    });

    it('opens the results drawer as today when the flag is off', () => {
      table().viewVote.emit('vote-open');
      expect(component().resultsDrawerVisible()).toBe(true);
      expect(component().selectedVoteId()).toBe('vote-open');

      table().viewResults.emit('vote-ended');
      expect(component().selectedVoteId()).toBe('vote-ended');
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
