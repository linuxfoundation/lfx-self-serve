// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, inject, Injectable, Injector } from '@angular/core';
import { MeetingDetailsDrawerData, MeetingDetailsOpenOptions, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { take } from 'rxjs';

import { MeetingDetailsDrawerComponent } from '../components/meeting-details-drawer/meeting-details-drawer.component';

/**
 * Opens the meeting details drawer on the meetings home page, one at a time.
 * @description Provide it on the page, so the drawer reaches the page's store and edit flow, and leaving the page closes it.
 */
@Injectable()
export class MeetingsHomeDetailsService {
  private readonly drawer = inject(UiDrawerService);
  private readonly injector = inject(Injector);
  private ref: DialogRef<unknown, MeetingDetailsDrawerComponent> | null = null;

  public constructor() {
    inject(DestroyRef).onDestroy(() => this.ref?.close());
  }

  /** Opens the drawer on the row's date, replacing one already open. */
  public open(row: MeetingHomeRow, options: MeetingDetailsOpenOptions = {}): void {
    this.ref?.close();
    const data: MeetingDetailsDrawerData = { row, tab: options.tab ?? 'agenda', injector: this.injector };
    const ref = this.drawer.open<unknown, MeetingDetailsDrawerData, MeetingDetailsDrawerComponent>(MeetingDetailsDrawerComponent, { width: 1080, data });
    this.ref = ref;
    ref.closed.pipe(take(1)).subscribe(() => {
      if (this.ref === ref) this.ref = null;
    });
  }
}
