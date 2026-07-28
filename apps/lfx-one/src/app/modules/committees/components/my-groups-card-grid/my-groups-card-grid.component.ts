// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BadgeComponent } from '@components/badge/badge.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { CommitteeMemberRole } from '@lfx-one/shared/enums';
import { BadgeSeverity, MyCommittee } from '@lfx-one/shared/interfaces';
import { formatRelativeTime } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-my-groups-card-grid',
  imports: [BadgeComponent, EmptyStateComponent, RouterLink],
  templateUrl: './my-groups-card-grid.component.html',
})
export class MyGroupsCardGridComponent {
  // Inputs
  public readonly committees = input.required<MyCommittee[]>();
  public readonly hasItems = input<boolean>(true);

  // Outputs
  public readonly resetRequested = output<void>();

  protected readonly committeeLabel = COMMITTEE_LABEL;

  protected readonly cards = computed(() =>
    this.committees().map((committee) => ({
      committee,
      roleBadgeSeverity: this.resolveRoleSeverity(committee.my_role),
      lastActivityLabel: formatRelativeTime(new Date(committee.updated_at)),
    }))
  );

  private resolveRoleSeverity(role: CommitteeMemberRole | 'Member' | undefined): BadgeSeverity {
    switch (role) {
      case CommitteeMemberRole.CHAIR:
        return 'info';
      case CommitteeMemberRole.VICE_CHAIR:
        return 'success';
      case CommitteeMemberRole.LF_STAFF:
        return 'contrast';
      default:
        return 'secondary';
    }
  }
}
