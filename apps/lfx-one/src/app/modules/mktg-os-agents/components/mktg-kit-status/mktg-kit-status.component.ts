// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MktgKitAssetRow } from '@lfx-one/shared/interfaces';
import { describeMktgKitAsset } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-mktg-kit-status',
  templateUrl: './mktg-kit-status.component.html',
})
export class MktgKitStatusComponent {
  public readonly row = input.required<MktgKitAssetRow>();
  protected readonly label = computed(() => describeMktgKitAsset(this.row()));
}
