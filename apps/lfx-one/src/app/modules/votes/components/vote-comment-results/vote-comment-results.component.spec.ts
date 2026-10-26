// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { PollCommentResponse, PollCommentResult } from '@lfx-one/shared/interfaces';
import { PaginatorState } from 'primeng/paginator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VoteCommentResultsComponent } from './vote-comment-results.component';

/** Newest-first synthetic responses for one prompt. */
function responses(promptId: string, count: number): PollCommentResponse[] {
  return Array.from({ length: count }, (_, i) => ({
    vote_id: `${promptId}-response-${i + 1}`,
    comment_text: `Synthetic ${promptId} comment ${String(i + 1).padStart(2, '0')}`,
    user_name: `Synthetic Voter ${i + 1}`,
    vote_creation_time: new Date(Date.UTC(2026, 0, 31) - i * 60_000).toISOString(),
    abstained: false,
  }));
}

function result(promptId: string, items: PollCommentResponse[], totalResponses?: number): PollCommentResult {
  return { prompt: { prompt_id: promptId, prompt: `Synthetic prompt ${promptId}` }, responses: items, total_responses: totalResponses };
}

describe('VoteCommentResultsComponent', () => {
  let fixture: ComponentFixture<VoteCommentResultsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VoteCommentResultsComponent], providers: [provideNoopAnimations()] }).compileComponents();
    fixture = TestBed.createComponent(VoteCommentResultsComponent);
  });

  afterEach(() => fixture.destroy());

  function render(commentResults: PollCommentResult[], pageState?: Map<string, PaginatorState>): HTMLElement {
    fixture.componentRef.setInput('commentResults', commentResults);
    if (pageState) fixture.componentRef.setInput('pageState', pageState);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, '');
  const byTestId = (el: HTMLElement, testId: string): HTMLElement | null => el.querySelector(`[data-testid="${testId}"]`);

  it('renders each prompt with its responses, author, date and abstained marker', () => {
    const [first] = responses('p1', 1);
    const el = render([result('p1', [{ ...first, abstained: true }])]);

    const text = el.textContent ?? '';
    expect(text).toContain('Synthetic prompt p1');
    expect(text).toContain('Synthetic p1 comment 01');
    expect(text).toContain('Synthetic Voter 1');
    // DatePipe formats in local time; derive the expectation the same way so the spec passes in any timezone.
    expect(text).toContain(formatDate(first.vote_creation_time!, 'MMM d, y', 'en-US'));
    expect(text).toContain('(Abstained)');
    expect(el.querySelector('lfx-expandable-text.comment-text')).toBeTruthy();
  });

  it('shows the empty-prompt message', () => {
    const el = render([result('p1', [])]);
    expect(byTestId(el, 'vote-results-comments-empty-p1')?.textContent?.trim()).toBe('No responses yet.');
  });

  it('falls back to "Anonymous" when the author name is missing', () => {
    const [first] = responses('p1', 1);
    const el = render([result('p1', [{ ...first, user_name: undefined }])]);
    expect(el.textContent).toContain('Anonymous');
  });

  it('shows the paginator only when responses exceed the page size', () => {
    const el = render([result('p1', responses('p1', 26)), result('p2', responses('p2', 25))]);

    expect(byTestId(el, 'vote-results-comments-paginator-p1')).toBeTruthy();
    expect(byTestId(el, 'vote-results-comments-paginator-p2')).toBeNull();
    expect(squash(el.textContent)).toContain(squash('Synthetic p1 comment 25'));
    expect(squash(el.textContent)).not.toContain(squash('Synthetic p1 comment 26'));
  });

  it('discloses truncation when total_responses exceeds the list', () => {
    const el = render([result('p1', responses('p1', 3), 7), result('p2', responses('p2', 3), 3)]);

    expect(byTestId(el, 'vote-results-comments-truncated-p1')?.textContent?.trim()).toBe('Showing the 3 most recent of 7 responses.');
    expect(byTestId(el, 'vote-results-comments-truncated-p2')).toBeNull();
  });

  it('emits page changes through pageState with { first, rows }', async () => {
    const emitted: Map<string, PaginatorState>[] = [];
    fixture.componentInstance.pageState.subscribe((state) => emitted.push(state));
    const el = render([result('p1', responses('p1', 30))]);

    byTestId(el, 'vote-results-comments-paginator-p1')?.querySelector<HTMLButtonElement>('.p-paginator-next')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].get('p1')).toEqual({ first: 25, rows: 25 });
    expect(squash(el.textContent)).toContain(squash('Synthetic p1 comment 26'));
    expect(squash(el.textContent)).not.toContain(squash('Synthetic p1 comment 01'));
  });

  it('renders the page held in pageState', () => {
    const el = render([result('p1', responses('p1', 12))], new Map([['p1', { first: 5, rows: 5 }]]));

    expect(squash(el.textContent)).toContain(squash('Synthetic p1 comment 06'));
    expect(squash(el.textContent)).toContain(squash('Synthetic p1 comment 10'));
    expect(squash(el.textContent)).not.toContain(squash('Synthetic p1 comment 05'));
    expect(squash(el.textContent)).not.toContain(squash('Synthetic p1 comment 11'));
  });

  it('clamps a stale offset to the last page', () => {
    const el = render([result('p1', responses('p1', 30))], new Map([['p1', { first: 100, rows: 25 }]]));

    expect(squash(el.textContent)).toContain(squash('Synthetic p1 comment 26'));
    expect(squash(el.textContent)).toContain(squash('Synthetic p1 comment 30'));
    expect(squash(el.textContent)).not.toContain(squash('Synthetic p1 comment 25'));
  });

  describe('pseudo-anonymous votes (#3916)', () => {
    /** Text-only responses, as the BFF returns them for a pseudo-anonymous vote. */
    const textOnly = (...texts: string[]): PollCommentResponse[] => texts.map((text) => ({ comment_text: text }));

    it('renders text only, with no author, date, abstained label or ballot link, plus the lock notice', () => {
      fixture.componentRef.setInput('anonymous', true);
      fixture.componentRef.setInput('showBallotLinks', true);
      const el = render([result('p1', [{ ...responses('p1', 1)[0], abstained: true }])]);

      expect(el.textContent).toContain('Synthetic p1 comment 01');
      expect(el.textContent).not.toContain('Synthetic Voter 1');
      expect(el.textContent).not.toContain('Anonymous');
      expect(el.textContent).not.toContain('(Abstained)');
      expect(byTestId(el, 'vote-results-comment-meta')).toBeNull();
      expect(el.querySelector('[data-testid^="vote-results-comment-view-ballot-"]')).toBeNull();
      expect(byTestId(el, 'vote-results-comments-anonymous-notice')?.textContent).toContain('Pseudo-anonymous vote.');
    });

    it('keys responses with no vote_id by position, keeping duplicates and server order', () => {
      fixture.componentRef.setInput('anonymous', true);
      const el = render([result('p1', textOnly('alpha', 'alpha', 'bravo'))]);

      const texts = [...el.querySelectorAll('lfx-expandable-text')].map((node) => node.textContent?.trim());
      expect(texts).toEqual(['alpha', 'alpha', 'bravo']);
    });

    it.each([
      ['page', { first: 10, rows: 5 }, '11'],
      ['page size', { first: 0, rows: 10 }, '01'],
    ] as const)('resets anonymous comment expansion when the %s changes', async (_label, nextPage, expectedComment) => {
      fixture.componentRef.setInput('anonymous', true);
      const items = textOnly(...Array.from({ length: 20 }, (_, i) => `Synthetic comment ${String(i + 1).padStart(2, '0')}`));
      const el = render([result('p1', items)], new Map([['p1', { first: 5, rows: 5 }]]));
      await fixture.whenStable();

      const previous = fixture.debugElement.query(By.directive(ExpandableTextComponent)).componentInstance as ExpandableTextComponent;
      previous.needsExpansion.set(true);
      previous.isExpanded.set(true);
      fixture.detectChanges();

      fixture.componentRef.setInput('pageState', new Map([['p1', nextPage]]));
      fixture.detectChanges();
      await fixture.whenStable();

      const current = fixture.debugElement.query(By.directive(ExpandableTextComponent)).componentInstance as ExpandableTextComponent;
      expect(current).not.toBe(previous);
      expect(current.isExpanded()).toBe(false);
      expect(el.querySelector('lfx-expandable-text')?.textContent).toContain(`Synthetic comment ${expectedComment}`);
    });

    it('discloses truncation without claiming recency', () => {
      fixture.componentRef.setInput('anonymous', true);
      const el = render([result('p1', textOnly('alpha', 'bravo'), 5)]);

      expect(byTestId(el, 'vote-results-comments-truncated-p1')?.textContent?.trim()).toBe('Showing 2 of 5 responses.');
    });

    it('shows no lock notice on a named vote', () => {
      const el = render([result('p1', responses('p1', 1))]);

      expect(byTestId(el, 'vote-results-comments-anonymous-notice')).toBeNull();
      expect(byTestId(el, 'vote-results-comment-meta')).toBeTruthy();
    });
  });

  describe('ballot links (#3914)', () => {
    it('renders no links by default', () => {
      const el = render([result('p1', responses('p1', 2))]);

      expect(byTestId(el, 'vote-results-comment-view-ballot-p1-response-1')).toBeNull();
    });

    it("links each response and emits the response's vote id", () => {
      fixture.componentRef.setInput('showBallotLinks', true);
      const el = render([result('p1', responses('p1', 2))]);
      const emitted: string[] = [];
      fixture.componentInstance.viewBallot.subscribe((voteId) => emitted.push(voteId));

      const link = byTestId(el, 'vote-results-comment-view-ballot-p1-response-2')!.querySelector('button')!;
      expect(link.getAttribute('aria-label')).toBe('View ballot of Synthetic Voter 2');
      link.click();
      expect(emitted).toEqual(['p1-response-2']);
    });
  });
});
