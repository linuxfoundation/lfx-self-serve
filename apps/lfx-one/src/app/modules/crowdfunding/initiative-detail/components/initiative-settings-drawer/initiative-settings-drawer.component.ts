// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, output, signal, Signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { ButtonComponent } from '@components/button/button.component';
import { ANNOUNCEMENTS_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { InitiativeDetail, TabOption, UpdateInitiativeInput } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { SettingsAnnouncementsTabComponent } from './components/settings-announcements-tab/settings-announcements-tab.component';
import { SettingsBeneficiariesTabComponent } from './components/settings-beneficiaries-tab/settings-beneficiaries-tab.component';
import { SettingsBrandingTabComponent } from './components/settings-branding-tab/settings-branding-tab.component';
import { SettingsDetailsTabComponent } from './components/settings-details-tab/settings-details-tab.component';
import { SettingsFundingTabComponent } from './components/settings-funding-tab/settings-funding-tab.component';

@Component({
  selector: 'lfx-initiative-settings-drawer',
  imports: [
    DrawerModule,
    ButtonComponent,
    SettingsAnnouncementsTabComponent,
    SettingsDetailsTabComponent,
    SettingsBrandingTabComponent,
    SettingsBeneficiariesTabComponent,
    SettingsFundingTabComponent,
  ],
  templateUrl: './initiative-settings-drawer.component.html',
  styleUrl: './initiative-settings-drawer.component.scss',
})
export class InitiativeSettingsDrawerComponent {
  private readonly crowdfundingService = inject(CrowdfundingService);
  private readonly messageService = inject(MessageService);
  private readonly featureFlagService = inject(FeatureFlagService);

  public readonly initiative = input.required<InitiativeDetail>();
  public readonly visible = model(false);
  public readonly initiativeSaved = output<InitiativeDetail>();

  protected readonly activeSettingsTab = signal<string>('details');
  protected readonly saving = signal(false);

  protected readonly announcementsEnabled = this.featureFlagService.getBooleanFlag(ANNOUNCEMENTS_ENABLED_FLAG, false);

  protected readonly settingsTabs: Signal<TabOption<string>[]> = computed(() => [
    { value: 'details', label: 'Initiative details' },
    { value: 'branding', label: 'Branding' },
    { value: 'beneficiaries', label: 'Beneficiaries' },
    { value: 'funding', label: 'Funding' },
    ...(this.announcementsEnabled() ? [{ value: 'announcements', label: 'Announcements' }] : []),
  ]);

  private readonly detailsTab = viewChild.required(SettingsDetailsTabComponent);
  private readonly brandingTab = viewChild.required(SettingsBrandingTabComponent);
  private readonly beneficiariesTab = viewChild.required(SettingsBeneficiariesTabComponent);
  private readonly fundingTab = viewChild.required(SettingsFundingTabComponent);

  public constructor() {
    toObservable(this.visible)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe(() => this.activeSettingsTab.set('details'));
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  protected async onSave(): Promise<void> {
    const details = this.detailsTab();
    const branding = this.brandingTab();
    const beneficiaries = this.beneficiariesTab();
    const funding = this.fundingTab();

    const invalidBeneficiary = beneficiaries.beneficiaryGroups().some((g) => g.invalid);
    if (details.form.invalid || funding.form.invalid || invalidBeneficiary) {
      details.form.markAllAsTouched();
      funding.form.markAllAsTouched();
      beneficiaries.beneficiaryGroups().forEach((g) => g.markAllAsTouched());
      return;
    }

    this.saving.set(true);

    try {
      const { name, description, topics, websiteUrl } = details.form.value as {
        name: string;
        description: string;
        topics: string[];
        websiteUrl: string;
      };
      const { goal } = funding.form.value as { goal: number | null };

      const input: UpdateInitiativeInput = {
        name,
        description,
        // Only send industry when the user has explicitly changed topics — sending an
        // empty string clears the backend value, and existing slugs that don't map to
        // SS options would be lost if we always overwrite.
        ...(details.form.controls['topics'].dirty ? { industry: topics.join(',') } : {}),
        logoUrl: branding.logoUrl(),
        websiteUrl: websiteUrl || undefined,
      };

      if (goal != null) {
        const goalCents = Math.round(goal * 100);
        const enabledItems = funding.distributionItems().filter((i) => i.enabled);
        if (enabledItems.length > 0) {
          if (funding.totalAllocated() > 100) {
            this.messageService.add({
              severity: 'error',
              summary: 'Invalid distribution',
              detail: 'Funding distribution exceeds 100%. Adjust the percentages before saving.',
            });
            return;
          }
          const nonZeroItems = enabledItems.filter((i) => i.percentage > 0);
          if (nonZeroItems.length === 0) {
            this.messageService.add({
              severity: 'error',
              summary: 'Invalid distribution',
              detail: 'At least one enabled category must have a percentage greater than 0.',
            });
            return;
          }
          input.goals = nonZeroItems.map((i) => ({ name: i.label, amountCents: Math.round((i.percentage / 100) * goalCents) }));
        } else {
          input.goals = [{ name: 'Annual Funding Goal', amountCents: goalCents }];
        }
      }

      input.beneficiaries = beneficiaries
        .beneficiaryGroups()
        .map((g) => ({
          name: (g.value.name as string) || undefined,
          email: (g.value.email as string) || undefined,
        }))
        .filter((b) => b.name || b.email);

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
}
