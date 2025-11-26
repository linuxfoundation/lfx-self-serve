// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { ProjectContext } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';

import { CookieRegistryService } from './cookie-registry.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectContextService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly foundationStorageKey = 'lfx-selected-foundation';
  private readonly projectStorageKey = 'lfx-selected-project';

  public readonly selectedFoundation: WritableSignal<ProjectContext | null>;
  public readonly selectedProject: WritableSignal<ProjectContext | null>;
  public availableProjects: ProjectContext[] = [];

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
    this.clearProject();
    this.selectedFoundation.set(foundation);
    this.persistToStorage(this.foundationStorageKey, foundation);
  }

  /**
   * Set the selected sub-project (child project)
   */
  public setProject(project: ProjectContext): void {
    this.clearFoundation();
    this.selectedProject.set(project);
    this.persistToStorage(this.projectStorageKey, project);
  }

  /**
   * Clear the selected sub-project
   */
  public clearProject(): void {
    this.cookieService.delete(this.projectStorageKey, '/');
    this.selectedProject.set(null);
  }

  /**
   * Clear the selected foundation
   */
  public clearFoundation(): void {
    this.cookieService.delete(this.foundationStorageKey, '/');
    this.selectedFoundation.set(null);
  }

  /**
   * Get the current project ID (sub-project if set, otherwise foundation)
   */
  public getProjectUid(): string {
    return this.selectedProject()?.uid || '';
  }

  /**
   * Get the current foundation ID
   */
  public getFoundationId(): string {
    return this.selectedFoundation()?.uid || '';
  }

  private persistToStorage(key: string, project: ProjectContext): void {
    // Store in cookie (SSR-compatible)
    this.cookieService.set(key, JSON.stringify(project), {
      expires: 30, // 30 days
      path: '/',
      sameSite: 'Lax',
      secure: process.env['NODE_ENV'] === 'production',
    });
    // Register cookie for tracking
    this.cookieRegistry.registerCookie(key);
  }

  private loadFromStorage(key: string): ProjectContext | null {
    try {
      const stored = this.cookieService.get(key);
      if (stored) {
        return JSON.parse(stored) as ProjectContext;
      }
    } catch {
      // Invalid data in cookie, ignore
    }
    return null;
  }
}
