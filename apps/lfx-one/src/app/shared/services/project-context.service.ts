// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal, WritableSignal } from '@angular/core';
import { ProjectContext } from '@lfx-one/shared/interfaces';

@Injectable({
  providedIn: 'root',
})
export class ProjectContextService {
  private readonly foundationStorageKey = 'lfx-selected-foundation';
  private readonly projectStorageKey = 'lfx-selected-project';

  public readonly selectedFoundation: WritableSignal<ProjectContext | null>;
  public readonly selectedProject: WritableSignal<ProjectContext | null>;
  public readonly availableProjects: ProjectContext[] = [];

  public constructor() {
    const storedFoundation = this.loadFromStorage(this.foundationStorageKey);
    const storedProject = this.loadFromStorage(this.projectStorageKey);

    this.selectedFoundation = signal<ProjectContext | null>(storedFoundation || null);
    this.selectedProject = signal<ProjectContext | null>(storedProject || null);
  }

  /**
   * Set the selected foundation-level project
   */
  public setFoundation(foundation: ProjectContext): void {
    this.selectedFoundation.set(foundation);
    this.persistToStorage(this.foundationStorageKey, foundation);
  }

  /**
   * Set the selected sub-project (child project)
   */
  public setProject(project: ProjectContext): void {
    this.selectedProject.set(project);
    this.persistToStorage(this.projectStorageKey, project);
  }

  /**
   * Get the current project ID (sub-project if set, otherwise foundation)
   */
  public getProjectId(): string {
    return this.selectedProject()?.projectId || '';
  }

  /**
   * Get the current foundation ID
   */
  public getFoundationId(): string {
    return this.selectedFoundation()?.projectId || '';
  }

  private persistToStorage(key: string, project: ProjectContext): void {
    localStorage.setItem(key, JSON.stringify(project));
  }

  private loadFromStorage(key: string): ProjectContext | null {
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored) as ProjectContext;
      }
    } catch {
      // Invalid data in localStorage, ignore
    }
    return null;
  }
}
