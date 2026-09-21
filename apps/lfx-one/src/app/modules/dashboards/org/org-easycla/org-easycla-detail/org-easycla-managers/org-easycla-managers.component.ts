// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ORG_CLA_MANAGER_REFUSAL_COPY, ORG_CLA_MANAGER_REFUSALS, ORG_CLA_MANAGER_REMOVE_COPY, ORG_CLA_MANAGERS_COPY } from '@lfx-one/shared/constants';
import type { OrgClaGroup, OrgClaManager, OrgClaManagerAddRequest, OrgClaManagerRefusal, OrgClaManagerRow } from '@lfx-one/shared/interfaces';
import { formatClaSignedOnInstant, orgClaPairProjectSfid } from '@lfx-one/shared/utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { combineLatest, distinctUntilChanged, finalize, forkJoin, of, skip, switchMap, take, takeUntil, tap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MessageComponent } from '@components/message/message.component';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { UserService } from '@services/user.service';

import {
  orgClaAddManagerDialogConfig,
  OrgEasyclaAddManagerDialogComponent,
} from '../../org-easycla-add-manager-dialog/org-easycla-add-manager-dialog.component';

@Component({
  selector: 'lfx-org-easycla-managers',
  imports: [ButtonComponent, ConfirmDialogModule, EmptyStateComponent, MessageComponent, SkeletonModule, TooltipModule],
  providers: [DialogService, ConfirmationService],
  templateUrl: './org-easycla-managers.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaManagersComponent implements OnInit {
  private readonly claService = inject(OrgLensClaService);
  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly userService = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly orgUid = input.required<string>();
  public readonly signatureId = input.required<string>();
  public readonly signed = input.required<boolean>();
  public readonly claGroup = input.required<OrgClaGroup>();

  public readonly managerCountChanged = output<number>();

  protected readonly copy = ORG_CLA_MANAGERS_COPY;

  protected readonly managers = signal<OrgClaManager[] | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly writing = signal(false);
  private destroyed = false;
  private addDialog: DynamicDialogRef | null = null;

  private readonly contextChanged$ = combineLatest([toObservable(this.orgUid), toObservable(this.signatureId)]).pipe(skip(1));

  protected readonly viewerUsername = computed(() => this.userService.viewerUsername()?.trim().toLowerCase() ?? '');

  protected readonly empty = computed(() => this.managers()?.length === 0);

  protected readonly lastManager = computed(() => this.managers()?.length === 1);

  protected readonly rows = computed(() => this.initRows());

  /**
   * ACS grants for the two manager writes (#1984). Separate strings: Add is the same
   * `signature_approval_list:update` Corporate Console uses for that button; Remove is
   * `cla_manager_delete:remove`. Null while the hop has not arrived — hide, do not guess.
   */
  private readonly addGrant = signal<boolean | null>(null);
  private readonly removeGrant = signal<boolean | null>(null);

  protected readonly canAdd = computed(() => this.addGrant() === true);
  protected readonly canRemove = computed(() => this.removeGrant() === true);

  public constructor() {
    this.contextChanged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.onContextChanged());

    toObservable(
      computed(() => {
        if (!this.signed()) return '';
        const orgUid = this.orgUid();
        const projectSfid = orgClaPairProjectSfid(this.claGroup());
        return orgUid && projectSfid ? `${orgUid}::${projectSfid}` : '';
      })
    )
      .pipe(
        distinctUntilChanged(),
        tap(() => {
          this.addGrant.set(null);
          this.removeGrant.set(null);
        }),
        switchMap((pair) => {
          if (!pair) return of({ add: false, remove: false });
          const [orgUid, projectSfid] = pair.split('::');
          return forkJoin({
            add: this.claService.checkPermission(orgUid, 'approval-list-update', projectSfid),
            remove: this.claService.checkPermission(orgUid, 'cla-manager-delete', projectSfid),
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ add, remove }) => {
        this.addGrant.set(add);
        this.removeGrant.set(remove);
      });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
  }

  // The parent renders this panel only while its tab is selected, so being constructed is the
  // signal to load. A parent-driven trigger cannot work here: the app is zoneless, so the pass
  // that creates this component is scheduled as a macrotask, and anything the parent queues on
  // selection runs while its own view query is still empty.
  public ngOnInit(): void {
    this.loadIfNeeded();
  }

  /**
   * Loads the roster once the tab is showing. Idempotent: a second call after the first
   * request or a completed load is a no-op. The parent used to drive this; construction is
   * now the same moment (the panel is created only while the tab is selected).
   */
  public loadIfNeeded(): void {
    if (!this.signed() || this.loading() || this.managers() !== null || this.loadFailed()) return;
    this.fetchManagers();
  }

  protected retry(): void {
    this.fetchManagers();
  }

  protected openAdd(): void {
    if (!this.canAdd() || this.writing()) return;

    const target = this.writeTarget();
    if (!target) return;

    this.addDialog?.close();
    const ref = this.dialogService.open(OrgEasyclaAddManagerDialogComponent, orgClaAddManagerDialogConfig());
    if (!ref) return;

    this.addDialog = ref;
    ref.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((request?: OrgClaManagerAddRequest) => {
      this.addDialog = null;
      if (request) this.addManager(request, target);
    });
  }

  protected confirmRemove(manager: OrgClaManager): void {
    if (!this.canRemove() || this.writing() || this.lastManager()) return;

    const target = this.writeTarget();
    if (!target) return;

    const label = this.displayName(manager);
    this.confirmationService.confirm({
      header: ORG_CLA_MANAGER_REMOVE_COPY.title(label),
      message: this.isSelf(manager) ? ORG_CLA_MANAGER_REMOVE_COPY.self : ORG_CLA_MANAGER_REMOVE_COPY.other(label),
      acceptLabel: this.copy.removeAction,
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.removeManager(manager, target),
    });
  }

  protected displayName(manager: OrgClaManager): string {
    return manager.name?.trim() || manager.lfUsername;
  }

  protected isSelf(manager: OrgClaManager): boolean {
    const viewer = this.viewerUsername();
    return !!viewer && manager.lfUsername.trim().toLowerCase() === viewer;
  }

  private initRows(): OrgClaManagerRow[] | null {
    const managers = this.managers();
    if (!managers) return null;

    return managers.map((manager) => {
      const displayName = this.displayName(manager);
      const email = manager.email?.trim();
      return {
        manager,
        displayName,
        removeLabel: `Remove ${displayName} as CLA Manager`,
        mailtoHref: email ? `mailto:${email}` : null,
        addedLabel: formatClaSignedOnInstant(manager.addedOn ?? ''),
      };
    });
  }

  private fetchManagers(): void {
    const orgUid = this.orgUid();
    const signatureId = this.signatureId();
    if (!orgUid || !signatureId) return;

    this.loading.set(true);
    this.loadFailed.set(false);

    // `loading` is cleared on each outcome rather than in `finalize`, because a cancellation is
    // not an outcome: the context-change handler starts the replacement fetch before the
    // cancelled stream would unwind, so a `finalize` would clear the flag the new request just
    // set and leave the panel showing neither skeleton, error, nor table.
    this.claService
      .getManagers(orgUid, signatureId)
      .pipe(takeUntil(this.contextChanged$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          // `contextChanged$` re-emits a cycle after the inputs change, so `takeUntil` can let one
          // response for the previous agreement through. The echoed id is what tells them apart;
          // the context-change handler that is already queued refetches.
          if (result.signatureId !== this.signatureId()) return;

          this.loading.set(false);
          this.managers.set(result.managers);
          this.managerCountChanged.emit(result.managers.length);
        },
        error: () => {
          this.loading.set(false);
          this.loadFailed.set(true);
          this.managers.set(null);
        },
      });
  }

  private addManager(request: OrgClaManagerAddRequest, target: { orgUid: string; signatureId: string }): void {
    if (this.writing() || !this.stillOn(target)) return;

    this.writing.set(true);
    this.claService
      .addManager(target.orgUid, target.signatureId, request)
      .pipe(finalize(() => {
        if (!this.destroyed) this.writing.set(false);
      }))
      .subscribe({
        next: (manager) => {
          if (this.destroyed || !this.stillOn(target)) return;
          this.messageService.add({
            severity: 'success',
            summary: this.copy.addedTitle,
            detail: `${this.displayName(manager)} has been added as a CLA Manager for this CLA and can act immediately.`,
          });
          this.fetchManagers();
        },
        error: (error: unknown) => {
          if (this.destroyed || !this.stillOn(target)) return;
          this.reportRefusal(error);
        },
      });
  }

  private removeManager(manager: OrgClaManager, target: { orgUid: string; signatureId: string }): void {
    if (this.writing() || !this.stillOn(target)) return;

    this.writing.set(true);
    this.claService
      .removeManager(target.orgUid, target.signatureId, manager.lfUsername)
      .pipe(finalize(() => {
        if (!this.destroyed) this.writing.set(false);
      }))
      .subscribe({
        next: () => {
          if (this.destroyed || !this.stillOn(target)) return;
          if (this.isSelf(manager)) {
            this.addGrant.set(false);
            this.removeGrant.set(false);
          }
          this.messageService.add({
            severity: 'success',
            summary: 'CLA Manager removed',
            detail: `${this.displayName(manager)} is no longer a CLA Manager for this CLA.`,
          });
          this.fetchManagers();
        },
        error: (error: unknown) => {
          if (this.destroyed || !this.stillOn(target)) return;
          this.reportRefusal(error);
        },
      });
  }

  private reportRefusal(error: unknown): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Could not update CLA Managers',
      detail: ORG_CLA_MANAGER_REFUSAL_COPY[this.refusalFrom(error)],
    });
  }

  // Membership is tested against the canonical list, not with `in` on the copy table: `in` walks
  // the prototype chain, so an upstream code of `toString` would pass and index a function.
  private refusalFrom(error: unknown): OrgClaManagerRefusal {
    const code = (error as { error?: { upstreamCode?: unknown } } | undefined)?.error?.upstreamCode;
    return ORG_CLA_MANAGER_REFUSALS.includes(code as OrgClaManagerRefusal) ? (code as OrgClaManagerRefusal) : 'unknown';
  }

  private writeTarget(): { orgUid: string; signatureId: string } | null {
    const orgUid = this.orgUid();
    const signatureId = this.signatureId();
    return orgUid && signatureId ? { orgUid, signatureId } : null;
  }

  private stillOn(target: { orgUid: string; signatureId: string }): boolean {
    const live = this.writeTarget();
    return !!live && live.orgUid === target.orgUid && live.signatureId === target.signatureId;
  }

  private dismissPendingWrites(): void {
    this.addDialog?.close();
    this.addDialog = null;
    this.confirmationService.close();
  }

  private onContextChanged(): void {
    this.dismissPendingWrites();
    this.managers.set(null);
    this.loadFailed.set(false);

    if (this.signed()) this.fetchManagers();
  }
}
