// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { Affiliation, ConnectedIdentity } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { take } from 'rxjs';

import { VerifyIdentitiesComponent } from '../components/verify-identities/verify-identities.component';

@Component({
  selector: 'lfx-profile-affiliations',
  imports: [ButtonComponent, CardComponent, TableComponent, TagComponent, TooltipModule],
  providers: [DialogService],
  templateUrl: './profile-affiliations.component.html',
  styleUrl: './profile-affiliations.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileAffiliationsComponent {
  // Private injections
  private readonly dialogService = inject(DialogService);
  private readonly userService = inject(UserService);

  // Data signals from API
  public readonly affiliations: Signal<Affiliation[]> = this.initAffiliations();
  public readonly identities: Signal<ConnectedIdentity[]> = this.initIdentities();

  // Computed signals
  public readonly sortedAffiliations = computed(() =>
    [...this.affiliations()].sort((a, b) => {
      // Sort by verified status (verified first), then by start date
      if (a.verified !== b.verified) {
        return a.verified ? -1 : 1;
      }
      return 0;
    })
  );

  public readonly hasUnverifiedAffiliations = computed(() => this.affiliations().some((a) => !a.verified));

  // Public methods
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

  // Private init functions
  private initAffiliations(): Signal<Affiliation[]> {
    return toSignal(this.userService.getAffiliations(), { initialValue: [] });
  }

  private initIdentities(): Signal<ConnectedIdentity[]> {
    return toSignal(this.userService.getOverviewIdentities(), { initialValue: [] });
  }
}
