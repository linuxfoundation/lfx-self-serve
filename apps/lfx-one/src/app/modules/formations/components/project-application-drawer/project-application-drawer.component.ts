// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, model, output, Signal, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import type {
  Project,
  ProjectApplication,
  ProjectApplicationAnswers,
  ProjectApplicationAnswerSection,
  ProjectApplicationStateMeta,
  ProjectApplicationViewMode,
  ProjectApplicationWriteResult,
} from '@lfx-one/shared/interfaces';
import { buildProjectApplicationAnswerSections, getProjectApplicationStateMeta, isProjectApplicationOpen } from '@lfx-one/shared/utils';
import { ProjectApplicationService } from '@services/project-application.service';
import { ProjectService } from '@services/project.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { DrawerModule } from 'primeng/drawer';
import { finalize, Observable, take } from 'rxjs';

import { ProjectApplicationFormComponent } from '../project-application-form/project-application-form.component';

/**
 * Detail + actions for one project application (#3037). Submitters may revise, withdraw and delete;
 * the formation team (`mode === 'staff'`) may additionally accept — choosing the parent project the
 * backend creates the new project under — and deny. Revise/withdraw/accept/deny are offered only while
 * the application is `submitted`; delete is always offered and always confirmed.
 *
 * Every write sends the held revision as `If-Match`. A 412 (another write won) or 404 (deleted
 * elsewhere) is never replayed: the drawer closes its edit state and asks the parent list to reload.
 * Answers render as plain text only.
 */
@Component({
  selector: 'lfx-project-application-drawer',
  imports: [
    AutocompleteComponent,
    ButtonComponent,
    ConfirmDialogModule,
    DatePipe,
    DialogModule,
    DrawerModule,
    ProjectApplicationFormComponent,
    ReactiveFormsModule,
    TagComponent,
  ],
  templateUrl: './project-application-drawer.component.html',
})
export class ProjectApplicationDrawerComponent {
  // === Services ===
  private readonly projectApplicationService = inject(ProjectApplicationService);
  private readonly projectService = inject(ProjectService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // === Inputs ===
  public readonly application = input<ProjectApplication | null>(null);
  public readonly mode = input<ProjectApplicationViewMode>('submitter');

  // === Outputs ===
  /** A write succeeded; carries the application as the backend returned it. */
  public readonly changed = output<ProjectApplication>();
  /** The application was deleted. */
  public readonly deleted = output<string>();
  /** The held revision is stale or the application is gone — reload before any further write. */
  public readonly stale = output<void>();

  // === Forms ===
  public readonly acceptForm = new FormGroup({
    parent: new FormControl<Project | string | null>(null),
  });

  // === Models ===
  public readonly visible = model<boolean>(false);

  // === Writable Signals ===
  protected readonly editing = signal(false);
  protected readonly busyAction = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly acceptDialogVisible = signal(false);
  protected readonly parentSuggestions = signal<Project[]>([]);
  protected readonly selectedParent = signal<Project | null>(null);

  // === Computed Signals ===
  protected readonly stateMeta: Signal<ProjectApplicationStateMeta> = computed(() => getProjectApplicationStateMeta(this.application()?.state));
  protected readonly sections: Signal<ProjectApplicationAnswerSection[]> = computed(() =>
    buildProjectApplicationAnswerSections(this.application()?.application)
  );
  protected readonly projectName = computed(() => {
    const name = this.application()?.application?.project_name;
    return typeof name === 'string' && name.trim() ? name : 'Untitled proposal';
  });
  protected readonly isOpen = computed(() => {
    const application = this.application();
    return application ? isProjectApplicationOpen(application) : false;
  });
  protected readonly isStaff = computed(() => this.mode() === 'staff');
  protected readonly busy = computed(() => this.busyAction() !== null);

  // === Constructor ===
  public constructor() {
    // A different application (or a closed drawer) always starts in read mode with no stale error.
    effect(() => {
      const uid = this.application()?.uid;
      const open = this.visible();
      untracked(() => {
        if (!uid || !open) {
          this.acceptDialogVisible.set(false);
        }
        this.editing.set(false);
        this.errorMessage.set(null);
      });
    });
  }

  // === Protected Methods ===
  protected startEditing(): void {
    this.errorMessage.set(null);
    this.editing.set(true);
  }

  protected cancelEditing(): void {
    this.errorMessage.set(null);
    this.editing.set(false);
  }

  protected onRevise(answers: ProjectApplicationAnswers): void {
    const application = this.application();
    if (!application) return;
    this.errorMessage.set(null);
    this.run('revise', this.projectApplicationService.revise(application, answers), 'Proposal updated', true, () => this.editing.set(false));
  }

  protected onWithdraw(): void {
    const application = this.application();
    if (!application) return;
    this.confirm(
      'Withdraw this proposal?',
      'The formation team will stop reviewing it. The proposal is kept, but it can no longer be revised, accepted or denied.',
      'Withdraw',
      () => this.run('withdraw', this.projectApplicationService.withdraw(application), 'Proposal withdrawn')
    );
  }

  protected onDeny(): void {
    const application = this.application();
    if (!application) return;
    this.confirm('Deny this proposal?', 'The proposal is kept with a Denied status. The submitter is not notified automatically.', 'Deny', () =>
      this.run('deny', this.projectApplicationService.deny(application), 'Proposal denied')
    );
  }

  protected onDelete(): void {
    const application = this.application();
    if (!application) return;
    this.confirm('Delete this proposal?', 'This permanently removes the proposal and its answers. This cannot be undone.', 'Delete', () => {
      this.busyAction.set('delete');
      this.projectApplicationService
        .remove(application)
        .pipe(finalize(() => this.busyAction.set(null)))
        .subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Proposal deleted' });
            this.deleted.emit(application.uid);
            this.visible.set(false);
          },
          error: (error: unknown) => this.handleWriteError(error),
        });
    });
  }

  protected openAcceptDialog(): void {
    this.acceptForm.reset({ parent: null });
    this.selectedParent.set(null);
    this.parentSuggestions.set([]);
    this.acceptDialogVisible.set(true);
  }

  protected closeAcceptDialog(): void {
    this.acceptDialogVisible.set(false);
  }

  protected searchParents(event: AutoCompleteCompleteEvent): void {
    const query = (event.query ?? '').trim();
    if (query.length < 2) {
      this.parentSuggestions.set([]);
      return;
    }
    this.projectService
      .searchProjects(query)
      .pipe(take(1))
      .subscribe((projects) => this.parentSuggestions.set(projects.filter((project) => !!project.uid)));
  }

  protected onParentSelected(event: AutoCompleteSelectEvent): void {
    this.selectedParent.set((event.value as Project) ?? null);
  }

  protected onParentCleared(): void {
    this.selectedParent.set(null);
  }

  protected confirmAccept(): void {
    const application = this.application();
    const parent = this.selectedParent();
    if (!application || !parent?.uid) return;
    this.run('accept', this.projectApplicationService.accept(application, parent.uid), `Proposal accepted under ${parent.name}`, false, () =>
      this.acceptDialogVisible.set(false)
    );
  }

  // === Private Helpers ===
  private run(action: string, request$: Observable<ProjectApplicationWriteResult>, successSummary: string, inline = false, onSuccess?: () => void): void {
    this.busyAction.set(action);
    request$.pipe(finalize(() => this.busyAction.set(null))).subscribe({
      next: (result) => {
        this.messageService.add({ severity: 'success', summary: successSummary });
        onSuccess?.();
        this.changed.emit(result.application);
      },
      error: (error: unknown) => this.handleWriteError(error, inline),
    });
  }

  /**
   * 412/404 mean the held copy is no longer current — never replay; close any edit state and have the
   * list reload so the user sees the latest before trying again. Anything else shows the server's safe
   * message (inline while editing, so the form keeps the user's changes).
   */
  private handleWriteError(error: unknown, inline = false): void {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 412 || status === 404) {
      this.messageService.add({
        severity: 'warn',
        summary: status === 412 ? 'This proposal changed since you opened it' : 'This proposal is no longer available',
        detail: status === 412 ? 'The latest version has been loaded. Review it and try again.' : undefined,
      });
      this.editing.set(false);
      this.acceptDialogVisible.set(false);
      this.stale.emit();
      return;
    }
    const message = extractErrorMessage(error, 'Something went wrong. Please try again.');
    if (inline) {
      this.errorMessage.set(message);
      return;
    }
    this.messageService.add({ severity: 'error', summary: 'Action failed', detail: message });
  }

  /** Every confirm here is for a hard-to-undo decision, so the accept button is always styled as danger. */
  private confirm(header: string, message: string, acceptLabel: string, accept: () => void): void {
    this.confirmationService.confirm({
      key: 'project-application-drawer',
      header,
      message,
      acceptLabel,
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept,
    });
  }
}
