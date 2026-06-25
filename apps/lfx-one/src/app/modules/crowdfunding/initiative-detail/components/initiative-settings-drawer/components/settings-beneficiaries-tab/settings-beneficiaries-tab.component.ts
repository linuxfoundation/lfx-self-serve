// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { filter } from 'rxjs';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { Beneficiary, InitiativeDetail } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-settings-beneficiaries-tab',
  imports: [ReactiveFormsModule, InputTextComponent, ButtonComponent],
  templateUrl: './settings-beneficiaries-tab.component.html',
})
export class SettingsBeneficiariesTabComponent {
  public readonly visible = input.required<boolean>();
  public readonly initiative = input.required<InitiativeDetail>();

  public readonly beneficiaryGroups = signal<FormGroup[]>([]);

  public constructor() {
    toObservable(this.visible)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe(() => {
        this.beneficiaryGroups.set((this.initiative().beneficiaries ?? []).map((b) => this.makeBeneficiaryGroup(b)));
      });
  }

  protected addBeneficiary(): void {
    this.beneficiaryGroups.update((groups) => [...groups, this.makeBeneficiaryGroup()]);
  }

  protected removeBeneficiary(index: number): void {
    this.beneficiaryGroups.update((groups) => groups.filter((_, i) => i !== index));
  }

  private makeBeneficiaryGroup(b?: Beneficiary): FormGroup {
    // `id` omitted intentionally — CF PATCH is full delete-and-replace, so name + email is the full contract.
    return new FormGroup({
      name: new FormControl(b?.name ?? ''),
      email: new FormControl(b?.email ?? '', Validators.email),
    });
  }
}
