// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, inject, Injectable, Injector } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MEETING_DETAILS_OVERLAY_ID } from '@lfx-one/shared/constants';
import { MeetingDetailsDrawerData, MeetingDetailsOpenOptions, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { OverlayStateService } from '@services/overlay-state.service';
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
  private readonly title = inject(Title);
  private readonly overlayState = inject(OverlayStateService);
  private readonly router = inject(Router);
  private ref: DialogRef<unknown, MeetingDetailsDrawerComponent> | null = null;
  /** The page's tab title, restored once no drawer is open; the drawer shows its meeting's title meanwhile. */
  private pageTitle = '';
  /** The page's URL at open; after a navigation away the new page owns the title. */
  private pageUrl = '';

  public constructor() {
    inject(DestroyRef).onDestroy(() => this.ref?.close());
  }

  /** Opens the drawer on the row's date, replacing one already open. */
  public open(row: MeetingHomeRow, options: MeetingDetailsOpenOptions = {}): void {
    if (this.ref) {
      this.ref.close();
    } else {
      this.pageTitle = this.title.getTitle();
      this.pageUrl = this.router.url;
      // The support launcher steps aside while a drawer is open.
      this.overlayState.register(MEETING_DETAILS_OVERLAY_ID);
    }
    const data: MeetingDetailsDrawerData = { row, tab: options.tab ?? 'agenda', injector: this.injector };
    const ref = this.drawer.open<unknown, MeetingDetailsDrawerData, MeetingDetailsDrawerComponent>(MeetingDetailsDrawerComponent, { width: 1080, data });
    this.ref = ref;
    ref.closed.pipe(take(1)).subscribe(() => {
      // A replaced drawer closes after its successor opened; only the last one hands the page back.
      if (this.ref !== ref) return;
      this.ref = null;
      if (this.router.url === this.pageUrl) this.title.setTitle(this.pageTitle);
      this.overlayState.unregister(MEETING_DETAILS_OVERLAY_ID);
    });
  }
}
