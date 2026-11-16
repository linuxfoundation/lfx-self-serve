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

  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    (fixture.nativeElement as HTMLElement).remove();
    fixture.destroy();
  });

  function render(response: CommentResponseView, inputs: { anonymous?: boolean; showBallotLink?: boolean; linkStyle?: 'button' | 'row' } = {}): HTMLElement {
    fixture.componentRef.setInput('response', response);
    if (inputs.anonymous !== undefined) fixture.componentRef.setInput('anonymous', inputs.anonymous);
    if (inputs.showBallotLink !== undefined) fixture.componentRef.setInput('showBallotLink', inputs.showBallotLink);
    if (inputs.linkStyle !== undefined) fixture.componentRef.setInput('linkStyle', inputs.linkStyle);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const byTestId = (el: HTMLElement, testId: string): HTMLElement | null => el.querySelector(`[data-testid="${testId}"]`);

  it('renders each paragraph of the comment', () => {
    const el = render(view({ paragraphs: ['First paragraph', 'Second paragraph'] }));

    const row = byTestId(el, 'vote-results-comment');
    expect(row).not.toBeNull();
    const paragraphs = [...row!.querySelectorAll('p')].map((p) => p.textContent?.trim());
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

  describe('row link style', () => {
    const nameButtonId = 'vote-results-comment-view-ballot-synthetic-response-1';
    const row = (el: HTMLElement): HTMLElement => byTestId(el, 'vote-results-comment')!;
    const collect = (): string[] => {
      const emitted: string[] = [];
      fixture.componentInstance.viewBallot.subscribe((voteId) => emitted.push(voteId));
      return emitted;
    };
    const selectCommentText = (el: HTMLElement): Selection => {
      document.body.appendChild(el);
      const range = document.createRange();
      range.selectNodeContents(row(el).querySelector('p')!);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection;
    };

    it('default mode keeps the View ballot button and ignores row clicks', () => {
      const el = render(view(), { showBallotLink: true });
      const emitted = collect();

      row(el).click();

      expect(emitted).toEqual([]);
      expect(byTestId(el, nameButtonId)?.textContent).toContain('View ballot');
    });

    it('renders the name as the ballot button without a View ballot label', () => {
      const el = render(view(), { showBallotLink: true, linkStyle: 'row' });

      const button = byTestId(el, nameButtonId)!.querySelector('button')!;
      expect(button.textContent).toContain('Synthetic Voter');
      expect(el.textContent).not.toContain('View ballot');
      expect(button.getAttribute('aria-label')).toBe('View ballot of Synthetic Voter');
    });

    it('emits once from the name button', () => {
      const el = render(view(), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();

      byTestId(el, nameButtonId)!.querySelector('button')!.click();

      expect(emitted).toEqual(['synthetic-response-1']);
    });

    it('emits from a click on the row', () => {
      const el = render(view(), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();

      row(el).click();

      expect(emitted).toEqual(['synthetic-response-1']);
      expect(row(el).classList).toContain('cursor-pointer');
    });

    it('keeps single, double and triple clicks on comment prose from opening the ballot', () => {
      const el = render(view(), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();
      const paragraph = row(el).querySelector('p')!;

      for (const detail of [1, 2, 3]) {
        paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
        expect(emitted).toEqual([]);
      }
      expect(row(el).querySelector('.comment-text')?.classList).toContain('cursor-text');
    });

    it('preserves selected comment prose without opening the ballot', () => {
      const el = render(view(), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();
      const selection = selectCommentText(el);
      expect(selection.toString()).toBe('Synthetic comment');

      row(el).querySelector('p')!.click();

      expect(emitted).toEqual([]);
      expect(selection.toString()).toBe('Synthetic comment');
    });

    it('does not open the ballot from the row background while this row has selected text', () => {
      const el = render(view(), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();
      const selection = selectCommentText(el);

      row(el).click();

      expect(emitted).toEqual([]);
      expect(selection.toString()).toBe('Synthetic comment');
    });

    it('opens the ballot when selected text belongs to a different part of the page', () => {
      const el = render(view(), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();
      const outside = document.createElement('p');
      outside.textContent = 'Other selected text';
      el.prepend(outside);
      document.body.appendChild(el);
      const range = document.createRange();
      range.selectNodeContents(outside);
      const selection = document.getSelection()!;
      selection.addRange(range);

      row(el).click();

      expect(emitted).toEqual(['synthetic-response-1']);
      expect(selection.toString()).toBe('Other selected text');
    });

    it.each(['before', 'after'])('protects a selection spanning this row and text %s it', (position) => {
      const el = render(view(), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();
      const outside = document.createElement('p');
      outside.textContent = 'Other selected text';
      if (position === 'before') el.prepend(outside);
      else el.appendChild(outside);
      document.body.appendChild(el);
      const commentText = row(el).querySelector('p')!.firstChild!;
      const range = document.createRange();
      if (position === 'before') {
        range.setStart(outside.firstChild!, 0);
        range.setEnd(commentText, 1);
      } else {
        range.setStart(commentText, 0);
        range.setEnd(outside.firstChild!, 1);
      }
      const selection = document.getSelection()!;
      selection.addRange(range);

      row(el).click();

      expect(emitted).toEqual([]);
      expect(selection.isCollapsed).toBe(false);
    });

    it('opens the ballot from the row background when the text selection is collapsed', () => {
      const el = render(view(), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();
      const selection = selectCommentText(el);
      selection.collapseToEnd();
      expect(selection.isCollapsed).toBe(true);

      row(el).click();

      expect(emitted).toEqual(['synthetic-response-1']);
    });

    it('keeps the name button active while comment prose is selected', () => {
      const el = render(view(), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();
      selectCommentText(el);

      byTestId(el, nameButtonId)!.querySelector('button')!.click();

      expect(emitted).toEqual(['synthetic-response-1']);
    });

    it('does not emit from a link inside the comment text', () => {
      const el = render(view({ paragraphs: ['See https://example.com/doc'] }), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();
      const link = row(el).querySelector('a');
      expect(link).not.toBeNull();
      link!.addEventListener('click', (event) => event.preventDefault());

      link!.click();

      expect(emitted).toEqual([]);
    });

    it('does not emit from another button inside the row', () => {
      const el = render(view(), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();
      const inner = document.createElement('button');
      row(el).appendChild(inner);

      inner.click();

      expect(emitted).toEqual([]);
    });

    it('stays inert when the ballot link is not allowed', () => {
      const el = render(view(), { showBallotLink: false, linkStyle: 'row' });
      const emitted = collect();

      row(el).click();

      expect(emitted).toEqual([]);
      expect(byTestId(el, nameButtonId)).toBeNull();
      expect(row(el).classList).not.toContain('cursor-pointer');
    });

    it('stays inert and hides the name when anonymous', () => {
      const el = render(view(), { anonymous: true, showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();

      row(el).click();

      expect(emitted).toEqual([]);
      expect(el.textContent).not.toContain('Synthetic Voter');
      expect(row(el).classList).not.toContain('cursor-pointer');
    });

    it('stays inert without a vote id', () => {
      const el = render(view({ vote_id: undefined }), { showBallotLink: true, linkStyle: 'row' });
      const emitted = collect();

      row(el).click();

      expect(emitted).toEqual([]);
    });
  });
});
