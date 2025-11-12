// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { Project } from '@lfx-one/shared/interfaces';
import { Popover } from 'primeng/popover';
import { PopoverModule } from 'primeng/popover';

@Component({
  selector: 'lfx-project-selector',
  standalone: true,
  imports: [CommonModule, PopoverModule, ButtonComponent],
  templateUrl: './project-selector.component.html',
  styleUrl: './project-selector.component.scss',
})
export class ProjectSelectorComponent {
  // Input properties
  public readonly projects = input.required<Project[]>();
  public readonly selectedProject = input<Project | null>(null);

  // Output events
  public readonly projectChange = output<Project>();

  // Computed properties
  protected readonly displayName = computed(() => {
    const project = this.selectedProject();
    return project?.name || 'Select Project';
  });

  protected readonly displayLogo = computed(() => {
    const project = this.selectedProject();
    return project?.logo_url || '';
  });

  // Event handlers
  protected selectProject(project: Project, popover: Popover): void {
    this.projectChange.emit(project);
    popover.hide();
  }

  protected togglePanel(event: Event, popover: Popover): void {
    popover.toggle(event);
  }
}
