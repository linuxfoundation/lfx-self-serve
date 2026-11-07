// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { FaqGroupView } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';
import { MktgFamilyPrintFaqPageComponent } from './mktg-family-print-faq-page.component';

const groups: FaqGroupView[] = [
  {
    path: 'faq[0]',
    name: 'About',
    unanswered: 1,
    questions: [
      { path: 'faq[0][1][0]', question: 'What is it?', answer: 'A synthetic project.', source: 'Framework', answered: true },
      { path: 'faq[0][1][1]', question: 'Who runs it?', answer: '', source: '', answered: false },
    ],
  },
  {
    path: 'faq[1]',
    name: 'Joining',
    unanswered: 0,
    questions: [{ path: 'faq[1][1][0]', question: 'How do I join?', answer: 'Sign up.', source: 'Site', answered: true }],
  },
  { path: 'faq[2]', name: 'Empty', unanswered: 0, questions: [] },
];

describe('MktgFamilyPrintFaqPageComponent', () => {
  it('prints the page’s groups as a grid of question, answer and source chip, counting the whole FAQ on the first page', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintFaqPageComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('pageGroups', [0, 1]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="family-print-faq-intro"]')?.textContent).toBe(
      '3 questions in 2 groups, each answered from the framework or a source it names.'
    );
    expect(root.querySelectorAll('[data-testid="family-print-faq-group"]')).toHaveLength(2);
    const entries = Array.from(root.querySelectorAll('[data-testid="family-print-faq-entry"]'));
    expect(entries).toHaveLength(3);
    expect(entries[0].querySelector('.fpq-entry__answer')?.textContent).toBe('A synthetic project.');
    expect(entries[0].querySelector('.fp-chip')?.textContent).toBe('Framework');
    // An unanswered question prints its question only.
    expect(entries[1].querySelector('.fpq-entry__answer')).toBeNull();
    expect(entries[1].querySelector('.fp-chip')).toBeNull();
  });

  it('names its groups on a later page and ignores an index the FAQ has not got', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintFaqPageComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('pageGroups', [1, 7]);
    fixture.componentRef.setInput('index', 1);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="family-print-faq-intro"]')?.textContent).toBe('Joining.');
    expect(root.querySelectorAll('[data-testid="family-print-faq-group"]')).toHaveLength(1);
  });
});
