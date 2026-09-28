// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, ElementRef, inject, input, model, output, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { MessageComponent } from '@components/message/message.component';
import { TagComponent } from '@components/tag/tag.component';
import type {
  Project,
  ProjectApplication,
  ProjectApplicationAcceptDialogData,
  ProjectApplicationAnswerLink,
  ProjectApplicationAnswers,
  ProjectApplicationAnswerSection,
  ProjectApplicationStateMeta,
  ProjectApplicationStatusCallout,
  ProjectApplicationViewMode,
  ProjectApplicationWriteResult,
} from '@lfx-one/shared/interfaces';
import {
  buildProjectApplicationAnswerSections,
  getProjectApplicationDisplayName,
  getProjectApplicationStateMeta,
  getProjectApplicationStatusCallout,
  isProjectApplicationOpen,
  toProjectApplicationEmailLink,
} from '@lfx-one/shared/utils';
import { ProjectApplicationService } from '@services/project-application.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DrawerModule } from 'primeng/drawer';
import { DialogService } from 'primeng/dynamicdialog';
import type { DrawerPassThroughOptions } from 'primeng/types/drawer';
import { combineLatest, distinctUntilChanged, filter, finalize, map, Observable, pairwise, take } from 'rxjs';

import { ProjectApplicationAcceptDialogComponent } from '../project-application-accept-dialog/project-application-accept-dialog.component';
import { ProjectApplicationFormComponent } from '../project-application-form/project-application-form.component';

/**
 * Detail + actions for one project application (#3037). Submitters may revise, withdraw and delete;
 * the formation team (`mode === 'staff'`) may additionally accept — choosing the parent project the
 * backend creates the new project under — and deny. Revise/withdraw/accept/deny are offered only while
 * the application is `submitted`; delete is always offered and always confirmed.
 *
 * The footer leads with each persona's primary action (#3046): Accept and Deny for the formation team,
 * Revise for the submitter. The remaining actions — delete always last and set apart — sit in a "More
 * actions" menu, or, once the application is decided, delete stands alone.
 *
 * Every write sends the held revision as `If-Match`. Neither a 412 (another write won) nor a 404 (deleted
 * elsewhere) is replayed: a 412 asks the list to reload; a 404 asks it to drop the application.
 * Answers render as text; a URL or email answer becomes a link only when it passes `toProjectApplicationUrlLink` /
 * `toProjectApplicationEmailLink` (http(s) with a host, or a plain single address).
 */
@Component({
  selector: 'lfx-project-application-drawer',
  imports: [ButtonComponent, ConfirmDialogModule, DatePipe, DrawerModule, MenuComponent, MessageComponent, ProjectApplicationFormComponent, TagComponent],
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
  /** Mirrors the More actions popup so its trigger can expose `aria-expanded`. */
  protected readonly moreMenuOpen = signal(false);

  // === Computed Signals ===
  protected readonly stateMeta: Signal<ProjectApplicationStateMeta> = computed(() => getProjectApplicationStateMeta(this.application()?.state));
  protected readonly sections: Signal<ProjectApplicationAnswerSection[]> = computed(() =>
    buildProjectApplicationAnswerSections(this.application()?.application)
  );
  protected readonly projectName: Signal<string> = computed(() => getProjectApplicationDisplayName(this.application()));
  protected readonly isOpen: Signal<boolean> = this.initIsOpen();
  protected readonly isStaff: Signal<boolean> = computed(() => this.mode() === 'staff');
  protected readonly busy: Signal<boolean> = computed(() => this.busyAction() !== null);
  protected readonly statusCallout: Signal<ProjectApplicationStatusCallout | null> = computed(() =>
    getProjectApplicationStatusCallout(this.application()?.state, this.mode())
  );
  /** The submitter's email as a `mailto:` link target — shown to the formation team only. */
  protected readonly submitterEmailLink: Signal<ProjectApplicationAnswerLink | null> = this.initSubmitterEmailLink();
  /** "Updated" only adds information once it falls on a different day from the submission. */
  protected readonly showUpdated: Signal<boolean> = this.initShowUpdated();
  protected readonly moreActions: Signal<MenuItem[]> = this.initMoreActions();
  /**
   * p-drawer renders an unnamed complementary landmark; a modal drawer must announce as a named dialog. The footer
   * template stays statically declared, so while editing (the form has its own buttons) it is hidden via `pt`.
   */
  protected readonly drawerPt: Signal<DrawerPassThroughOptions> = this.initDrawerPt();
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

  // === Private Initializers ===
  private initIsOpen(): Signal<boolean> {
    return computed(() => {
      const application = this.application();
      return application ? isProjectApplicationOpen(application) : false;
    });
  }

  private initSubmitterEmailLink(): Signal<ProjectApplicationAnswerLink | null> {
    return computed(() => {
      const email = this.application()?.submitter_email;
      return email ? toProjectApplicationEmailLink(email) : null;
    });
  }

  private initDrawerPt(): Signal<DrawerPassThroughOptions> {
    return computed(() => ({
      root: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'project-application-drawer-title' },
      footer: { class: this.editing() || !this.application() ? 'hidden' : 'border-t border-gray-200' },
    }));
  }

  private initShowUpdated(): Signal<boolean> {
    return computed(() => {
      const application = this.application();
      if (!application?.updated_at || !application.created_at) return false;
      return new Date(application.updated_at).toDateString() !== new Date(application.created_at).toDateString();
    });
  }

  /** Secondary actions for an open application; the persona's primary actions render as footer buttons instead. */
  private initMoreActions(): Signal<MenuItem[]> {
    return computed(() => {
      const items: MenuItem[] = [];
      if (this.isStaff()) {
        items.push({ label: 'Revise', icon: 'fa-light fa-pen', command: () => this.startEditing() });
      }
      items.push(
        { label: 'Withdraw', icon: 'fa-light fa-arrow-rotate-left', command: () => this.onWithdraw() },
        { separator: true },
        { label: 'Delete', icon: 'fa-light fa-trash', styleClass: 'text-red-500', command: () => this.onDelete() }
      );
      return items;
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
