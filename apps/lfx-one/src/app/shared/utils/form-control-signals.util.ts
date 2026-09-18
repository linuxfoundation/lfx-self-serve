// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormGroup } from '@angular/forms';
import { map, of, startWith, switchMap } from 'rxjs';

/*
 * Signals over reactive-forms state, for templates that are only allowed to read signals.
 *
 * `docs/reviews/frontend-checklist.md` section 4 lets a template read signals, computed values and
 * pipes — not call methods. `form().get('title')?.errors?.['required'] && form().get('title')?.touched`
 * is four method calls per binding per change-detection pass, and it buries which control the block
 * actually depends on. These helpers name that dependency once, in the component.
 *
 * Every helper is built on `AbstractControl.events` (Angular 18+) rather than on the composer's
 * `revision()` counter. `revision()` is driven by `valueChanges` and `statusChanges`, and
 * `markAsTouched()` emits on neither — so a `computed()` keyed on it keeps whatever it cached before
 * the field was first left. Template expressions get away with reading `control.touched` directly
 * because a blur marks the view dirty and every expression is re-evaluated; a `computed()` does not,
 * which is how an `aria-describedby` assembled in TypeScript ends up naming errors the template has
 * stopped rendering — or missing the one it has just started to. `events` carries `ValueChangeEvent`,
 * `StatusChangeEvent`, `TouchedChangeEvent`, `PristineChangeEvent` and `FormResetEvent`, so a single
 * subscription covers every read below and needs no explicit bump from the form service.
 *
 * The form is taken as a signal rather than as a value so a section handed a rebuilt `FormGroup`
 * re-subscribes instead of holding a control that is no longer on screen. All of these must be
 * called from an injection context — a field initializer or a constructor — since `toObservable` and
 * `toSignal` both require one.
 */

/**
 * Subscribes to one control's events and re-reads it on every emission.
 * @param form the group to resolve against, as a signal so a rebuild re-subscribes
 * @param controlName the control to watch, or `null` for the group itself (cross-field validators)
 * @param read what to pull off the control; the state is read back rather than taken off the event,
 * so no event type has to be narrowed and every event kind is reflected by the same read
 * @param absent what to report while the named control does not exist on the group
 */
function controlStateSignal<T>(form: Signal<FormGroup>, controlName: string | null, read: (control: AbstractControl) => T, absent: T): Signal<T> {
  return toSignal(
    toObservable(form).pipe(
      switchMap((group) => {
        const control = controlName === null ? group : group.get(controlName);

        if (!control) {
          return of(absent);
        }

        return control.events.pipe(
          startWith(null),
          map(() => read(control))
        );
      })
    ),
    { initialValue: absent }
  );
}

/** Tracks one control's `touched` flag — what every blur-gated error message hangs off. */
export function controlTouchedSignal(form: Signal<FormGroup>, controlName: string): Signal<boolean> {
  return controlStateSignal(form, controlName, (control) => control.touched, false);
}

/**
 * Tracks one control's value.
 * @description Reports `null` while the control is absent, which is also what an unset control holds.
 */
export function controlValueSignal<T>(form: Signal<FormGroup>, controlName: string): Signal<T | null> {
  return controlStateSignal<T | null>(form, controlName, (control) => (control.value as T | null) ?? null, null);
}

/** Tracks whether one control carries a given validation error, whether or not it has been left. */
export function controlErrorSignal(form: Signal<FormGroup>, controlName: string, errorKey: string): Signal<boolean> {
  return controlStateSignal(form, controlName, (control) => control.hasError(errorKey), false);
}

/**
 * Tracks a validation error that should only surface once the field has been left.
 * @description The gate the composer's error paragraphs use, and the one `aria-describedby` has to
 * agree with so the attribute never names a paragraph the template is not rendering.
 */
export function touchedErrorSignal(form: Signal<FormGroup>, controlName: string, errorKey: string): Signal<boolean> {
  return controlStateSignal(form, controlName, (control) => control.touched && control.hasError(errorKey), false);
}

/**
 * Tracks whether any of several errors is showing on a field that has been left.
 * @description For the fields whose rules share one message — the reminder minutes are `required`,
 * `pattern`, `min` and `max`, and all four say the same sentence. One subscription rather than one
 * per key, and the disjunction is stated where the message is named rather than in the template.
 */
export function touchedAnyErrorSignal(form: Signal<FormGroup>, controlName: string, errorKeys: readonly string[]): Signal<boolean> {
  return controlStateSignal(form, controlName, (control) => control.touched && errorKeys.some((key) => control.hasError(key)), false);
}

/** Tracks `touched && invalid` — what an input's `aria-invalid` should reflect. */
export function touchedInvalidSignal(form: Signal<FormGroup>, controlName: string): Signal<boolean> {
  return controlStateSignal(form, controlName, (control) => control.touched && control.invalid, false);
}

/**
 * Tracks a group-level validation error, such as the composer's cross-field `futureDateTime`.
 * @description Ungated on purpose: a group only counts as `touched` once one of its children is,
 * which is rarely the gate a cross-field message wants. Combine with `controlTouchedSignal` on the
 * fields that actually feed the rule.
 */
export function formErrorSignal(form: Signal<FormGroup>, errorKey: string): Signal<boolean> {
  return controlStateSignal(form, null, (control) => control.hasError(errorKey), false);
}
