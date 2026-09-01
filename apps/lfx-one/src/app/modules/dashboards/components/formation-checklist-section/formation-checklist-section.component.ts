// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { ProjectContextService } from '@services/project-context.service';
import { FormationService } from '@services/formation.service';
import type { FormationChecklistResponse, FormationItem } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, catchError, combineLatest, finalize, of, switchMap, take } from 'rxjs';

import { FormationChecklistRowComponent } from '../formation-checklist-row/formation-checklist-row.component';
import { FormationItemDrawerComponent } from '../formation-item-drawer/formation-item-drawer.component';
import { FormationReadinessStripComponent } from '../formation-readiness-strip/formation-readiness-strip.component';
import { FormationSkipReasonDialogComponent } from '../formation-skip-reason-dialog/formation-skip-reason-dialog.component';

type FormationChecklistPageState = 'loading' | 'error' | 'no-template' | 'no-items' | 'ready';

const EMPTY_RESPONSE: FormationChecklistResponse | null = null;

@Component({
  selector: 'lfx-formation-checklist-section',
  // FormationSkipReasonDialogComponent is deliberately not here — it's opened dynamically via
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
  protected readonly loading = signal(false);

  public readonly drawerVisible = signal(false);
  public readonly drawerItemUid = signal<string | null>(null);

  private readonly response: Signal<FormationChecklistResponse | null> = this.initResponse();
  protected readonly formation = computed(() => this.response()?.formation ?? null);
  protected readonly template = computed(() => this.response()?.template ?? null);
  protected readonly items = computed(() => this.response()?.items ?? []);

  protected readonly legalSectionKey = 'legal-and-entity';
  protected readonly launchSectionKey = 'community-and-launch';

  protected readonly pageState: Signal<FormationChecklistPageState> = computed(() => {
    if (this.loading()) return 'loading';
    if (this.loadFailed()) return 'error';
    if (!this.template()) return 'no-template';
    if (this.items().length === 0) return 'no-items';
    return 'ready';
  });

  protected sectionItems(sectionKey: string): FormationItem[] {
    return this.items().filter((item) => item.section_key === sectionKey);
  }

  protected onRetry(): void {
    this.refresh$.next();
  }

  protected onOpenDrawer(item: FormationItem): void {
    this.drawerItemUid.set(item.uid);
    this.drawerVisible.set(true);
  }

  protected onRowAction(item: FormationItem): void {
    const call$ = item.action === 'request' ? this.formationService.requestFormationItem(item.uid) : this.formationService.completeFormationItem(item.uid);

    call$.pipe(take(1)).subscribe({
      next: () => this.refresh$.next(),
      error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not complete this action.' }),
    });
  }

  protected onDrawerItemChanged(): void {
    this.refresh$.next();
    this.drawerVisible.set(false);
  }

  protected onSkipRequested(item: FormationItem): void {
    const ref = this.dialogService.open(FormationSkipReasonDialogComponent, {
      header: 'Skip item',
      width: '480px',
      modal: true,
      data: { itemTitle: item.title },
    });

    ref?.onClose.pipe(take(1)).subscribe((result: { reason: string } | undefined) => {
      if (!result?.reason) return;

      this.formationService
        .skipFormationItem(item.uid, result.reason)
        .pipe(take(1))
        .subscribe({
          next: () => {
            this.refresh$.next();
            this.drawerVisible.set(false);
            this.messageService.add({ severity: 'success', summary: 'Skipped', detail: `"${item.title}" was skipped.` });
          },
          error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not skip this item.' }),
        });
    });
  }

  private initResponse(): Signal<FormationChecklistResponse | null> {
    return toSignal(
      combineLatest([this.refresh$, toObservable(computed(() => this.projectContextService.activeContext()))]).pipe(
        switchMap(([, context]) => {
          if (!context?.slug) {
            return of(EMPTY_RESPONSE);
          }

          this.loadFailed.set(false);
          this.loading.set(true);
          return this.formationService.getProjectFormation(context.slug).pipe(
            catchError(() => {
              this.loadFailed.set(true);
              return of(EMPTY_RESPONSE);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: EMPTY_RESPONSE }
    );
  }
}
