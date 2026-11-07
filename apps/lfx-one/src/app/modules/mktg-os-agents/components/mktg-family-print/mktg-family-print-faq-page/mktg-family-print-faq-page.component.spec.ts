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

describe('MktgFamilyPrintFaqPageComponent', () => {
  it('prints the plan’s two columns of question, answer and source chip under their group headings, counting the whole FAQ on the first page', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintFaqPageComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('columns', [
      [{ group: 0, question: 0, heading: true }],
      [
        { group: 1, question: 0, heading: true },
        // An unanswered question or one the FAQ has not got is not an entry, whatever the plan says.
        { group: 3, question: 0, heading: true },
        { group: 7, question: 0, heading: true },
      ],
    ]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    // The count is of what prints: answered questions, in groups left with one.
    expect(root.querySelector('[data-testid="family-print-faq-intro"]')?.textContent).toBe(
      '2 questions in 2 groups, each answered from the framework or a source it names.'
    );
    const columns = Array.from(root.querySelectorAll('.fpq-column'));
    expect(columns).toHaveLength(2);
    expect(columns.map((column) => column.querySelectorAll('[data-testid="family-print-faq-entry"]').length)).toEqual([1, 1]);
    expect(Array.from(root.querySelectorAll('[data-testid="family-print-faq-group"]')).map((heading) => heading.textContent)).toEqual(['About', 'Joining']);
    const entries = Array.from(root.querySelectorAll('[data-testid="family-print-faq-entry"]'));
    expect(entries.map((entry) => entry.querySelector('.fpq-entry__question')?.textContent)).toEqual(['What is it?', 'How do I join?']);
    expect(entries[0].querySelector('.fpq-entry__answer')?.textContent).toBe('A synthetic project.');
    expect(entries[0].querySelector('.pp-chip')?.textContent).toBe('Framework');
    // The run's `Notes` source is the project's notes to a reader of the book.
    expect(entries[1].querySelector('.pp-chip')?.textContent).toBe('Project notes');
    expect(root.textContent).not.toContain('Who runs it?');
    expect(root.textContent).not.toContain('Open');
  });

  it('repeats a heading only where the plan opens the group, and names its groups on a later page', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintFaqPageComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('columns', [[{ group: 0, question: 0, heading: false }], [{ group: 1, question: 0, heading: true }]]);
    fixture.componentRef.setInput('index', 1);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="family-print-faq-intro"]')?.textContent).toBe('About · Joining.');
    expect(Array.from(root.querySelectorAll('[data-testid="family-print-faq-group"]')).map((heading) => heading.textContent)).toEqual(['Joining']);
  });
});
