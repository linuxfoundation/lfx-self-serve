// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CommentResponseView } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VoteCommentItemComponent } from './vote-comment-item.component';

/** Synthetic named-vote response, decorated as the hosts decorate it. */
function view(overrides: Partial<CommentResponseView> = {}): CommentResponseView {
  return {
    vote_id: 'synthetic-response-1',
    comment_text: 'Synthetic comment',
    paragraphs: ['Synthetic comment'],
    user_name: 'Synthetic Voter',
    vote_creation_time: '2026-01-31T12:00:00Z',
    abstained: false,
    position: 0,
    ...overrides,
  };
}

describe('VoteCommentItemComponent', () => {
  let fixture: ComponentFixture<VoteCommentItemComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VoteCommentItemComponent], providers: [provideNoopAnimations()] }).compileComponents();
    fixture = TestBed.createComponent(VoteCommentItemComponent);
  });

  afterEach(() => fixture.destroy());

  function render(response: CommentResponseView, inputs: { anonymous?: boolean; showBallotLink?: boolean } = {}): HTMLElement {
    fixture.componentRef.setInput('response', response);
    if (inputs.anonymous !== undefined) fixture.componentRef.setInput('anonymous', inputs.anonymous);
    if (inputs.showBallotLink !== undefined) fixture.componentRef.setInput('showBallotLink', inputs.showBallotLink);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const byTestId = (el: HTMLElement, testId: string): HTMLElement | null => el.querySelector(`[data-testid="${testId}"]`);

  it('renders each paragraph of the comment', () => {
    const el = render(view({ paragraphs: ['First paragraph', 'Second paragraph'] }));

    const paragraphs = [...el.querySelectorAll('lfx-expandable-text.comment-text p')].map((p) => p.textContent?.trim());
    expect(paragraphs).toEqual(['First paragraph', 'Second paragraph']);
  });

  it('renders text only when anonymous, even with the ballot link enabled', () => {
    const el = render(view({ abstained: true }), { anonymous: true, showBallotLink: true });

    expect(el.textContent).toContain('Synthetic comment');
    expect(el.textContent).not.toContain('Synthetic Voter');
    expect(el.textContent).not.toContain('(Abstained)');
    expect(byTestId(el, 'vote-results-comment-meta')).toBeNull();
    expect(el.querySelector('[data-testid^="vote-results-comment-view-ballot-"]')).toBeNull();
  });

  it('renders the author name and submission date on a named response', () => {
    const response = view();
    const meta = byTestId(render(response), 'vote-results-comment-meta')?.textContent ?? '';

    expect(meta).toContain('Synthetic Voter');
    // DatePipe formats in local time; derive the expectation the same way so the spec passes in any timezone.
    expect(meta).toContain(formatDate(response.vote_creation_time!, 'MMM d, y', 'en-US'));
  });

  it('falls back to "Anonymous" when the author name is missing', () => {
    const meta = byTestId(render(view({ user_name: undefined })), 'vote-results-comment-meta')?.textContent ?? '';

    expect(meta).toContain('Anonymous');
  });

  it('labels an abstained response', () => {
    expect(byTestId(render(view({ abstained: true })), 'vote-results-comment-meta')?.textContent).toContain('(Abstained)');
  });

  describe('ballot link', () => {
    it('is hidden by default', () => {
      expect(byTestId(render(view()), 'vote-results-comment-view-ballot-synthetic-response-1')).toBeNull();
    });

    it('is hidden when the response has no vote id', () => {
      const el = render(view({ vote_id: undefined }), { showBallotLink: true });

      expect(el.querySelector('[data-testid^="vote-results-comment-view-ballot-"]')).toBeNull();
    });

    it("emits the response's vote id", () => {
      const el = render(view(), { showBallotLink: true });
      const emitted: string[] = [];
      fixture.componentInstance.viewBallot.subscribe((voteId) => emitted.push(voteId));

      const link = byTestId(el, 'vote-results-comment-view-ballot-synthetic-response-1')!.querySelector('button')!;
      expect(link.getAttribute('aria-label')).toBe('View ballot of Synthetic Voter');
      link.click();
      expect(emitted).toEqual(['synthetic-response-1']);
    });
  });
});
