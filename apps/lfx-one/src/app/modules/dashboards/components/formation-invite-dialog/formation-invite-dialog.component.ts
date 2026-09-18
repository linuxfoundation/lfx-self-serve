// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, effect, input, model, output, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ControlEvent, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import {
  EMAIL_REGEX,
  FORMATION_INVITE_DIALOG_HEADER,
  FORMATION_INVITE_DIALOG_INTRO,
  FORMATION_INVITE_DUPLICATE_MESSAGE,
  FORMATION_INVITE_ROLE_OPTIONS,
} from '@lfx-one/shared/constants';
import type { FormationInviteFormValue, FormationPersonRole } from '@lfx-one/shared/interfaces';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { DialogModule } from 'primeng/dialog';

/**
 * The people card's invite dialog (#2724, PR 2): name, email, and a View/Manage radio (View by
 * default). Presentation only — it validates, blocks an address already on the project without a
 * request, and emits a normalised {@link FormationInviteFormValue}; the host card owns the HTTP
 * calls, the toasts, and the `saving` flag (the `add-access-user-modal` contract). Inline
 * `<p-dialog>` with `model()` visibility rather than `DialogService`, so the host can two-way bind
 * it and the dialog dies with the card.
 */
@Component({
  selector: 'lfx-formation-invite-dialog',
  imports: [ReactiveFormsModule, DialogModule, InputTextComponent, RadioButtonComponent],
  templateUrl: './formation-invite-dialog.component.html',
  styleUrl: './formation-invite-dialog.component.scss',
})
export class FormationInviteDialogComponent {
  public readonly saving = input<boolean>(false);
  /** Lowercased addresses already on the project — a match is rejected inline, with no request. */
  public readonly existingEmails = input<readonly string[]>([]);

  public readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [trimmedRequired()] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(EMAIL_REGEX)] }),
    role: new FormControl<FormationPersonRole>('view', { nonNullable: true }),
  });

  public readonly visible = model<boolean>(false);

  public readonly submitted = output<FormationInviteFormValue>();

  protected readonly header = FORMATION_INVITE_DIALOG_HEADER;
  protected readonly intro = FORMATION_INVITE_DIALOG_INTRO;
  protected readonly duplicateMessage = FORMATION_INVITE_DUPLICATE_MESSAGE;
  protected readonly roleOptions = FORMATION_INVITE_ROLE_OPTIONS;

  // Each control's own event stream mirrored into a signal: plain FormControl state is not
  // signal-reactive, so the error-id computeds below need this to re-run on touch/value/status
  // changes, and the template must read signals, not call methods.
  private readonly nameState: Signal<ControlEvent | null> = this.initControlState('name');
  private readonly emailState: Signal<ControlEvent | null> = this.initControlState('email');
  private readonly emailValue: Signal<string> = toSignal(this.form.controls.email.valueChanges, { initialValue: this.form.controls.email.value });

  protected readonly isDuplicate: Signal<boolean> = computed(() => this.existingEmails().includes(this.emailValue().trim().toLowerCase()));
  /** Id of the error currently on screen for each field — wired to the input's `describedBy`/`invalid` and the message block. */
  protected readonly nameErrorId: Signal<string | undefined> = this.initNameErrorId();
  protected readonly emailErrorId: Signal<string | undefined> = this.initEmailErrorId();

  public constructor() {
    // Reset on open, synchronously with the `visible` flip — NOT on p-dialog's `onShow`, which
    // fires only after the show animation and would wipe anything typed during it (a race the
    // Playwright suite hit, and a fast human could too).
    effect(() => {
      if (this.visible()) {
        this.form.reset({ name: '', email: '', role: 'view' });
      }
    });
  }

  protected onCancel(): void {
    if (this.saving()) {
      return;
    }
    this.visible.set(false);
  }

  protected onSubmit(): void {
    if (this.saving()) {
      return;
    }

    // Submit stays enabled so a click surfaces the validation messages; the guard is here.
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isDuplicate()) {
      return;
    }

    const { name, email, role } = this.form.getRawValue();
    this.submitted.emit({ name: name.trim(), email: email.trim().toLowerCase(), role });
  }

  private initControlState(control: 'name' | 'email'): Signal<ControlEvent | null> {
    // Per-control `events` rather than the group's: a FormGroup only re-emits a touched change
    // when its own aggregate touched flips, so a second field being touched would not notify.
    return toSignal(this.form.controls[control].events, { initialValue: null });
  }

  private initNameErrorId(): Signal<string | undefined> {
    return computed(() => {
      this.nameState();
      const control = this.form.controls.name;
      if (control.touched && control.invalid) {
        return 'formation-invite-name-required';
      }
      return undefined;
    });
  }

  private initEmailErrorId(): Signal<string | undefined> {
    return computed(() => {
      this.emailState();
      // A duplicate is worth flagging as soon as it is typed — it needs no touch to be certain.
      if (this.isDuplicate()) {
        return 'formation-invite-email-duplicate';
      }
      const control = this.form.controls.email;
      if (!control.touched) {
        return undefined;
      }
      if (control.hasError('required')) {
        return 'formation-invite-email-required';
      }
      if (control.hasError('pattern')) {
        return 'formation-invite-email-invalid';
      }
      return undefined;
    });
  }
}
