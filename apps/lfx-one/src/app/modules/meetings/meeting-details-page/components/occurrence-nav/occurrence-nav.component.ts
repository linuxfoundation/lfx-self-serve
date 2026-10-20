// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { MeetingOccurrenceNavContext, OccurrenceNavItem, PublicMeetingOccurrencesResponse } from '@lfx-one/shared/interfaces';
import { buildOccurrenceNavTimeline, getActiveOccurrences, getMeetingSeriesUid, hasMeetingEnded } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { distinctUntilChanged, filter, map, switchMap } from 'rxjs';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * V1's occurrence navigation on the V2 page: Previous / Next and "N of M" over a recurring meeting's
 * series, with the same data, rules and edge cases as `meeting-join.component` (V1 parity, epic #1765).
 * @description The series comes from the unpaged `/public/api/meetings/:id/occurrences`, read in the
 * browser only (the server renders the live occurrences alone and the browser completes the timeline),
 * merged with the meeting's own active occurrences by `buildOccurrenceNavTimeline`. Each link is a plain
 * `href` built on V1's URL rules: a past record by its composite id, an ended occurrence without one by
 * `{seriesUid}-{start ms}`, anything else by `{seriesUid}?occurrence={start ms}`; only a password already
 * in the address bar is carried over. Absent when there is nowhere to go, as in V1.
 */
@Component({
  selector: 'lfx-meeting-occurrence-nav',
  templateUrl: './occurrence-nav.component.html',
})
export class MeetingOccurrenceNavComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly meetingService = inject(MeetingService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly routeId: Signal<string> = toSignal(this.activatedRoute.paramMap.pipe(map((params) => params.get('id') ?? '')), {
    initialValue: this.activatedRoute.snapshot.paramMap.get('id') ?? '',
  });
  private readonly seriesOccurrences: Signal<PublicMeetingOccurrencesResponse> = this.initSeriesOccurrences();
  private readonly context: Signal<MeetingOccurrenceNavContext> = this.initContext();

  /** A 34px pill link, as the identity bar's controls. */
  protected readonly linkClass =
    'inline-flex h-[34px] items-center gap-[6px] rounded-full border border-[var(--md-border-strong)] bg-[var(--md-surface-card)] px-[14px] text-[13px] font-semibold text-[var(--md-accent-ink)] no-underline hover:bg-[var(--md-surface-hover)] focus-visible:shadow-[var(--md-shadow-focus)] focus-visible:outline-none';
  /** The same pill with nowhere to go, as V1's greyed-out Previous / Next. */
  protected readonly disabledClass =
    'inline-flex h-[34px] cursor-default items-center gap-[6px] rounded-full border border-[var(--md-border)] px-[14px] text-[13px] font-semibold text-[var(--md-glyph-faint)]';

  protected readonly previousUrl: Signal<string | null> = this.initStepUrl(-1);
  protected readonly nextUrl: Signal<string | null> = this.initStepUrl(1);
  /** "N of M", or `null` when the navigation is absent. */
  protected readonly label: Signal<string | null> = this.initLabel();

  /**
   * The series timeline, V1's `initializeSeriesOccurrences`: skipped on the server (the browser reads it
   * after hydration), read for a recurring meeting, and for a past occurrence even without a rule, since
   * the past payload omits `recurrence` and the timeline itself tells whether there is anywhere to go.
   */
  private initSeriesOccurrences(): Signal<PublicMeetingOccurrencesResponse> {
    const empty: PublicMeetingOccurrencesResponse = { past: [], future: [] };
    if (isPlatformServer(this.platformId)) {
      return signal(empty).asReadonly();
    }
    return toSignal(
      toObservable(this.state.meeting).pipe(
        map((meeting) => (meeting && (meeting.recurrence || getMeetingSeriesUid(meeting) !== meeting.id) ? getMeetingSeriesUid(meeting) : null)),
        filter((seriesUid): seriesUid is string => !!seriesUid),
        distinctUntilChanged(),
        switchMap((seriesUid) => this.meetingService.getPublicMeetingOccurrences(seriesUid, this.state.password()))
      ),
      { initialValue: empty }
    );
  }

  /** V1's `initializeOccurrenceContext`: the merged timeline and the page's place in it. */
  private initContext(): Signal<MeetingOccurrenceNavContext> {
    return computed(() => {
      const meeting = this.state.meeting();
      if (!meeting) {
        return { sorted: [], currentIdx: -1 };
      }
      const loadedViaPast = this.state.loadedViaPastMeetingId();
      // On a past page the payload's occurrences (if any) describe the live series, not the viewed
      // occurrence: the merged timeline supplies both directions instead.
      const liveOccurrences = loadedViaPast ? [] : getActiveOccurrences(meeting.occurrences ?? [], meeting.cancelled_occurrences);
      const sorted = buildOccurrenceNavTimeline(liveOccurrences, this.seriesOccurrences(), meeting.duration);
      if (sorted.length === 0) {
        return { sorted, currentIdx: -1 };
      }

      const routeId = this.routeId();
      if (loadedViaPast) {
        // The route id is the composite past-occurrence id: match it directly first.
        const idxById = sorted.findIndex((occurrence) => occurrence.meeting_and_occurrence_id === routeId);
        if (idxById >= 0) {
          return { sorted, currentIdx: idxById };
        }
      }

      const current = this.state.selectedOccurrence();
      let currentTime: number;
      if (current) {
        currentTime = new Date(current.start_time).getTime();
      } else {
        // A past occurrence opened by `/meetings/{id}-{start ms}`: its start is in the route.
        const parts = routeId.split('-');
        currentTime = parts.length === 2 && /^\d{13}$/.test(parts[1]) ? parseInt(parts[1], 10) : Date.now();
      }
      let currentIdx = sorted.findIndex((occurrence) => new Date(occurrence.start_time).getTime() === currentTime);
      if (currentIdx < 0) {
        currentIdx = sorted.findIndex((occurrence) => new Date(occurrence.start_time).getTime() >= currentTime);
      }
      if (currentIdx < 0) {
        currentIdx = sorted.length - 1;
      }
      return { sorted, currentIdx };
    });
  }

  /** V1's `initializePreviousOccurrenceUrl` (step -1) and `initializeNextOccurrenceUrl` (step 1). */
  private initStepUrl(step: -1 | 1): Signal<string | null> {
    return computed(() => {
      const meeting = this.state.meeting();
      if (!meeting) {
        return null;
      }
      const { sorted, currentIdx } = this.context();
      const target = currentIdx < 0 ? undefined : sorted[currentIdx + step];
      return target ? this.buildUrl(getMeetingSeriesUid(meeting), target) : null;
    });
  }

  /** V1's `initializeOccurrenceLabel`. */
  private initLabel(): Signal<string | null> {
    return computed(() => {
      const meeting = this.state.meeting();
      if (!meeting) {
        return null;
      }
      const { sorted, currentIdx } = this.context();
      if (sorted.length === 0) {
        return null;
      }
      // A payload without a recurrence rule (a past page) shows the navigation only when the series
      // timeline has somewhere to go.
      if (!meeting.recurrence && sorted.length < 2) {
        return null;
      }
      return `${currentIdx + 1} of ${sorted.length}`;
    });
  }

  /**
   * V1's `buildOccurrenceUrl`. `urlPassword`, not `password`: these are plain `href`s, so anything put
   * here lands in the address bar, the history entry and the `Referer`. A password the composer handed
   * over in navigation state is never published; that visitor is asked for it on the next occurrence.
   */
  private buildUrl(seriesUid: string, occurrence: OccurrenceNavItem): string {
    const params = new URLSearchParams();
    const password = this.state.urlPassword();
    if (password) {
      params.set('password', password);
    }
    const withQuery = (base: string): string => {
      const query = params.toString();
      return query ? `${base}?${query}` : base;
    };
    // A past record: its composite id is the canonical past-meeting URL, never rebuilt from start_time.
    if (occurrence.meeting_and_occurrence_id) {
      return withQuery(`/meetings/${occurrence.meeting_and_occurrence_id}`);
    }
    const timestamp = new Date(occurrence.start_time).getTime();
    const meeting = this.state.meeting();
    if (meeting && hasMeetingEnded(meeting, occurrence)) {
      return withQuery(`/meetings/${seriesUid}-${timestamp}`);
    }
    params.set('occurrence', timestamp.toString());
    return withQuery(`/meetings/${seriesUid}`);
  }
}
