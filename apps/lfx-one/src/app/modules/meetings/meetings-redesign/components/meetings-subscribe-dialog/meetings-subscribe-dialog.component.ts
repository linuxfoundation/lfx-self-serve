// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CALENDAR_SUBSCRIBE_APPS } from '@lfx-one/shared/constants';
import { CalendarSubscribeAppLink, IcalSubscribeDialogData } from '@lfx-one/shared/interfaces';
import { getCalendarSubscribeUrls } from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';

/** Subscribe to a project's meetings calendar: its iCal feed URL to copy, and one link per calendar app that adds it. */
@Component({
  selector: 'lfx-meetings-subscribe-dialog',
  imports: [UiButtonComponent, UiInputComponent, UiModalComponent],
  templateUrl: './meetings-subscribe-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingsSubscribeDialogComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(UiToastService);
  protected readonly data = inject<IcalSubscribeDialogData>(DIALOG_DATA);

  protected readonly apps: CalendarSubscribeAppLink[] = this.initApps();

  protected copyFeedUrl(): void {
    if (!this.clipboard.copy(this.data.feedUrl)) {
      this.toast.show({ variant: 'error', message: "Couldn't copy the feed URL", description: 'Select it and copy it instead.' });
      return;
    }
    this.toast.show({ variant: 'dark', message: 'Feed URL copied', description: 'Paste it into any calendar app to subscribe.' });
  }

  private initApps(): CalendarSubscribeAppLink[] {
    const urls = getCalendarSubscribeUrls(this.data.feedUrl, this.data.name);
    return CALENDAR_SUBSCRIBE_APPS.map((app) => ({ app, href: urls[app.key], newTab: app.key !== 'apple' }));
  }
}
