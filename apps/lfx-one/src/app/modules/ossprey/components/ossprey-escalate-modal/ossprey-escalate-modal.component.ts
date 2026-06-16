// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';

import { OSSPREY_ESCALATION_PATHS } from '@lfx-one/shared/constants';
import { OsspreyEscalateRequest, OsspreyEscalationPath } from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';

@Component({
  selector: 'lfx-ossprey-escalate-modal',
  imports: [DialogModule, ReactiveFormsModule, ButtonComponent, TextareaComponent],
  templateUrl: './ossprey-escalate-modal.component.html',
})
export class OsspreyEscalateModalComponent {
  private readonly formBuilder = inject(FormBuilder);

  public readonly visible = model(false);
  public readonly packageName = input<string | null>(null);
  public readonly loading = input(false);

  public readonly confirm = output<OsspreyEscalateRequest>();

  protected readonly selectedPath = signal<OsspreyEscalationPath | null>(null);
  protected readonly escalationPaths = OSSPREY_ESCALATION_PATHS;

  protected readonly form = this.formBuilder.nonNullable.group({
    notes: '',
  });

  protected selectPath(path: OsspreyEscalationPath): void {
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
