// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import {
  DEFAULT_MEETING_TYPE_CONFIG,
  MAX_CUSTOM_DURATION,
  MAX_MEETING_DURATION,
  MEETING_STATUS_LABELS,
  MEETING_TYPE_CONFIGS,
  MEETING_V2_ENABLED_DEFAULT,
  MEETING_V2_ENABLED_FLAG,
} from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import {
  Meeting,
  MeetingCancelOccurrenceResult,
  MeetingCommitteeLink,
  MeetingPrivacyState,
  MeetingRescheduleOccurrenceResult,
  MeetingStatusKind,
  MeetingTimeState,
  MeetingTypeConfig,
  ProjectContext,
  PublicMeetingProject,
} from '@lfx-one/shared/interfaces';
import { getLargestSessionShareUrl, getPastMeetingResourceId, resolveOccurrenceRecurrence } from '@lfx-one/shared/utils';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { restoreFocusOnDialogClose } from '@shared/utils/restore-dialog-focus.util';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { catchError, distinctUntilChanged, map, of, switchMap, take } from 'rxjs';

import { CancelOccurrenceConfirmationComponent } from '../../../components/cancel-occurrence-confirmation/cancel-occurrence-confirmation.component';
import { RescheduleOccurrenceDialogComponent } from '../../../components/reschedule-occurrence-dialog/reschedule-occurrence-dialog.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The meeting details V2 header (E1-03, #1772): project context, title, badge row, copy link and,
 * for an organizer of a recurring meeting, V1's Edit / Cancel this occurrence.
 * @description The badge row follows the prototype: recurrence, meeting type, committee chips, then
 * the feature badges (Recording, Transcripts, YouTube Upload, AI summary). E1-05's status pill and
 * E1-04's privacy chip lead the row.
 *
 * Feature badges follow V1's: the `*_enabled` flags, except Recording on a past occurrence opened by
 * its own id, which shows only when that occurrence's recording actually loads (V1's
 * `showRecordingBadge`).
 */
@Component({
  selector: 'lfx-meeting-header',
  imports: [ButtonComponent, NgTemplateOutlet, TagComponent],
  providers: [DialogService],
  templateUrl: './header.component.html',
})
export class MeetingHeaderComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly clipboardShare = inject(ClipboardShareService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  /** As V1: the reschedule dialog's duration cap follows the composer flag. */
  private readonly meetingsV2Enabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(MEETING_V2_ENABLED_FLAG, MEETING_V2_ENABLED_DEFAULT);

  /**
   * The prototype's chip on top of `lfx-tag outlined rounded`: 25px tall (15px line + 4px padding +
   * border), 12.5px semibold, V2 tokens.
   * Arbitrary px values because the app's 14px root would shrink rem-based utilities.
   */
  protected readonly chipClass =
    '!gap-[6px] !border-[var(--md-border)] !bg-[var(--md-surface-card)] !px-[11px] !py-[4px] !text-[12.5px] !font-semibold !leading-[15px] !text-[var(--md-text-body)]';

  /** The header's round icon buttons (copy link, and V1's occurrence actions), V2 tokens. */
  protected readonly iconButtonClass =
    'flex-none !border-[var(--md-border-strong)] !bg-[var(--md-surface-card)] !text-[var(--md-text-body)] hover:!bg-[var(--md-surface-hover)] hover:!text-[var(--md-text-heading)] focus-visible:!shadow-[var(--md-shadow-focus)] focus-visible:!outline-none';

  /** The prototype's pill colours per status, all V2 tokens; RSVP answers swap the dot for a glyph. */
  protected readonly statusClasses: Record<MeetingStatusKind, { pill: string; dot?: string; glyph?: string }> = {
    upcoming: { pill: 'bg-[var(--md-accent-bg)] text-[var(--md-accent-ink)]', dot: 'bg-[var(--md-accent)]' },
    live: { pill: 'bg-[var(--md-status-live-bg)] text-[var(--md-status-live)]', dot: 'bg-[var(--md-status-live)]' },
    ended: { pill: 'bg-[var(--md-border)] text-[var(--md-text-body)]', dot: 'bg-[var(--md-glyph-faint)]' },
    'starting-soon': { pill: 'bg-[var(--md-status-live-bg)] text-[var(--md-status-live)]', dot: 'bg-[var(--md-status-live)]' },
    'awaiting-rsvp': { pill: 'bg-[var(--md-status-warn-bg)] text-[var(--md-status-warn)]', dot: 'bg-[var(--md-status-warn)]' },
    going: { pill: 'bg-[var(--md-status-good-bg)] text-[var(--md-status-good)]', glyph: 'fa-solid fa-check' },
    maybe: { pill: 'bg-[var(--md-status-warn-bg)] text-[var(--md-status-warn)]', glyph: 'fa-solid fa-question' },
    'cant-attend': { pill: 'bg-[var(--md-status-live-bg)] text-[var(--md-status-live)]', glyph: 'fa-solid fa-xmark' },
  };

  protected readonly meeting: Signal<(Meeting & { project: PublicMeetingProject }) | undefined> = this.state.meeting;
  protected readonly project = computed(() => this.meeting()?.project);
  /** V1's `meetingTitle`: the selected occurrence's own title, else the meeting's. */
  protected readonly meetingTitle: Signal<string> = this.state.meetingTitle;
  /**
   * The one privacy chip (E1-04, FR-010), from `resolvePrivacy`: it reads an absent `visibility` as
   * private, so the label and icon helpers it calls always agree with each other and with the rail.
   */
  protected readonly privacy: Signal<MeetingPrivacyState | null> = this.state.privacy;
  /** The chip's icon: the prototype's green globe for a meeting anyone can join, muted otherwise. */
  protected readonly privacyIcon = computed(() => {
    const privacy = this.privacy();
    if (!privacy) {
      return '';
    }
    return `${privacy.icon} ${privacy.openToPublic ? 'text-[var(--md-status-good)]' : 'text-[var(--md-text-muted)]'}`;
  });
  protected readonly meetingType: Signal<MeetingTypeConfig | null> = this.initMeetingType();
  /**
   * Recurring when the selected occurrence or the meeting carries a recurrence rule, as v1's badge
   * reads it (`resolveOccurrenceRecurrence`). A past record keeps the original meeting uid in
   * `meeting_id` with a composite `id` whether or not it repeats, so series membership cannot be read
   * from the ids; a past occurrence whose payload omits `recurrence` needs the series timeline
   * (Phase 2 occurrence work), as it does in v1.
   */
  protected readonly recurring = computed(() => {
    const meeting = this.meeting();
    return !!meeting && !!resolveOccurrenceRecurrence(meeting, this.state.selectedOccurrence());
  });
  /** Committees with both a name and a uid, linked to their group page with the uid encoded. */
  protected readonly committees: Signal<MeetingCommitteeLink[]> = this.initCommittees();
  /**
   * The foundation the project link opens: the resolved parent, or the project itself when it is
   * top-level. `null` when the project has a parent the BFF could not resolve (a ROOT parent or a
   * failed lookup): mixing the parent's uid with the child's name and slug would open the overview
   * on inconsistent context, so the project then shows without a link.
   */
  protected readonly foundation: Signal<ProjectContext | null> = this.initFoundation();
  /** The page's time state and meeting status, from the state service so the bar shows the same. */
  protected readonly timeState: Signal<MeetingTimeState | null> = this.state.timeState;
  protected readonly status: Signal<MeetingStatusKind | null> = this.state.meetingStatus;
  /**
   * V1's `showRecordingBadge`: a past occurrence opened by its own id badges on a recording that
   * actually loads; anything else on the `recording_enabled` setting.
   */
  protected readonly showRecordingBadge: Signal<boolean> = this.initShowRecordingBadge();
  protected readonly statusLabel = computed(() => {
    const status = this.status();
    return status ? MEETING_STATUS_LABELS[status] : '';
  });
  /**
   * The viewer's own RSVP for `data-my-rsvp` (E2-04): `none` when they have not answered, and absent
   * while it is unknown, which covers everyone it is not loaded for (testid-contract.md).
   */
  protected readonly myRsvpAttr: Signal<string | null> = this.state.myRsvpAttr;
  /** V1's `canManageOccurrence`: Edit / Cancel this occurrence, beside copy link. */
  protected readonly canManageOccurrence: Signal<boolean> = this.state.canManageOccurrence;

  /**
   * Opens the meeting's foundation overview in a new tab, as v1's context chips do: sets the
   * foundation context first, so the overview opens on the right project.
   */
  protected openFoundation(): void {
    const foundation = this.foundation();
    if (!foundation || !isPlatformBrowser(this.platformId)) {
      return;
    }

    this.projectContextService.setFoundation(foundation);
    window.open('/foundation/overview', '_blank', 'noopener,noreferrer');
  }

  /**
   * Copies the meeting's public link, as v1's copy button does: with the meeting password when the
   * payload carries one, so the people it is shared with can open it (FR-050 keeps copy-link).
   */
  protected copyLink(): void {
    const meeting = this.meeting();
    if (!meeting) {
      return;
    }

    const url = new URL(`${environment.urls.home}/meetings/${encodeURIComponent(meeting.id)}`);
    if (meeting.password) {
      url.searchParams.set('password', meeting.password);
    }
    // The shared service confirms the copy, or reports a failed clipboard write instead of a false success.
    this.clipboardShare.copyLink(url.toString(), 'The meeting link is on your clipboard.');
  }

  /**
   * V1's `rescheduleCurrentOccurrence`: the same Edit Occurrence dialog (time, duration, title,
   * agenda) for the occurrence on screen, then the page follows the occurrence to its new start.
   */
  protected rescheduleOccurrence(): void {
    const meeting = this.meeting();
    const occurrence = this.state.selectedOccurrence();
    if (!meeting || !occurrence) {
      return;
    }

    const trigger = this.document.activeElement;
    const dialogRef = this.dialogService.open(RescheduleOccurrenceDialogComponent, {
      header: 'Edit Occurrence',
      width: '520px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { meeting, occurrence, maxDuration: this.meetingsV2Enabled() ? MAX_MEETING_DURATION : MAX_CUSTOM_DURATION },
    });
    restoreFocusOnDialogClose(dialogRef, trigger);

    dialogRef?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: MeetingRescheduleOccurrenceResult | undefined) => {
      if (!result?.confirmed || !result.start_time) {
        return;
      }
      this.messageService.add({
        severity: 'success',
        summary: 'Occurrence updated',
        detail: 'Only this occurrence was changed. The rest of the series is unchanged.',
      });
      this.state.showOccurrenceAfterChange(new Date(result.start_time).getTime());
    });
  }

  /**
   * V1's `cancelCurrentOccurrence`: the same Cancel Occurrence confirmation, then the page moves to
   * the cancelled occurrence's successor. The successor is read with the occurrence, before the dialog
   * opens: the clock can move the selection on while it is open.
   */
  protected cancelOccurrence(): void {
    const meeting = this.meeting();
    const occurrence = this.state.selectedOccurrence();
    if (!meeting || !occurrence) {
      return;
    }
    const successorMs = this.state.nextLiveOccurrenceStartMs();

    const trigger = this.document.activeElement;
    const dialogRef = this.dialogService.open(CancelOccurrenceConfirmationComponent, {
      header: 'Cancel Occurrence',
      width: '450px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { meeting, occurrence },
    });
    restoreFocusOnDialogClose(dialogRef, trigger);

    dialogRef?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: MeetingCancelOccurrenceResult | undefined) => {
      if (result?.confirmed) {
        this.messageService.add({
          severity: 'success',
          summary: 'Occurrence cancelled',
          detail: 'This occurrence was cancelled. The rest of the series is unchanged.',
        });
        this.state.showOccurrenceAfterChange(successorMs);
      } else if (result?.error) {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: result.error });
      }
    });
  }

  private initShowRecordingBadge(): Signal<boolean> {
    // V1's past recording read: signed in, with the past endpoint's full access, for the occurrence's
    // resource id. `getPastMeetingRecording` is cached, so the recording section reuses the same read.
    const resourceId = computed(() => {
      const meeting = this.meeting();
      const readable = !!meeting && this.state.loadedViaPastMeetingId() && this.state.pastMeetingFullAccess() && this.userService.authenticated();
      return readable && meeting ? getPastMeetingResourceId(meeting) : null;
    });
    const recordingUrl = toSignal(
      toObservable(resourceId).pipe(
        distinctUntilChanged(),
        switchMap((id) =>
          id
            ? this.meetingService.getPastMeetingRecording(id).pipe(
                map((recording) => getLargestSessionShareUrl(recording)),
                // Silent on purpose, as V1's: this is the recording section's cached read, and that
                // section logs its failures (`artifactFailure`). A failed read only hides the chip.
                catchError(() => of(null))
              )
            : of(null)
        )
      ),
      { initialValue: null }
    );
    return computed(() => (this.state.loadedViaPastMeetingId() ? !!recordingUrl() : !!this.meeting()?.recording_enabled));
  }

  private initCommittees(): Signal<MeetingCommitteeLink[]> {
    return computed(() =>
      (this.meeting()?.committees ?? [])
        .filter((committee) => !!committee.name && !!committee.uid)
        .map((committee) => ({ uid: committee.uid, name: committee.name ?? '', href: `/groups/${encodeURIComponent(committee.uid)}` }))
    );
  }

  private initFoundation(): Signal<ProjectContext | null> {
    return computed(() => {
      const project = this.project();
      if (!project) {
        return null;
      }
      if (project.parent) {
        return { uid: project.parent.uid, name: project.parent.name, slug: project.parent.slug };
      }
      return project.parent_uid ? null : { uid: project.uid, name: project.name, slug: project.slug };
    });
  }

  private initMeetingType(): Signal<MeetingTypeConfig | null> {
    return computed(() => {
      const type = this.meeting()?.meeting_type?.toLowerCase();
      // `None` means "no type" everywhere else in the app (the composer maps it to ''), so no chip.
      if (!type || type === MeetingType.NONE.toLowerCase()) {
        return null;
      }
      return MEETING_TYPE_CONFIGS[type] ?? DEFAULT_MEETING_TYPE_CONFIG;
    });
  }
}
