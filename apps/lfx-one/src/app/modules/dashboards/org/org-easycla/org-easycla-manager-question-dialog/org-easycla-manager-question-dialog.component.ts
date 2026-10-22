// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, HostListener, inject, signal } from '@angular/core';
import { CCLA_SIGN_COPY, ORG_CLA_MANAGER_QUESTION_COPY } from '@lfx-one/shared/constants';
import type { OrgClaManagerQuestionDialogData, OrgClaManagerQuestionResult } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';

export function orgClaManagerQuestionDialogConfig(data: OrgClaManagerQuestionDialogData): DynamicDialogConfig<OrgClaManagerQuestionDialogData> {
  return {
    // No PrimeNG header — the heading changes with the state, so the dialog body renders it.
    showHeader: false,
    modal: true,
    closable: false,
    closeOnEscape: false,
    dismissableMask: false,
    width: '32rem',
    style: { maxWidth: '90vw' },
    // Uniform padding all around — PrimeNG's default content padding zeroes the top
    // (normally supplied by the header we removed), so set it explicitly here.
    contentStyle: { padding: '1.5rem' },
    data,
  };
}

/**
 * Corporate Console's "Are you authorized to be a CLA Manager?" before Start.
 *
 * It cannot be dismissed while configuring: the role write still lands upstream, so a dismissal
 * would only hide it.
 */
@Component({
  selector: 'lfx-org-easycla-manager-question-dialog',
  imports: [ButtonComponent],
  templateUrl: './org-easycla-manager-question-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaManagerQuestionDialogComponent {
  static readonly headingId = 'org-easycla-manager-question-heading';

  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject<DynamicDialogConfig<OrgClaManagerQuestionDialogData>>(DynamicDialogConfig);

  protected readonly copy = ORG_CLA_MANAGER_QUESTION_COPY;
  protected readonly configuringCopy = CCLA_SIGN_COPY.preparing;
  protected readonly headingId = OrgEasyclaManagerQuestionDialogComponent.headingId;

  protected readonly state = signal<'asking' | 'configuring'>('asking');

  protected readonly heading = computed(() => (this.state() === 'configuring' ? this.configuringCopy.header : this.copy.question));

  protected onYes(): void {
    if (this.state() !== 'asking') return;
    this.state.set('configuring');
    this.config.data?.onYes();
  }

  protected onNo(): void {
    if (this.state() !== 'asking') return;
    this.dialogRef.close('no' satisfies OrgClaManagerQuestionResult);
  }

  protected onCancel(): void {
    if (this.state() !== 'asking') return;
    this.dialogRef.close();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.onCancel();
  }
}
