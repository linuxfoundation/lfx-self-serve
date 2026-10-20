// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, NgClass, TitleCasePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { MKTG_HOST_ASSET_STATES } from '@lfx-one/shared/constants';
import { MktgAssetHeaderMetadata } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-mktg-asset-meta',
  imports: [DatePipe, NgClass, TitleCasePipe],
  templateUrl: './mktg-asset-meta.component.html',
})
export class MktgAssetMetaComponent {
  public readonly metadata = input.required<MktgAssetHeaderMetadata>();
  public readonly prefix = input.required<string>();
  public readonly stateId = input('');
  protected readonly state = computed(() => (this.metadata().approval ? MKTG_HOST_ASSET_STATES.approved : MKTG_HOST_ASSET_STATES.pending));
  protected readonly approver = computed(() => this.metadata().otherApprovedCurrent?.approvedBy?.name?.trim() || 'a project writer');
}
