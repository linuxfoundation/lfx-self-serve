// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee } from '@lfx-one/shared';
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
}
