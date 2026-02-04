// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { ConnectedIdentity, ContributionCounts, VerificationChoice, VerificationChoices } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-verify-identities',
  imports: [ButtonComponent, TagComponent],
  templateUrl: './verify-identities.component.html',
  styleUrl: './verify-identities.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VerifyIdentitiesComponent {
  // Private injections
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig);

  // Data from dialog config
  public readonly identities = signal<ConnectedIdentity[]>([]);
  public readonly contributionCounts = signal<ContributionCounts>({});

  // Verification choices state
  public readonly verificationChoices = signal<VerificationChoices>({});

  // Computed signals
  public readonly canSubmit = computed(() => {
    const choices = this.verificationChoices();
    const identities = this.identities();

    // Can submit if at least one identity has a choice
    return identities.some((identity) => choices[identity.id] !== undefined);
  });

  public constructor() {
    // Init from dialog config data
    const identities = (this.dialogConfig.data?.identities as ConnectedIdentity[]) ?? [];
    const contributionCounts = (this.dialogConfig.data?.contributionCounts as ContributionCounts) ?? {};

    // Filter to only unverified identities
    this.identities.set(identities.filter((i) => !i.verified));
    this.contributionCounts.set(contributionCounts);
  }

  // Public methods
  public getChoice(identityId: string): VerificationChoice {
    return this.verificationChoices()[identityId];
  }

  public getContributionCount(identityId: string): number {
    return this.contributionCounts()[identityId] ?? 0;
  }

  public requiresAuth(identity: ConnectedIdentity): boolean {
    return identity.provider === 'github' || identity.provider === 'linkedin';
  }

  public isEmail(identity: ConnectedIdentity): boolean {
    return identity.provider === 'email';
  }

  public getProviderLabel(identity: ConnectedIdentity): string {
    const labels: Record<string, string> = {
      github: 'GitHub',
      gitlab: 'GitLab',
      linkedin: 'LinkedIn',
      google: 'Google',
      email: 'Email',
    };
    return labels[identity.provider] || identity.provider;
  }

  public handleContinueWithProvider(identityId: string): void {
    // TODO: Initiate OAuth flow for the provider
    // For now, mark as confirmed
    this.handleChoice(identityId, 'yes');
  }

  public handleGetVerificationCode(identityId: string): void {
    // TODO: Send verification email to the user
    // For now, mark as confirmed
    this.handleChoice(identityId, 'yes');
  }

  public handleChoice(identityId: string, choice: VerificationChoice): void {
    this.verificationChoices.update((current) => ({
      ...current,
      [identityId]: choice,
    }));
  }

  public cancel(): void {
    this.dialogRef.close(null);
  }

  public submit(): void {
    const choices = this.verificationChoices();
    const confirmedIds = Object.entries(choices)
      .filter(([, choice]) => choice === 'yes')
      .map(([id]) => id);

    this.dialogRef.close({
      confirmedIds,
      choices,
    });
  }
}
