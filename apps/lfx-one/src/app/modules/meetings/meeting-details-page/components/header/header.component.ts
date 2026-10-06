// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import { DEFAULT_MEETING_TYPE_CONFIG, MEETING_TYPE_CONFIGS } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import { Meeting, MeetingCommitteeLink, MeetingTypeConfig, ProjectContext, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { getMeetingSeriesUid } from '@lfx-one/shared/utils';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { ProjectContextService } from '@services/project-context.service';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The meeting details V2 header (E1-03, #1772): project context, title, badge row and copy link.
 * @description The badge row follows the prototype: recurrence, meeting type, committee chips, then
 * the feature badges (Recording, Transcripts, YouTube Upload, AI summary). E1-05's status pill and
 * E1-04's privacy chip take the front of the row when they land.
 *
 * Feature badges read the `*_enabled` flags only, never artifact access: those flags survive on the
 * reduced past payload, so a viewer without access still sees what the meeting was configured to
 * capture (FR-041). They say nothing about whether an artifact exists. This deliberately differs
 * from v1, which badges a past-id load's Recording only once a recording URL resolves; the
 * artifact itself is E4-01's to show or explain.
 */
@Component({
  selector: 'lfx-meeting-header',
  imports: [ButtonComponent, NgTemplateOutlet, TagComponent],
  templateUrl: './header.component.html',
})
export class MeetingHeaderComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly clipboardShare = inject(ClipboardShareService);

  /**
   * The prototype's chip on top of `lfx-tag outlined rounded`: 25px tall (15px line + 4px padding +
   * border), 12.5px semibold, V2 tokens.
   * Arbitrary px values because the app's 14px root would shrink rem-based utilities.
   */
  protected readonly chipClass =
    '!gap-[6px] !border-[var(--md-border)] !bg-[var(--md-surface-card)] !px-[11px] !py-[4px] !text-[12.5px] !font-semibold !leading-[15px] !text-[var(--md-text-body)]';

  protected readonly meeting: Signal<(Meeting & { project: PublicMeetingProject }) | undefined> = this.state.meeting;
  protected readonly project = computed(() => this.meeting()?.project);
  protected readonly meetingType: Signal<MeetingTypeConfig | null> = this.initMeetingType();
  /**
   * Recurring for a live series (`recurrence`) and for a past occurrence of one: the past payload can
   * omit `recurrence`, but its series uid then differs from its own id, as v1 reads it.
   */
  protected readonly recurring = computed(() => {
    const meeting = this.meeting();
    return !!meeting && (!!meeting.recurrence || getMeetingSeriesUid(meeting) !== meeting.id);
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
