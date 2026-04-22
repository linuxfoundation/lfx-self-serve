// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { isBoardScopedPersona, PendingActionItem } from '@lfx-one/shared/interfaces';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, of, switchMap } from 'rxjs';

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

  public readonly refresh$ = new BehaviorSubject<void>(undefined);

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
  // Windowing (dismiss filtering + display cap) is owned by PendingActionsComponent.
  // Pass the raw list and let the child render the top N unhidden items. The aggregator is
  // persona-agnostic — contributor and maintainer users hit the same endpoint as board users.
  public readonly pendingActions: Signal<PendingActionItem[]> = this.initPendingActions();

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

  private initPendingActions(): Signal<PendingActionItem[]> {
    const project$ = toObservable(this.projectContextService.activeContext);

    return toSignal(
      this.refresh$.pipe(
        takeUntilDestroyed(),
        switchMap(() =>
          project$.pipe(
            switchMap((project) => {
              if (!project?.slug || !project?.uid) {
                return of([] as PendingActionItem[]);
              }

              return this.projectService
                .getPendingActions(project.slug, project.uid, this.personaService.currentPersona())
                .pipe(catchError(() => of([] as PendingActionItem[])));
            })
          )
        )
      ),
      { initialValue: [] }
    );
  }
}
