// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { FormationService } from '@services/formation.service';
import type { Formation, FormationsQueueFilterState, FormationsQueueResponse, ReasonPromptDialogResult, StatCardItem } from '@lfx-one/shared/interfaces';
import { isValidUrl } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, catchError, combineLatest, finalize, of, switchMap, take } from 'rxjs';

import { ReasonPromptDialogComponent } from '@components/reason-prompt-dialog/reason-prompt-dialog.component';

import { FormationsTableComponent } from '../components/formations-table/formations-table.component';

const EMPTY_TILES: FormationsQueueResponse['tiles'] = {
  proposed: 0,
  exploratory: 0,
  engaged: 0,
  on_hold: 0,
  activating: 0,
  withdrawn: 0,
  total: 0,
  foundations: 0,
  subprojects: 0,
  mine: 0,
};
const EMPTY_RESPONSE: FormationsQueueResponse = { tiles: EMPTY_TILES, rows: [], data_source: 'fixture' };

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
  // Starts true — this page has nothing meaningful to show before the first fetch resolves; false
  // would flash "No formations yet" for one frame.
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);

  private readonly response: Signal<FormationsQueueResponse> = this.initResponse();
  protected readonly rows = computed(() => this.response().rows);

  protected readonly tiles: Signal<StatCardItem[]> = computed(() => {
    const t = this.response().tiles;
    return [
      {
        value: t.total,
        label: 'In formation',
        subLine: `${t.foundations} foundations · ${t.subprojects} subprojects`,
        icon: 'fa-light fa-diagram-project',
        iconContainerClass: 'bg-blue-50 text-blue-600',
      },
      {
        value: t.activating,
        label: 'Ready to activate',
        subLine: 'Gating items done',
        icon: 'fa-light fa-flag-checkered',
        iconContainerClass: 'bg-amber-50 text-amber-600',
      },
      { value: t.proposed, label: 'New proposals', subLine: 'Awaiting triage', icon: 'fa-light fa-inbox', iconContainerClass: 'bg-violet-50 text-violet-600' },
      { value: t.mine, label: 'Mine', subLine: 'Led or proposed by you', icon: 'fa-light fa-user', iconContainerClass: 'bg-emerald-50 text-emerald-600' },
    ];
  });

  protected onFiltersChange(filters: FormationsQueueFilterState): void {
    this.filters.set(filters);
  }

  protected onRetry(): void {
    this.refresh$.next();
  }

  protected onAccept(row: Formation): void {
    this.formationService
      .acceptFormation(row.uid)
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          // deep_link_url is fixture-constructed today (a fixed base + an encoded slug), but it's
          // API-sourced the same way action_href/link.href are — validate it the same way before
          // it ever reaches window.open, so the #1957 swap can't turn this into a javascript: sink.
          if (!isValidUrl(result.deep_link_url)) {
            console.error('[FormationsQueue] Rejected unsafe deep_link_url', result.deep_link_url);
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not open the admin tool.' });
            return;
          }

          const opened = window.open(result.deep_link_url, '_blank', 'noopener,noreferrer');
          if (!opened) {
            // Popup blocked — this fires from an async response callback, outside the click's
            // user-gesture window, so the browser can (and does, in some configurations) block it.
            this.messageService.add({
              severity: 'warn',
              summary: 'Pop-up blocked',
              detail: `Open the admin tool manually: ${result.deep_link_url}`,
              sticky: true,
            });
          }
          this.refresh$.next();
        },
        error: (error: unknown) => {
          console.error('[FormationsQueue] Accept failed', error);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not open the admin tool.' });
        },
      });
  }

  protected onDecline(row: Formation): void {
    const ref = this.dialogService.open(ReasonPromptDialogComponent, {
      header: 'Decline formation',
      width: '480px',
      modal: true,
      data: {
        prompt: `Declining "${row.parent_project_name}" requires a reason. The proposer is notified.`,
        placeholder: 'Why is this formation being declined?',
        confirmLabel: 'Decline formation',
      },
    });

    ref?.onClose.pipe(take(1)).subscribe((result: ReasonPromptDialogResult | undefined) => {
      if (!result?.reason) return;

      this.formationService
        .declineFormation(row.uid, result.reason)
        .pipe(take(1))
        .subscribe({
          next: () => {
            this.refresh$.next();
            this.messageService.add({ severity: 'success', summary: 'Declined', detail: `"${row.parent_project_name}" was declined.` });
          },
          error: (error: unknown) => {
            console.error('[FormationsQueue] Decline failed', error);
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not decline this formation.' });
          },
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
            catchError((error: unknown) => {
              console.error('[FormationsQueue] Failed to load Formations queue', error);
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
