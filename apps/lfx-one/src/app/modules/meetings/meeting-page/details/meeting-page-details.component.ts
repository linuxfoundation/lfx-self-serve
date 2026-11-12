// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Provider, Signal, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { getPastMeetingResourceId, isPastMeetingCalendarRow } from '@lfx-one/shared/utils';

import { MeetingDetailsBodyComponent } from '../../meetings-redesign/components/meeting-details-drawer/body/meeting-details-body.component';
import { MeetingDetailsContext } from '../../meetings-redesign/components/meeting-details-drawer/meeting-details.context';
import { MeetingDetailsSource } from '../../meetings-redesign/components/meeting-details-drawer/meeting-details.source';
import { MeetingDetailsArtifactsService } from '../../meetings-redesign/components/meeting-details-drawer/tools/meeting-details-artifacts.service';
import { MeetingsHomeDeleteService } from '../../meetings-redesign/services/meetings-home-delete.service';
import { MeetingsHomeEditService } from '../../meetings-redesign/services/meetings-home-edit.service';
import { MeetingPageDataService } from '../../services/meeting-page-data.service';

/** The page hosting the details: the row it shows, read once when the details are created. */
export abstract class MeetingPageRowHost {
  public abstract readonly row: Signal<MeetingHomeRow | null>;
}

/**
 * The meeting details on the standalone page, for the host's row; the page re-creates it for each row it shows.
 * @description Provides what `MeetingDetailsBodyComponent` needs, with a page source: no dialog, no list behind it,
 * and another date opens at its own `/meetings/...` URL.
 */
@Component({
  selector: 'lfx-meeting-page-details',
  imports: [MeetingDetailsBodyComponent],
  templateUrl: './meeting-page-details.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    MeetingDetailsContext,
    MeetingDetailsArtifactsService,
    MeetingsHomeEditService,
    // shortcut: no cancel flow, since organizers stay on the legacy page. revisit: when the page serves organizers.
    { provide: MeetingsHomeDeleteService, useValue: null },
    provideMeetingPageSource(),
  ],
})
export class MeetingPageDetailsComponent {}

/** The page's source: its row and clock, and navigation to another date's page. */
function provideMeetingPageSource(): Provider {
  return {
    provide: MeetingDetailsSource,
    useFactory: (): MeetingDetailsSource => {
      const row = inject(MeetingPageRowHost).row();
      if (!row) throw new Error('MeetingPageDetailsComponent needs a row');
      const pageData = inject(MeetingPageDataService);
      const router = inject(Router);
      return {
        row,
        tab: 'agenda',
        now: computed(() => new Date(pageData.clock())),
        upcomingRows: signal<MeetingHomeRow[]>([]).asReadonly(),
        hostRef: null,
        open: (row) => void router.navigateByUrl(meetingPageUrl(row)),
        applySummaryChange: () => undefined,
      };
    },
  };
}

/** A past row opens its `{id}-{ms}` record; an upcoming date opens the series at `?occurrence=` (its start ms). */
function meetingPageUrl(row: MeetingHomeRow): string {
  if (isPastMeetingCalendarRow(row.meeting)) {
    return `/meetings/${encodeURIComponent(getPastMeetingResourceId(row.meeting))}`;
  }
  const path = `/meetings/${encodeURIComponent(row.meeting.id)}`;
  return row.occurrenceId ? `${path}?occurrence=${Date.parse(row.startTime)}` : path;
}
