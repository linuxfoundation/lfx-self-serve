// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { BOARD_SCOPED_PERSONAS, EnrichedPersonaProject, isBoardScopedPersona, PROJECT_SCOPED_PERSONAS, ProjectContext } from '@lfx-one/shared/interfaces';
import { isFoundationProject, toProjectContext } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';

import { CookieRegistryService } from './cookie-registry.service';
import { LensService } from './lens.service';
import { PersonaService } from './persona.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectContextService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly lensService = inject(LensService);
  private readonly personaService = inject(PersonaService);

  private readonly foundationStorageKey = 'lfx-selected-foundation';
  private readonly projectStorageKey = 'lfx-selected-project';

  // Per-lens storage — independent, never clear each other
  private readonly foundationSelection: WritableSignal<ProjectContext | null>;
  private readonly projectSelection: WritableSignal<ProjectContext | null>;

  // PRIMARY API — resolves based on active lens + persona
  public readonly activeContext: Signal<ProjectContext | null> = this.initActiveContext();
  public readonly isFoundationContext: Signal<boolean> = this.initIsFoundationContext();
  public readonly activeContextUid: Signal<string> = computed(() => this.activeContext()?.uid || '');

  // Lens-specific read access
  public readonly selectedFoundation: Signal<ProjectContext | null> = computed(() => this.foundationSelection());
  public readonly selectedProject: Signal<ProjectContext | null> = computed(() => this.projectSelection());

  // Available projects filtered for the active lens
  public readonly availableProjects: Signal<ProjectContext[]> = this.initAvailableProjects();

  public constructor() {
    this.foundationSelection = signal<ProjectContext | null>(this.loadFromStorage(this.foundationStorageKey));
    this.projectSelection = signal<ProjectContext | null>(this.loadFromStorage(this.projectStorageKey));
  }

  /**
   * Set the foundation-lens selection
   */
  public setFoundation(foundation: ProjectContext): void {
    if (this.foundationSelection()?.uid === foundation.uid) {
      return;
    }
    this.foundationSelection.set(foundation);
    this.persistToStorage(this.foundationStorageKey, foundation);
  }

  /**
   * Set the project-lens selection
   */
  public setProject(project: ProjectContext): void {
    if (this.projectSelection()?.uid === project.uid) {
      return;
    }
    this.projectSelection.set(project);
    this.persistToStorage(this.projectStorageKey, project);
  }

  /**
   * Clear the foundation-lens selection
   */
  public clearFoundation(): void {
    this.cookieService.delete(this.foundationStorageKey, '/');
    this.foundationSelection.set(null);
  }

  /**
   * Clear the project-lens selection
   */
  public clearProject(): void {
    this.cookieService.delete(this.projectStorageKey, '/');
    this.projectSelection.set(null);
  }

  /**
   * Ensure both lens slots have a selection from the detected projects.
   * Called by sidebar when persona detection first populates.
   */
  public ensureDefaultSelection(detectedProjects: EnrichedPersonaProject[]): void {
    const validProjectIds = new Set(detectedProjects.map((p) => p.projectUid));
    const personaProjects = this.personaService.personaProjects();

    // Foundation slot — pick from board-scoped persona projects
    if (!this.foundationSelection() || !detectedProjects.some((p) => p.projectUid === this.foundationSelection()?.uid)) {
      const boardUids = this.getPersonaProjectUids(personaProjects, BOARD_SCOPED_PERSONAS);
      const defaultFoundation =
        detectedProjects.find((p) => boardUids.has(p.projectUid) && isFoundationProject(p, validProjectIds)) ??
        detectedProjects.find((p) => isFoundationProject(p, validProjectIds));
      if (defaultFoundation) {
        this.setFoundation(toProjectContext(defaultFoundation));
      }
    }

    // Project slot — pick from project-scoped persona projects, prefer child projects over foundations
    if (!this.projectSelection() || !detectedProjects.some((p) => p.projectUid === this.projectSelection()?.uid)) {
      const projectUids = this.getPersonaProjectUids(personaProjects, PROJECT_SCOPED_PERSONAS);
      const defaultProject =
        detectedProjects.find((p) => projectUids.has(p.projectUid) && !isFoundationProject(p, validProjectIds)) ??
        detectedProjects.find((p) => projectUids.has(p.projectUid)) ??
        detectedProjects[0];
      if (defaultProject) {
        this.setProject(toProjectContext(defaultProject));
      }
    }
  }

  private initActiveContext(): Signal<ProjectContext | null> {
    return computed(() => {
      const lens = this.lensService.activeLens();

      switch (lens) {
        case 'foundation':
          return this.foundationSelection();
        case 'project':
          return this.projectSelection();
        case 'me':
        case 'org':
          return isBoardScopedPersona(this.personaService.currentPersona()) ? this.foundationSelection() : this.projectSelection();
        default:
          return null;
      }
    });
  }

  private initIsFoundationContext(): Signal<boolean> {
    return computed(() => {
      const lens = this.lensService.activeLens();

      switch (lens) {
        case 'foundation':
          return true;
        case 'project':
          return false;
        case 'me':
        case 'org':
          return isBoardScopedPersona(this.personaService.currentPersona());
        default:
          return false;
      }
    });
  }

  private initAvailableProjects(): Signal<ProjectContext[]> {
    return computed(() => {
      const all = this.personaService.detectedProjects();
      if (all.length === 0) {
        return [];
      }

      const lens = this.lensService.activeLens();
      if (lens === 'me' || lens === 'org') {
        return all.map(toProjectContext);
      }

      const personaProjects = this.personaService.personaProjects();
      const relevantPersonas = lens === 'foundation' ? BOARD_SCOPED_PERSONAS : PROJECT_SCOPED_PERSONAS;
      const allowedUids = this.getPersonaProjectUids(personaProjects, relevantPersonas);

      const filtered = allowedUids.size > 0 ? all.filter((p) => allowedUids.has(p.projectUid)) : all;
      return filtered.map(toProjectContext);
    });
  }

  private getPersonaProjectUids(personaProjects: Partial<Record<string, { projectUid: string }[]>>, relevantPersonas: ReadonlySet<string>): Set<string> {
    const uids = new Set<string>();
    for (const [persona, projects] of Object.entries(personaProjects)) {
      if (relevantPersonas.has(persona) && projects) {
        for (const p of projects) {
          uids.add(p.projectUid);
        }
      }
    }
    return uids;
  }

  private persistToStorage(key: string, project: ProjectContext): void {
    this.cookieService.set(key, JSON.stringify(project), {
      expires: 30,
      path: '/',
      sameSite: 'Lax',
      secure: process.env['NODE_ENV'] === 'production',
    });
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
