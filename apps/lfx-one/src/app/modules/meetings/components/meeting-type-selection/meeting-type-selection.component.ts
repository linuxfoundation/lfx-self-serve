// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { HttpParams } from '@angular/common/http';
import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { MeetingType } from '@lfx-one/shared/enums';
import { Project } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { TooltipModule } from 'primeng/tooltip';
import { map, of } from 'rxjs';

interface MeetingTypeInfo {
  icon: string;
  description: string;
  examples: string;
  color: string;
}

@Component({
  selector: 'lfx-meeting-type-selection',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MessageComponent, SelectComponent, ToggleComponent, TooltipModule],
  templateUrl: './meeting-type-selection.component.html',
})
export class MeetingTypeSelectionComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);

  // Form group input from parent
  public readonly form = input.required<FormGroup>();

  // Child projects signal
  public childProjects = this.initializeChildProjects();

  // Map projects to select options
  public projectOptions = computed(() => {
    return this.childProjects().map((project: Project) => ({
      label: project.name,
      value: project.uid,
    }));
  });

  // Meeting type options with their info - computed for template efficiency
  // Filtered based on user role (currently showing only maintainers, technical, and other)
  public readonly meetingTypeOptions = computed(() => {
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
    const filteredOptions = allOptions.filter((option) => allowedTypes.includes(option.value));

    return filteredOptions.map((option) => ({
      ...option,
      info: this.meetingTypeInfo[option.value],
    }));
  });

  // Computed grid columns based on number of meeting types
  public readonly gridColumns = computed(() => {
    const count = this.meetingTypeOptions().length;
    // If divisible by 3, show 3 columns; if divisible by 2, show 2 columns; otherwise show 1
    if (count % 3 === 0) {
      return 3;
    } else if (count % 2 === 0) {
      return 2;
    }
    return 1;
  });

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

  // Handle meeting type selection
  public onMeetingTypeSelect(meetingType: MeetingType): void {
    this.form().get('meeting_type')?.setValue(meetingType);
    this.form().get('meeting_type')?.markAsTouched();
  }

  // Get child projects for the current project
  private initializeChildProjects() {
    const currentProject = this.projectContextService.selectedProject();

    if (!currentProject) {
      return toSignal(of([]), { initialValue: [] });
    }

    const params = new HttpParams().set('tags', `parent_uid:${currentProject.uid}`);
    return toSignal(
      this.projectService.getProjects(params).pipe(
        map((projects: Project[]) => {
          // Filter out the current project from the list
          return projects.filter((project) => project.uid !== currentProject.uid && project.writer);
        })
      ),
      { initialValue: [] }
    );
  }
}
