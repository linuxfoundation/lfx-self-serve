// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_MENTOR_RESUME_MAX_BYTES, MENTORSHIP_MENTOR_RESUME_SIZE_ERROR, MENTORSHIP_MENTOR_RESUME_TYPE_ERROR } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { MentorResumeSectionComponent } from './mentor-resume-section.component';

describe('MentorResumeSectionComponent', () => {
  let fixture: ComponentFixture<MentorResumeSectionComponent>;
  let form: FormGroup<{ resumeFileName: FormControl<string> }>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const fileName = (): string => element().querySelector('span.flex-1')?.textContent?.trim() ?? '';
  const error = (): string | null => element().querySelector('[data-testid="mentorship-mentor-resume-error"]')?.textContent?.trim() ?? null;

  /** Stands in for the change event, so the spec never has to build a real FileList. */
  const select = (name: string, size = 1024): HTMLInputElement => {
    const input = { files: [{ name, size }], value: name } as unknown as HTMLInputElement;
    fixture.componentInstance['onFileChange']({ target: input } as unknown as Event);
    fixture.detectChanges();
    return input;
  };

  beforeEach(() => {
    form = new FormGroup({ resumeFileName: new FormControl('', { nonNullable: true }) });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorResumeSectionComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(MentorResumeSectionComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();
  });

  it('prompts for a file until one is chosen', () => {
    expect(fileName()).toBe('Choose file');
    expect(element().querySelector('[data-testid="mentorship-mentor-resume-clear"]')).toBeNull();
  });

  it('stores the file name on the form, not the bytes, since there is no upload endpoint', () => {
    select('resume.pdf');

    expect(form.controls.resumeFileName.value).toBe('resume.pdf');
    expect(fileName()).toBe('resume.pdf');
    expect(error()).toBeNull();
  });

  it('rejects a file that is not a document, and clears the input so it can be retried', () => {
    const input = select('headshot.png');

    expect(error()).toBe(MENTORSHIP_MENTOR_RESUME_TYPE_ERROR);
    expect(form.controls.resumeFileName.value).toBe('');
    expect(input.value).toBe('');
  });

  it('rejects a document over the size cap', () => {
    select('resume.pdf', MENTORSHIP_MENTOR_RESUME_MAX_BYTES + 1);

    expect(error()).toBe(MENTORSHIP_MENTOR_RESUME_SIZE_ERROR);
    expect(form.controls.resumeFileName.value).toBe('');
  });

  it('accepts a document exactly at the cap', () => {
    select('resume.docx', MENTORSHIP_MENTOR_RESUME_MAX_BYTES);

    expect(error()).toBeNull();
    expect(form.controls.resumeFileName.value).toBe('resume.docx');
  });

  it('drops a stale error once an acceptable file replaces the rejected one', () => {
    select('headshot.png');
    expect(error()).toBe(MENTORSHIP_MENTOR_RESUME_TYPE_ERROR);

    select('resume.pdf');
    expect(error()).toBeNull();
  });

  it('clears a chosen resume, naming it for a screen reader', () => {
    select('resume.pdf');

    const clear = element().querySelector('[data-testid="mentorship-mentor-resume-clear"]');
    expect(clear?.querySelector('button')?.getAttribute('aria-label')).toBe('Remove resume.pdf');

    fixture.componentInstance['onClear']();
    fixture.detectChanges();

    expect(form.controls.resumeFileName.value).toBe('');
    expect(fileName()).toBe('Choose file');
  });

  it('follows a parent-side reset of the form', () => {
    select('resume.pdf');

    form.reset();
    fixture.detectChanges();

    expect(fileName()).toBe('Choose file');
  });
});
