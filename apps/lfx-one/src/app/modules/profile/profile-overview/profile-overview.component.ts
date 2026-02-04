// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { ConnectedIdentity, ProfileProject } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, switchMap, take } from 'rxjs';

import { ManageSkillsComponent } from '../components/manage-skills/manage-skills.component';
import { VerifyIdentitiesComponent } from '../components/verify-identities/verify-identities.component';

@Component({
  selector: 'lfx-profile-overview',
  imports: [CardComponent, TableComponent, TagComponent, ButtonComponent, TooltipModule],
  providers: [DialogService],
  templateUrl: './profile-overview.component.html',
  styleUrl: './profile-overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileOverviewComponent {
  // Private injections
  private readonly dialogService = inject(DialogService);
  private readonly userService = inject(UserService);

  // Refresh triggers
  private readonly refreshSkills$ = new BehaviorSubject<void>(undefined);

  // Data signals from API
  public readonly projects: Signal<ProfileProject[]> = this.initProjects();
  public readonly identities: Signal<ConnectedIdentity[]> = this.initIdentities();
  public readonly skills: Signal<string[]> = this.initSkills();

  // Computed signals
  public readonly sortedSkills = computed(() => [...this.skills()].sort((a, b) => a.localeCompare(b)));

  public readonly hasUnverifiedIdentities = computed(() => this.identities().some((i) => !i.verified));

  public readonly projectCount = computed(() => this.projects().length);

  // Public methods
  public openSkillsModal(): void {
    const dialogRef = this.dialogService.open(ManageSkillsComponent, {
      header: 'Manage Skills',
      width: '500px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { skills: this.skills() },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((updatedSkills: string[] | null) => {
      if (updatedSkills) {
        this.saveSkills(updatedSkills);
      }
    });
  }

  public openVerifyIdentitiesModal(): void {
    const unverifiedIdentities = this.identities().filter((i) => !i.verified);

    const dialogRef = this.dialogService.open(VerifyIdentitiesComponent, {
      header: 'Verify identities',
      width: '700px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        identities: unverifiedIdentities,
        contributionCounts: {},
      },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: { confirmedIds: string[]; choices: Record<string, string> } | null) => {
      if (result?.confirmedIds?.length) {
        // TODO: Call API to verify the identities and reload data
        // For now, the modal closes without persisting changes
      }
    });
  }

  // Private methods
  private saveSkills(skills: string[]): void {
    this.userService
      .updateOverviewSkills(skills)
      .pipe(take(1))
      .subscribe(() => {
        this.refreshSkills$.next();
      });
  }

  // Private init functions
  private initProjects(): Signal<ProfileProject[]> {
    return toSignal(this.userService.getOverviewProjects(), { initialValue: [] });
  }

  private initIdentities(): Signal<ConnectedIdentity[]> {
    return toSignal(this.userService.getOverviewIdentities(), { initialValue: [] });
  }

  private initSkills(): Signal<string[]> {
    return toSignal(this.refreshSkills$.pipe(switchMap(() => this.userService.getOverviewSkills())), { initialValue: [] });
  }
}
