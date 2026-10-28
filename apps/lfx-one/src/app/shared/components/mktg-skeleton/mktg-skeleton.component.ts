// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import type { MktgSkeletonVariant } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-mktg-skeleton',
  templateUrl: './mktg-skeleton.component.html',
  host: { class: 'block w-full', role: 'status', 'aria-busy': 'true', 'aria-label': 'Loading', 'data-testid': 'mktg-skeleton' },
})
export class MktgSkeletonComponent {
  public readonly variant = input<MktgSkeletonVariant>('card');
  public readonly rows = input(3);
  protected readonly rowIndices = computed(() => Array.from({ length: Math.max(1, Math.min(8, Math.floor(this.rows()) || 3)) }, (_, index) => index));
}
