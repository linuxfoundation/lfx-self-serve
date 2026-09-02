// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { GERRIT_CONTRACT_TYPE_CORPORATE, GERRIT_CONTRACT_TYPE_INDIVIDUAL, SIGN_CONTRACT_TYPE_COPY } from '@lfx-one/shared/constants';
import type { GerritContractType, SignContractTypeSelectResult } from '@lfx-one/shared/interfaces';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { SelectableCardComponent } from '@components/selectable-card/selectable-card.component';

/**
 * Which contract type a Gerrit contributor will sign under (#2066).
 *
 * Shown after the contributor confirms their Gerrit identity and before navigation to the
 * Console. Copy mirrors the Contributor Console decision screen; nothing is preselected.
 *
 * Both cards are always rendered, and the dialog takes no enablement data. A group with only one
 * type enabled never reaches here — the caller resolves that type and hands off without asking —
 * so a flag on this dialog could only ever say "both", and a dialog that could render one card is
 * one that could render none.
 */
@Component({
  selector: 'lfx-sign-contract-type-select',
  imports: [ReactiveFormsModule, ButtonComponent, SelectableCardComponent],
  templateUrl: './sign-contract-type-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignContractTypeSelectComponent {
  private readonly ref = inject(DynamicDialogRef);

  protected readonly copy = SIGN_CONTRACT_TYPE_COPY;
  protected readonly individualValue = GERRIT_CONTRACT_TYPE_INDIVIDUAL;
  protected readonly corporateValue = GERRIT_CONTRACT_TYPE_CORPORATE;

  protected readonly selectForm = new FormGroup({
    contractType: new FormControl<GerritContractType | null>(null),
  });

  protected readonly selectedType = signal<GerritContractType | null>(null);

  public constructor() {
    this.selectForm.controls.contractType.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.selectedType.set(value));
  }

  protected onContinue(): void {
    const contractType = this.selectedType();
    if (!contractType) return;

    this.ref.close({ contractType } satisfies SignContractTypeSelectResult);
  }

  protected onCancel(): void {
    this.ref.close(null);
  }
}
