// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { SELECTED_FOUNDATION_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import { isBoardScopedPersona, ProjectContext } from '@lfx-one/shared/interfaces';
import { isSameProjectContext } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { catchError, filter, map, of, startWith, switchMap, take } from 'rxjs';

import { CookieRegistryService } from './cookie-registry.service';
import { LensService } from './lens.service';
import { PersonaService } from './persona.service';
import { ProjectService } from './project.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectContextService {
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly cookieService = inject(SsrCookieService);
  private readonly lensService = inject(LensService);
  private readonly location = inject(Location);
  private readonly personaService = inject(PersonaService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);

  private readonly foundationStorageKey = SELECTED_FOUNDATION_COOKIE_KEY;
  private readonly projectStorageKey = SELECTED_PROJECT_COOKIE_KEY;

  private readonly foundationSelection: WritableSignal<ProjectContext | null> = signal<ProjectContext | null>(null);
  private readonly projectSelection: WritableSignal<ProjectContext | null> = signal<ProjectContext | null>(null);

  public readonly activeContext: Signal<ProjectContext | null> = this.initActiveContext();
  public readonly isFoundationContext: Signal<boolean> = this.initIsFoundationContext();
  public readonly activeContextUid: Signal<string> = computed(() => this.activeContext()?.uid || '');

  public readonly selectedFoundation: Signal<ProjectContext | null> = computed(() => this.foundationSelection());
  public readonly selectedProject: Signal<ProjectContext | null> = computed(() => this.projectSelection());

  /** Writer permission for the current active context — drives CTA visibility across dashboards. */
  public readonly canWrite: Signal<boolean> = this.initCanWrite();

  /** Salesforce 18-char ID for the active foundation — resolves PCC deep-link targets. `null` while resolving or unavailable. */
  public readonly selectedFoundationSfid: Signal<string | null> = this.initSelectedFoundationSfid();

  public constructor() {
    // Restore the prior selection from cookies so the active context survives a refresh.
    this.foundationSelection.set(this.readFromCookie(this.foundationStorageKey));
    this.projectSelection.set(this.readFromCookie(this.projectStorageKey));
    this.syncUrlAfterInitialNavigation();
  }

  public setFoundation(foundation: ProjectContext, syncUrl = true): void {
    if (isSameProjectContext(this.foundationSelection(), foundation)) {
      return;
    }
    this.foundationSelection.set(foundation);
    this.persistSelection(this.foundationStorageKey, foundation);
    if (syncUrl) {
      this.syncProjectQueryParam(foundation.slug);
    }
  }

  public setProject(project: ProjectContext, syncUrl = true): void {
    if (isSameProjectContext(this.projectSelection(), project)) {
      return;
    }
    this.projectSelection.set(project);
    this.persistSelection(this.projectStorageKey, project);
    if (syncUrl) {
      this.syncProjectQueryParam(project.slug);
    }
  }

  public clearFoundation(): void {
    this.foundationSelection.set(null);
    this.persistSelection(this.foundationStorageKey, null);
    this.resyncExistingProjectQueryParam();
  }

  public clearProject(): void {
    this.projectSelection.set(null);
    this.persistSelection(this.projectStorageKey, null);
    this.resyncExistingProjectQueryParam();
  }

  /** Writes ?project= into the URL once after the initial navigation completes, reflecting any cookie-restored selection. */
  private syncUrlAfterInitialNavigation(): void {
    // Initial navigation may already be done by the time this service is injected — sync immediately so the cookie-restored param isn't skipped.
    if (this.router.navigated) {
      this.syncRestoredProjectParam();
      return;
    }

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        take(1)
      )
      .subscribe(() => {
        this.syncRestoredProjectParam();
      });
  }

  /** Reflects the cookie-restored selection into ?project=, but never on entity deep-link URLs (e.g. /project/groups/:id) that intentionally omit it. */
  private syncRestoredProjectParam(): void {
    if (this.isEntityDeepLink()) {
      return;
    }
    this.syncProjectQueryParam(this.activeContext()?.slug ?? null);
  }

  /** Updates ?project= only when the URL already carries it — clearing a selection must not inject a slug into deep-link URLs. */
  private resyncExistingProjectQueryParam(): void {
    if (!('project' in this.router.parseUrl(this.router.url).queryParams)) {
      return;
    }
    this.syncProjectQueryParam(this.activeContext()?.slug ?? null);
  }

  /** True when the active route resolves to an entity detail (carries a path param like :id), where injecting ?project= is unwanted. */
  private isEntityDeepLink(): boolean {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return Object.keys(route.params).length > 0;
  }

  private persistSelection(key: string, context: ProjectContext | null): void {
    if (context === null) {
      this.cookieRegistry.delete(key);
    } else {
      this.cookieRegistry.set(key, JSON.stringify(context));
    }
  }

  private readFromCookie(key: string): ProjectContext | null {
    try {
      const raw = this.cookieService.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<ProjectContext> | null;
      if (parsed && typeof parsed === 'object' && typeof parsed.uid === 'string' && typeof parsed.name === 'string' && typeof parsed.slug === 'string') {
        return parsed as ProjectContext;
      }
      // Drop malformed/legacy cookies so the app self-heals instead of re-parsing bad data every refresh.
      this.cookieRegistry.delete(key);
      return null;
    } catch {
      this.cookieRegistry.delete(key);
      return null;
    }
  }

  /**
   * Updates the ?project= query param in the current URL via Location.replaceState —
   * no Angular navigation is triggered, so guards and resolvers are not re-evaluated.
   * Skipped when a navigation is already in flight: the URL already carries the correct
   * param (deep-link) or the caller's own navigation will set the destination URL.
   */
  private syncProjectQueryParam(slug: string | null): void {
    if (this.router.getCurrentNavigation()) {
      return;
    }
    const urlTree = this.router.parseUrl(this.router.url);
    if (slug === null) {
      delete urlTree.queryParams['project'];
    } else {
      urlTree.queryParams['project'] = slug;
    }
    this.location.replaceState(this.router.serializeUrl(urlTree));
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

  private initSelectedFoundationSfid(): Signal<string | null> {
    return toSignal(
      toObservable(this.selectedFoundation).pipe(
        switchMap((foundation) => {
          if (!foundation?.uid) {
            return of(null);
          }
          return this.projectService.getProjectSfid(foundation.uid).pipe(startWith(null));
        })
      ),
      { initialValue: null }
    );
  }
}
