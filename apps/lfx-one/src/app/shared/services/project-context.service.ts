// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { isBoardScopedPersona, ProjectContext } from '@lfx-one/shared/interfaces';
import { isSameProjectContext } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { catchError, map, of, switchMap } from 'rxjs';

import { LensService } from './lens.service';
import { PersonaService } from './persona.service';
import { ProjectService } from './project.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectContextService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly lensService = inject(LensService);
  private readonly personaService = inject(PersonaService);
  private readonly projectService = inject(ProjectService);

  private readonly foundationStorageKey = 'lfx-selected-foundation';
  private readonly projectStorageKey = 'lfx-selected-project';

  private readonly foundationSelection: WritableSignal<ProjectContext | null> = signal<ProjectContext | null>(null);
  private readonly projectSelection: WritableSignal<ProjectContext | null> = signal<ProjectContext | null>(null);

  public readonly activeContext: Signal<ProjectContext | null> = this.initActiveContext();
  public readonly isFoundationContext: Signal<boolean> = this.initIsFoundationContext();
  public readonly activeContextUid: Signal<string> = computed(() => this.activeContext()?.uid || '');

  public readonly selectedFoundation: Signal<ProjectContext | null> = computed(() => this.foundationSelection());
  public readonly selectedProject: Signal<ProjectContext | null> = computed(() => this.projectSelection());

  /** Writer permission for the current active context — drives CTA visibility across dashboards. */
  public readonly canWrite: Signal<boolean> = this.initCanWrite();

  public constructor() {
    // Clean up legacy cookies from the previous cookie-hydrated design.
    this.cookieService.delete(this.foundationStorageKey, '/');
    this.cookieService.delete(this.projectStorageKey, '/');
  }

  public setFoundation(foundation: ProjectContext): void {
    if (isSameProjectContext(this.foundationSelection(), foundation)) {
      return;
    }
    this.foundationSelection.set(foundation);
  }

  public setProject(project: ProjectContext): void {
    if (isSameProjectContext(this.projectSelection(), project)) {
      return;
    }
    this.projectSelection.set(project);
  }

  public clearFoundation(): void {
    this.foundationSelection.set(null);
  }

  public clearProject(): void {
    this.projectSelection.set(null);
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

  private initCanWrite(): Signal<boolean> {
    return toSignal(
      toObservable(this.activeContext).pipe(
        switchMap((ctx) => {
          if (!ctx?.slug) {
            return of(false);
          }
          return this.projectService.getProject(ctx.slug, false).pipe(
            map((project) => project?.writer === true),
            catchError(() => of(false))
          );
        })
      ),
      { initialValue: false }
    );
  }
}
