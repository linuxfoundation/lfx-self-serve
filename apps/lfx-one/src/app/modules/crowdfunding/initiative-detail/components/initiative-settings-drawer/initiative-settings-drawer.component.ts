// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, model, input, signal, computed } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { CrowdfundingInitiativeDetail, TabOption } from '@lfx-one/shared/interfaces';
import { filter } from 'rxjs';
import { InputTextModule } from 'primeng/inputtext';
import { DrawerModule } from 'primeng/drawer';

@Component({
  selector: 'lfx-initiative-settings-drawer',
  imports: [DrawerModule, InputTextComponent, TextareaComponent, ButtonComponent, ReactiveFormsModule, InputTextModule, LowerCasePipe],
  templateUrl: './initiative-settings-drawer.component.html',
  styleUrl: './initiative-settings-drawer.component.scss',
})
export class InitiativeSettingsDrawerComponent {
  public readonly initiative = input.required<CrowdfundingInitiativeDetail>();
  public readonly visible = model(false);

  protected readonly activeSettingsTab = signal<string>('details');

  protected readonly settingsTabs: TabOption<string>[] = [
    { value: 'details', label: 'Initiative details' },
    { value: 'branding', label: 'Branding' },
    { value: 'beneficiaries', label: 'Beneficiaries' },
    { value: 'funding', label: 'Funding' },
  ];

  protected readonly form: FormGroup = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    description: new FormControl('', [Validators.required, Validators.maxLength(500)]),
    websiteUrl: new FormControl(''),
    goal: new FormControl<number | null>(null),
  });

  protected readonly tags = signal<string[]>([]);
  protected readonly newTagValue = signal<string>('');
  protected readonly beneficiaryGroups = signal<FormGroup[]>([]);

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected readonly nameLength = computed(() => this.formValue().name?.length ?? 0);
  protected readonly descriptionLength = computed(() => this.formValue().description?.length ?? 0);

  public constructor() {
    toObservable(this.visible)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe(() => {
        const init = this.initiative();
        this.form.patchValue({
          name: init.name,
          description: init.description,
          websiteUrl: init.publicUrl ?? '',
          goal: init.goal,
        });
        this.tags.set([...init.tags]);
        this.beneficiaryGroups.set([]);
        this.activeSettingsTab.set('details');
      });
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  protected addTag(): void {
    const tag = this.newTagValue().trim();
    if (tag && !this.tags().includes(tag)) {
      this.tags.update((tags) => [...tags, tag]);
    }
    this.newTagValue.set('');
  }

  protected removeTag(tag: string): void {
    this.tags.update((tags) => tags.filter((t) => t !== tag));
  }

  protected addBeneficiary(): void {
    const group = new FormGroup({
      name: new FormControl(''),
      email: new FormControl('', Validators.email),
    });
    this.beneficiaryGroups.update((groups) => [...groups, group]);
  }

  protected removeBeneficiary(index: number): void {
    this.beneficiaryGroups.update((groups) => groups.filter((_, i) => i !== index));
  }
}
