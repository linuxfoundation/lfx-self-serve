// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, inject, model, input, output, signal, computed } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { CROWDFUNDING_TOPIC_OPTIONS } from '@lfx-one/shared/constants';
import { InitiativeDetail, TabOption, UpdateInitiativeInput } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';

@Component({
  selector: 'lfx-initiative-settings-drawer',
  imports: [DrawerModule, InputTextComponent, TextareaComponent, ButtonComponent, ReactiveFormsModule, MultiSelectComponent, LowerCasePipe],
  templateUrl: './initiative-settings-drawer.component.html',
  styleUrl: './initiative-settings-drawer.component.scss',
})
export class InitiativeSettingsDrawerComponent {
  // ─── Private injections ──────────────────────────────────────────────────
  private readonly crowdfundingService = inject(CrowdfundingService);
  private readonly messageService = inject(MessageService);

  public readonly initiative = input.required<InitiativeDetail>();
  public readonly visible = model(false);
  public readonly initiativeSaved = output<InitiativeDetail>();

  protected readonly topicOptions = CROWDFUNDING_TOPIC_OPTIONS;

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
    topics: new FormControl<string[]>([], Validators.required),
    websiteUrl: new FormControl(''),
    goal: new FormControl<number | null>(null),
  });

  protected readonly saving = signal(false);
  protected readonly beneficiaryGroups = signal<FormGroup[]>([]);

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected readonly nameLength = computed(() => this.formValue().name?.length ?? 0);
  protected readonly descriptionLength = computed(() => this.formValue().description?.length ?? 0);
  protected readonly initiativeInitial = computed(() => this.initiative().name.charAt(0));

  public constructor() {
    toObservable(this.visible)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe(() => {
        const init = this.initiative();
        const existingTopics = init.industry
          ? init.industry.split(',').filter((v) => CROWDFUNDING_TOPIC_OPTIONS.some((o) => o.value === v))
          : [];
        this.form.patchValue({
          name: init.name,
          description: init.description,
          topics: existingTopics,
          websiteUrl: init.websiteUrl ?? '',
          goal: init.fundingStatus?.goalsTotalCents != null ? init.fundingStatus.goalsTotalCents / 100 : null,
        });
        this.beneficiaryGroups.set([]);
        this.activeSettingsTab.set('details');
      });
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  protected async onSave(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);

    try {
      const { name, description, topics, websiteUrl, goal } = this.form.value as {
        name: string;
        description: string;
        topics: string[];
        websiteUrl: string;
        goal: number | null;
      };

      const input: UpdateInitiativeInput = {
        name,
        description,
        industry: topics.join(','),
        websiteUrl: websiteUrl || undefined,
      };

      if (goal != null) {
        input.goals = [{ name: 'Annual Funding Goal', amountCents: Math.round(goal * 100) }];
      }

      const groups = this.beneficiaryGroups();
      if (groups.length > 0) {
        input.beneficiaries = groups.map((g) => ({
          name: (g.value.name as string) || undefined,
          email: (g.value.email as string) || undefined,
        }));
      }

      const updated = await firstValueFrom(this.crowdfundingService.updateInitiative(this.initiative().id, input), { defaultValue: null });

      if (!updated) return; // CF_UNAUTHENTICATED redirect in progress

      this.messageService.add({ severity: 'success', summary: 'Saved', detail: 'Initiative updated successfully.' });
      this.initiativeSaved.emit(updated);
      this.visible.set(false);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to save initiative. Please try again.' });
    } finally {
      this.saving.set(false);
    }
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
