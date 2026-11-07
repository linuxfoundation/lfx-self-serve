// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';
import { environment } from '@environments/environment';
import { MeetingHomeRowProject } from '@lfx-one/shared/interfaces';
import { getMeetingHomeRowProject, getMeetingShareUrl, isPastMeetingCalendarRow } from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerContext } from '@shared/uikit/drawer/drawer.context';
import { UiMenuItemComponent } from '@shared/uikit/menu/menu-item.component';
import { UiMenuComponent } from '@shared/uikit/menu/menu.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

import { MeetingsHomeEditService } from '../../../services/meetings-home-edit.service';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsProjectLinkComponent } from '../project-link/meeting-details-project-link.component';

/**
 * Sticky top row of the meeting details drawer: the compact project and title once the big title scrolls away, Copy Link,
 * the organizer's ⋯ menu and Close.
 */
@Component({
  selector: 'lfx-meeting-details-header',
  imports: [MeetingDetailsProjectLinkComponent, UiButtonComponent, UiMenuComponent, UiMenuItemComponent, UiTooltipDirective],
  templateUrl: './meeting-details-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingDetailsHeaderComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(UiToastService);
  private readonly drawer = inject(UiDrawerContext);
  private readonly editService = inject(MeetingsHomeEditService);
  protected readonly context = inject(MeetingDetailsContext);

  /** The big title has scrolled under this row, so the compact title shows. */
  public readonly compact = input(false);

  protected readonly project: Signal<MeetingHomeRowProject | null> = computed(() => getMeetingHomeRowProject(this.context.meeting()));
  /** Organizer of an upcoming meeting with a project slug, which the editor needs; never a past row (as the row menu). */
  protected readonly canEdit: Signal<boolean> = computed(
    () =>
      this.context.organizer() &&
      this.context.state() !== 'ended' &&
      !!this.context.meeting().project_slug &&
      !isPastMeetingCalendarRow(this.context.row().meeting)
  );

  protected copyLink(): void {
    // An ended date links to its past meeting record, which takes no passcode.
    const pastId = this.context.pastMeetingId();
    const meeting = this.context.meeting();
    const url = getMeetingShareUrl(environment.urls.home, pastId ?? meeting.id, pastId ? null : meeting.password);
    if (!url || !this.clipboard.copy(url)) {
      this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Copy Failed', description: 'Failed to copy link. Please try again.' });
      return;
    }
    this.toast.show({ variant: 'dark', message: 'Meeting link copied to clipboard' });
  }

  protected editMeeting(): void {
    // The page's edit flow outlives the drawer, so it closes first and the editor opens over the page.
    this.drawer.requestClose();
    this.editService.edit(this.context.shownRow());
  }

  protected close(): void {
    this.drawer.requestClose();
  }
}
