// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { inject, Provider, Signal } from '@angular/core';
import { Meeting, MeetingDetailsDrawerData, MeetingDetailsTab, MeetingHomeRow, MeetingOccurrence, PastMeetingSummary } from '@lfx-one/shared/interfaces';

import { MeetingsHomeStore } from '../../services/meetings-home.store';

/**
 * What the host of the meeting details hands them: the row to show, its clock and list, and how to show another row.
 * @description The drawer provides it from the meetings home page; a page can provide its own.
 */
export abstract class MeetingDetailsSource {
  /** The row the details open on. */
  public abstract readonly row: MeetingHomeRow;
  public abstract readonly tab: MeetingDetailsTab;
  /** The host's clock; the details also keep their own. */
  public abstract readonly now: Signal<Date>;
  /** The host's upcoming rows, which carry the viewer's saved answers; empty when the host lists none. */
  public abstract readonly upcomingRows: Signal<MeetingHomeRow[]>;
  /** The dialog the details live in, closed by flows that leave them; null when they are not in one. */
  public abstract readonly hostRef: DialogRef | null;
  /** Opens the subscription to the meeting's project calendar; the drawer offers none. */
  public readonly subscribeToCalendar?: (meeting: Meeting) => void;
  /** Moves on from a date just cancelled; the drawer closes instead. */
  public readonly occurrenceCancelled?: (meeting: Meeting, occurrence: MeetingOccurrence) => void;
  /** True once, when Join may open Zoom by itself as the page loads; the drawer never does. */
  public readonly claimJoinOnLoad?: () => boolean;
  /** Joins with another email address in place; the drawer links to the meeting page instead. */
  public readonly joinWithOtherEmail?: () => void;
  /** Shows another row, such as an upcoming date picked from a past one. */
  public abstract open(row: MeetingHomeRow): void;
  /** Mirrors a summary edit into the host's list. */
  public abstract applySummaryChange(key: string, summary: PastMeetingSummary): void;
}

/** The drawer's source: its dialog data and the meetings home page's store. */
export function provideMeetingDetailsDrawerSource(): Provider {
  return {
    provide: MeetingDetailsSource,
    useFactory: (): MeetingDetailsSource => {
      const data = inject<MeetingDetailsDrawerData>(DIALOG_DATA);
      const store = data.injector.get(MeetingsHomeStore);
      return {
        row: data.row,
        tab: data.tab,
        now: store.now,
        upcomingRows: store.upcomingRows,
        hostRef: inject(DialogRef),
        open: data.open,
        applySummaryChange: (key, summary) => store.applySummaryChange(key, summary),
      };
    },
  };
}
