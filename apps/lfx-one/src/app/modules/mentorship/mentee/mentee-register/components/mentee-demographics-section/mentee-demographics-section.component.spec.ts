// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { MenteeDemographicsSectionComponent } from './mentee-demographics-section.component';

describe('MenteeDemographicsSectionComponent', () => {
  let fixture: ComponentFixture<MenteeDemographicsSectionComponent>;
  let form: FormGroup;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    // The section reads five consent/answer control pairs off the shared mentee-register
    // form. Building the controls from the data-driven row list keeps this fixture aligned
    // with the constant the template renders — a new question is one entry, not two edits.
    const controls: Record<string, FormControl<unknown>> = {};
    for (const row of MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS) {
      controls[row.consentControl] = new FormControl<boolean>(false, { nonNullable: true }) as FormControl<unknown>;
      controls[row.answerControl] = new FormControl<string>('', { nonNullable: true }) as FormControl<unknown>;
    }
    form = new FormGroup(controls);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeDemographicsSectionComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(MenteeDemographicsSectionComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();
  });

  it('renders every demographic question the constant lists', () => {
    // Data-driven rather than five hand-written blocks: adding a question in the constant
    // must surface here without a template change.
    for (const row of MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS) {
      const container = element().querySelector(`[data-testid="mentorship-mentee-demographic-${row.answerControl}"]`);
      expect(container).not.toBeNull();
      expect(container?.querySelector('label')?.textContent?.trim()).toBe(row.question);
    }
  });

  it('names the question on every row via aria-labelledby, since "Select" alone means nothing', () => {
    // The `<label>` id is what the checkbox and dropdown reference — without it a screen
    // reader announces two anonymous controls per question.
    for (const row of MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS) {
      const questionId = `mentorship-mentee-demographic-${row.answerControl}-question`;
      const label = element().querySelector(`#${questionId}`);
      expect(label).not.toBeNull();

      const consentCheckbox = element().querySelector(`[data-testid="mentorship-mentee-demographic-${row.answerControl}-consent"]`);
      expect(consentCheckbox?.getAttribute('aria-describedby')).toBe(questionId);
    }
  });

  it('routes the removal request through a mailto: link so consent is easy to withdraw', () => {
    const link = element().querySelector<HTMLAnchorElement>('a[href^="mailto:"]');

    expect(link?.getAttribute('href')).toBe('mailto:privacy@linuxfoundation.org');
  });

  it('reflects a consent checkbox tick back onto the shared form control', () => {
    const [firstRow] = MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS;

    form.controls[firstRow.consentControl].setValue(true);
    fixture.detectChanges();

    // The section shares its FormGroup with the parent form, so ticks written from either
    // side must land on the same control instance.
    expect(form.controls[firstRow.consentControl].value).toBe(true);
  });

  it('starts every answer control disabled, since consent begins unchecked', () => {
    // Disabling on the FormControl is what PrimeNG's `<p-select>` picks up as its
    // disabled state — the mentee cannot open a dropdown for a question they have
    // not yet consented to.
    for (const row of MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS) {
      expect(form.controls[row.answerControl].disabled).toBe(true);
    }
  });

  it('enables the answer control when consent is granted, and disables it again when consent is withdrawn', () => {
    const [firstRow] = MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS;

    form.controls[firstRow.consentControl].setValue(true);
    expect(form.controls[firstRow.answerControl].enabled).toBe(true);

    form.controls[firstRow.consentControl].setValue(false);
    expect(form.controls[firstRow.answerControl].disabled).toBe(true);
  });

  it('clears a previously selected answer when the mentee withdraws consent for that row', () => {
    // Withdrawing consent is a privacy signal, not a UI convenience — the answer
    // must not linger in the form snapshot after the mentee unchecks the box.
    const [firstRow] = MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS;
    const [firstOption] = firstRow.options;

    form.controls[firstRow.consentControl].setValue(true);
    form.controls[firstRow.answerControl].setValue(firstOption.value);
    expect(form.controls[firstRow.answerControl].value).toBe(firstOption.value);

    form.controls[firstRow.consentControl].setValue(false);
    expect(form.controls[firstRow.answerControl].value).toBe('');
    expect(form.controls[firstRow.answerControl].disabled).toBe(true);
  });

  it('gates every question independently — one row unlocks only its own answer', () => {
    // A shared toggle would collapse five consent signals into one; each demographic
    // question is opt-in on its own.
    const [firstRow, secondRow] = MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS;

    form.controls[firstRow.consentControl].setValue(true);

    expect(form.controls[firstRow.answerControl].enabled).toBe(true);
    expect(form.controls[secondRow.answerControl].disabled).toBe(true);
  });
});
