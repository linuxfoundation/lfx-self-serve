// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { filter } from 'rxjs';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputNumberComponent } from '@components/input-number/input-number.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { DEFAULT_SPONSORSHIP_TIERS, SPONSORSHIP_DONATION_MODE_OPTIONS, SPONSORSHIP_TIER_LABELS } from '@lfx-one/shared/constants';
import { InitiativeDetail, SponsorshipDonationMode, SponsorshipTier, UpdateInitiativeInput } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-settings-sponsorship-tiers-tab',
  imports: [ReactiveFormsModule, InputTextModule, ButtonComponent, CheckboxComponent, InputNumberComponent, SelectButtonComponent],
  templateUrl: './settings-sponsorship-tiers-tab.component.html',
})
export class SettingsSponsorshipTiersTabComponent {
  public readonly visible = input.required<boolean>();
  public readonly initiative = input.required<InitiativeDetail>();

  protected readonly tierLabels = SPONSORSHIP_TIER_LABELS;
  protected readonly tierNames = DEFAULT_SPONSORSHIP_TIERS.map((t) => t.name);
  protected readonly donationModeOptions = SPONSORSHIP_DONATION_MODE_OPTIONS;

  public readonly form: FormGroup = new FormGroup({
    donationMode: new FormControl<SponsorshipDonationMode>('tiers', { nonNullable: true }),
    tiers: new FormArray<FormGroup>(DEFAULT_SPONSORSHIP_TIERS.map((t) => this.makeTierGroup(t))),
  });

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  protected readonly donationMode = computed(() => this.formValue().donationMode as SponsorshipDonationMode);

  protected readonly tiersData: Signal<{ group: FormGroup; benefits: FormArray<FormControl<string>>; enabled: boolean }[]> = computed(() => {
    this.formValue();
    return (this.form.get('tiers') as FormArray<FormGroup>).controls.map((group) => ({
      group,
      benefits: group.get('benefits') as FormArray<FormControl<string>>,
      enabled: group.get('enabled')?.value as boolean,
    }));
  });

  public constructor() {
    toObservable(this.visible)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe(() => {
        const init = this.initiative();
        this.form.patchValue({ donationMode: init.donationMode ?? 'tiers' }, { emitEvent: false });

        const tiersArray = this.form.get('tiers') as FormArray<FormGroup>;
        DEFAULT_SPONSORSHIP_TIERS.forEach((defaultTier, i) => {
          const saved = init.sponsorshipTiers?.find((t) => t.name === defaultTier.name);
          tiersArray
            .at(i)
            .patchValue(
              { enabled: saved?.enabled ?? defaultTier.enabled, goal: saved?.goalCents != null ? saved.goalCents / 100 : null },
              { emitEvent: false }
            );

          const benefits = tiersArray.at(i).get('benefits') as FormArray<FormControl<string>>;
          benefits.clear({ emitEvent: false });
          (saved?.benefits.length ? saved.benefits : ['']).forEach((b) => benefits.push(new FormControl(b, { nonNullable: true }), { emitEvent: false }));
        });

        // Patches above are silent (emitEvent: false); force one emission so the valueChanges-driven signal picks up the loaded data.
        this.form.updateValueAndValidity({ emitEvent: true });
      });
  }

  // By design, both donation modes ship the full tier set (including disabled/hidden tiers) — the backend discards tiers when mode is 'open'.
  public getValue(): Pick<UpdateInitiativeInput, 'donationMode' | 'sponsorshipTiers'> {
    const value = this.form.getRawValue();
    return {
      donationMode: value.donationMode,
      sponsorshipTiers: value.tiers.map(
        (t: { enabled: boolean; goal: number | null; benefits: string[] }, i: number): SponsorshipTier => ({
          name: DEFAULT_SPONSORSHIP_TIERS[i].name,
          enabled: t.enabled,
          goalCents: t.goal != null ? Math.round(t.goal * 100) : undefined,
          benefits: t.benefits.map((b) => b.trim()).filter(Boolean),
        })
      ),
    };
  }

  protected addBenefit(tierIndex: number): void {
    ((this.form.get('tiers') as FormArray<FormGroup>).at(tierIndex).get('benefits') as FormArray<FormControl<string>>).push(
      new FormControl('', { nonNullable: true })
    );
  }

  protected removeBenefit(tierIndex: number, benefitIndex: number): void {
    const benefits = (this.form.get('tiers') as FormArray<FormGroup>).at(tierIndex).get('benefits') as FormArray<FormControl<string>>;
    if (benefits.length > 1) {
      benefits.removeAt(benefitIndex);
    }
  }

  private makeTierGroup(tier: SponsorshipTier): FormGroup {
    return new FormGroup({
      enabled: new FormControl<boolean>(tier.enabled, { nonNullable: true }),
      goal: new FormControl<number | null>(null, [Validators.min(0)]),
      benefits: new FormArray<FormControl<string>>([new FormControl('', { nonNullable: true })]),
    });
  }
}
