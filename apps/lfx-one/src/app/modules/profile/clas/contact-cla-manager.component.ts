// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CLA_MANAGER_MESSAGE_MAX_LENGTH, CLA_MANAGER_MODAL_COPY } from '@lfx-one/shared/constants';
import type { ClaManagerRequestResult, ClaManagerView, ContactClaManagerDialogData } from '@lfx-one/shared/interfaces';
import { codePointLength } from '@lfx-one/shared/utils';
import { maxCodePointsValidator, trimmedRequired } from '@lfx-one/shared/validators';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { MessageComponent } from '@components/message/message.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MyClasService } from '@services/my-clas.service';

/**
 * Shared Contact CLA Manager modal (#1372 / #1574). Three copy modes, all POSTing the matching
 * `requestType` to the producer. Contact differs only in what it asks for: no change, which is
 * why its message is required rather than optional.
 */
@Component({
  selector: 'lfx-contact-cla-manager',
  imports: [ReactiveFormsModule, ButtonComponent, CheckboxComponent, MessageComponent, TextareaComponent],
  templateUrl: './contact-cla-manager.component.html',
  styleUrl: './contact-cla-manager.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactClaManagerComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject<DynamicDialogConfig<ContactClaManagerDialogData>>(DynamicDialogConfig);
  private readonly myClasService = inject(MyClasService);
  private readonly messageService = inject(MessageService);

  protected readonly data: ContactClaManagerDialogData = this.config.data ?? {
    signatureId: '',
    projectName: '',
    mode: 'contact',
  };
  protected readonly copy = CLA_MANAGER_MODAL_COPY[this.data.mode];
  protected readonly hint = this.copy.hint(this.data.projectName);
  protected readonly messageMaxLength = CLA_MANAGER_MESSAGE_MAX_LENGTH;
  /** Contact asks for no change, so the message is the request. Approval and removal keep it optional. */
  protected readonly messageRequired = this.data.mode === 'contact';

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly sending = signal(false);
  protected readonly sendError = signal(false);
  protected readonly managers = signal<ClaManagerView[]>([]);
  protected readonly selectedCount = signal(0);

  protected readonly managerForm = new FormGroup({});
  protected readonly messageControl = new FormControl('', {
    nonNullable: true,
    validators: this.messageRequired
      ? [trimmedRequired(), maxCodePointsValidator(CLA_MANAGER_MESSAGE_MAX_LENGTH)]
      : [maxCodePointsValidator(CLA_MANAGER_MESSAGE_MAX_LENGTH)],
  });
  protected readonly form = new FormGroup({
    message: this.messageControl,
    managers: this.managerForm,
  });

  // Zoneless change detection cannot see `messageControl.errors`, so the validators' verdict is
  // mirrored into a signal on every `valueChanges`.
  private readonly messageErrors = signal(this.messageControl.errors);
  private readonly messageValue = signal('');
  // Withholds the error until the contributor has actually typed. Opening a contact modal to a red
  // "required" line would scold them for not having started; the label's `*` carries it until then.
  private readonly messageEdited = signal(false);

  protected readonly messageError: Signal<'required' | 'too-long' | null> = this.initMessageError();
  protected readonly visibleMessageError = computed(() => (this.messageEdited() ? this.messageError() : null));
  protected readonly messageLength = computed(() => codePointLength(this.messageValue()));

  protected readonly hasManagers = computed(() => this.managers().length > 0);
  protected readonly canSend = computed(
    () => this.selectedCount() > 0 && this.messageError() === null && !this.sending() && !this.loading() && this.hasManagers()
  );

  public constructor() {
    this.managerForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.syncSelectedCount());
    this.messageControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      this.messageValue.set(value);
      this.messageErrors.set(this.messageControl.errors);
      this.messageEdited.set(true);
    });

    this.myClasService
      .getClaManagers(this.data.signatureId)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (list) => {
          const views = list.managers.map((manager) => ({
            ...manager,
            label: manager.name || manager.lfUsername,
          }));
          for (const manager of views) {
            this.managerForm.addControl(manager.lfUsername, new FormControl(true, { nonNullable: true }));
          }
          this.managers.set(views);
          this.syncSelectedCount();
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  protected onCancel(): void {
    this.ref.close(null);
  }

  protected onSend(): void {
    if (!this.canSend()) return;

    this.sending.set(true);
    this.sendError.set(false);

    const message = this.messageControl.value.trim();
    this.myClasService
      .createClaManagerRequest(this.data.signatureId, {
        requestType: this.data.mode,
        recipients: this.selectedUsernames(),
        ...(message ? { message } : {}),
      })
      .pipe(take(1))
      .subscribe({
        next: (result) => this.onSent(result),
        error: () => {
          this.sending.set(false);
          this.sendError.set(true);
        },
      });
  }

  private selectedUsernames(): string[] {
    return Object.entries(this.managerForm.getRawValue())
      .filter(([, checked]) => checked)
      .map(([lfUsername]) => lfUsername);
  }

  private syncSelectedCount(): void {
    this.selectedCount.set(this.selectedUsernames().length);
  }

  private onSent(result: ClaManagerRequestResult): void {
    this.sending.set(false);
    const receipt = this.copy.receipt[result.status];
    this.messageService.add({
      severity: result.status === 'sent' ? 'success' : 'info',
      summary: receipt.summary,
      detail: receipt.detail,
    });
    this.ref.close(result);
  }

  private initMessageError(): Signal<'required' | 'too-long' | null> {
    return computed(() => {
      const errors = this.messageErrors();
      if (errors?.['maxCodePoints']) return 'too-long';
      if (errors?.['trimmedRequired']) return 'required';
      return null;
    });
  }
}
