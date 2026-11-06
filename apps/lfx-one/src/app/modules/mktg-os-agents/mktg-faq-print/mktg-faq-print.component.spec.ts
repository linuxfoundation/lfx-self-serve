// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_FAQ_PRINT_UNANSWERED } from '@lfx-one/shared/constants';
import { buildFaqPrintView, faqAssetOfRevision, mktgPrintBrand } from '@lfx-one/shared/utils';
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

it('prints grouped pairs with sources, keeps headings with the first pair and marks unanswered questions without a source', async () => {
  const asset = faqAssetOfRevision(JSON.stringify(envelope.content), envelope);
  if (!asset) throw new Error('Invalid synthetic FAQ');
  const fixture = TestBed.createComponent(MktgFaqPrintComponent);
  const brand = mktgPrintBrand(null);
  fixture.componentRef.setInput('view', buildFaqPrintView(asset, brand));
  fixture.componentRef.setInput('number', '08');
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.querySelector('section')?.classList.contains('break-before-page')).toBe(true);
  const pairs = root.querySelectorAll('article');
  expect(pairs).toHaveLength(4);
  pairs.forEach((pair) => {
    expect(pair.classList.contains('break-inside-avoid')).toBe(true);
    expect(pair.querySelector('h4')?.classList.contains('break-after-avoid')).toBe(true);
  });
  expect(root.querySelector('header h2')?.textContent).toContain('08');
  expect(root.querySelector('header lfx-mktg-print-chapter-header h2')?.className).toBe('lfx-print-chapter-title');
  expect(root.querySelector<HTMLElement>('header lfx-mktg-print-chapter-header')?.style.getPropertyValue('--mfp-chapter-accent')).toBe(brand.accent);
  expect(root.querySelector('header')?.classList.contains('break-after-avoid')).toBe(true);
  const head = root.querySelector('header [data-testid="mktg-print-running-head"]');
  expect(head?.textContent).toContain('Synthetic project FAQ');
  expect(head?.querySelector('img')?.getAttribute('src')).toBe(brand.logoOnLight?.src);
  expect(root.querySelectorAll('h3')).toHaveLength(2);
  expect(pairs[0].querySelector('h3')?.classList.contains('break-after-avoid')).toBe(true);
  expect(pairs[0].textContent).toContain('Source: Website');
  expect(pairs[2].textContent).toContain('How much does membership cost?');
  expect(pairs[2].textContent).toContain(MKTG_FAQ_PRINT_UNANSWERED);
  expect(pairs[2].querySelector('[data-testid="mktg-faq-print-source"]')).toBeNull();
  // The unanswered label is a plain paragraph, never Markdown; the answers go through the restricted renderer.
  expect(pairs[2].querySelector('[data-testid="mktg-faq-print-answer"]')).toBeNull();
  expect(pairs[2].querySelector('p')?.textContent).toBe(MKTG_FAQ_PRINT_UNANSWERED);
  expect(pairs[0].querySelector('[data-testid="mktg-faq-print-answer"] p')?.textContent).toBe('Example Search is an open source search and analytics suite.');
});

it('prints a plain answer as one paragraph, a lead-in with its items as a list, separators verbatim and no injected HTML', async () => {
  const asset = faqAssetOfRevision(JSON.stringify(faqAnswersContent()), envelope);
  if (!asset) throw new Error('Invalid synthetic FAQ answers');
  const fixture = TestBed.createComponent(MktgFaqPrintComponent);
  fixture.componentRef.setInput('view', buildFaqPrintView(asset, mktgPrintBrand(null)));
  fixture.componentRef.setInput('number', '04');
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const pairs = root.querySelectorAll('article');
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
  // (b) the lead-in paragraph, then a list of the five items in order, inside the same break-inside-avoid pair.
  const lead = answerOf(1).querySelector('p');
  expect(lead?.textContent).toBe(FAQ_LIST_LEAD_IN);
  expect(lead?.nextElementSibling?.tagName).toBe('UL');
  expect(texts(answerOf(1), 'ul > li')).toEqual([...FAQ_LIST_ITEMS]);
  expect(pairs[1].classList.contains('break-inside-avoid')).toBe(true);
  expect(pairs[1].querySelector('h4')?.textContent).toBe('Which agents does the family hold?');
  expect(pairs[1].textContent).toContain('Source: Docs');
  // (c) thousands separators verbatim.
  expect(texts(answerOf(2), 'p')).toEqual([FAQ_PRICE_ANSWER]);
  expect(FAQ_PRICE_ANSWER).toContain('$5,000 to $75,000');
  // (d) no image, script, handler or javascript: link survives.
  expect(FAQ_INJECTED_ANSWER).toContain('onerror');
  expect(answerOf(3).querySelector('img, script, [onerror], a')).toBeNull();
  expect(answerOf(3).innerHTML).not.toContain('javascript:');
  expect(root.querySelector('.whitespace-pre-line')).toBeNull();
});

it.each([false, true])('prints the document identity even with an empty first group (empty FAQ: %s)', async (empty) => {
  const asset = faqAssetOfRevision(JSON.stringify(envelope.content), envelope);
  if (!asset) throw new Error('Invalid synthetic FAQ');
  const view = buildFaqPrintView(asset, mktgPrintBrand(null));
  view.groups = empty ? [] : [{ name: 'Empty group', path: 'empty', questions: [], unanswered: 0 }, ...view.groups];
  const fixture = TestBed.createComponent(MktgFaqPrintComponent);
  fixture.componentRef.setInput('view', view);
  fixture.componentRef.setInput('number', '04');
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  // The document is one sheet, whose head repeats the page's top room on every page; one row per pair, so a page
  // breaks only between pairs; the identity leads it in a row that keeps the first pair with it.
  expect(root.querySelector('section')?.firstElementChild?.tagName).toBe('LFX-MKTG-PRINT-SHEET');
  const rows = root.querySelectorAll('[data-testid="mktg-print-sheet-body"] > lfx-mktg-print-sheet-row');
  expect(rows).toHaveLength(empty ? 1 : 5);
  expect(rows[0].classList.contains('break-after-avoid')).toBe(true);
  expect(rows[0].querySelector('[data-testid="mktg-print-sheet-cell"]')?.firstElementChild?.tagName).toBe('HEADER');
  expect(root.querySelectorAll('lfx-mktg-print-sheet-row > * > article')).toHaveLength(empty ? 0 : 4);
  expect(root.querySelector('header')?.textContent).toContain('Synthetic project FAQ');
  expect(root.querySelector('h2')?.textContent).toContain('04');
  expect(root.querySelectorAll('h2')).toHaveLength(1);
  expect(root.querySelectorAll('article')).toHaveLength(empty ? 0 : 4);
});
