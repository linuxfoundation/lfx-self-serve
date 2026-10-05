// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import { DEFAULT_MEETING_TYPE_CONFIG, MEETING_TYPE_CONFIGS } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import { Meeting, MeetingCommittee, MeetingTypeConfig, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';

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
  imports: [ButtonComponent, TagComponent],
  templateUrl: './header.component.html',
})
export class MeetingHeaderComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly clipboard = inject(Clipboard);
  private readonly messageService = inject(MessageService);

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
  /** Committees with both a name and a uid; a chip needs both to say what it is and where it goes. */
  protected readonly committees: Signal<MeetingCommittee[]> = computed(() => (this.meeting()?.committees ?? []).filter((c) => !!c.name && !!c.uid));

  /**
   * Opens the meeting's foundation overview in a new tab, as v1's context chips do: sets the
   * foundation context first, so the overview opens on the right project.
   */
  protected openFoundation(): void {
    const meeting = this.meeting();
    const project = this.project();
    const parent = project?.parent ?? null;
    const isTopLevel = !project?.parent_uid;
    const uid = parent?.uid || project?.parent_uid || (isTopLevel ? project?.uid || meeting?.project_uid : undefined);
    if (!uid || !isPlatformBrowser(this.platformId)) {
      return;
    }

    this.projectContextService.setFoundation({
      uid,
      name: parent?.name || project?.name || meeting?.project_name || '',
      slug: parent?.slug || project?.slug || '',
    });
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
    this.clipboard.copy(url.toString());
    this.messageService.add({ severity: 'success', summary: 'Meeting link copied', detail: 'The meeting link is on your clipboard.' });
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
