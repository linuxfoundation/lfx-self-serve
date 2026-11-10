// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, input, Signal, viewChild } from '@angular/core';
import { environment } from '@environments/environment';
import { PHONE_MEDIA_QUERY } from '@lfx-one/shared/constants';
import { MeetingHomeRowProject } from '@lfx-one/shared/interfaces';
import { getMeetingHomeRowProject, getMeetingShareUrl, isPastMeetingCalendarRow } from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerContext } from '@shared/uikit/drawer/drawer.context';
import { UiMenuItemComponent } from '@shared/uikit/menu/menu-item.component';
import { UiMenuSeparatorComponent } from '@shared/uikit/menu/menu-separator.component';
import { UiMenuComponent } from '@shared/uikit/menu/menu.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { injectIsMobileViewport } from '@shared/utils/mobile-viewport.util';

import { take } from 'rxjs';

import { MeetingsHomeDeleteService } from '../../../services/meetings-home-delete.service';
import { MeetingsHomeEditService } from '../../../services/meetings-home-edit.service';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsProjectLinkComponent } from '../project-link/meeting-details-project-link.component';
import { MeetingDetailsOwnActionsComponent } from '../tools/own-actions/meeting-details-own-actions.component';

/**
 * Sticky top row of the meeting details drawer: the compact project and title once the big title scrolls away, Copy Link,
 * the ⋯ menu (organizer actions, and the viewer's own actions on phones) and Close.
 */
@Component({
  selector: 'lfx-meeting-details-header',
  imports: [MeetingDetailsProjectLinkComponent, UiButtonComponent, UiMenuComponent, UiMenuItemComponent, UiMenuSeparatorComponent, UiTooltipDirective],
  templateUrl: './meeting-details-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingDetailsHeaderComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(UiToastService);
  private readonly drawer = inject(UiDrawerContext);
  private readonly dialogRef = inject(DialogRef);
  private readonly editService = inject(MeetingsHomeEditService);
  private readonly deleteService = inject(MeetingsHomeDeleteService);
  protected readonly context = inject(MeetingDetailsContext);
  private readonly moreButton = viewChild<UiButtonComponent>('moreButton');

  /** The big title has scrolled under this row, so the compact title shows. */
  public readonly compact = input(false);
  /** The viewer's Resend Invite and Remove Myself, which move into the ⋯ menu on phones. */
  public readonly ownActions = input<MeetingDetailsOwnActionsComponent | null>(null);

  protected readonly phone: Signal<boolean> = injectIsMobileViewport(PHONE_MEDIA_QUERY);

  protected readonly project: Signal<MeetingHomeRowProject | null> = computed(() => getMeetingHomeRowProject(this.context.meeting()));
  /** Organizer of an upcoming meeting with a project slug, which the editor needs; never a past row (as the row menu). */
  protected readonly canEdit: Signal<boolean> = computed(
    () =>
      this.context.organizer() &&
      this.context.state() !== 'ended' &&
      !!this.context.meeting().project_slug &&
      !isPastMeetingCalendarRow(this.context.row().meeting)
  );
  /** Organizer on an upcoming date of a series (the meeting page's rule); never a past row, as Edit. */
  protected readonly canCancel: Signal<boolean> = computed(
    () =>
      this.context.organizer() &&
      !!this.context.meeting().recurrence &&
      this.context.state() !== 'ended' &&
      !!this.context.occurrence() &&
      !isPastMeetingCalendarRow(this.context.row().meeting)
  );

  protected readonly canResend: Signal<boolean> = computed(() => this.phone() && !!this.ownActions()?.canResend());
  protected readonly canRemove: Signal<boolean> = computed(() => this.phone() && !!this.ownActions()?.canRemove());

  protected copyLink(): void {
    // An ended date links to its past meeting record, which takes no passcode.
    const pastId = this.context.pastMeetingId();
    const meeting = this.context.meeting();
    // A coming date picked on a past row links to its series, not the past record the row holds.
    const id = pastId ?? (isPastMeetingCalendarRow(meeting) ? meeting.meeting_id : meeting.id);
    const url = getMeetingShareUrl(environment.urls.home, id, pastId ? null : meeting.password);
    if (!url || !this.clipboard.copy(url)) {
      this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Copy Failed', description: 'Failed to copy link. Please try again.' });
      return;
    }
    this.toast.show({ variant: 'dark', message: 'Meeting link copied to clipboard' });
  }

  /** The menu item goes away with the menu, so the confirmation hands focus back to ⋯ instead. */
  protected confirmRemove(): void {
    this.moreButton()?.focus();
    this.ownActions()?.confirmRemove();
  }

  protected editMeeting(): void {
    // An explicit leave: close without the close guard, then open the editor once focus is handed back.
    const row = this.context.shownRow();
    this.dialogRef.closed.pipe(take(1)).subscribe(() => this.editService.edit(row));
    this.dialogRef.close();
  }

  protected cancelOccurrence(): void {
    const occurrence = this.context.occurrence();
    if (!occurrence) return;
    // The page's flow cancels the date and reloads the list; the drawer then closes on a date that no longer exists.
    this.deleteService.cancelOccurrence(this.context.shownRow(), occurrence, 'drawer').subscribe((cancelled) => {
      if (cancelled) this.drawer.requestClose();
    });
  }

  protected close(): void {
    this.drawer.requestClose();
  }
}
