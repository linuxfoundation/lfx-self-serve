// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardSelectorComponent } from '@components/card-selector/card-selector.component';
import { lfxColors } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import { CardSelectorOption, CardSelectorOptionInfo } from '@lfx-one/shared/interfaces';
import { PersonaService } from '@services/persona.service';

@Component({
  selector: 'lfx-meeting-type-selection',
  imports: [ReactiveFormsModule, CardSelectorComponent],
  templateUrl: './meeting-type-selection.component.html',
})
export class MeetingTypeSelectionComponent {
  private readonly personaService = inject(PersonaService);

  // Form group input from parent
  public readonly form = input.required<FormGroup>();

  // Privacy options for Public/Restricted selection
  public readonly privacyOptions: CardSelectorOption<boolean>[] = [
    {
      label: 'Public',
      value: false,
      info: {
        icon: 'fa-light fa-globe',
        description: 'Anyone can join this meeting. Best for community meetings and open discussions.',
        color: lfxColors.emerald[500],
      },
    },
    {
      label: 'Restricted',
      value: true,
      info: {
        icon: 'fa-light fa-lock',
        description: 'Only invited guests can join. Best for board meetings and confidential discussions.',
        color: lfxColors.amber[500],
      },
    },
  ];

  // Meeting type options with their info - computed for template efficiency
  // Filtered based on user role (maintainers only see a subset of meeting types)
  public readonly meetingTypeOptions = computed<CardSelectorOption<MeetingType>[]>(() => {
    const allOptions = [
      { label: 'Board', value: MeetingType.BOARD },
      { label: 'Maintainers', value: MeetingType.MAINTAINERS },
      { label: 'Marketing', value: MeetingType.MARKETING },
      { label: 'Technical', value: MeetingType.TECHNICAL },
      { label: 'Legal', value: MeetingType.LEGAL },
      { label: 'Other', value: MeetingType.OTHER },
    ];

    // Filter to only show maintainers, technical, and other meeting types for maintainer persona
    const allowedTypes = [MeetingType.MAINTAINERS, MeetingType.TECHNICAL, MeetingType.OTHER];
    const filteredOptions =
      this.personaService.currentPersona() === 'maintainer' ? allOptions.filter((option) => allowedTypes.includes(option.value)) : allOptions;

    return filteredOptions.map((option) => ({
      ...option,
      info: this.meetingTypeInfo[option.value],
    }));
  });

  // Meeting type info mapping with icons and colors matching the design
  private readonly meetingTypeInfo: Record<MeetingType, CardSelectorOptionInfo> = {
    [MeetingType.BOARD]: {
      icon: 'fa-light fa-square-check',
      description: 'Governance meetings for project direction, funding, and strategic decisions',
      color: lfxColors.violet[500],
    },
    [MeetingType.MAINTAINERS]: {
      icon: 'fa-light fa-award',
      description: 'Regular sync meetings for core maintainers to discuss project health',
      color: lfxColors.blue[500],
    },
    [MeetingType.MARKETING]: {
      icon: 'fa-light fa-arrow-pointer',
      description: 'Community growth, outreach, and marketing strategy meetings',
      color: lfxColors.emerald[500],
    },
    [MeetingType.TECHNICAL]: {
      icon: 'fa-light fa-code-simple',
      description: 'Technical discussions, architecture decisions, and development planning',
      color: lfxColors.violet[500],
    },
    [MeetingType.LEGAL]: {
      icon: 'fa-light fa-shield',
      description: 'Legal compliance, licensing, and policy discussions',
      color: lfxColors.amber[500],
    },
    [MeetingType.OTHER]: {
      icon: 'fa-light fa-bars',
      description: "General project meetings that don't fit other categories",
      color: lfxColors.gray[500],
    },
    [MeetingType.NONE]: {
      icon: 'fa-light fa-bars',
      description: 'No specific meeting type',
      color: lfxColors.gray[500],
    },
  };
}
