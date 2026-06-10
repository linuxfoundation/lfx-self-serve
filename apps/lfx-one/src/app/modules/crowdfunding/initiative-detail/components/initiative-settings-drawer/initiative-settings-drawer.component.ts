// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, inject, model, input, output, signal, computed, viewChild, PLATFORM_ID } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  ALLOWED_LOGO_MIME_TYPES,
  AllowedLogoMimeType,
  CROWDFUNDING_TOPIC_OPTIONS,
  DEFAULT_FUND_DISTRIBUTION,
  MAX_LOGO_SIZE_BYTES,
} from '@lfx-one/shared/constants';
import { Beneficiary, FundDistributionItem, InitiativeDetail, TabOption, UpdateInitiativeInput } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';

function formatCompactAmount(amount: number): string {
  if (amount === 0) return '$0';
  if (amount >= 1_000_000) {
    const val = amount / 1_000_000;
    return `$${val % 1 === 0 ? val : val.toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    const val = amount / 1_000;
    return `$${val % 1 === 0 ? val : val.toFixed(1)}K`;
  }
  return `$${Math.round(amount)}`;
}

@Component({
  selector: 'lfx-initiative-settings-drawer',
  imports: [DrawerModule, InputTextComponent, TextareaComponent, ButtonComponent, ReactiveFormsModule, FormsModule, MultiSelectComponent, ToggleSwitchModule],
  templateUrl: './initiative-settings-drawer.component.html',
  styleUrl: './initiative-settings-drawer.component.scss',
})
export class InitiativeSettingsDrawerComponent {
  // ─── Private injections ──────────────────────────────────────────────────
  private readonly crowdfundingService = inject(CrowdfundingService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

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
  protected readonly logoUrl = signal<string>('');
  protected readonly uploadingLogo = signal(false);
  protected readonly logoUploadError = signal<string | null>(null);
  protected readonly distributionItems = signal<FundDistributionItem[]>(DEFAULT_FUND_DISTRIBUTION.map((i) => ({ ...i })));
  protected readonly beneficiaryGroups = signal<FormGroup[]>([]);

  protected readonly hasEnabledCategories = computed(() => this.distributionItems().some((i) => i.enabled));
  protected readonly totalAllocated = computed(() =>
    this.distributionItems()
      .filter((i) => i.enabled)
      .reduce((sum, i) => sum + i.percentage, 0)
  );
  protected readonly remaining = computed(() => 100 - this.totalAllocated());
  protected readonly distributionAmounts = computed(() => {
    const goalValue = this.formValue().goal as number | null;
    return this.distributionItems().map((item) => {
      const amount = goalValue != null ? (item.percentage / 100) * goalValue : 0;
      return formatCompactAmount(amount);
    });
  });

  private readonly logoFileInput = viewChild<ElementRef<HTMLInputElement>>('logoFileInput');

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
          ? init.industry
              .split(',')
              .map((v) => v.trim())
              .filter((v) => CROWDFUNDING_TOPIC_OPTIONS.some((o) => o.value === v))
          : [];
        this.form.patchValue({
          name: init.name,
          description: init.description,
          topics: existingTopics,
          websiteUrl: init.websiteUrl ?? '',
          goal: init.fundingStatus?.goalsTotalCents != null ? init.fundingStatus.goalsTotalCents / 100 : null,
        });
        this.logoUrl.set(init.logoUrl ?? '');
        this.logoUploadError.set(null);
        const goals = init.fundingGoals ?? [];
        const totalCents = init.fundingStatus?.goalsTotalCents ?? 0;
        this.distributionItems.set(
          DEFAULT_FUND_DISTRIBUTION.map((item) => {
            const match = goals.find((g) => g.name === item.label);
            if (match && totalCents > 0) {
              return { ...item, enabled: true, percentage: Math.round((match.goalCents / totalCents) * 100) };
            }
            return { ...item };
          })
        );
        this.beneficiaryGroups.set((init.beneficiaries ?? []).map((b) => this.makeBeneficiaryGroup(b)));
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
        logoUrl: this.logoUrl(),
        websiteUrl: websiteUrl || undefined,
      };

      if (goal != null) {
        const goalCents = Math.round(goal * 100);
        const enabledItems = this.distributionItems().filter((i) => i.enabled);
        if (enabledItems.length > 0) {
          input.goals = enabledItems.map((i) => ({ name: i.label, amountCents: Math.round((i.percentage / 100) * goalCents) }));
        } else {
          input.goals = [{ name: 'Annual Funding Goal', amountCents: goalCents }];
        }
      }

      input.beneficiaries = this.beneficiaryGroups().map((g) => ({
        name: (g.value.name as string) || undefined,
        email: (g.value.email as string) || undefined,
      }));

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

  protected triggerLogoUpload(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.logoFileInput()?.nativeElement.click();
    }
  }

  protected removeLogo(): void {
    this.logoUrl.set('');
    this.logoUploadError.set(null);
    const input = this.logoFileInput()?.nativeElement;
    if (input) input.value = '';
  }

  protected async onLogoFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    this.logoUploadError.set(null);

    if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type as AllowedLogoMimeType)) {
      this.logoUploadError.set('Unsupported file type. Use PNG, JPEG, GIF, or WebP.');
      return;
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      this.logoUploadError.set(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 2 MB.`);
      return;
    }

    this.uploadingLogo.set(true);
    try {
      const presigned = await firstValueFrom(this.crowdfundingService.getPresignedUrl(file.type), { defaultValue: null });
      if (!presigned) return;

      const s3Response = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: presigned.requiredHeaders,
        body: file,
      });

      if (!s3Response.ok) {
        this.logoUploadError.set('Upload failed. Please try again.');
        return;
      }

      this.logoUrl.set(presigned.destinationUrl);
    } catch {
      this.logoUploadError.set('Logo upload failed. Please try again.');
    } finally {
      this.uploadingLogo.set(false);
    }
  }

  protected toggleCategory(index: number, enabled: boolean): void {
    this.distributionItems.update((items) => items.map((item, i) => (i === index ? { ...item, enabled, percentage: 0 } : item)));
  }

  protected updatePercentage(index: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const pct = parseInt(raw, 10);
    this.distributionItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, percentage: isNaN(pct) ? 0 : Math.min(Math.max(0, pct), 100) } : item))
    );
  }

  protected addBeneficiary(): void {
    this.beneficiaryGroups.update((groups) => [...groups, this.makeBeneficiaryGroup()]);
  }

  protected removeBeneficiary(index: number): void {
    this.beneficiaryGroups.update((groups) => groups.filter((_, i) => i !== index));
  }

  private makeBeneficiaryGroup(b?: Beneficiary): FormGroup {
    return new FormGroup({
      name: new FormControl(b?.name ?? ''),
      email: new FormControl(b?.email ?? '', Validators.email),
    });
  }
}
