// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { FormationService } from '@services/formation.service';
import type { Formation, FormationsQueueResponse, StatCardItem } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, catchError, combineLatest, finalize, of, switchMap, take } from 'rxjs';

import { FormationsDeclineDialogComponent } from '../components/formations-decline-dialog/formations-decline-dialog.component';
import { FormationsQueueFilterState, FormationsTableComponent } from '../components/formations-table/formations-table.component';

const EMPTY_RESPONSE: FormationsQueueResponse = { tiles: {} as FormationsQueueResponse['tiles'], rows: [], data_source: 'fixture' };

@Component({
  selector: 'lfx-formations-queue',
  imports: [StatCardGridComponent, FormationsTableComponent],
  providers: [DialogService],
  templateUrl: './formations-queue.component.html',
  styleUrl: './formations-queue.component.scss',
})
export class FormationsQueueComponent {
  private readonly formationService = inject(FormationService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);

  private readonly refresh$ = new BehaviorSubject<void>(undefined);
  private readonly filters = signal<FormationsQueueFilterState>({ subStage: undefined, search: '' });
  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);

  private readonly response: Signal<FormationsQueueResponse> = this.initResponse();
  protected readonly rows = computed(() => this.response().rows);

  protected readonly tiles: Signal<StatCardItem[]> = computed(() => {
    const t = this.response().tiles;
    return [
      {
        value: t.total ?? 0,
        label: 'In formation',
        subLine: `${t.foundations ?? 0} foundations · ${t.subprojects ?? 0} subprojects`,
        icon: 'fa-light fa-diagram-project',
        iconContainerClass: 'bg-blue-50 text-blue-600',
      },
      {
        value: t.activating ?? 0,
        label: 'Ready to activate',
        subLine: 'Gating items done',
        icon: 'fa-light fa-flag-checkered',
        iconContainerClass: 'bg-amber-50 text-amber-600',
      },
      {
        value: t.proposed ?? 0,
        label: 'New proposals',
        subLine: 'Awaiting triage',
        icon: 'fa-light fa-inbox',
        iconContainerClass: 'bg-violet-50 text-violet-600',
      },
      { value: t.mine ?? 0, label: 'Mine', subLine: 'Led or proposed by you', icon: 'fa-light fa-user', iconContainerClass: 'bg-emerald-50 text-emerald-600' },
    ];
  });

  protected onFiltersChange(filters: FormationsQueueFilterState): void {
    this.filters.set(filters);
  }

  protected onAccept(row: Formation): void {
    this.formationService
      .acceptFormation(row.uid)
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          window.open(result.deep_link_url, '_blank', 'noopener');
        },
        error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not open the admin tool.' }),
      });
  }

  protected onDecline(row: Formation): void {
    const ref = this.dialogService.open(FormationsDeclineDialogComponent, {
      header: 'Decline formation',
      width: '480px',
      modal: true,
      data: { formationName: row.parent_project_name },
    });

    ref?.onClose.pipe(take(1)).subscribe((result: { reason: string } | undefined) => {
      if (!result?.reason) return;

      this.formationService
        .declineFormation(row.uid, result.reason)
        .pipe(take(1))
        .subscribe({
          next: () => {
            this.refresh$.next();
            this.messageService.add({ severity: 'success', summary: 'Declined', detail: `"${row.parent_project_name}" was declined.` });
          },
          error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not decline this formation.' }),
        });
    });
  }

  private initResponse(): Signal<FormationsQueueResponse> {
    return toSignal(
      combineLatest([this.refresh$, toObservable(this.filters)]).pipe(
        switchMap(([, filters]) => {
          this.loadFailed.set(false);
          this.loading.set(true);
          return this.formationService.getFormationsQueue(filters.subStage, filters.search).pipe(
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
