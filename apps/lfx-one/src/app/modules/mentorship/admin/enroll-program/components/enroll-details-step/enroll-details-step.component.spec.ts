// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { createEmptyMentorshipEnrollForm, MENTORSHIP_ENROLL_DESCRIPTION_MAX, MENTORSHIP_RICH_TEXT_RAW_MAX } from '@lfx-one/shared/constants';
import { MentorshipService } from '@services/mentorship.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { EnrollDetailsStepComponent } from './enroll-details-step.component';

describe('EnrollDetailsStepComponent — description counter', () => {
  let fixture: ComponentFixture<EnrollDetailsStepComponent>;
  let form: FormGroup;

  const counterText = (): string =>
    ((fixture.nativeElement as HTMLElement).querySelector('[data-testid="mentorship-enroll-description-counter"]')?.textContent ?? '').trim();

  const setDescription = (html: string): void => {
    form.controls['description'].setValue(html);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    // The lfx-* wrappers (Tiptap editor, PrimeNG selects) are not under test here — render them as
    // inert custom elements so only this component's own counter logic runs.
    TestBed.overrideComponent(EnrollDetailsStepComponent, { set: { imports: [ReactiveFormsModule], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });

    await TestBed.configureTestingModule({
      imports: [EnrollDetailsStepComponent],
      providers: [
        {
          provide: MentorshipService,
          useValue: {
            getPrograms: () => of({ data: [] }),
            getLfProjects: () => of({ data: [], total: 0 }),
            getCiiBadge: () => of(null),
            isProgramNameAvailable: () => of({ available: true }),
          },
        },
      ],
    }).compileComponents();

    const defaults = createEmptyMentorshipEnrollForm() as unknown as Record<string, unknown>;
    form = new FormGroup(Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, new FormControl(value)])));

    fixture = TestBed.createComponent(EnrollDetailsStepComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();
  });

  it('shows the plain-text count for rich text at the raw cap', () => {
    const atCap = `<p>${'a'.repeat(MENTORSHIP_RICH_TEXT_RAW_MAX - 7)}</p>`;
    expect(atCap.length).toBe(MENTORSHIP_RICH_TEXT_RAW_MAX);

    setDescription(atCap);

    expect(counterText()).toBe(`${MENTORSHIP_RICH_TEXT_RAW_MAX - 7} / ${MENTORSHIP_ENROLL_DESCRIPTION_MAX}`);
  });

  it('shows "Over limit" instead of a raw HTML length once the raw cap is exceeded', () => {
    setDescription(`<p>${'<strong>a</strong>'.repeat(Math.ceil(MENTORSHIP_RICH_TEXT_RAW_MAX / 18) + 1)}</p>`);

    expect(counterText()).toBe(`Over limit / ${MENTORSHIP_ENROLL_DESCRIPTION_MAX}`);
  });
});
