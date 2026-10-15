// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { PastMeetingSummary, PastMeetingSummaryApprovalState, SummarySection } from '@lfx-one/shared/interfaces';
import { getPastMeetingSummaryApprovalState, getPastMeetingSummaryContent } from '@lfx-one/shared/utils';
import { PAST_MEETING_SUMMARY_APPROVAL_LABELS } from '@lfx-one/shared/constants';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-meeting-summary-modal',
  imports: [NgClass, MarkdownRendererComponent],
  templateUrl: './meeting-summary-modal.component.html',
})
export class MeetingSummaryModalComponent {
  private readonly dialogConfig = inject(DynamicDialogConfig);

  public readonly summary: PastMeetingSummary = this.dialogConfig.data.summary;
  public readonly hasTitle: boolean = !!this.summary.summary_data?.title;
  // Edited content first, else the original (getPastMeetingSummaryContent: an unedited summary's
  // edited_content is '', so it falls back rather than rendering blank).
  public readonly content: string = getPastMeetingSummaryContent(this.summary);
  /** The shared approval state (E4-03): a summary that never required approval shows no status. */
  public readonly approval: PastMeetingSummaryApprovalState = getPastMeetingSummaryApprovalState(this.summary);
  /** The shared wording for each state, so the modal and the page read alike. */
  protected readonly approvalLabels = PAST_MEETING_SUMMARY_APPROVAL_LABELS;
  public readonly sections: SummarySection[] = this.parseSections(this.content);
  public readonly isStructured: boolean = this.sections.length > 0;

  private parseSections(markdown: string): SummarySection[] {
    const headingRegex = /^## (.+)$/gm;
    const matches = [...markdown.matchAll(headingRegex)];

    if (matches.length === 0) return [];

    const sections: SummarySection[] = [];
    for (let i = 0; i < matches.length; i++) {
      const heading = matches[i][1].trim();
      const startIndex = (matches[i].index ?? 0) + matches[i][0].length;
      const endIndex = i + 1 < matches.length ? (matches[i + 1].index ?? markdown.length) : markdown.length;
      const content = markdown.slice(startIndex, endIndex).trim();

      sections.push({ heading, content, ...this.getSectionStyle(heading) });
    }

    return sections;
  }

  private getSectionStyle(heading: string): { icon: string; borderColor: string; iconColor: string } {
    const lower = heading.toLowerCase();
    if (lower.includes('discussion') || lower.includes('key points')) {
      return { icon: 'fa-light fa-comments', borderColor: 'border-l-blue-400', iconColor: 'text-blue-500' };
    }
    if (lower.includes('decision')) {
      return { icon: 'fa-light fa-gavel', borderColor: 'border-l-emerald-400', iconColor: 'text-emerald-500' };
    }
    if (lower.includes('action')) {
      return { icon: 'fa-light fa-list-check', borderColor: 'border-l-amber-400', iconColor: 'text-amber-500' };
    }
    if (lower.includes('next step')) {
      return { icon: 'fa-light fa-arrow-right', borderColor: 'border-l-purple-400', iconColor: 'text-purple-500' };
    }
    return { icon: 'fa-light fa-bookmark', borderColor: 'border-l-gray-300', iconColor: 'text-gray-500' };
  }
}
