// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FOUNDATION_MESSAGE_ANSWER_MAX_CHARS } from '@lfx-one/shared/constants';
import { describe, expect, it, vi } from 'vitest';
import { MktgRunQuestionsComponent } from './mktg-run-questions.component';

async function render(allowNonAnswers?: boolean) {
  await TestBed.configureTestingModule({ imports: [MktgRunQuestionsComponent], providers: [provideNoopAnimations()] }).compileComponents();
  const fixture = TestBed.createComponent(MktgRunQuestionsComponent);
  fixture.componentRef.setInput(
    'questions',
    ['avoid', 'other'].map((key) => ({ key, label: key, question: 'Any restrictions?', why: '', suggestedAnswer: 'None', basis: [] }))
  );
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  if (allowNonAnswers !== undefined) fixture.componentRef.setInput('allowNonAnswers', allowNonAnswers);
  await fixture.whenStable();
  fixture.detectChanges();
  const emitted = vi.fn();
  fixture.componentInstance.answered.subscribe(emitted);
  return { fixture, component: fixture.componentInstance, emitted };
}

describe('MktgRunQuestionsComponent answer validation', () => {
  it('accepts None for LinkedIn through Continue and final submission when opted in', async () => {
    const { fixture, component, emitted } = await render(true);
    component['onNext']();
    fixture.detectChanges();
    expect(component['index']()).toBe(1);
    component['onNext']();
    expect(emitted).toHaveBeenCalledExactlyOnceWith([
      { key: 'avoid', text: 'None', origin: 'accepted' },
      { key: 'other', text: 'None', origin: 'accepted' },
    ]);
  });

  it('keeps question two when send updates previous answers and clears the draft', async () => {
    const { fixture, component } = await render(true);
    component['onNext']();
    fixture.detectChanges();
    expect(component['index']()).toBe(1);
    fixture.componentRef.setInput('previousAnswers', { avoid: 'None', other: 'None' });
    fixture.componentRef.setInput('initialDraft', { index: 0, answers: { avoid: 'None', other: 'None' } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component['index']()).toBe(1);
    fixture.componentRef.setInput('initialDraft', null);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component['index']()).toBe(1);
  });

  it('still rejects None by default for other agents', async () => {
    const { component, emitted } = await render();
    component['onNext']();
    expect(component['index']()).toBe(0);
    expect(component['showError']()).toBe(true);
    expect(emitted).not.toHaveBeenCalled();
  });

  it.each(['   ', 'x'.repeat(FOUNDATION_MESSAGE_ANSWER_MAX_CHARS + 1)])('rejects empty or oversized opt-in answers', async (answer) => {
    const { fixture, component, emitted } = await render(true);
    component['answersForm'].controls['avoid'].setValue(answer);
    fixture.detectChanges();
    component['onNext']();
    expect(component['index']()).toBe(0);
    expect(component['showError']()).toBe(true);
    expect(emitted).not.toHaveBeenCalled();
  });
});
