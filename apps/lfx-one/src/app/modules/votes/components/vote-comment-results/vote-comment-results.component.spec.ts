// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { VOTE_COMMENT_ANONYMOUS_NOTICES } from '@lfx-one/shared/constants';
import { PollCommentResponse, PollCommentResult } from '@lfx-one/shared/interfaces';
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

  async function render(commentResults: PollCommentResult[], expansionState?: Map<string, boolean>): Promise<HTMLElement> {
    fixture.componentRef.setInput('commentResults', commentResults);
    if (expansionState) fixture.componentRef.setInput('expansionState', expansionState);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, '');
  const byTestId = (el: HTMLElement, testId: string): HTMLElement | null => el.querySelector(`[data-testid="${testId}"]`);
  const toggle = (el: HTMLElement, promptId: string): HTMLButtonElement => byTestId(el, `vote-results-comments-toggle-${promptId}`) as HTMLButtonElement;

  it('renders each prompt with its responses, author, date and abstained marker', async () => {
    const [first] = responses('p1', 1);
    const el = await render([result('p1', [{ ...first, abstained: true }])]);

    const text = el.textContent ?? '';
    expect(text).toContain('Synthetic prompt p1');
    expect(text).toContain('Synthetic p1 comment 01');
    expect(text).toContain('Synthetic Voter 1');
    // DatePipe formats in local time; derive the expectation the same way so the spec passes in any timezone.
    expect(text).toContain(formatDate(first.vote_creation_time!, 'MMM d, y', 'en-US'));
    expect(text).toContain('(Abstained)');
    expect(el.querySelector('lfx-expandable-text.comment-text')).toBeTruthy();
  });

  it('shows the empty-prompt message', async () => {
    const el = await render([result('p1', [])]);
    expect(byTestId(el, 'vote-results-comments-empty-p1')?.textContent?.trim()).toBe('No responses yet.');
  });

  it('falls back to "Anonymous" when the author name is missing', async () => {
    const [first] = responses('p1', 1);
    const el = await render([result('p1', [{ ...first, user_name: undefined }])]);
    expect(el.textContent).toContain('Anonymous');
  });

  it('shows a single question directly without an accordion or bulk controls', async () => {
    const el = await render([result('p1', responses('p1', 1))]);
    expect(toggle(el, 'p1')).toBeNull();
    expect(byTestId(el, 'vote-results-comments-controls')).toBeNull();
    const heading = el.querySelector<HTMLHeadingElement>('h3')!;
    expect(heading.textContent).toContain('Synthetic prompt p1');
    expect(heading.querySelector('button')).toBeNull();
    expect(el.querySelector('[aria-expanded]')).toBeNull();
    const panel = el.querySelector<HTMLElement>('[role="region"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(panel.hidden).toBe(false);
    expect(el.textContent).toContain('1 comment');
    expect(el.querySelectorAll('lfx-vote-comment-item')).toHaveLength(1);
  });

  it('starts multiple questions collapsed with full text and counts visible, without bulk controls', async () => {
    const el = await render([result('p1', responses('p1', 2)), result('p2', [])]);
    expect(toggle(el, 'p1').getAttribute('aria-expanded')).toBe('false');
    expect(toggle(el, 'p2').getAttribute('aria-expanded')).toBe('false');
    expect(toggle(el, 'p1').textContent).toContain('Synthetic prompt p1');
    expect(toggle(el, 'p1').textContent).toContain('2 comments');
    expect(toggle(el, 'p2').textContent).toContain('0 comments');
    expect(el.querySelectorAll('lfx-vote-comment-item')).toHaveLength(0);
    expect(byTestId(el, 'vote-results-comments-controls')).toBeNull();
    expect(byTestId(el, 'vote-results-comments-expand-all')).toBeNull();
    expect(byTestId(el, 'vote-results-comments-collapse-all')).toBeNull();
  });

  it('opens and closes each panel independently through its native button', async () => {
    const emitted: Map<string, boolean>[] = [];
    fixture.componentInstance.expansionState.subscribe((state) => emitted.push(state));
    const el = await render([result('p1', responses('p1', 2)), result('p2', responses('p2', 1))]);
    toggle(el, 'p1').click();
    await fixture.whenStable();
    expect(toggle(el, 'p1').getAttribute('aria-expanded')).toBe('true');
    expect(toggle(el, 'p2').getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelectorAll('lfx-vote-comment-item')).toHaveLength(2);
    toggle(el, 'p2').click();
    await fixture.whenStable();
    expect(el.querySelectorAll('lfx-vote-comment-item')).toHaveLength(3);
    toggle(el, 'p1').click();
    await fixture.whenStable();
    expect(toggle(el, 'p1').getAttribute('aria-expanded')).toBe('false');
    expect(toggle(el, 'p2').getAttribute('aria-expanded')).toBe('true');
    expect(emitted.at(-1)).toEqual(
      new Map([
        ['p1', false],
        ['p2', true],
      ])
    );
  });

  it('connects each heading button to its labeled region and hides collapsed panels', async () => {
    const el = await render([result('p1', []), result('p2', [])]);
    for (const promptId of ['p1', 'p2']) {
      const button = toggle(el, promptId);
      expect(button.tagName).toBe('BUTTON');
      expect(button.type).toBe('button');
      expect(button.closest('h3')).toBeTruthy();
      const panel = el.querySelector<HTMLElement>(`[id="${button.getAttribute('aria-controls')}"]`)!;
      expect(panel.getAttribute('role')).toBe('region');
      expect(panel.getAttribute('aria-labelledby')).toBe(button.id);
      expect(panel.hidden).toBe(true);
      button.click();
      await fixture.whenStable();
      expect(panel.hidden).toBe(false);
      expect(byTestId(el, `vote-results-comments-empty-${promptId}`)?.textContent).toContain('No responses yet.');
    }
  });

  it('renders all returned comments in server order without pagination', async () => {
    const el = await render([result('p1', responses('p1', 200))]);
    expect(el.querySelectorAll('lfx-vote-comment-item')).toHaveLength(200);
    expect(el.querySelector('p-paginator')).toBeNull();
    const texts = [...el.querySelectorAll('lfx-expandable-text')].map((node) => squash(node.textContent));
    expect(texts).toEqual(responses('p1', 200).map((response) => squash(response.comment_text)));
  });

  it('retains explicit expansion choices when results refresh and new prompts arrive', async () => {
    const el = await render(
      [result('p1', responses('p1', 1)), result('p2', [])],
      new Map([
        ['p1', true],
        ['p2', false],
      ])
    );
    await render([result('p1', responses('p1', 3)), result('p2', []), result('p3', [])]);
    expect(toggle(el, 'p1').getAttribute('aria-expanded')).toBe('true');
    expect(toggle(el, 'p2').getAttribute('aria-expanded')).toBe('false');
    expect(toggle(el, 'p3').getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelectorAll('lfx-vote-comment-item')).toHaveLength(3);
  });

  it('keeps a single question visible even with a retained collapsed choice', async () => {
    const el = await render([result('p1', responses('p1', 1))], new Map([['p1', false]]));
    expect(toggle(el, 'p1')).toBeNull();
    expect(el.querySelectorAll('lfx-vote-comment-item')).toHaveLength(1);
  });

  it('switches between plain and accordion layouts as the question count changes', async () => {
    const el = await render([result('p1', responses('p1', 1))]);
    await render([result('p1', responses('p1', 1)), result('p2', [])]);
    expect(toggle(el, 'p1').getAttribute('aria-expanded')).toBe('false');
    expect(toggle(el, 'p2').getAttribute('aria-expanded')).toBe('false');
    expect(byTestId(el, 'vote-results-comments-controls')).toBeNull();
    expect(el.querySelectorAll('lfx-vote-comment-item')).toHaveLength(0);
    await render([result('p1', responses('p1', 1))]);
    expect(toggle(el, 'p1')).toBeNull();
    expect(byTestId(el, 'vote-results-comments-controls')).toBeNull();
    expect(el.querySelectorAll('lfx-vote-comment-item')).toHaveLength(1);
    expect(el.querySelectorAll('[id^="vote-results-comments-heading-"]')).toHaveLength(1);
  });

  it('handles no questions without bulk controls', async () => {
    const el = await render([]);
    expect(el.querySelector('section')).toBeNull();
    expect(byTestId(el, 'vote-results-comments-controls')).toBeNull();
  });

  it('discloses truncation and uses the full response count in the question header', async () => {
    const el = await render([result('p1', responses('p1', 3), 7), result('p2', responses('p2', 3), 3)]);
    expect(toggle(el, 'p1').textContent).toContain('7 comments');
    toggle(el, 'p1').click();
    toggle(el, 'p2').click();
    await fixture.whenStable();
    expect(byTestId(el, 'vote-results-comments-truncated-p1')?.textContent?.trim()).toBe('Showing the 3 most recent of 7 responses.');
    expect(byTestId(el, 'vote-results-comments-truncated-p2')).toBeNull();
  });

  describe('pseudo-anonymous votes (#3916)', () => {
    /** Text-only responses, as the BFF returns them for a pseudo-anonymous vote. */
    const textOnly = (...texts: string[]): PollCommentResponse[] => texts.map((text) => ({ comment_text: text }));

    it('renders text only, with no author, date, abstained label or ballot link, plus the lock notice', async () => {
      fixture.componentRef.setInput('anonymous', true);
      fixture.componentRef.setInput('showBallotLinks', true);
      const el = await render([result('p1', [{ ...responses('p1', 1)[0], abstained: true }])]);

      expect(el.textContent).toContain('Synthetic p1 comment 01');
      expect(el.textContent).not.toContain('Synthetic Voter 1');
      expect(el.textContent).not.toContain('Anonymous');
      expect(el.textContent).not.toContain('(Abstained)');
      expect(byTestId(el, 'vote-results-comment-meta')).toBeNull();
      expect(el.querySelector('[data-testid^="vote-results-comment-view-ballot-"]')).toBeNull();
      expect(byTestId(el, 'vote-results-comments-anonymous-notice')?.textContent).toContain('Pseudo-anonymous vote.');
    });

    it('keys responses with no vote_id by position, keeping duplicates and server order', async () => {
      fixture.componentRef.setInput('anonymous', true);
      const el = await render([result('p1', textOnly('alpha', 'alpha', 'bravo'))]);

      const texts = [...el.querySelectorAll('lfx-expandable-text')].map((node) => node.textContent?.trim());
      expect(texts).toEqual(['alpha', 'alpha', 'bravo']);
    });

    it('mounts comments on expansion and recreates their Show more measurement on reopening', async () => {
      fixture.componentRef.setInput('anonymous', true);
      const el = await render([result('p1', textOnly('alpha', 'alpha', 'bravo')), result('p2', textOnly('charlie'))]);
      expect(fixture.debugElement.query(By.directive(ExpandableTextComponent))).toBeNull();
      toggle(el, 'p1').click();
      await fixture.whenStable();
      const previous = fixture.debugElement.query(By.directive(ExpandableTextComponent)).componentInstance as ExpandableTextComponent;
      previous.needsExpansion.set(true);
      previous.isExpanded.set(true);
      await fixture.whenStable();
      toggle(el, 'p1').click();
      await fixture.whenStable();
      toggle(el, 'p1').click();
      await fixture.whenStable();
      const current = fixture.debugElement.query(By.directive(ExpandableTextComponent)).componentInstance as ExpandableTextComponent;
      expect(current).not.toBe(previous);
      expect(current.isExpanded()).toBe(false);
      expect([...el.querySelectorAll('lfx-expandable-text')].map((node) => node.textContent?.trim())).toEqual(['alpha', 'alpha', 'bravo']);
    });

    it('discloses truncation without claiming recency', async () => {
      fixture.componentRef.setInput('anonymous', true);
      const el = await render([result('p1', textOnly('alpha', 'bravo'), 5)]);

      expect(byTestId(el, 'vote-results-comments-truncated-p1')?.textContent?.trim()).toBe('Showing 2 of 5 responses.');
    });

    it('shows no lock notice on a named vote', async () => {
      const el = await render([result('p1', responses('p1', 1))]);

      expect(byTestId(el, 'vote-results-comments-anonymous-notice')).toBeNull();
      expect(byTestId(el, 'vote-results-comment-meta')).toBeTruthy();
    });
  });

  describe('voter view of a named vote (#4330)', () => {
    it('renders text only with the voter-view notice instead of the pseudo-anonymous one', async () => {
      fixture.componentRef.setInput('anonymous', true);
      fixture.componentRef.setInput('anonymousReason', 'voter_view');
      const el = await render([result('p1', [{ comment_text: 'Synthetic p1 comment 01' }])]);

      const notice = byTestId(el, 'vote-results-comments-anonymous-notice')?.textContent?.trim();
      expect(notice).toBe(VOTE_COMMENT_ANONYMOUS_NOTICES.voter_view);
      expect(notice).not.toContain('Pseudo-anonymous vote.');
      expect(el.textContent).toContain('Synthetic p1 comment 01');
      expect(byTestId(el, 'vote-results-comment-meta')).toBeNull();
    });
  });

  describe('ballot links (#3914)', () => {
    it('renders no links by default', async () => {
      const el = await render([result('p1', responses('p1', 2))]);

      expect(byTestId(el, 'vote-results-comment-view-ballot-p1-response-1')).toBeNull();
    });

    it("links each response and emits the response's vote id", async () => {
      fixture.componentRef.setInput('showBallotLinks', true);
      const el = await render([result('p1', responses('p1', 2))]);
      const emitted: string[] = [];
      fixture.componentInstance.viewBallot.subscribe((voteId) => emitted.push(voteId));

      const link = byTestId(el, 'vote-results-comment-view-ballot-p1-response-2')!.querySelector('button')!;
      expect(link.getAttribute('aria-label')).toBe('View ballot of Synthetic Voter 2');
      link.click();
      expect(emitted).toEqual(['p1-response-2']);
    });
  });
});
