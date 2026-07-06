// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

import { AkritesEcosystem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-akrites-ecosystem-badge',
  templateUrl: './akrites-ecosystem-badge.component.html',
})
export class AkritesEcosystemBadgeComponent {
  public readonly ecosystem = input.required<AkritesEcosystem>();
  public readonly size = input<'sm' | 'base'>('base');
}
