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
  {
    path: 'faq[3]',
    name: 'Open',
    unanswered: 1,
    questions: [{ path: 'faq[3][1][0]', question: 'When is the next release?', answer: '', source: '', answered: false }],
  },
];

describe('MktgFamilyPrintFaqPageComponent', () => {
  it('prints the page’s answered questions as a grid of question, answer and source chip, counting the whole FAQ on the first page', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintFaqPageComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('pageGroups', [0, 1, 3]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    // Unanswered questions do not print, nor a group left with none, and the count is of what prints.
    expect(root.querySelector('[data-testid="family-print-faq-intro"]')?.textContent).toBe(
      '2 questions in 2 groups, each answered from the framework or a source it names.'
    );
    expect(root.querySelectorAll('[data-testid="family-print-faq-group"]')).toHaveLength(2);
    const entries = Array.from(root.querySelectorAll('[data-testid="family-print-faq-entry"]'));
    expect(entries.map((entry) => entry.querySelector('.fpq-entry__question')?.textContent)).toEqual(['What is it?', 'How do I join?']);
    expect(entries[0].querySelector('.fpq-entry__answer')?.textContent).toBe('A synthetic project.');
    expect(entries[0].querySelector('.pp-chip')?.textContent).toBe('Framework');
    expect(root.textContent).not.toContain('Who runs it?');
    expect(root.textContent).not.toContain('Open');
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
