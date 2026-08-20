// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { ClaManager, ClaManagerRequestMode, ClaManagerRequestResult } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MyClasService } from '@services/my-clas.service';

export interface ContactClaManagerDialogData {
  signatureId: string;
  projectName: string;
  mode: ClaManagerRequestMode;
}

/** v17 `mgrCopy` — titles also used as DialogService headers by the kebab factory. */
export const CLA_MANAGER_MODAL_COPY: Record<ClaManagerRequestMode, { title: string; hint: (project: string) => string }> = {
  approval: {
    title: 'Request approval',
    hint: (project) => `Ask the CLA manager(s) below to re-approve your ECLA for ${project}.`,
  },
  removal: {
    title: 'Request Removal',
    hint: (project) => `Ask the CLA manager(s) below to remove your ECLA for ${project}. This starts the process to invalidate it on your behalf.`,
  },
  contact: {
    title: 'Contact CLA Manager',
    hint: (project) => `Send a message to the CLA manager(s) for ${project}.`,
  },
};

/**
 * Shared Contact CLA Manager modal (#1372 / #1574). Three copy modes; approval and removal
 * POST to the producer; contact Send is a no-op (the producer email always claims an
 * Approved-List change).
 */
@Component({
  selector: 'lfx-contact-cla-manager',
  imports: [ReactiveFormsModule, ButtonComponent, MessageComponent, TextareaComponent],
  templateUrl: './contact-cla-manager.component.html',
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
  protected readonly managers = signal<ClaManager[]>([]);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());

  protected readonly form = new FormGroup({
    message: new FormControl('', { nonNullable: true }),
  });

  protected readonly hasManagers = computed(() => this.managers().length > 0);
  protected readonly canSend = computed(() => this.selected().size > 0 && !this.sending() && !this.loading() && this.hasManagers());

  public constructor() {
    this.myClasService
      .getClaManagers(this.data.signatureId)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (list) => {
          this.managers.set(list.managers);
          this.selected.set(new Set(list.managers.map((manager) => manager.lfUsername)));
          this.loading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.loading.set(false);
        },
      });
  }

  protected managerLabel(manager: ClaManager): string {
    return manager.name || manager.lfUsername;
  }

  protected isSelected(lfUsername: string): boolean {
    return this.selected().has(lfUsername);
  }

  protected toggleManager(lfUsername: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.selected());
    if (checked) next.add(lfUsername);
    else next.delete(lfUsername);
    this.selected.set(next);
  }

  protected onCancel(): void {
    this.ref.close(null);
  }

  protected onSend(): void {
    if (!this.canSend()) return;

    // Contact is a product-complete no-op: the producer has no contact requestType, and posting
    // approval/removal would tell the manager to change the Approved List.
    if (this.data.mode === 'contact') {
      this.ref.close(null);
      return;
    }

    this.sending.set(true);
    this.sendError.set(false);

    const message = this.form.controls.message.value.trim();
    this.myClasService
      .createClaManagerRequest(this.data.signatureId, {
        requestType: this.data.mode,
        recipients: [...this.selected()],
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
