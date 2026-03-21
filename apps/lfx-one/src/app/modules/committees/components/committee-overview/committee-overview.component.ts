// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, CommitteeMember } from '@lfx-one/shared';
import { JoinModeLabelPipe } from '@pipes/join-mode-label.pipe';

@Component({
  selector: 'lfx-committee-overview',
  imports: [CardComponent, TagComponent, JoinModeLabelPipe],
  templateUrl: './committee-overview.component.html',
  styleUrl: './committee-overview.component.scss',
})
export class CommitteeOverviewComponent {
  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);
  public members = input<CommitteeMember[]>([]);
  public membersLoading = input<boolean>(true);
  public myRole = input<string | null>(null);
  public myMemberUid = input<string | null>(null);
  public myRoleLoading = input<boolean>(true);

  // Outputs
  public readonly committeeUpdated = output<void>();
  public readonly joinRequested = output<void>();
  public readonly tabNavigated = output<string>();
}
