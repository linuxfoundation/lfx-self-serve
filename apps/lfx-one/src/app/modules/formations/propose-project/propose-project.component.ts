// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  PROJECT_APPLICATION_CONTACT_EMAIL,
  PROJECT_APPLICATION_FROM_FOUNDATION_COPY,
  PROJECT_APPLICATION_PARENT_QUERY_PARAM,
  PROJECT_APPLICATION_TABS,
} from '@lfx-one/shared/constants';
import type { Project, ProjectApplicationAnswers } from '@lfx-one/shared/interfaces';
import { ProjectApplicationService } from '@services/project-application.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { finalize, Subscription } from 'rxjs';

import { ProjectApplicationFormComponent } from '../components/project-application-form/project-application-form.component';

/**
 * Me-lens "Propose a project" page (#3037) — reached from the My Formations header CTA, open to any
 * signed-in user (no project grant needed) while `formation-enabled` is on (the route's
 * `formationMeEnabledGuard`). Submitting creates a private application for the LF formation team;
 * no project exists until the team accepts it.
 *
 * Started from a foundation's Formations page (#5187) the link carries `?parent=<foundation uid>`. It is read
 * once, and kept only when it is a UUID for a foundation the caller can view; anything else is dropped without
 * a message. The foundation is a prefill hint for the formation team — never a placement, never an access grant —
 * so there is no picker or free-text input for it, and "Change" simply discards it.
 */
@Component({
  selector: 'lfx-propose-project',
  imports: [ProjectApplicationFormComponent, RouterLink],
  templateUrl: './propose-project.component.html',
})
export class ProposeProjectComponent {
  // === Services ===
  private readonly projectApplicationService = inject(ProjectApplicationService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  // === Template constants ===
  protected readonly contactEmail = PROJECT_APPLICATION_CONTACT_EMAIL;
  protected readonly fromFoundationCopy = PROJECT_APPLICATION_FROM_FOUNDATION_COPY;

  // === Writable Signals ===
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** The validated foundation the proposal started from; `null` for every other entry point and for any rejected `parent`. */
  protected readonly parentFoundation = signal<Project | null>(null);
  /** The in-flight `parent` lookup, ended by Change so a late response cannot bring a cleared foundation back. */
  private parentLookup: Subscription | null = null;

  // === Constructor ===
  public constructor() {
    this.resolveParent(this.route.snapshot.queryParamMap.get(PROJECT_APPLICATION_PARENT_QUERY_PARAM));
  }

  // === Protected Methods ===
  protected onSubmit(answers: ProjectApplicationAnswers): void {
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.projectApplicationService
      .create(answers, this.parentFoundation()?.uid ?? null)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (result) => {
          // query-service lags the write — record it so Submitted proposals shows it at once.
          this.projectApplicationService.recordWrite('submitter', result.application);
          this.messageService.add({
            severity: 'success',
            summary: 'Proposal submitted',
            detail: 'The LF formation team will review it. You can follow it under Submitted proposals.',
          });
          this.router.navigate(['/formations'], { queryParams: { tab: PROJECT_APPLICATION_TABS.proposals } });
        },
        error: (error: unknown) => this.errorMessage.set(extractErrorMessage(error, 'We could not submit your proposal. Please try again.')),
      });
  }

  protected onChangeParent(): void {
    this.parentLookup?.unsubscribe();
    this.parentFoundation.set(null);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [PROJECT_APPLICATION_PARENT_QUERY_PARAM]: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onCancel(): void {
    this.router.navigate(['/formations']);
  }

  // === Private Helpers ===
  /**
   * Keeps `parent` only when it resolves to a foundation the caller can view (`getStartedFrom`: a UUID that
   * `GET /api/projects/:uid` returns as a foundation). A project the caller cannot view, one that does not exist and a
   * non-foundation all resolve to `null` and are dropped alike — the hint is never worth an error.
   */
  private resolveParent(uid: string | null): void {
    if (!uid) {
      return;
    }
    this.parentLookup = this.projectApplicationService
      .getStartedFrom(uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((project) => this.parentFoundation.set(project));
  }
}
