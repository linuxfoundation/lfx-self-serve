// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { ProjectContextService } from '@services/project-context.service';
import { FormationService } from '@services/formation.service';
import type {
  FormationChecklistPageState,
  FormationChecklistResponse,
  FormationItem,
  FormationRenderedSection,
  ReasonPromptDialogResult,
} from '@lfx-one/shared/interfaces';
import { collectFormationOrphanItems, groupFormationItemsBySection } from '@lfx-one/shared/utils';
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
  imports: [SkeletonModule, EmptyStateComponent, FormationReadinessStripComponent, FormationChecklistRowComponent, FormationItemDrawerComponent],
  providers: [DialogService],
  templateUrl: './formation-checklist-section.component.html',
  styleUrl: './formation-checklist-section.component.scss',
})
export class FormationChecklistSectionComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly formationService = inject(FormationService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);

  private readonly refresh$ = new BehaviorSubject<void>(undefined);
  private readonly loadFailed = signal(false);
  // Starts true — the parent only renders this component once it already knows the project is in
  // a Formation stage, so a real project context is expected on the very first combineLatest
  // emission; starting false would flash the "Choose a template" empty state for one frame first.
  protected readonly loading = signal(true);

  public readonly drawerVisible = signal(false);
  public readonly drawerItemUid = signal<string | null>(null);

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
    this.drawerVisible.set(true);
  }

  protected onRowAction(item: FormationItem): void {
    if (!this.beginSubmitting(item.uid, 'row')) return;
    const call$ = item.action === 'request' ? this.formationService.requestFormationItem(item.uid) : this.formationService.completeFormationItem(item.uid);

    call$
      .pipe(
        take(1),
        finalize(() => this.endSubmitting(item.uid))
      )
      .subscribe({
        next: () => this.refresh$.next(),
        error: (error: unknown) => {
          console.error('[FormationChecklistSection] Row action failed', error);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not complete this action.' });
        },
      });
  }

  /** Mark complete changed the item's status — close the drawer and let the refreshed row list show it. */
  protected onDrawerItemChanged(): void {
    this.refresh$.next();
    this.drawerVisible.set(false);
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

  protected onSkipRequested(item: FormationItem): void {
    const ref = this.dialogService.open(ReasonPromptDialogComponent, {
      header: 'Skip item',
      width: '480px',
      modal: true,
      data: {
        prompt: `Skipping "${item.title}" requires a reason. This is logged in the item's history.`,
        placeholder: 'Why is this item being skipped?',
        confirmLabel: 'Skip item',
      },
    });

    ref?.onClose.pipe(take(1)).subscribe((result: ReasonPromptDialogResult | undefined) => {
      if (!result?.reason || !this.beginSubmitting(item.uid, 'skip')) return;

      this.formationService
        .skipFormationItem(item.uid, result.reason)
        .pipe(
          take(1),
          finalize(() => this.endSubmitting(item.uid))
        )
        .subscribe({
          next: () => {
            this.refresh$.next();
            this.drawerVisible.set(false);
            this.messageService.add({ severity: 'success', summary: 'Skipped', detail: `"${item.title}" was skipped.` });
          },
          error: (error: unknown) => {
            console.error('[FormationChecklistSection] Skip failed', error);
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not skip this item.' });
          },
        });
    });
  }

  private initResponse(): Signal<FormationChecklistResponse | null> {
    // Projected to the slug and deduped — activeContext() is a computed that can re-emit a fresh
    // object with the same slug (e.g. the context service enriching it), and without
    // distinctUntilChanged that would still re-trigger this fetch on every such re-set.
    const slug$ = toObservable(computed(() => this.projectContextService.activeContext()?.slug ?? null)).pipe(distinctUntilChanged());

    // Distinguishes a genuine (re)load — first mount or a project-context switch — from a
    // post-mutation refresh$ tick with the same slug: only the former should flash the panels to
    // skeletons. onRetry sets `loading` itself before calling refresh$, since a retry needs the
    // skeleton back even though the slug hasn't changed.
    let lastSlug: string | null = null;

    return toSignal(
      combineLatest([this.refresh$, slug$]).pipe(
        switchMap(([, slug]) => {
          if (!slug) {
            // Unreachable in the real flow — the parent only renders this component once
            // ProjectService.project()?.stage already confirmed a Formation-stage project, which
            // requires a resolved context. Still resolved defensively rather than left loading forever.
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
          return this.formationService.getProjectFormation(slug).pipe(
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
