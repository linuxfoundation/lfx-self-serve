// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, ElementRef, inject, input, model, output, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import type {
  Project,
  ProjectApplication,
  ProjectApplicationAcceptDialogData,
  ProjectApplicationAnswers,
  ProjectApplicationAnswerSection,
  ProjectApplicationStateMeta,
  ProjectApplicationViewMode,
  ProjectApplicationWriteResult,
} from '@lfx-one/shared/interfaces';
import {
  buildProjectApplicationAnswerSections,
  getProjectApplicationDisplayName,
  getProjectApplicationStateMeta,
  isProjectApplicationOpen,
} from '@lfx-one/shared/utils';
import { ProjectApplicationService } from '@services/project-application.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DrawerModule } from 'primeng/drawer';
import { DialogService } from 'primeng/dynamicdialog';
import { combineLatest, distinctUntilChanged, filter, finalize, map, Observable, pairwise, take } from 'rxjs';

import { ProjectApplicationAcceptDialogComponent } from '../project-application-accept-dialog/project-application-accept-dialog.component';
import { ProjectApplicationFormComponent } from '../project-application-form/project-application-form.component';

/**
 * Detail + actions for one project application (#3037). Submitters may revise, withdraw and delete;
 * the formation team (`mode === 'staff'`) may additionally accept — choosing the parent project the
 * backend creates the new project under — and deny. Revise/withdraw/accept/deny are offered only while
 * the application is `submitted`; delete is always offered and always confirmed.
 *
 * Every write sends the held revision as `If-Match`. Neither a 412 (another write won) nor a 404 (deleted
 * elsewhere) is replayed: a 412 asks the list to reload; a 404 asks it to drop the application.
 * Answers render as plain text only.
 */
@Component({
  selector: 'lfx-project-application-drawer',
  imports: [ButtonComponent, ConfirmDialogModule, DatePipe, DrawerModule, ProjectApplicationFormComponent, TagComponent],
  templateUrl: './project-application-drawer.component.html',
})
export class ProjectApplicationDrawerComponent {
  // === Services ===
  private readonly projectApplicationService = inject(ProjectApplicationService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  // === Inputs ===
  public readonly application = input<ProjectApplication | null>(null);
  public readonly mode = input<ProjectApplicationViewMode>('submitter');

  // === Outputs ===
  /** A write succeeded; carries the application as the backend returned it. */
  public readonly changed = output<ProjectApplication>();
  /** The application was deleted. */
  public readonly deleted = output<string>();
  /** The held revision is stale (412); carries the UID the write targeted — reload before any further write. */
  public readonly stale = output<string>();
  /** A write found the application already gone (404); carries its UID so the list drops it. */
  public readonly gone = output<string>();

  // === View queries ===
  private readonly titleRef = viewChild<ElementRef<HTMLElement>>('titleRef');

  // === Models ===
  public readonly visible = model<boolean>(false);

  // === Writable Signals ===
  protected readonly editing = signal(false);
  protected readonly busyAction = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  // === Computed Signals ===
  protected readonly stateMeta: Signal<ProjectApplicationStateMeta> = computed(() => getProjectApplicationStateMeta(this.application()?.state));
  protected readonly sections: Signal<ProjectApplicationAnswerSection[]> = computed(() =>
    buildProjectApplicationAnswerSections(this.application()?.application)
  );
  protected readonly projectName: Signal<string> = computed(() => getProjectApplicationDisplayName(this.application()));
  protected readonly isOpen = computed(() => {
    const application = this.application();
    return application ? isProjectApplicationOpen(application) : false;
  });
  protected readonly isStaff = computed(() => this.mode() === 'staff');
  protected readonly busy = computed(() => this.busyAction() !== null);
  /** p-drawer renders an unnamed complementary landmark; a modal drawer must announce as a named dialog. */
  protected readonly drawerPt = { root: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'project-application-drawer-title' } };
  /** The element that had focus when the drawer opened, handed focus back on every close path. */
  private opener: HTMLElement | null = null;

  // === Constructor ===
  public constructor() {
    // Opening a different application, or closing the drawer, always returns to read mode with no stale
    // error. Keyed on the UID so a successful write (same UID, new revision) doesn't reset anything itself.
    combineLatest([
      toObservable(this.application).pipe(
        map((application) => application?.uid ?? null),
        distinctUntilChanged()
      ),
      toObservable(this.visible),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.editing.set(false);
        this.errorMessage.set(null);
      });

    // Hand focus back to the opener on every close — PrimeNG emits (onHide) only for its own Escape/mask
    // close, never for a programmatic visible.set(false) such as the post-delete close.
    toObservable(this.visible)
      .pipe(
        pairwise(),
        filter(([was, is]) => was && !is),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.restoreFocus());
  }

  // === Protected Methods ===
  /** Moves focus into the drawer (its title) and remembers the opener to return to on close. */
  protected onDrawerShow(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const active = this.document.activeElement;
    this.opener = active instanceof HTMLElement ? active : null;
    this.titleRef()?.nativeElement.focus();
  }

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
    this.run('revise', application.uid, this.projectApplicationService.revise(application, answers), 'Proposal updated', true, () => this.editing.set(false));
  }

  protected onWithdraw(): void {
    const application = this.application();
    if (!application) return;
    this.confirm(
      'Withdraw this proposal?',
      'The formation team will stop reviewing it. The proposal is kept, but it can no longer be revised, accepted or denied.',
      'Withdraw',
      () => this.run('withdraw', application.uid, this.projectApplicationService.withdraw(application), 'Proposal withdrawn')
    );
  }

  protected onDeny(): void {
    const application = this.application();
    if (!application) return;
    this.confirm('Deny this proposal?', 'The proposal is kept with a Denied status. The submitter is not notified automatically.', 'Deny', () =>
      this.run('deny', application.uid, this.projectApplicationService.deny(application), 'Proposal denied')
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
          error: (error: unknown) => this.handleWriteError(error, application.uid),
        });
    });
  }

  /** Opens the parent-project picker; accepting runs only once the team has chosen a parent. */
  protected onAccept(): void {
    const application = this.application();
    if (!application) return;
    const data: ProjectApplicationAcceptDialogData = { projectName: this.projectName() };
    const ref = this.dialogService.open(ProjectApplicationAcceptDialogComponent, {
      header: 'Accept proposal',
      width: '520px',
      modal: true,
      closable: true,
      data,
    });
    ref?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((parent: Project | undefined) => {
      if (parent?.uid) {
        this.acceptUnder(application, parent);
      }
    });
  }

  // === Private Helpers ===
  private restoreFocus(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) {
      setTimeout(() => opener.focus());
    }
  }

  private acceptUnder(application: ProjectApplication, parent: Project): void {
    this.busyAction.set('accept');
    this.projectApplicationService
      .accept(application, parent.uid)
      .pipe(finalize(() => this.busyAction.set(null)))
      .subscribe({
        next: (result) => {
          this.messageService.add({ severity: 'success', summary: `Proposal accepted under ${parent.name}` });
          this.changed.emit(result.application);
        },
        // Accept is two upstream writes (record the parent, then accept). Any failure may have landed
        // after the first, so the held revision can no longer be trusted: never retry — a 404 drops the
        // application, anything else reloads.
        error: (error: unknown) => this.handleAcceptError(error, application.uid),
      });
  }

  private run(
    action: string,
    uid: string,
    request$: Observable<ProjectApplicationWriteResult>,
    successSummary: string,
    inline = false,
    onSuccess?: () => void
  ): void {
    this.busyAction.set(action);
    request$.pipe(finalize(() => this.busyAction.set(null))).subscribe({
      next: (result) => {
        this.messageService.add({ severity: 'success', summary: successSummary });
        onSuccess?.();
        this.changed.emit(result.application);
      },
      error: (error: unknown) => this.handleWriteError(error, uid, inline),
    });
  }

  /**
   * Neither case is replayed. A 412 closes any edit state and emits `stale` (the list reloads); a 404 emits
   * `gone` with the UID the failed write was issued for — captured at request time, never the application
   * open now, which may have changed while the request was in flight — so the list drops it. Anything else
   * shows the server's safe message (inline while editing, so the form keeps the user's changes).
   */
  private handleWriteError(error: unknown, uid: string, inline = false): void {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 404) {
      this.messageService.add({ severity: 'warn', summary: 'This proposal is no longer available' });
      this.editing.set(false);
      this.gone.emit(uid);
      return;
    }
    if (status === 412) {
      this.messageService.add({
        severity: 'warn',
        summary: 'This proposal changed since you opened it',
        detail: 'The latest version has been loaded. Review it and try again.',
      });
      this.editing.set(false);
      this.stale.emit(uid);
      return;
    }
    const message = extractErrorMessage(error, 'Something went wrong. Please try again.');
    if (inline) {
      this.errorMessage.set(message);
      return;
    }
    this.messageService.add({ severity: 'error', summary: 'Action failed', detail: message });
  }

  private handleAcceptError(error: unknown, uid: string): void {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 412 || status === 404) {
      this.handleWriteError(error, uid);
      return;
    }
    this.messageService.add({
      severity: 'error',
      summary: 'The proposal could not be accepted',
      detail: `${extractErrorMessage(error, 'Something went wrong.')} The latest version has been loaded; check it before trying again.`,
    });
    this.stale.emit(uid);
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
