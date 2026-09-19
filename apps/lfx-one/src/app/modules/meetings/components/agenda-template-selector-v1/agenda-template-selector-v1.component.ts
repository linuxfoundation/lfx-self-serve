// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The pre-v2 agenda-template selector — an inline, self-dismissing panel.
 *
 * A copy of what {@link AgendaTemplateSelectorComponent} was before meetings v2 restyled it into
 * popover content and dropped its `visible` / `closeSelector` API. The pre-v2 wizard owns neither a
 * popover nor a cancel affordance of its own, so it needs this shape; v2 needs the other one. Kept
 * as a separate component rather than re-adding the two members to the v2 one, so the v2 composer
 * carries nothing that only the pre-v2 wizard uses and the pre-v2 wizard deletes as a unit.
 *
 * Only consumed by `MeetingDetailsComponent`. Do not use in v2 surfaces.
 */

import { Component, computed, input, OnInit, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { TagComponent } from '@components/tag/tag.component';
import { MeetingType } from '@lfx-one/shared/enums';
import type { MeetingTemplate } from '@lfx-one/shared/interfaces';
import { MEETING_TEMPLATES } from '@lfx-one/shared/constants';

@Component({
  selector: 'lfx-agenda-template-selector-v1',
  imports: [ButtonComponent, MessageComponent, TagComponent],
  templateUrl: './agenda-template-selector-v1.component.html',
})
export class AgendaTemplateSelectorV1Component implements OnInit {
  // Inputs
  public readonly meetingType = input.required<MeetingType>();
  public readonly visible = input.required<boolean>();

  // Outputs
  public readonly templateSelected = output<MeetingTemplate>();
  public readonly closeSelector = output<void>();

  // Computed properties
  public readonly availableTemplates = computed(() => {
    const templateGroup = MEETING_TEMPLATES.find((group) => group.meetingType === this.meetingType());
    return templateGroup?.templates || [];
  });

  public readonly displayTemplates = computed(() => {
    return this.availableTemplates().map((template) => ({
      ...template,
      preview: this.getPreview(template.content),
      formattedDuration: this.formatDuration(template.estimatedDuration),
    }));
  });

  public ngOnInit(): void {
    // Component initialization if needed
  }

  public selectTemplate(template: MeetingTemplate): void {
    this.templateSelected.emit(template);
  }

  public close(): void {
    this.closeSelector.emit();
  }

  private getPreview(content: string): string {
    // Remove markdown formatting and get first 120 characters
    const plainText = content
      .replace(/\*\*/g, '') // Remove bold
      .replace(/\*/g, '') // Remove italics
      .replace(/#{1,6}\s/g, '') // Remove headers
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .trim();

    return plainText.length > 120 ? plainText.substring(0, 120) + '...' : plainText;
  }

  private formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours === 0) {
      return `${minutes} min`;
    } else if (remainingMinutes === 0) {
      return `${hours} hr`;
    }
    return `${hours}h ${remainingMinutes}m`;
  }
}
