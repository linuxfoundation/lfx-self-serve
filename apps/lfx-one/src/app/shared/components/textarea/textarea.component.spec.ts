// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

import { TextareaComponent } from './textarea.component';

/**
 * Guards the `maxlength` binding, which is a footgun this wrapper has already stepped on once.
 *
 * Angular's `MaxLengthValidator` has selector `[maxlength][formControlName]` and ships inside the
 * `ReactiveFormsModule` this component imports, so binding `[maxlength]` on the inner `<textarea>`
 * silently attaches a validator to the *caller's* control — a caller that only wanted the browser to
 * stop accepting characters ends up with an invalid `FormGroup` and, in the composer's case, a Save
 * button that does nothing with no error UI to explain it. `[attr.maxlength]` sets the attribute
 * without the directive.
 *
 * The regression guard is specifically `leaves the control valid at a value over the cap`. Angular
 * reflects a property-bound `maxlength` to the attribute as well, so the attribute assertions below
 * pass either way — they pin the rendered contract, not the absence of the validator.
 */
describe('TextareaComponent — maxlength', () => {
  const CAP = 1000;

  let fixture: ComponentFixture<TextareaComponent>;
  let form: FormGroup;

  const textarea = (): HTMLTextAreaElement => {
    const el = fixture.nativeElement.querySelector('textarea');
    if (!el) throw new Error('no textarea rendered');
    return el as HTMLTextAreaElement;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TextareaComponent] }).compileComponents();

    form = new FormGroup({ notes: new FormControl('') });

    fixture = TestBed.createComponent(TextareaComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('control', 'notes');
    fixture.componentRef.setInput('maxlength', CAP);
    await fixture.whenStable();
  });

  it('renders the cap as a native attribute', () => {
    expect(textarea().getAttribute('maxlength')).toBe(String(CAP));
  });

  it('leaves the control valid at a value over the cap', async () => {
    form.get('notes')?.setValue('a'.repeat(CAP + 1));
    await fixture.whenStable();

    expect(form.get('notes')?.errors).toBeNull();
    expect(form.valid).toBe(true);
  });

  it('omits the attribute entirely when no cap is set', async () => {
    fixture.componentRef.setInput('maxlength', undefined);
    await fixture.whenStable();

    expect(textarea().hasAttribute('maxlength')).toBe(false);
  });
});
