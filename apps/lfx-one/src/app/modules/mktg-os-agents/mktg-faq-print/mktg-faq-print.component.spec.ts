// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_FAQ_PRINT_UNANSWERED, MKTG_PRINT_APPENDIX_LAYOUT } from '@lfx-one/shared/constants';
import { FaqGroupView, FaqPrintView } from '@lfx-one/shared/interfaces';
import { buildFaqPrintView, faqAssetOfRevision, mktgPagePt, mktgPrintBrand, mktgFaqPageCount } from '@lfx-one/shared/utils';
import envelope from '@lfx-one/shared/utils/__fixtures__/faq-envelope.json';
import {
  FAQ_INJECTED_ANSWER,
  FAQ_LIST_ITEMS,
  FAQ_LIST_LEAD_IN,
  FAQ_PLAIN_ANSWER,
  FAQ_PRICE_ANSWER,
  faqAnswersContent,
} from '@shared/testing/mktg-faq-answers-test-data';
import { expect, it } from 'vitest';
import { MktgFaqPrintComponent } from './mktg-faq-print.component';

async function mount(view: FaqPrintView, firstPage = 1) {
  const fixture = TestBed.createComponent(MktgFaqPrintComponent);
  fixture.componentRef.setInput('view', view);
  fixture.componentRef.setInput('number', '04');
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  fixture.componentRef.setInput('familyName', 'Positioning & brand');
  fixture.componentRef.setInput('firstPage', firstPage);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

function fixtureView(content: object = envelope.content): FaqPrintView {
  const asset = faqAssetOfRevision(JSON.stringify(content), envelope);
  if (!asset) throw new Error('Invalid synthetic FAQ');
  return buildFaqPrintView(asset, mktgPrintBrand(null));
}

it('prints the pairs as a two-column grid on one landscape page, question over answer, the unanswered one labelled, sources where present', async () => {
  const view = fixtureView();
  const root = await mount(view, 17);
  const brand = view.brand;
  const pages = root.querySelectorAll('[data-testid="mktg-faq-print-page"]');
  expect(pages).toHaveLength(mktgFaqPageCount(view.groups));
  expect(pages).toHaveLength(1);
  expect(pages[0].querySelector('[data-testid="mktg-print-page"]')?.getAttribute('data-layout')).toBe('content');
  expect(Array.from(pages[0].querySelectorAll('[data-testid="mktg-print-page-head"]'), (el) => el.textContent?.trim())).toEqual([
    '04 Questions and answers',
    'Synthetic project Positioning & brand',
  ]);
  expect(pages[0].querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('Questions and answers');
  expect(Array.from(pages[0].querySelectorAll('[data-testid="mktg-print-page-footer"]'), (el) => el.textContent?.trim())).toEqual([
    'Synthetic project · a Linux Foundation project',
    '17',
  ]);
  expect(pages[0].querySelector('[data-testid="mktg-print-page-logo"] img')?.getAttribute('src')).toBe(brand.logoOnLight?.src);
  const grid = pages[0].querySelector<HTMLElement>('[data-testid="mktg-faq-print-grid"]');
  expect(grid?.style.gridTemplateRows.split(' minmax(')).toHaveLength(2);
  expect(grid?.style.getPropertyValue('--mfq-ink')).toBe(brand.dark);
  // The pairs flow row by row in group order, with no group heading of their own on the grid.
  const pairs = pages[0].querySelectorAll('[data-testid="mktg-faq-print-pair"]');
  expect(pairs).toHaveLength(4);
  expect(Array.from(pairs, (pair) => pair.querySelector('h3')?.textContent)).toEqual(
    view.groups.flatMap((group) => group.questions.map((row) => row.question))
  );
  expect(root.querySelector('[data-testid="mktg-faq-print-group"]')).toBeNull();
  expect(pairs[0].querySelector<HTMLElement>('h3')?.style.fontSize).toBe(mktgPagePt(MKTG_PRINT_APPENDIX_LAYOUT.faqQuestionSize));
  expect(pairs[0].querySelector<HTMLElement>('[data-testid="mktg-faq-print-answer"]')?.style.fontSize).toBe(
    mktgPagePt(MKTG_PRINT_APPENDIX_LAYOUT.faqAnswerSize)
  );
  expect(pairs[0].querySelector('[data-testid="mktg-faq-print-answer"] p')?.textContent).toBe('Example Search is an open source search and analytics suite.');
  expect(pairs[0].querySelector('[data-testid="mktg-faq-print-source"]')?.textContent).toBe('Source · Website');
  // The unanswered label is a plain paragraph, never Markdown, and carries no source line.
  expect(pairs[2].querySelector('h3')?.textContent).toBe('How much does membership cost?');
  expect(pairs[2].querySelector('[data-testid="mktg-faq-print-answer"]')).toBeNull();
  expect(pairs[2].querySelector('p.mfq-unanswered')?.textContent).toBe(MKTG_FAQ_PRINT_UNANSWERED);
  expect(pairs[2].querySelector('[data-testid="mktg-faq-print-source"]')).toBeNull();
});

it('prints a plain answer as one paragraph, a lead-in with its items as a real list, separators verbatim and no injected HTML', async () => {
  const root = await mount(fixtureView(faqAnswersContent()));
  const pairs = root.querySelectorAll('[data-testid="mktg-faq-print-pair"]');
  expect(pairs).toHaveLength(4);
  const answerOf = (q: number): HTMLElement => {
    const answer = pairs[q].querySelector<HTMLElement>('[data-testid="mktg-faq-print-answer"]');
    if (!answer) throw new Error(`No answer printed for question ${q}`);
    return answer;
  };
  const texts = (scope: HTMLElement, selector: string): (string | null)[] => Array.from(scope.querySelectorAll(selector), (node) => node.textContent);
  // (a) a plain answer: one paragraph, the exact text, no list.
  expect(texts(answerOf(0), 'p')).toEqual([FAQ_PLAIN_ANSWER]);
  expect(answerOf(0).querySelector('ul')).toBeNull();
  // (b) the lead-in paragraph, then a list of the five items in order: bullets are the list's markers, never a "- " string.
  const lead = answerOf(1).querySelector('p');
  expect(lead?.textContent).toBe(FAQ_LIST_LEAD_IN);
  expect(lead?.nextElementSibling?.tagName).toBe('UL');
  expect(texts(answerOf(1), 'ul > li')).toEqual([...FAQ_LIST_ITEMS]);
  expect(answerOf(1).textContent).not.toContain('- ');
  expect(pairs[1].querySelector('h3')?.textContent).toBe('Which agents does the family hold?');
  expect(pairs[1].querySelector('[data-testid="mktg-faq-print-source"]')?.textContent).toBe('Source · Docs');
  // (c) thousands separators verbatim.
  expect(texts(answerOf(2), 'p')).toEqual([FAQ_PRICE_ANSWER]);
  expect(FAQ_PRICE_ANSWER).toContain('$5,000 to $75,000');
  // (d) no image, script, handler or javascript: link survives.
  expect(FAQ_INJECTED_ANSWER).toContain('onerror');
  expect(answerOf(3).querySelector('img, script, [onerror], a')).toBeNull();
  expect(answerOf(3).innerHTML).not.toContain('javascript:');
});

it("continues a long set on numbered pages at the pagination's scale, and prints a title band with no questions", async () => {
  const view = fixtureView();
  const questions = Array.from({ length: 40 }, (_, q) => ({
    path: `faq[0][1][${q}]`,
    question: `Question number ${q + 1} of the synthetic set?`,
    answer: Array.from({ length: 30 }, () => 'Answer').join(' ') + '.',
    source: 'Docs',
    answered: true,
  }));
  const groups: FaqGroupView[] = [{ name: 'Many', path: 'faq[0]', questions, unanswered: 0 }];
  const root = await mount({ ...view, groups }, 5);
  const pages = Array.from(root.querySelectorAll('[data-testid="mktg-faq-print-page"]'));
  expect(pages).toHaveLength(mktgFaqPageCount(groups));
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.map((page) => page.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim())).toEqual(
    pages.map((_, i) => (i === 0 ? 'Questions and answers' : `Questions and answers (${i + 1})`))
  );
  expect(pages.map((page) => page.querySelectorAll('[data-testid="mktg-print-page-footer"]')[1]?.textContent?.trim())).toEqual(
    pages.map((_, i) => String(5 + i).padStart(2, '0'))
  );
  expect(pages.flatMap((page) => Array.from(page.querySelectorAll('[data-testid="mktg-faq-print-pair"] h3'), (q) => q.textContent))).toEqual(
    questions.map((row) => row.question)
  );
  for (const empty of [[], [{ name: 'Empty group', path: 'empty', questions: [], unanswered: 0 }]]) {
    const emptyRoot = await mount({ ...view, groups: empty });
    expect(emptyRoot.querySelectorAll('[data-testid="mktg-faq-print-page"]')).toHaveLength(1);
    expect(emptyRoot.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('Questions and answers');
    expect(emptyRoot.querySelectorAll('[data-testid="mktg-faq-print-pair"]')).toHaveLength(0);
  }
});
