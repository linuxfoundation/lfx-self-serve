// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CLA_MANAGER_MODAL_COPY } from '@lfx-one/shared/constants';
import type { ClaManagerRequestResult, ClaManagerView, ContactClaManagerDialogData } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { MessageComponent } from '@components/message/message.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MyClasService } from '@services/my-clas.service';

/**
 * Shared Contact CLA Manager modal (#1372 / #1574). Three copy modes; approval and removal
 * POST to the producer; contact Send is a documented no-op (the producer email always claims an
 * Approved-List change) and tells the contributor that nothing was sent.
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

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly sending = signal(false);
  protected readonly sendError = signal(false);
  protected readonly managers = signal<ClaManagerView[]>([]);
  protected readonly selectedCount = signal(0);

  protected readonly managerForm = new FormGroup({});
  protected readonly form = new FormGroup({
    message: new FormControl('', { nonNullable: true }),
    managers: this.managerForm,
  });

  protected readonly hasManagers = computed(() => this.managers().length > 0);
  protected readonly canSend = computed(() => this.selectedCount() > 0 && !this.sending() && !this.loading() && this.hasManagers());

  public constructor() {
    this.managerForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.syncSelectedCount());

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

    // Contact is a product-complete no-op: the producer has no contact requestType, and posting
    // approval/removal would tell the manager to change the Approved List.
    if (this.data.mode === 'contact') {
      this.messageService.add({
        severity: 'info',
        summary: 'Message not sent',
        detail: "Contacting CLA managers isn't available yet — no message was sent.",
      });
      this.ref.close(null);
      return;
    }

    this.sending.set(true);
    this.sendError.set(false);

    const message = this.form.controls.message.value.trim();
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
    this.messageService.add({
      severity: result.status === 'sent' ? 'success' : 'info',
      summary: result.status === 'sent' ? 'Request sent' : 'Request recorded',
      detail:
        result.status === 'sent'
          ? 'The CLA manager(s) you selected will be notified.'
          : 'The request was recorded, but no CLA manager email could be delivered.',
    });
    this.ref.close(result);
  }
}
