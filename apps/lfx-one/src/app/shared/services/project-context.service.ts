// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal, WritableSignal } from '@angular/core';
import { ProjectContext } from '@lfx-one/shared/interfaces';

@Injectable({
  providedIn: 'root',
})
export class ProjectContextService {
  private readonly storageKey = 'lfx-selected-project';
  public readonly selectedProject: WritableSignal<ProjectContext | null>;
  public readonly availableProjects: ProjectContext[] = [];

  public constructor() {
    const stored = this.loadStoredProject();
    this.selectedProject = signal<ProjectContext | null>(stored || null);
  }

  public setProject(project: ProjectContext): void {
    this.selectedProject.set(project);
    this.persistProject(project);
  }

  public getProjectId(): string {
    return this.selectedProject()?.projectId || '';
  }

  private persistProject(project: ProjectContext): void {
    localStorage.setItem(this.storageKey, JSON.stringify(project));
  }

  private loadStoredProject(): ProjectContext | null {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        return JSON.parse(stored) as ProjectContext;
      }
    } catch {
      // Invalid data in localStorage, ignore
    }
    return null;
  }
}
