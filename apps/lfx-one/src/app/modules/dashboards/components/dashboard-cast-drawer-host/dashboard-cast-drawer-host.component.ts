// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output, signal } from '@angular/core';
import { VoteCastDrawerComponent } from '@app/modules/votes/components/vote-cast-drawer/vote-cast-drawer.component';

@Component({
  selector: 'lfx-dashboard-cast-drawer-host',
  imports: [VoteCastDrawerComponent],
  templateUrl: './dashboard-cast-drawer-host.component.html',
})
export class DashboardCastDrawerHostComponent {
  protected readonly voteId = signal<string | null>(null);
  protected readonly visible = signal<boolean>(false);
  public readonly voteSubmitted = output<string>();

  public open(voteUid: string): void {
    this.voteId.set(voteUid);
    this.visible.set(true);
  }
}
