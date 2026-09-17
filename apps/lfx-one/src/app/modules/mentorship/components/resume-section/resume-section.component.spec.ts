// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  MENTORSHIP_MENTOR_RESUME_EMPTY_LABEL,
  MENTORSHIP_MENTOR_RESUME_MAX_BYTES,
  MENTORSHIP_MENTOR_RESUME_SIZE_ERROR,
  MENTORSHIP_MENTOR_RESUME_TYPE_ERROR,
} from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { ResumeSectionComponent } from './resume-section.component';

/**
 * The shared resume section replaces two near-identical siblings, so the spec runs its
 * behavioural scenarios against both consumer prefixes to prove the merge preserves each
 * caller's namespace. If a future third register form adopts this component, add its
 * `idPrefix` to the loop rather than forking the spec.
 */
describe('ResumeSectionComponent', () => {
  for (const idPrefix of ['mentorship-mentor-resume', 'mentorship-mentee-resume']) {
    describe(`with idPrefix "${idPrefix}"`, () => {
      let fixture: ComponentFixture<ResumeSectionComponent>;
      let form: FormGroup<{ resumeFileName: FormControl<string> }>;

      const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
      const fileName = (): string => element().querySelector(`[data-testid="${idPrefix}-name"]`)?.textContent?.trim() ?? '';
      const error = (): string | null => element().querySelector(`[data-testid="${idPrefix}-error"]`)?.textContent?.trim() ?? null;

      /**
       * A real input carrying a real `File`, so the spec exercises the component against the
       * shapes the browser hands it. `size` and `value` are redefined rather than assigned
       * because neither is writable on the genuine article.
       */
      const select = (name: string, size = 1024): HTMLInputElement => {
        const input = document.createElement('input');
        input.type = 'file';

        const file = new File([], name);
        Object.defineProperty(file, 'size', { value: size });
        Object.defineProperty(input, 'files', { value: [file] });
        Object.defineProperty(input, 'value', { value: name, writable: true });

        const event = new Event('change');
        Object.defineProperty(event, 'target', { value: input });

        fixture.componentInstance['onFileChange'](event);
        fixture.detectChanges();
        return input;
      };

      beforeEach(() => {
        form = new FormGroup({ resumeFileName: new FormControl('', { nonNullable: true }) });

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          imports: [ResumeSectionComponent],
          providers: [provideNoopAnimations()],
        });

        fixture = TestBed.createComponent(ResumeSectionComponent);
        fixture.componentRef.setInput('form', form);
        fixture.componentRef.setInput('intro', `intro copy for ${idPrefix}`);
        fixture.componentRef.setInput('idPrefix', idPrefix);
        fixture.detectChanges();
      });

      it('names the section, the label, and the file input from the idPrefix, so callers own their namespace', () => {
        // A rename here is a UX break — anything anchored on the caller's testid prefix
        // (E2E, register spec section audit) must still find the section unchanged.
        expect(element().querySelector(`[data-testid="${idPrefix}"]`)).not.toBeNull();
        const label = element().querySelector('label');
        expect(label?.getAttribute('for')).toBe(`${idPrefix}-input`);
        expect(element().querySelector(`#${idPrefix}-input`)).not.toBeNull();
      });

      it('renders the intro copy the caller passes, without falling back to a shared default', () => {
        // The intro is what tells mentors "candidates look you up" vs mentees "mentors do";
        // if the default ever swallows a caller's copy the two personas get the wrong context.
        expect(element().querySelector('p.text-sm.text-gray-600')?.textContent?.trim()).toBe(`intro copy for ${idPrefix}`);
      });

      it('prompts for a file until one is chosen', () => {
        expect(fileName()).toBe(MENTORSHIP_MENTOR_RESUME_EMPTY_LABEL);
        expect(element().querySelector(`[data-testid="${idPrefix}-clear"]`)).toBeNull();
      });

      it('stores the file name on the form, not the bytes, since there is no upload endpoint yet', () => {
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

      it('rejects a document over the shared size cap', () => {
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

        const clear = element().querySelector(`[data-testid="${idPrefix}-clear"]`);
        expect(clear?.querySelector('button')?.getAttribute('aria-label')).toBe('Remove resume.pdf');

        fixture.componentInstance['onClear']();
        fixture.detectChanges();

        expect(form.controls.resumeFileName.value).toBe('');
        expect(fileName()).toBe(MENTORSHIP_MENTOR_RESUME_EMPTY_LABEL);
      });

      it('follows a parent-side reset of the form', () => {
        select('resume.pdf');

        form.reset();
        fixture.detectChanges();

        expect(fileName()).toBe(MENTORSHIP_MENTOR_RESUME_EMPTY_LABEL);
      });

      it('renders the card wrapper with border and padding when bordered is true (default)', () => {
        const wrapper = element().querySelector('[data-testid="' + idPrefix + '"]');
        expect(wrapper?.classList.contains('rounded-2xl')).toBe(true);
        expect(wrapper?.classList.contains('border')).toBe(true);
        expect(wrapper?.classList.contains('border-gray-200')).toBe(true);
        expect(wrapper?.classList.contains('bg-white')).toBe(true);
      });

      it('strips the card wrapper when bordered is false, used inside drawers', () => {
        fixture.componentRef.setInput('bordered', false);
        fixture.detectChanges();

        const wrapper = element().querySelector('[data-testid="' + idPrefix + '"]');
        expect(wrapper?.classList.contains('rounded-2xl')).toBe(false);
        expect(wrapper?.classList.contains('border')).toBe(false);
        expect(wrapper?.classList.contains('border-gray-200')).toBe(false);
        expect(wrapper?.classList.contains('bg-white')).toBe(false);
      });
    });
  }
});
