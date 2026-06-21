// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, Signal, computed, inject, input, model, output, signal } from '@angular/core';
import { take } from 'rxjs';
import { DialogModule } from 'primeng/dialog';

import { AkritesAssignStewardRequest, AkritesRoleOption, AkritesSearchStewardResult, AkritesStewardRole } from '@lfx-one/shared/interfaces';
import { AkritesService } from '@app/shared/services/akrites.service';
import { ButtonComponent } from '@components/button/button.component';

@Component({
  selector: 'lfx-akrites-assign-steward-modal',
  imports: [DialogModule, ButtonComponent],
  templateUrl: './akrites-assign-steward-modal.component.html',
})
export class AkritesAssignStewardModalComponent {
  private readonly akritesService = inject(AkritesService);

  public readonly visible = model(false);
  public readonly packageName = input<string | null>(null);
  public readonly loading = input(false);

  public readonly confirm = output<AkritesAssignStewardRequest>();

  protected readonly selectedRole = signal<AkritesStewardRole>('lead');
  protected readonly moveToAssessing = signal(false);
  protected readonly searchQuery = signal('');
  protected readonly selectedSteward = signal<AkritesSearchStewardResult | null>(null);
  protected readonly stewards = signal<AkritesSearchStewardResult[]>([]);
  protected readonly loadingStewards = signal(false);

  protected readonly roleOptions: AkritesRoleOption[] = [
    { value: 'lead', label: 'Lead steward', description: 'Primary owner — drives the security assessment and remediation.' },
    { value: 'co_steward', label: 'Co-steward', description: 'Supporting role — assists the lead but shares responsibility.' },
  ];

  protected readonly filteredStewards: Signal<AkritesSearchStewardResult[]> = this.initFilteredStewards();

  protected selectRole(role: AkritesStewardRole): void {
    this.selectedRole.set(role);
  }

  protected selectSteward(steward: AkritesSearchStewardResult): void {
    const current = this.selectedSteward();
    this.selectedSteward.set(current?.userId === steward.userId ? null : steward);
  }

  protected onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected getInitials(displayName: string): string {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return displayName.slice(0, 2).toUpperCase();
  }

  protected onCancel(): void {
    this.visible.set(false);
  }

  protected onConfirm(): void {
    const steward = this.selectedSteward();
    if (!steward) return;
    this.confirm.emit({
      userId: steward.userId,
      username: steward.username,
      displayName: steward.displayName,
      role: this.selectedRole(),
      moveToAssessing: this.moveToAssessing() || undefined,
    });
  }

  protected onShow(): void {
    this.selectedRole.set('lead');
    this.moveToAssessing.set(false);
    this.searchQuery.set('');
    this.selectedSteward.set(null);
    this.stewards.set([]);
    this.loadingStewards.set(true);
    this.akritesService
      .searchStewards()
      .pipe(take(1))
      .subscribe((members) => {
        this.stewards.set(members);
        this.loadingStewards.set(false);
      });
  }

  private initFilteredStewards(): Signal<AkritesSearchStewardResult[]> {
    return computed(() => {
      const q = this.searchQuery().toLowerCase().trim();
      if (!q) return this.stewards();
      return this.stewards().filter(
        (s) => s.displayName.toLowerCase().includes(q) || s.username.toLowerCase().includes(q) || (s.organization ?? '').toLowerCase().includes(q)
      );
    });
  }
}
