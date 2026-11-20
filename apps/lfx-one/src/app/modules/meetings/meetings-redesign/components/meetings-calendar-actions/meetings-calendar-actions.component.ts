// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { environment } from '@environments/environment';
import { IcalSubscribeDialogData } from '@lfx-one/shared/interfaces';
import { getProjectCalendarFeedUrl, getPublicProjectCalendarPath } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';

import { MeetingsSubscribeDialogComponent } from '../meetings-subscribe-dialog/meetings-subscribe-dialog.component';

/**
 * Subscribe and Public Calendar under a project's mini calendar, with a Share link that copies the public calendar's URL.
 * @description Subscribe opens the project's iCal feed dialog; Public Calendar opens the project's public calendar page in a new tab.
 */
@Component({
  selector: 'lfx-meetings-calendar-actions',
  imports: [UiButtonComponent],
  templateUrl: './meetings-calendar-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[8px]' },
})
export class MeetingsCalendarActionsComponent {
  private readonly projectContext = inject(ProjectContextService);
  private readonly modal = inject(UiModalService);
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(UiToastService);

  /** The project's iCal feed; empty until the project resolves. */
  protected readonly feedUrl: Signal<string> = computed(() => {
    const uid = this.projectContext.activeContextUid();
    return uid ? getProjectCalendarFeedUrl(environment.urls.home, uid) : '';
  });
  /** Path of the project's public calendar page; empty until the project resolves. */
  protected readonly publicCalendarPath: Signal<string> = computed(() => {
    const slug = this.projectContext.activeContext()?.slug;
    return slug ? getPublicProjectCalendarPath(slug) : '';
  });

  protected subscribe(): void {
    const data: IcalSubscribeDialogData = { feedUrl: this.feedUrl(), name: this.projectContext.activeContext()?.name || 'Calendar' };
    this.modal.open(MeetingsSubscribeDialogComponent, { data, describedBy: true });
  }

  protected copyPublicCalendarLink(): void {
    if (!this.clipboard.copy(`${environment.urls.home}${this.publicCalendarPath()}`)) {
      this.toast.show({ variant: 'error', message: "Couldn't copy the link", description: 'Open Public Calendar and copy its address instead.' });
      return;
    }
    this.toast.show({ variant: 'dark', message: 'Public calendar link copied', description: "Share it with anyone to show this project's public meetings." });
  }
}
