// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { MeetingType } from '@lfx-pcc/shared/enums';
import { TooltipModule } from 'primeng/tooltip';

interface MeetingTypeInfo {
  icon: string;
  description: string;
  examples: string;
  color: string;
}

@Component({
  selector: 'lfx-meeting-type-selection',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ToggleComponent, TooltipModule],
  templateUrl: './meeting-type-selection.component.html',
})
export class MeetingTypeSelectionComponent {
  // Form group input from parent
  public readonly form = input.required<FormGroup>();

  // Meeting type options using shared enum (excluding NONE for selection)
  public readonly meetingTypeOptions = [
    { label: 'Board', value: MeetingType.BOARD },
    { label: 'Maintainers', value: MeetingType.MAINTAINERS },
    { label: 'Marketing', value: MeetingType.MARKETING },
    { label: 'Technical', value: MeetingType.TECHNICAL },
    { label: 'Legal', value: MeetingType.LEGAL },
    { label: 'Other', value: MeetingType.OTHER },
  ];

  // Meeting type info mapping (using colors consistent with committee colors)
  private readonly meetingTypeInfo: Record<MeetingType, MeetingTypeInfo> = {
    [MeetingType.BOARD]: {
      icon: 'fa-light fa-user-crown',
      description: 'Governance meetings for project direction, funding, and strategic decisions',
      examples: 'Quarterly reviews, budget planning, strategic roadmap discussions',
      color: '#ef4444', // red-500
    },
    [MeetingType.MAINTAINERS]: {
      icon: 'fa-light fa-gear',
      description: 'Regular sync meetings for core maintainers to discuss project health',
      examples: 'Weekly standups, release planning, code review discussions',
      color: '#3b82f6', // blue-500
    },
    [MeetingType.MARKETING]: {
      icon: 'fa-light fa-chart-line-up',
      description: 'Community growth, outreach, and marketing strategy meetings',
      examples: 'Conference planning, community campaigns, website updates',
      color: '#10b981', // green-500
    },
    [MeetingType.TECHNICAL]: {
      icon: 'fa-light fa-brackets-curly',
      description: 'Technical discussions, architecture decisions, and development planning',
      examples: 'RFC reviews, API design, performance optimization planning',
      color: '#8b5cf6', // purple-500
    },
    [MeetingType.LEGAL]: {
      icon: 'fa-light fa-scale-balanced',
      description: 'Legal compliance, licensing, and policy discussions',
      examples: 'License reviews, contributor agreements, compliance audits',
      color: '#f59e0b', // amber-500
    },
    [MeetingType.OTHER]: {
      icon: 'fa-light fa-folder-open',
      description: "General project meetings that don't fit other categories",
      examples: 'Community events, workshops, informal discussions',
      color: '#6b7280', // gray-500
    },
    [MeetingType.NONE]: {
      icon: 'fa-light fa-folder-open',
      description: 'No specific meeting type',
      examples: 'General meetings',
      color: '#6b7280', // gray-500
    },
  };

  // Get meeting type information
  public getMeetingTypeInfo(type: MeetingType): MeetingTypeInfo {
    return this.meetingTypeInfo[type] || this.meetingTypeInfo[MeetingType.OTHER];
  }

  // Handle meeting type selection
  public onMeetingTypeSelect(meetingType: MeetingType): void {
    this.form().get('meeting_type')?.setValue(meetingType);
    this.form().get('meeting_type')?.markAsTouched();
  }
}
