// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardSelectorComponent } from '@components/card-selector/card-selector.component';
import { MessageComponent } from '@components/message/message.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import { CardSelectorOption, CardSelectorOptionInfo } from '@lfx-one/shared/interfaces';
import { PersonaService } from '@services/persona.service';

@Component({
  selector: 'lfx-meeting-type-selection',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MessageComponent, ToggleComponent, CardSelectorComponent],
  templateUrl: './meeting-type-selection.component.html',
})
export class MeetingTypeSelectionComponent {
  private readonly personaService = inject(PersonaService);

  // Form group input from parent
  public readonly form = input.required<FormGroup>();

  // Meeting type options with their info - computed for template efficiency
  // Filtered based on user role (currently showing only maintainers, technical, and other)
  public readonly meetingTypeOptions = computed<CardSelectorOption<MeetingType>[]>(() => {
    const allOptions = [
      { label: 'Board', value: MeetingType.BOARD },
      { label: 'Maintainers', value: MeetingType.MAINTAINERS },
      { label: 'Marketing', value: MeetingType.MARKETING },
      { label: 'Technical', value: MeetingType.TECHNICAL },
      { label: 'Legal', value: MeetingType.LEGAL },
      { label: 'Other', value: MeetingType.OTHER },
    ];

    // Filter to only show maintainers, technical, and other meeting types
    const allowedTypes = [MeetingType.MAINTAINERS, MeetingType.TECHNICAL, MeetingType.OTHER];
    const filteredOptions =
      this.personaService.currentPersona() === 'maintainer' ? allOptions.filter((option) => allowedTypes.includes(option.value)) : allOptions;

    return filteredOptions.map((option) => ({
      ...option,
      info: this.meetingTypeInfo[option.value],
    }));
  });

  // Meeting type info mapping (using colors consistent with committee colors)
  private readonly meetingTypeInfo: Record<MeetingType, CardSelectorOptionInfo> = {
    [MeetingType.BOARD]: {
      icon: 'fa-light fa-user-crown',
      description: 'Governance meetings for project direction, funding, and strategic decisions',
      examples: 'Quarterly reviews, budget planning, strategic roadmap discussions',
      color: lfxColors.red[500],
    },
    [MeetingType.MAINTAINERS]: {
      icon: 'fa-light fa-gear',
      description: 'Regular sync meetings for core maintainers to discuss project health',
      examples: 'Weekly standups, release planning, code review discussions',
      color: lfxColors.blue[500],
    },
    [MeetingType.MARKETING]: {
      icon: 'fa-light fa-chart-line-up',
      description: 'Community growth, outreach, and marketing strategy meetings',
      examples: 'Conference planning, community campaigns, website updates',
      color: lfxColors.emerald[500],
    },
    [MeetingType.TECHNICAL]: {
      icon: 'fa-light fa-brackets-curly',
      description: 'Technical discussions, architecture decisions, and development planning',
      examples: 'RFC reviews, API design, performance optimization planning',
      color: lfxColors.violet[500],
    },
    [MeetingType.LEGAL]: {
      icon: 'fa-light fa-scale-balanced',
      description: 'Legal compliance, licensing, and policy discussions',
      examples: 'License reviews, contributor agreements, compliance audits',
      color: lfxColors.amber[500],
    },
    [MeetingType.OTHER]: {
      icon: 'fa-light fa-folder-open',
      description: "General project meetings that don't fit other categories",
      examples: 'Community events, workshops, informal discussions',
      color: lfxColors.gray[500],
    },
    [MeetingType.NONE]: {
      icon: 'fa-light fa-folder-open',
      description: 'No specific meeting type',
      examples: 'General meetings',
      color: lfxColors.gray[500],
    },
  };
}
