// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { GERRIT_CONTRACT_TYPE_CORPORATE, GERRIT_CONTRACT_TYPE_INDIVIDUAL, SIGN_CONTRACT_TYPE_COPY } from '@lfx-one/shared/constants';
import type { GerritContractType, SignContractTypeDialogData, SignContractTypeSelectResult } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { SelectableCardComponent } from '@components/selectable-card/selectable-card.component';

/**
 * Which contract type a Gerrit contributor will sign under (#2066).
 *
 * Shown after the contributor confirms their Gerrit identity and before navigation to the
 * Console, only when both ICLA and CCLA are enabled for the selected group. Copy mirrors the
 * Contributor Console decision screen; nothing is preselected.
 */
@Component({
  selector: 'lfx-sign-contract-type-select',
  imports: [ReactiveFormsModule, ButtonComponent, SelectableCardComponent],
  templateUrl: './sign-contract-type-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignContractTypeSelectComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject<DynamicDialogConfig<SignContractTypeDialogData>>(DynamicDialogConfig);

  protected readonly copy = SIGN_CONTRACT_TYPE_COPY;
  protected readonly individualValue = GERRIT_CONTRACT_TYPE_INDIVIDUAL;
  protected readonly corporateValue = GERRIT_CONTRACT_TYPE_CORPORATE;

  protected readonly iclaEnabled = computed(() => this.config.data?.iclaEnabled === true);
  protected readonly cclaEnabled = computed(() => this.config.data?.cclaEnabled === true);

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
