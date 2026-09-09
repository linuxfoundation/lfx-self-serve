// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { map, of, startWith, switchMap } from 'rxjs';

/**
 * Tracks one control's `touched` flag as a signal.
 *
 * `touched` is what every blur-driven error message hangs off, and it is the one piece of form state
 * that no value- or status-derived signal can stand in for: `markAsTouched()` emits on neither
 * `valueChanges` nor `statusChanges`, so a `computed()` keyed on either keeps whatever it cached
 * before the field was first left. Template expressions get away with reading `control.touched`
 * directly because a blur marks the view dirty and every expression is re-evaluated; a `computed()`
 * does not, which is how an `aria-describedby` assembled in TypeScript ends up naming errors the
 * template has stopped rendering — or missing the one it has just started to.
 *
 * `AbstractControl.events` (Angular 18+) is the only stream that carries `TouchedChangeEvent`. The
 * flag is read back off the control rather than off the event, so no event type has to be narrowed
 * and a value or status change arriving on the same stream is reflected by the same read.
 *
 * The form is taken as a signal rather than as a value so a section handed a rebuilt `FormGroup`
 * re-subscribes instead of holding a control that is no longer on screen. Must be called from an
 * injection context — a field initializer or a constructor — since `toObservable` and `toSignal`
 * both require one.
 */
export function controlTouchedSignal(form: Signal<FormGroup>, controlName: string): Signal<boolean> {
  return toSignal(
    toObservable(form).pipe(
      switchMap((group) => {
        const control = group.get(controlName);
        if (!control) {
          return of(false);
        }

        return control.events.pipe(
          startWith(null),
          map(() => control.touched)
        );
      })
    ),
    { initialValue: false }
  );
}
