// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, Signal, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AbstractControl, FormControl, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { REMINDER_MINUTES_ERROR_KEYS } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  controlErrorSignal,
  controlTouchedSignal,
  controlValueSignal,
  formErrorSignal,
  touchedAnyErrorSignal,
  touchedErrorSignal,
  touchedInvalidSignal,
} from './form-control-signals.util';

/*
 * Regression coverage for the composer's template-state helpers.
 *
 * The defect these exist to prevent is the one stated in the util's own header: the composer form
 * service's `revision()` counter is driven by `valueChanges` and `statusChanges`, and
 * `markAsTouched()` emits on neither — so a `computed()` keyed on it keeps whatever it cached
 * before the field was first left. A template expression reading `control.touched` gets away with
 * that because a blur marks the view dirty and every expression re-runs; a `computed()` does not,
 * which is how an `aria-describedby` assembled in TypeScript ends up naming an error paragraph the
 * template has stopped rendering, or missing the one it has just started to. Every blur-gated
 * helper below is therefore asserted against a bare `markAsTouched()` with no value or status
 * change alongside it — the exact motion `revision()` cannot see.
 */
describe('form-control-signals.util', () => {
  /*
   * Close enough to the composer's own group to exercise every helper: a required/maxlength text
   * control, the four reminder-minutes rules that share one message, and a cross-field error that
   * lands on the group rather than on any child — the shape `futureDateTime` has.
   */
  const buildGroup = (): FormGroup =>
    new FormGroup(
      {
        title: new FormControl<string | null>(null, [Validators.required, Validators.maxLength(5)]),
        reminderMinutes: new FormControl<string | number | null>(0, [Validators.required, Validators.pattern(/^\d+$/), Validators.min(0), Validators.max(59)]),
        flagged: new FormControl<boolean>(false),
      },
      { validators: (group: AbstractControl): ValidationErrors | null => (group.get('flagged')?.value ? { futureDateTime: true } : null) }
    );

  let form: WritableSignal<FormGroup>;

  /**
   * Settles the helpers' first emission.
   * @description `toObservable` emits through an effect, so every helper reports its `initialValue`
   * until the first change-detection pass — the same one the app itself settles in before paint.
   */
  const flush = (): void => TestBed.inject(ApplicationRef).tick();

  /** Builds a helper in an injection context, since `toObservable` and `toSignal` both need one. */
  const build = <T>(create: () => Signal<T>): Signal<T> => {
    const built = TestBed.runInInjectionContext(create);
    flush();
    return built;
  };

  const control = (name: string): AbstractControl => form().get(name) as AbstractControl;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    form = signal(buildGroup());
  });

  describe('controlTouchedSignal', () => {
    it('follows a bare markAsTouched, with no value or status change alongside it', () => {
      const titleTouched = build(() => controlTouchedSignal(form, 'title'));

      expect(titleTouched()).toBe(false);

      control('title').markAsTouched();

      expect(titleTouched(), 'markAsTouched emits on AbstractControl.events only — not on valueChanges or statusChanges').toBe(true);
    });

    it('follows the control back to untouched when the form is reset', () => {
      const titleTouched = build(() => controlTouchedSignal(form, 'title'));
      control('title').markAsTouched();

      form().reset();

      expect(titleTouched()).toBe(false);
    });
  });

  describe('controlValueSignal', () => {
    it('follows setValue', () => {
      const title = build(() => controlValueSignal<string>(form, 'title'));

      expect(title()).toBeNull();

      control('title').setValue('Board sync');

      expect(title()).toBe('Board sync');
    });

    it('passes an emptied control through as the empty string it holds', () => {
      const title = build(() => controlValueSignal<string>(form, 'title'));
      control('title').setValue('');

      // `null` is reserved for a control that is absent or never set; a cleared field is still a
      // value, and `titleLength()` has to see the difference to count it as zero rather than skip it.
      expect(title()).toBe('');
    });
  });

  describe('controlErrorSignal', () => {
    it('reports the error without waiting for the field to be left', () => {
      const titleTooLong = build(() => controlErrorSignal(form, 'title', 'maxlength'));

      control('title').setValue('far too long for this field');

      expect(titleTooLong(), 'the YouTube callout answers a toggle the organizer just flipped, not a blur').toBe(true);
    });
  });

  describe('touchedErrorSignal', () => {
    it('stays quiet while the invalid field has not been left', () => {
      const titleRequired = build(() => touchedErrorSignal(form, 'title', 'required'));

      expect(control('title').hasError('required')).toBe(true);
      expect(titleRequired()).toBe(false);
    });

    it('surfaces the error on blur and clears it once the value fixes it', () => {
      const titleRequired = build(() => touchedErrorSignal(form, 'title', 'required'));

      control('title').markAsTouched();
      expect(titleRequired()).toBe(true);

      control('title').setValue('Sync');
      expect(titleRequired()).toBe(false);
    });

    it('ignores a different error on the same control', () => {
      const titleRequired = build(() => touchedErrorSignal(form, 'title', 'required'));

      control('title').setValue('far too long');
      control('title').markAsTouched();

      expect(titleRequired()).toBe(false);
    });
  });

  describe('touchedAnyErrorSignal', () => {
    it.each([
      ['required', ''],
      ['pattern', '1.5'],
      ['min', -1],
      ['max', 99],
    ])('fires on the %s rule, which shares one message with the other three', (errorKey: string, value: string | number) => {
      const minutesError = build(() => touchedAnyErrorSignal(form, 'reminderMinutes', REMINDER_MINUTES_ERROR_KEYS));

      control('reminderMinutes').setValue(value);
      control('reminderMinutes').markAsTouched();

      expect(control('reminderMinutes').hasError(errorKey), `expected the ${errorKey} validator to be the one that tripped`).toBe(true);
      expect(minutesError()).toBe(true);
    });

    it('stays quiet on a valid value that has been left', () => {
      const minutesError = build(() => touchedAnyErrorSignal(form, 'reminderMinutes', REMINDER_MINUTES_ERROR_KEYS));

      control('reminderMinutes').setValue(30);
      control('reminderMinutes').markAsTouched();

      expect(minutesError()).toBe(false);
    });
  });

  describe('touchedInvalidSignal', () => {
    it('reflects touched && invalid, whichever rule is the one failing', () => {
      const titleInvalid = build(() => touchedInvalidSignal(form, 'title'));

      expect(titleInvalid()).toBe(false);

      control('title').markAsTouched();
      expect(titleInvalid()).toBe(true);

      control('title').setValue('Sync');
      expect(titleInvalid()).toBe(false);
    });
  });

  describe('formErrorSignal', () => {
    it('reads a cross-field error off the group itself, ungated by touched', () => {
      const crossFieldError = build(() => formErrorSignal(form, 'futureDateTime'));

      expect(crossFieldError()).toBe(false);

      control('flagged').setValue(true);

      expect(crossFieldError(), 'a group is only touched once a child is, which is rarely the gate a cross-field message wants').toBe(true);
    });
  });

  describe('an absent control', () => {
    it('reports the helper default rather than throwing', () => {
      const missingValue = build(() => controlValueSignal<string>(form, 'nonexistent'));
      const missingTouched = build(() => controlTouchedSignal(form, 'nonexistent'));
      const missingError = build(() => touchedErrorSignal(form, 'nonexistent', 'required'));

      expect(missingValue()).toBeNull();
      expect(missingTouched()).toBe(false);
      expect(missingError()).toBe(false);
    });
  });

  describe('when the form signal is replaced', () => {
    it('re-subscribes to the rebuilt group instead of holding the control that left the screen', () => {
      const title = build(() => controlValueSignal<string>(form, 'title'));
      const titleTouched = build(() => controlTouchedSignal(form, 'title'));

      control('title').setValue('First open');
      control('title').markAsTouched();
      expect(title()).toBe('First open');
      expect(titleTouched()).toBe(true);

      // What `initialize()` does on a reopen: a brand-new FormGroup swapped into the same signal.
      form.set(buildGroup());
      flush();

      expect(title()).toBeNull();
      expect(titleTouched()).toBe(false);

      control('title').setValue('Second open');
      expect(title(), 'the helper has to follow the new group, not the one it first resolved').toBe('Second open');
    });

    it('picks up a control that only the rebuilt group carries', () => {
      const lateValue = build(() => controlValueSignal<string>(form, 'agenda'));

      expect(lateValue()).toBeNull();

      const rebuilt = buildGroup();
      rebuilt.addControl('agenda', new FormControl<string | null>('Roll call'));
      form.set(rebuilt);
      flush();

      expect(lateValue()).toBe('Roll call');
    });
  });
});
