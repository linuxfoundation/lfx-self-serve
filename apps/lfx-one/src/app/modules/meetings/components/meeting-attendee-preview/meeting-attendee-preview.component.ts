// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { MEETING_ATTENDEE_PREVIEW_LIMIT } from '@lfx-one/shared/constants';
import { MeetingAttendeePreviewPerson } from '@lfx-one/shared/interfaces';
import { TooltipModule } from 'primeng/tooltip';

/**
 * Fixed-height row of overlapping faces with a "+N" overflow and a "View all" link.
 * @description Shows at most {@link MEETING_ATTENDEE_PREVIEW_LIMIT} faces so the card never grows with
 * the guest count; the full, searchable list lives in the parent's guests drawer.
 */
@Component({
  selector: 'lfx-meeting-attendee-preview',
  imports: [AvatarComponent, TooltipModule],
  templateUrl: './meeting-attendee-preview.component.html',
})
export class MeetingAttendeePreviewComponent {
  public readonly people = input.required<MeetingAttendeePreviewPerson[]>();
  /** Total guests, which can exceed `people` when only part of the roster is known. */
  public readonly total = input<number | null>(null);
  public readonly viewAll = output<void>();

  protected readonly visiblePeople = computed(() => this.people().slice(0, MEETING_ATTENDEE_PREVIEW_LIMIT));
  protected readonly overflowCount = computed(() => Math.max((this.total() ?? this.people().length) - this.visiblePeople().length, 0));
  protected readonly accessibleSummary = computed(() => {
    const names = this.visiblePeople().map((person) => person.name);
    const overflow = this.overflowCount();
    return overflow > 0 ? `${names.join(', ')} and ${overflow} more` : names.join(', ');
  });

  protected onViewAll(event: Event): void {
    event.stopPropagation();
    this.viewAll.emit();
  }
}
