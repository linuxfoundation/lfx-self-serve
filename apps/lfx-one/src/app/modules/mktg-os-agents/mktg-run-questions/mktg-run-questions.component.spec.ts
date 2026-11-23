// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FOUNDATION_MESSAGE_ANSWER_MAX_CHARS } from '@lfx-one/shared/constants';
import { describe, expect, it, vi } from 'vitest';
import { MktgRunQuestionsComponent } from './mktg-run-questions.component';

async function render(allowNoneFor: readonly string[] = [], allowNonAnswers = false, inputs: Record<string, unknown> = {}) {
  await TestBed.configureTestingModule({ imports: [MktgRunQuestionsComponent], providers: [provideNoopAnimations()] }).compileComponents();
  const fixture = TestBed.createComponent(MktgRunQuestionsComponent);
  fixture.componentRef.setInput(
    'questions',
    ['avoid', 'other'].map((key) => ({ key, label: key, question: 'Any restrictions?', why: '', suggestedAnswer: 'None', basis: [] }))
  );
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  fixture.componentRef.setInput('allowNoneFor', allowNoneFor);
  fixture.componentRef.setInput('allowNonAnswers', allowNonAnswers);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  await fixture.whenStable();
  fixture.detectChanges();
  const emitted = vi.fn();
  fixture.componentInstance.answered.subscribe(emitted);
  return { fixture, component: fixture.componentInstance, emitted };
}

describe('MktgRunQuestionsComponent answer validation', () => {
  it('accepts None only for the exempt question and rechecks every answer before submission', async () => {
    const { fixture, component, emitted } = await render(['avoid']);
    component['onNext']();
    fixture.detectChanges();
    expect(component['index']()).toBe(1);
    component['onNext']();
    expect(emitted).not.toHaveBeenCalled();
    component['answersForm'].controls['other'].setValue('Use synthetic project facts.');
    fixture.detectChanges();
    component['onNext']();
    expect(emitted).toHaveBeenCalledExactlyOnceWith([
      { key: 'avoid', text: 'None', origin: 'accepted' },
      { key: 'other', text: 'Use synthetic project facts.', origin: 'edited' },
    ]);
  });

  it('keeps question two when send updates previous answers and clears the draft', async () => {
    const { fixture, component } = await render(['avoid']);
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

  it('marks the draft dirty only once an answer differs, trimmed, from what the box opened with', async () => {
    const { fixture, component } = await render(['avoid']);
    const drafts = vi.fn();
    component.draftChanged.subscribe(drafts);
    component['answersForm'].controls['other'].setValue(' None ');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(drafts).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: false }));
    component['answersForm'].controls['other'].setValue('Use synthetic project facts.');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(drafts).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0, dirty: true }));
    // A new block, opened with an earlier try's answers, starts clean again.
    fixture.componentRef.setInput('previousAnswers', { avoid: 'Kept', other: 'Kept too' });
    fixture.componentRef.setInput(
      'questions',
      ['avoid', 'other'].map((key) => ({ key, label: key, question: 'Anything new?', why: '', suggestedAnswer: 'None', basis: [] }))
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(drafts).toHaveBeenLastCalledWith(expect.objectContaining({ answers: { avoid: 'Kept', other: 'Kept too' }, dirty: false }));
  });

  it('locks a kept draft: every box disabled with its text, no Send, no draft emitted, the questions still browsable', async () => {
    // A kept block is a fresh instance opened with the typed draft and locked, as both hosts render it.
    const { fixture, component } = await render(['avoid'], false, {
      initialDraft: { index: 1, answers: { avoid: 'None', other: 'Use synthetic project facts.' }, dirty: true },
      locked: true,
    });
    const drafts = vi.fn();
    component.draftChanged.subscribe(drafts);
    await fixture.whenStable();
    expect(component['answersForm'].disabled).toBe(true);
    expect(component['answersForm'].getRawValue()).toEqual({ avoid: 'None', other: 'Use synthetic project facts.' });
    expect(fixture.nativeElement.querySelector('textarea[data-test="mktg-run-questions-answer-other"]')?.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-send"]')).toBeNull();
    component['onBack']();
    fixture.detectChanges();
    expect(component['index']()).toBe(0);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-next"]')).not.toBeNull();
    component['onNext']();
    fixture.detectChanges();
    expect(component['index']()).toBe(1);
    component['onNext']();
    await fixture.whenStable();
    expect(drafts).not.toHaveBeenCalled();
    expect(component['answersForm'].getRawValue()).toEqual({ avoid: 'None', other: 'Use synthetic project facts.' });
  });

  it('retains the explicit AEO/GEO compatibility opt-in without changing the default', async () => {
    const { fixture, component, emitted } = await render([], true);
    component['onNext']();
    fixture.detectChanges();
    component['onNext']();
    expect(emitted).toHaveBeenCalledOnce();
  });

  it('still rejects None by default for other agents', async () => {
    const { component, emitted } = await render();
    component['onNext']();
    expect(component['index']()).toBe(0);
    expect(component['showError']()).toBe(true);
    expect(emitted).not.toHaveBeenCalled();
  });

  it.each(['   ', 'skip', 'TBD', 'n/a', '-', '?', 'x'.repeat(FOUNDATION_MESSAGE_ANSWER_MAX_CHARS + 1)])(
    'rejects empty or oversized opt-in answers',
    async (answer) => {
      const { fixture, component, emitted } = await render(['avoid']);
      component['answersForm'].controls['avoid'].setValue(answer);
      fixture.detectChanges();
      component['onNext']();
      expect(component['index']()).toBe(0);
      expect(component['showError']()).toBe(true);
      expect(emitted).not.toHaveBeenCalled();
    }
  );
});
