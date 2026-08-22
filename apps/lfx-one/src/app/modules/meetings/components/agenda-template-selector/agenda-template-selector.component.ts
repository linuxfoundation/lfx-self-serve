// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output } from '@angular/core';
import { MeetingTemplate, MeetingType } from '@lfx-one/shared';
import { MEETING_TEMPLATES } from '@lfx-one/shared/constants';

@Component({
  selector: 'lfx-agenda-template-selector',
  templateUrl: './agenda-template-selector.component.html',
})
export class AgendaTemplateSelectorComponent {
  // Inputs
  public readonly meetingType = input.required<MeetingType>();

  // Outputs
  public readonly templateSelected = output<MeetingTemplate>();

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

  public selectTemplate(template: MeetingTemplate): void {
    this.templateSelected.emit(template);
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
