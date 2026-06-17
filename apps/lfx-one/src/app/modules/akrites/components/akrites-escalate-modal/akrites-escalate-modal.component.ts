// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';

import { AKRITES_ESCALATION_PATHS } from '@lfx-one/shared/constants';
import { AkritesEscalateRequest, AkritesEscalationPath } from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';

@Component({
  selector: 'lfx-akrites-escalate-modal',
  imports: [DialogModule, ReactiveFormsModule, ButtonComponent, TextareaComponent],
  templateUrl: './akrites-escalate-modal.component.html',
})
export class AkritesEscalateModalComponent {
  private readonly formBuilder = inject(FormBuilder);

  public readonly visible = model(false);
  public readonly packageName = input<string | null>(null);
  public readonly loading = input(false);

  public readonly confirm = output<AkritesEscalateRequest>();

  protected readonly selectedPath = signal<AkritesEscalationPath | null>(null);
  protected readonly escalationPaths = AKRITES_ESCALATION_PATHS;

  protected readonly form = this.formBuilder.nonNullable.group({
    notes: '',
  });

  protected selectPath(path: AkritesEscalationPath): void {
    this.selectedPath.set(path);
  }

  protected onCancel(): void {
    this.visible.set(false);
  }

  protected onConfirm(): void {
    const path = this.selectedPath();
    if (!path) return;
    const notes = this.form.getRawValue().notes.trim();
    this.confirm.emit({ resolutionPath: path, notes: notes || undefined });
  }

  protected onShow(): void {
    // Reset the form each time the dialog opens so stale selections don't carry over.
    this.selectedPath.set(null);
    this.form.reset();
  }
}
