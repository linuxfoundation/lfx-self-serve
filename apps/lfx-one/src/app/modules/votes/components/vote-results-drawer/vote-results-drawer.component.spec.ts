// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { PollStatus } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoteResultsDrawerComponent } from './vote-results-drawer.component';

let fixture: ComponentFixture<VoteResultsDrawerComponent>;

afterEach(() => {
  fixture?.destroy();
  document.body.innerHTML = '';
});

describe('VoteResultsDrawerComponent — view-only permalink', () => {
  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('shows vote details without casting or results for a non-voter (%s)', async (status) => {
    const vote = {
      uid: 'vote-1',
      name: 'Charter ratification',
      description: '<p>Approve the revised charter.</p>',
      project_uid: 'project-1',
      status,
    } as Vote;
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: VoteService, useValue: { getVote: vi.fn(() => of(vote)), getMyVoteResponse: vi.fn(() => of(null)), getVoteResults: vi.fn(() => of(null)) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(document.querySelector('[data-testid="vote-results-voter-not-participant"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="vote-results-voter-description"]')?.textContent).toContain('Approve the revised charter.');
    expect(document.querySelector('[data-testid="vote-results-drawer-cast-button"]')).toBeNull();
    expect(document.querySelector('[data-testid="vote-results-voter-final"]')).toBeNull();
  });
});
