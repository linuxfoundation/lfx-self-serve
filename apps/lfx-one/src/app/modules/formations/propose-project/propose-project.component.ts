// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PROJECT_APPLICATION_CONTACT_EMAIL, PROJECT_APPLICATION_TABS } from '@lfx-one/shared/constants';
import type { ProjectApplicationAnswers } from '@lfx-one/shared/interfaces';
import { ProjectApplicationService } from '@services/project-application.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { finalize } from 'rxjs';

import { ProjectApplicationFormComponent } from '../components/project-application-form/project-application-form.component';

/**
 * Me-lens "Propose a project" page (#3037) — reached from the My Formations header CTA, open to any
 * signed-in user (no project grant needed) while `formation-enabled` is on (the route's
 * `formationMeEnabledGuard`). Submitting creates a private application for the LF formation team;
 * no project exists until the team accepts it.
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

  // === Template constants ===
  protected readonly contactEmail = PROJECT_APPLICATION_CONTACT_EMAIL;

  // === Writable Signals ===
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  // === Protected Methods ===
  protected onSubmit(answers: ProjectApplicationAnswers): void {
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.projectApplicationService
      .create(answers)
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

  protected onCancel(): void {
    this.router.navigate(['/formations']);
  }
}
