// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { isBoardScopedPersona, PendingActionItem } from '@lfx-one/shared/interfaces';
import { HiddenActionsService } from '@services/hidden-actions.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, of, switchMap } from 'rxjs';

import { FoundationHealthComponent } from '../components/foundation-health/foundation-health.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';
import { RecentProgressComponent } from '../components/recent-progress/recent-progress.component';

@Component({
  selector: 'lfx-user-dashboard',
  imports: [FoundationHealthComponent, RecentProgressComponent, PendingActionsComponent, MyMeetingsComponent, SkeletonModule],
  templateUrl: './user-dashboard.component.html',
  styleUrl: './user-dashboard.component.scss',
})
export class UserDashboardComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly projectService = inject(ProjectService);
  private readonly hiddenActionsService = inject(HiddenActionsService);

  public readonly refresh$ = new BehaviorSubject<void>(undefined);

  private readonly rawContributorActions = signal<PendingActionItem[]>([]);

  protected readonly isBoardScoped = computed(() => isBoardScopedPersona(this.personaService.currentPersona()));
  protected readonly activityRoleLabel = computed(() => {
    const persona = this.personaService.currentPersona();

    if (isBoardScopedPersona(persona)) {
      return 'board';
    }

    if (persona === 'contributor') {
      return 'contributor';
    }

    return 'maintainer';
  });
  protected readonly subtitleText: Signal<string> = this.initSubtitleText();
  private readonly rawBoardActions: Signal<PendingActionItem[]> = this.initBoardActions();
  public readonly pendingActions: Signal<PendingActionItem[]> = computed(() => {
    const raw = this.isBoardScoped() ? this.rawBoardActions() : this.rawContributorActions();
    return raw.filter((item) => !this.hiddenActionsService.isActionHidden(item)).slice(0, 2);
  });

  public handleActionClick(): void {
    this.refresh$.next();
  }

  private initSubtitleText(): Signal<string> {
    return computed(() => {
      const projects = this.personaService.detectedProjects();
      const role = this.activityRoleLabel();

      if (projects.length === 1) {
        const projectName = projects[0].projectName?.trim() || 'your project';
        return `Your ${role} activity on ${projectName}.`;
      }

      if (projects.length > 1) {
        return `Your ${role} activity across ${projects.length} projects.`;
      }

      return 'Your activity, meetings, and actions across all projects.';
    });
  }

  private initBoardActions(): Signal<PendingActionItem[]> {
    const project$ = toObservable(this.projectContextService.activeContext);
    const isBoardScoped$ = toObservable(this.isBoardScoped);

    return toSignal(
      this.refresh$.pipe(
        takeUntilDestroyed(),
        switchMap(() => {
          return combineLatest([project$, isBoardScoped$]).pipe(
            switchMap(([project, isBoardScoped]) => {
              if (!isBoardScoped || !project?.slug || !project?.uid) {
                return of([]);
              }

              return this.projectService
                .getPendingActions(project.slug, project.uid, this.personaService.currentPersona())
                .pipe(catchError(() => of([] as PendingActionItem[])));
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
