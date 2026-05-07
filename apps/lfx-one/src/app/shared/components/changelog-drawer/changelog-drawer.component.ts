// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, model } from '@angular/core';
import { ChangelogService } from '@services/changelog.service';
import { DrawerModule } from 'primeng/drawer';

@Component({
  selector: 'lfx-changelog-drawer',
  imports: [DrawerModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './changelog-drawer.component.html',
  styleUrl: './changelog-drawer.component.scss',
})
export class ChangelogDrawerComponent {
  private readonly changelogService = inject(ChangelogService);

  public readonly visible = model<boolean>(false);

  protected onClose(): void {
    this.visible.set(false);
  }

  protected onShow(): void {
    this.changelogService.markViewed();
  }
}
