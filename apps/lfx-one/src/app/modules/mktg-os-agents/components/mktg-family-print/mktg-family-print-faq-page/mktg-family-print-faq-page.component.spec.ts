// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_FAMILY_PRINT_LABELS, MKTG_FAMILY_PRINT_SEP } from '@lfx-one/shared/constants';
import { FaqGroupView } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintFaqGroups } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import {
  FAQ_ANSWER_QUESTIONS,
  FAQ_LIST_ITEMS,
  FAQ_LIST_LEAD_IN,
  FAQ_PLAIN_ANSWER,
  FAQ_PRICE_ANSWER,
} from '../../../../../shared/testing/mktg-faq-answers-test-data';
import { MktgFamilyPrintFaqPageComponent } from './mktg-family-print-faq-page.component';

/** The stored FAQ: an unanswered question BEFORE the answered ones in About, so the stored index and the printed index differ. */
const stored: FaqGroupView[] = [
  {
    path: 'faq[0]',
    name: 'About',
    unanswered: 1,
    questions: [
      { path: 'faq[0][1][0]', question: 'Who runs it?', answer: '', source: '', answered: false },
      { path: 'faq[0][1][1]', question: 'What is it?', answer: 'A synthetic project.', source: 'Framework', answered: true },
      { path: 'faq[0][1][2]', question: 'Where is the code?', answer: 'On GitHub.', source: 'Framework', answered: true },
    ],
  },
  {
    path: 'faq[1]',
    name: 'Joining',
    unanswered: 0,
    questions: [{ path: 'faq[1][1][0]', question: 'How do I join?', answer: 'Sign up.', source: 'Notes', answered: true }],
  },
  { path: 'faq[2]', name: 'Empty', unanswered: 0, questions: [] },
  {
    path: 'faq[3]',
    name: 'Open',
    unanswered: 1,
    questions: [{ path: 'faq[3][1][0]', question: 'When is the next release?', answer: '', source: '', answered: false }],
  },
];
/** What the page takes: the answered questions in the plan's own index space (the same reader the plan paginates). */
const groups = mktgFamilyPrintFaqGroups(stored);

describe('MktgFamilyPrintFaqPageComponent', () => {
  it('prints the plan’s two columns of question, answer and source chip under their group headings, counting the whole FAQ on the first page', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintFaqPageComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('columns', [
      [{ group: 0, question: 0, heading: true }],
      [
        { group: 1, question: 0, heading: true },
        // A group left with no answered question, or one the FAQ has not got, is not an entry, whatever the plan says.
        { group: 3, question: 0, heading: true },
        { group: 7, question: 0, heading: true },
      ],
    ]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    // A block host (MKTG_PORTRAIT_BLOCK_HOST): Chrome 156 breaks a sheet at the anonymous-block boundary an inline host puts around a frame.
    expect(getComputedStyle(root).display).toBe('block');
    // The count is of what prints: answered questions, in groups left with one.
    expect(root.querySelector('[data-testid="family-print-faq-intro"]')?.textContent).toBe(
      '3 questions in 2 groups, each answered from the framework or a source it names.'
    );
    const columns = Array.from(root.querySelectorAll('.fpq-column'));
    expect(columns).toHaveLength(2);
    expect(columns.map((column) => column.querySelectorAll('[data-testid="family-print-faq-entry"]').length)).toEqual([1, 1]);
    expect(
      Array.from(root.querySelectorAll('[data-testid="family-print-faq-group"]')).map((heading) => heading.textContent?.replace(/\s+/g, ' ').trim())
    ).toEqual(['About', 'Joining']);
    const entries = Array.from(root.querySelectorAll('[data-testid="family-print-faq-entry"]'));
    expect(entries.map((entry) => entry.querySelector('.fpq-entry__question')?.textContent)).toEqual(['What is it?', 'How do I join?']);
    // The answer is the restricted renderer's one paragraph (marked ends it with a newline).
    expect(entries[0].querySelector('lfx-markdown-renderer.fpq-entry__answer p')?.textContent).toBe('A synthetic project.');
    expect(entries[0].querySelector('.pp-chip')?.textContent).toBe('Framework');
    // The run's `Notes` is an internal source label: no chip, and no label in its place.
    expect(entries[1].querySelector('.pp-chip')).toBeNull();
    expect(entries[1].querySelector('.fpq-entry__source')).toBeNull();
    expect(root.textContent).not.toMatch(/notes/i);
    expect(root.textContent).not.toContain('Who runs it?');
    expect(root.textContent).not.toContain('Open');
  });

  it('prints the plan’s questions by the plan’s own index when an unanswered question precedes them and the group breaks across the columns', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintFaqPageComponent);
    fixture.componentRef.setInput('groups', groups);
    // About's two answered questions split across the column break: index 0 and 1 of the answered list, not of the stored one.
    fixture.componentRef.setInput('columns', [[{ group: 0, question: 0, heading: true }], [{ group: 0, question: 1, heading: true }]]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const columns = Array.from(root.querySelectorAll('[data-testid="family-print-faq-column"]'));
    expect(columns.map((column) => Array.from(column.querySelectorAll('.fpq-entry__question')).map((question) => question.textContent))).toEqual([
      ['What is it?'],
      ['Where is the code?'],
    ]);
    // The second heading repeats a group begun in the first column: it carries the continued mark, the first does not.
    expect(
      Array.from(root.querySelectorAll('[data-testid="family-print-faq-group"]')).map((heading) => heading.textContent?.replace(/\s+/g, ' ').trim())
    ).toEqual(['About', `About ${MKTG_FAMILY_PRINT_LABELS.faqContinued}`]);
    expect(root.querySelectorAll('[data-testid="family-print-faq-continued"]')).toHaveLength(1);
    expect(root.textContent).not.toContain('Who runs it?');
  });

  it('prints an answer through the restricted Markdown renderer: a plain answer one paragraph, a lead-in and its items a paragraph and a list, markup never an element', async () => {
    const answers = mktgFamilyPrintFaqGroups([
      {
        path: 'faq[0]',
        name: 'About Synthetic Toolkit',
        unanswered: 0,
        questions: FAQ_ANSWER_QUESTIONS.map(([question, answer, source], index) => ({ path: `faq[0][1][${index}]`, question, answer, source, answered: true })),
      },
    ]);
    const fixture = TestBed.createComponent(MktgFamilyPrintFaqPageComponent);
    fixture.componentRef.setInput('groups', answers);
    fixture.componentRef.setInput('columns', [
      [
        { group: 0, question: 0, heading: true },
        { group: 0, question: 1, heading: false },
      ],
      [
        { group: 0, question: 2, heading: true },
        { group: 0, question: 3, heading: false },
      ],
    ]);
    await fixture.whenStable();
    const printed = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="family-print-faq-answer"]'));
    expect(printed.map((answer) => answer.tagName.toLowerCase())).toEqual(Array(4).fill('lfx-markdown-renderer'));
    const texts = (answer: Element, selector: string): (string | undefined)[] =>
      Array.from(answer.querySelectorAll(selector)).map((element) => element.textContent?.trim());
    // (a) and (c): one paragraph, the exact text, the thousands separators verbatim; no list.
    expect(texts(printed[0], 'p')).toEqual([FAQ_PLAIN_ANSWER]);
    expect(texts(printed[2], 'p')).toEqual([FAQ_PRICE_ANSWER]);
    expect(printed[0].querySelector('ul')).toBeNull();
    // (b): the lead-in paragraph, then one `li` per "- " line, in order, with no "- " left in the text.
    expect(texts(printed[1], 'p')).toEqual([FAQ_LIST_LEAD_IN]);
    expect(printed[1].querySelectorAll('p + ul')).toHaveLength(1);
    expect(texts(printed[1], 'ul > li')).toEqual([...FAQ_LIST_ITEMS]);
    // (d): the raw HTML, the script and the javascript: link are not elements; the sentence around them still prints.
    expect(printed[3].querySelectorAll('img, script, [onerror], a')).toHaveLength(0);
    expect(texts(printed[3], 'p')).toHaveLength(1);
    expect(printed[3].textContent).toContain('the docs');
    expect(printed[3].textContent).toContain('for details.');
  });

  it('repeats a heading only where the plan opens the group, and names its groups on a later page', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintFaqPageComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('columns', [[{ group: 0, question: 0, heading: false }], [{ group: 1, question: 0, heading: true }]]);
    fixture.componentRef.setInput('index', 1);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="family-print-faq-intro"]')?.textContent).toBe(`About${MKTG_FAMILY_PRINT_SEP}Joining.`);
    expect(
      Array.from(root.querySelectorAll('[data-testid="family-print-faq-group"]')).map((heading) => heading.textContent?.replace(/\s+/g, ' ').trim())
    ).toEqual(['Joining']);
    expect(root.querySelectorAll('[data-testid="family-print-faq-continued"]')).toHaveLength(0);
  });
});
