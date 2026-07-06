// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Lens } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';

@Component({
  selector: 'lfx-lens-tabs',
  imports: [NgClass],
  templateUrl: './lens-tabs.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LensTabsComponent {
  private readonly lensService = inject(LensService);

  protected readonly lenses = this.lensService.displayLenses;
  protected readonly activeLensId = this.lensService.displayActiveLens;
  // A lone tab carries no choice — only render the switcher when the persona can reach more than one lens.
  protected readonly showTabs: Signal<boolean> = computed(() => this.lenses().length > 1);

  protected switchLens(lens: Lens): void {
    this.lensService.switchLens(lens);
  }
}
