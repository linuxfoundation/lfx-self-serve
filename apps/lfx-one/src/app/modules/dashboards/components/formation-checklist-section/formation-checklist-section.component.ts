// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, DestroyRef, inject, input, Signal, signal } from '@angular/core';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MessageComponent } from '@components/message/message.component';
import { ProjectContextService } from '@services/project-context.service';
import { FormationService } from '@services/formation.service';
import type {
  FormationChecklistPageState,
  FormationChecklistResponse,
  FormationItem,
  FormationRenderedSection,
  FormationRowReasonedStatusChange,
  FormationRowStatusChange,
  ReasonedFormationStatus,
  ReasonPromptDialogResult,
} from '@lfx-one/shared/interfaces';
import { collectFormationOrphanItems, groupFormationItemsBySection, isFormationLifecycleLive } from '@lfx-one/shared/utils';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, catchError, combineLatest, distinctUntilChanged, finalize, of, switchMap, take, tap } from 'rxjs';

import { ReasonPromptDialogComponent } from '@components/reason-prompt-dialog/reason-prompt-dialog.component';

import { FormationChecklistRowComponent } from '../formation-checklist-row/formation-checklist-row.component';
import { FormationItemDrawerComponent } from '../formation-item-drawer/formation-item-drawer.component';
import { FormationReadinessStripComponent } from '../formation-readiness-strip/formation-readiness-strip.component';

@Component({
  selector: 'lfx-formation-checklist-section',
  // ReasonPromptDialogComponent is deliberately not here — it's opened dynamically via
  // DialogService.open(), never referenced in this component's own template.
  imports: [
    SkeletonModule,
    EmptyStateComponent,
    MessageComponent,
    FormationReadinessStripComponent,
    FormationChecklistRowComponent,
    FormationItemDrawerComponent,
  ],
  providers: [DialogService],
  templateUrl: './formation-checklist-section.component.html',
  styleUrl: './formation-checklist-section.component.scss',
})
export class FormationChecklistSectionComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly formationService = inject(FormationService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Renders another project's checklist by explicit slug, without touching the project context —
   * the foundation formations drill-down (`/foundation/formations/:projectSlug`, LFXV2-3386) sits
   * in the *foundation's* context while showing a child project's checklist. `null` (the default)
   * preserves the original behavior: the slug comes from `ProjectContextService.activeContext()`,
   * as on `/project/formation`.
   */
  public readonly projectSlug = input<string | null>(null);

  private readonly refresh$ = new BehaviorSubject<void>(undefined);
  private readonly loadFailed = signal(false);
  // Starts true — both hosts guarantee a slug on the very first combineLatest emission
  // (`/project/formation`'s `formationProjectEnabledGuard` confirmed a Formation-stage project
  // context; the foundation drill-down only renders this component once its `projectSlug` input is
  // resolved); starting false would flash the "Choose a template" empty state for one frame first.
  protected readonly loading = signal(true);

  public readonly drawerVisible = signal(false);
  public readonly drawerItemUid = signal<string | null>(null);
  /** Set alongside `drawerItemUid` in `onOpenDrawer` — the drawer's `itemProjectUid`/`itemKey` inputs read off this, since GH-2267 Phase 2 addresses items by `(project_uid, item_key)`, not by uid. */
  public readonly drawerItemAddress = signal<{ projectUid: string; itemKey: string } | null>(null);

  /**
   * Item uids with a mutation currently in flight, tagged by kind — guards a double-click (or a
   * click on one surface while the other is mid-write) into issuing two writes for the same item.
   * `'row'`/`'skip'` are begun/ended here directly; `'drawer'` is registered from the drawer's own
   * `writeStarted`/`writeEnded` (Mark complete/Save), which is otherwise invisible to this section —
   * without it, closing the drawer mid-write and then firing a row action for the same item would
   * race undetected. Drives the row button's `[loading]` (which itself blocks re-entry — see
   * `ButtonComponent.handleClick`) and, via `drawerItemMutationInFlight`/`drawerItemSkipInFlight` ->
   * the drawer's `mutationInFlight`/`skipInFlight` inputs, the drawer's `busy()`-gated
   * `[disabled]` state and its skip button's own `[loading]`.
   */
  protected readonly submittingItemUids = signal<ReadonlyMap<string, 'row' | 'skip' | 'drawer'>>(new Map());
  /** `drawerItemUid()` is nullable — spelled out explicitly rather than leaning on a `?? ''` sentinel that would coincidentally collide with a real (if invalid) empty-string uid. */
  protected readonly drawerItemMutationInFlight: Signal<boolean> = computed(() => {
    const uid = this.drawerItemUid();
    return uid !== null && this.submittingItemUids().has(uid);
  });
  /** Narrower than `drawerItemMutationInFlight` — true only while this item's own in-flight mutation is specifically a skip, so a row action elsewhere doesn't spin the drawer's Skip button. */
  protected readonly drawerItemSkipInFlight: Signal<boolean> = computed(() => {
    const uid = this.drawerItemUid();
    return uid !== null && this.submittingItemUids().get(uid) === 'skip';
  });

  private readonly response: Signal<FormationChecklistResponse | null> = this.initResponse();
  protected readonly formation = computed(() => this.response()?.formation ?? null);
  protected readonly template = computed(() => this.response()?.template ?? null);
  protected readonly items = computed(() => this.response()?.items ?? []);
  /**
   * GH-2328: true whenever the formation's upstream `lifecycle` isn't (recognizably) `'live'` —
   * `isFormationLifecycleLive` fails closed, so a `null` formation (still loading) or an
   * unrecognized `lifecycle` both count as read-only, never as live. Passed down to every row and
   * to the drawer; `readOnlyMessage` below drives the banner explaining why.
   */
  protected readonly readOnly = computed(() => !isFormationLifecycleLive(this.formation()?.lifecycle ?? null));
  /**
   * GH-2694: the caller's real `project.writer` on THIS checklist's project, resolved fail-closed
   * by the BFF (see `FormationChecklistResponse.can_write`'s doc comment) — a still-loading `null`
   * response counts as not-writable, never as writable. Passed to the drawer's `canWrite` input,
   * which previously went unbound here and so defaulted `true`: every caller was offered editable
   * assignee/due-date fields (and enabled Mark complete/Skip) whose writer-gated upstream routes
   * then refused the save.
   */
  protected readonly canWrite = computed(() => this.response()?.can_write === true);
  /**
   * GH-2705: the full pair the gateway's `set_item_status` rule checks — `can_write` plus
   * `team:formation` membership (see `FormationChecklistResponse.can_set_status`). Gates every
   * status-moving affordance (row status menu, skip entry, quick action, drawer Mark
   * complete/Skip), which `canWrite` alone cannot honestly gate: a writer outside the formation
   * team was offered a status dropdown whose every write the gateway deterministically 403'd.
   */
  protected readonly canSetStatus = computed(() => this.response()?.can_set_status === true);
  /** Names the reason for the `readOnly` banner — the two known terminal lifecycles get their own copy; anything else (including a future 4th upstream value) names the raw string rather than staying silent about it. */
  protected readonly readOnlyMessage = computed(() => {
    const formation = this.formation();
    if (!formation) return '';
    switch (formation.lifecycle) {
      case 'completed':
        return 'This formation is complete.';
      case 'frozen':
        return 'This formation is frozen.';
      default:
        return `This formation is read-only (status: "${formation.lifecycle_raw}").`;
    }
  });

  /** Kept a pure derivation — logging on the raw fetch (see `logOrphanSectionKeys`) instead of here avoids a side effect inside a `computed()`. */
  protected readonly renderedSections: Signal<FormationRenderedSection[]> = computed(() =>
    groupFormationItemsBySection(this.items(), this.template()?.sections ?? [])
  );

  protected readonly pageState: Signal<FormationChecklistPageState> = computed(() => {
    if (this.loading()) return 'loading';
    if (this.loadFailed()) return 'error';
    if (!this.template()) return 'no-template';
    if (this.items().length === 0) return 'no-items';
    return 'ready';
  });

  protected onRetry(): void {
    this.loading.set(true);
    this.refresh$.next();
  }

  protected onOpenDrawer(item: FormationItem): void {
    this.drawerItemUid.set(item.uid);
    this.drawerItemAddress.set({ projectUid: item.project_uid, itemKey: item.template_item_key });
    this.drawerVisible.set(true);
  }

  /**
   * `provisionable` calls `updateFormationItemStatus` directly to `done` (no reason required);
   * `request` targets `blocked`, which upstream always requires a reason for
   * (`blocked_reason_required`) — routed through `onRowReasonedStatusRequested` instead of writing
   * directly, same as the status menu's own "Mark blocked…". The row only renders this action for
   * `in_progress` (`FormationChecklistRowComponent.isActionable`), but guard here too since this
   * method is reachable directly from tests/future callers that bypass the row's own gating.
   */
  protected onRowAction(item: FormationItem): void {
    if (item.status !== 'in_progress') return;
    if (item.action === 'request') {
      this.onRowReasonedStatusRequested({ item, status: 'blocked' });
      return;
    }
    if (!this.beginSubmitting(item.uid, 'row')) return;

    this.formationService
      .updateFormationItemStatus(item.project_uid, item.template_item_key, String(item.version), { status: 'done' })
      .pipe(
        take(1),
        finalize(() => this.endSubmitting(item.uid))
      )
      .subscribe({
        next: () => this.refresh$.next(),
        error: (error: unknown) => {
          console.error('[FormationChecklistSection] Row action failed', error);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: serverAuthoredMessage(error, 'Could not complete this action.') });
        },
      });
  }

  /** Status-menu "Mark in progress" / "Mark done" — the two targets upstream never requires a `reason` for. */
  protected onRowStatusChanged(change: FormationRowStatusChange): void {
    if (!this.beginSubmitting(change.item.uid, 'row')) return;

    this.formationService
      .updateFormationItemStatus(change.item.project_uid, change.item.template_item_key, String(change.item.version), { status: change.status })
      .pipe(
        take(1),
        finalize(() => this.endSubmitting(change.item.uid))
      )
      .subscribe({
        next: () => this.refresh$.next(),
        error: (error: unknown) => {
          console.error('[FormationChecklistSection] Row status change failed', error);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: serverAuthoredMessage(error, 'Could not change this item’s status.') });
        },
      });
  }

  /**
   * Status-menu "Mark blocked…" / "Skip with reason" / "Back to not started" — every target upstream
   * requires a `reason` for (`blocked_reason_required`/`skip_reason_required`/`return_reason_required`).
   * `ReasonPromptDialogComponent` is a "confirm with a required reason" dialog (its `canConfirm`
   * rejects an empty/whitespace value) — there's no built-in optional-note mode, so all three always
   * prompt.
   */
  protected onRowReasonedStatusRequested({ item, status }: FormationRowReasonedStatusChange): void {
    const copy: Record<ReasonedFormationStatus, { header: string; prompt: string; placeholder: string }> = {
      blocked: {
        header: 'Mark blocked',
        prompt: `Marking "${item.title}" blocked requires a reason. This is logged in the item's history.`,
        placeholder: 'What is blocking this item?',
      },
      skipped: {
        header: 'Skip item',
        prompt: `Skipping "${item.title}" requires a reason. This is logged in the item's history.`,
        placeholder: 'Why is this item being skipped?',
      },
      not_started: {
        header: 'Back to not started',
        prompt: `Sending "${item.title}" back to not started requires a reason. This is logged in the item's history.`,
        placeholder: 'Why is this item going back to not started?',
      },
    };
    const { header, prompt, placeholder } = copy[status];
    const submitKind: 'row' | 'skip' = status === 'skipped' ? 'skip' : 'row';

    const ref = this.dialogService.open(ReasonPromptDialogComponent, {
      header,
      width: '480px',
      modal: true,
      data: { prompt, placeholder, confirmLabel: header },
    });

    ref?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: ReasonPromptDialogResult | undefined) => {
      if (!result?.reason || !this.beginSubmitting(item.uid, submitKind)) return;

      this.formationService
        .updateFormationItemStatus(item.project_uid, item.template_item_key, String(item.version), { status, reason: result.reason })
        .pipe(
          take(1),
          finalize(() => this.endSubmitting(item.uid))
        )
        .subscribe({
          next: () => {
            this.refresh$.next();
            // Same reasoning as onDrawerItemChanged: the reason dialog is modal, but once it closes
            // and this request is in flight, the drawer is interactive again — the user can switch to
            // a different item before this response lands, and closing unconditionally here would
            // yank that other item's drawer shut.
            if (item.uid === this.drawerItemUid()) this.drawerVisible.set(false);
            if (status === 'skipped') this.messageService.add({ severity: 'success', summary: 'Skipped', detail: `"${item.title}" was skipped.` });
          },
          error: (error: unknown) => {
            console.error('[FormationChecklistSection] Status change failed', error);
            this.messageService.add({ severity: 'error', summary: 'Error', detail: serverAuthoredMessage(error, 'Could not change this item’s status.') });
          },
        });
    });
  }

  /**
   * Mark complete changed the item's status — refresh the row list and close the drawer, but only if
   * it's still showing the item that changed. Mark complete is guarded against re-entry (`busy()`),
   * but nothing stops the user from closing this drawer and opening a different item before this
   * write's (possibly slow) response lands — closing unconditionally here would yank that other,
   * unrelated item's drawer shut out from under the user.
   */
  protected onDrawerItemChanged(item: FormationItem): void {
    this.refresh$.next();
    if (item.uid === this.drawerItemUid()) this.drawerVisible.set(false);
  }

  /** A metadata-only save (notes/assignee/due-date) — refresh the row list but leave the drawer open so the user keeps their place. */
  protected onDrawerItemUpdated(): void {
    this.refresh$.next();
  }

  /**
   * The drawer's own Mark complete/Save has started/finished a write — register/release it under the
   * uid the drawer emits (the item the write is actually *for*), not `drawerItemUid()`'s current
   * value: the drawer can switch to a different item (or close) before this write's response comes
   * back, and reading the section's current signal at that point would guard/release the wrong item.
   */
  protected onDrawerWriteStarted(uid: string): void {
    this.beginSubmitting(uid, 'drawer');
  }

  /**
   * `beginSubmitting` above can no-op (uid already claimed by a 'row'/'skip' write — the drawer's own
   * `busy()` should already have blocked this, but nothing enforces that from this side), so ending
   * must only retire an entry this drawer write actually registered — an unconditional `endSubmitting`
   * here would drop a different mutation's guard out from under it.
   */
  protected onDrawerWriteEnded(uid: string): void {
    if (this.submittingItemUids().get(uid) === 'drawer') this.endSubmitting(uid);
  }

  /** The drawer's own Skip button — reuses the same reason-prompt + `/status` write as the row overflow menu's "Skip with reason". */
  protected onSkipRequested(item: FormationItem): void {
    this.onRowReasonedStatusRequested({ item, status: 'skipped' });
  }

  private initResponse(): Signal<FormationChecklistResponse | null> {
    // Explicit `projectSlug` input first (foundation drill-down, LFXV2-3386), else the active
    // project context (`/project/formation`). Projected to the slug and deduped — activeContext()
    // is a computed that can re-emit a fresh object with the same slug (e.g. the context service
    // enriching it), and without distinctUntilChanged that would still re-trigger this fetch on
    // every such re-set.
    const slug$ = toObservable(computed(() => this.projectSlug() ?? this.projectContextService.activeContext()?.slug ?? null)).pipe(distinctUntilChanged());

    // Distinguishes a genuine (re)load — first mount or a project-context switch — from a
    // post-mutation refresh$ tick with the same slug: only the former should flash the panels to
    // skeletons. onRetry sets `loading` itself before calling refresh$, since a retry needs the
    // skeleton back even though the slug hasn't changed.
    let lastSlug: string | null = null;

    return toSignal(
      combineLatest([this.refresh$, slug$]).pipe(
        switchMap(([, slug]) => {
          if (!slug) {
            // Unreachable in the real flow — `/project/formation`'s `formationProjectEnabledGuard`
            // confirmed a Formation-stage project (which requires a resolved context), and the
            // foundation drill-down only renders this component with its `projectSlug` input set.
            // Still resolved defensively rather than left loading forever.
            // lastSlug is reset too — otherwise an A -> null -> A round trip would misclassify the
            // return to A as "same slug" and skip the loading state a genuine reload needs.
            lastSlug = null;
            this.loading.set(false);
            return of(null);
          }

          this.loadFailed.set(false);
          if (slug !== lastSlug) {
            lastSlug = slug;
            this.loading.set(true);
          }
          // Explicit-slug mode is the auditor drill-down, which must use the requireAuditor-gated
          // read so the queue's root-auditor contract holds server-side too (#2690 review); context
          // mode stays on the plain project-page read that serves `/project/formation`'s
          // per-project audience. Reading `projectSlug()` here (not in slug$) is safe: any change
          // to it re-emits slug$, so the mode can never be stale for the slug being fetched.
          const checklist$ = this.projectSlug() ? this.formationService.getQueueFormationChecklist(slug) : this.formationService.getProjectFormation(slug);
          return checklist$.pipe(
            tap((response) => this.logOrphanSectionKeys(response)),
            catchError((error: unknown) => {
              console.error('[FormationChecklistSection] Failed to load formation checklist', error);
              this.loadFailed.set(true);
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  /** Logs once per fetched response, sharing `collectFormationOrphanItems` with `groupFormationItemsBySection` so the two can't disagree on what counts as orphaned. */
  private logOrphanSectionKeys(response: FormationChecklistResponse): void {
    const orphans = collectFormationOrphanItems(response.items ?? [], response.template?.sections ?? []);
    if (orphans.length > 0) {
      console.error('[FormationChecklistSection] Items with an unrecognized section_key', { sectionKeys: orphans.map((item) => item.section_key) });
    }
  }

  /** Returns false (a no-op guard) if `uid` already has a mutation in flight. */
  private beginSubmitting(uid: string, kind: 'row' | 'skip' | 'drawer'): boolean {
    if (this.submittingItemUids().has(uid)) return false;
    this.submittingItemUids.update((uids) => new Map(uids).set(uid, kind));
    return true;
  }

  private endSubmitting(uid: string): void {
    this.submittingItemUids.update((uids) => {
      const next = new Map(uids);
      next.delete(uid);
      return next;
    });
  }
}
