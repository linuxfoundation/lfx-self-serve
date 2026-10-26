// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, NO_ERRORS_SCHEMA, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Committee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
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

  const table = () => fixture.debugElement.query(By.directive(VotesTableStubComponent)).componentInstance as VotesTableStubComponent;

  beforeEach(() => {
    navigate = vi.fn().mockResolvedValue(true);

    TestBed.configureTestingModule({
      imports: [CommitteeVotesComponent],
      providers: [
        { provide: Router, useValue: { navigate } },
        { provide: CommitteeService, useValue: { fetchCommittee: vi.fn() } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).overrideComponent(CommitteeVotesComponent, { set: { imports: [VotesTableStubComponent], schemas: [NO_ERRORS_SCHEMA] } });

    fixture = TestBed.createComponent(CommitteeVotesComponent);
    fixture.componentRef.setInput('committee', { uid: 'committee-1', project_slug: 'synthetic-project' } as Committee);
    fixture.detectChanges();
  });

  it.each(['vote-open', 'vote/invalid', 'vote?invalid', 'vote#invalid'])('opens a row with %s as one vote-id segment', (uid) => {
    table().viewVote.emit(uid);

    expect(navigate).toHaveBeenLastCalledWith(['/votes', uid]);
  });

  it.each(['vote-ended', 'vote/invalid', 'vote?invalid', 'vote#invalid'])('opens Results with %s as one vote-id segment', (uid) => {
    table().viewResults.emit(uid);

    expect(navigate).toHaveBeenLastCalledWith(['/votes', uid], { queryParams: { tab: 'results' } });
  });
});
