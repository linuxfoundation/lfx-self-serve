// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  CLA_GROUP_SEARCH_DEBOUNCE_MS,
  ORG_CLA_ACTIVITY_LOG_COLUMN_HEADERS,
  ORG_CLA_ACTIVITY_LOG_EM_DASH,
  ORG_CLA_ACTIVITY_LOG_EMPTY_COPY,
  ORG_CLA_ACTIVITY_LOG_FILTER_EMPTY_COPY,
  ORG_CLA_ACTIVITY_LOG_HEADING,
  ORG_CLA_ACTIVITY_LOG_LOAD_MORE_COPY,
  ORG_CLA_ACTIVITY_LOG_SEARCH_PLACEHOLDER,
  ORG_CLA_ACTIVITY_LOG_SUBHEADER,
} from '@lfx-one/shared/constants';
import type { OrgClaActivityLogEntry, OrgClaActivityLogPage, OrgClaActivityLogRow, OrgClaGroup } from '@lfx-one/shared/interfaces';
import { formatClaSignedOnInstant } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, of, startWith, switchMap, tap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';

/**
 * The Activity Log tab of the CLA Group detail page (#1987).
 *
 * Renders one row per audited producer event on this `(company, CLA Group)` pair. Every event
 * type the producer writes is shown — signing, manager, approval-list, acknowledgment,
 * auto-ECLA, sanctions, and anything else the producer adds — so the tab reflects the whole
 * stream, not the four categories the parent story names.
 *
 * The tab has no writes. There is no per-row action, no tab badge, and no CLA-manager-only
 * surface: the read is a broader grant than the write tabs on this page (auditors and program
 * leads without a manager role still see it), and the middleware chain reflects that.
 *
 * Search is client-side over the rows fetched so far, matching the actor and EventSummary.
 * The producer accepts `searchTerm`, but that filter matches EventData, the detailed audit
 * sentence this tab does not render. Load-more requests the next page via the opaque
 * `nextKey` cursor and appends it.
 *
 * Summary strings are rendered as plain text with no substring parsing. Historical rows may
 * carry a project name behind the literal label "with project SFID" (a corrected producer-side
 * rendering bug, easycla#5199, that left historical rows in place); tolerating that shape is
 * exactly what this discipline delivers.
 */
@Component({
  selector: 'lfx-org-easycla-activity-log',
  imports: [ButtonComponent, EmptyStateComponent, InputTextComponent, ReactiveFormsModule, SkeletonModule],
  templateUrl: './org-easycla-activity-log.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaActivityLogComponent implements OnInit {
  private readonly accountContext = inject(AccountContextService);
  private readonly claService = inject(OrgLensClaService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly claGroup = input.required<OrgClaGroup>();

  protected readonly heading = ORG_CLA_ACTIVITY_LOG_HEADING;
  protected readonly subheader = ORG_CLA_ACTIVITY_LOG_SUBHEADER;
  protected readonly columnHeaders = ORG_CLA_ACTIVITY_LOG_COLUMN_HEADERS;
  protected readonly emptyCopy = ORG_CLA_ACTIVITY_LOG_EMPTY_COPY;
  protected readonly filterEmptyCopy = ORG_CLA_ACTIVITY_LOG_FILTER_EMPTY_COPY;
  protected readonly loadMoreCopy = ORG_CLA_ACTIVITY_LOG_LOAD_MORE_COPY;
  protected readonly searchPlaceholder = ORG_CLA_ACTIVITY_LOG_SEARCH_PLACEHOLDER;
  protected readonly loadingRows = [1, 2, 3, 4] as const;

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly page = signal<OrgClaActivityLogPage | null>(null);
  private readonly errorMessage = signal<string | null>(null);
  private readonly loadingMore = signal(false);
  private readonly fetchGeneration = signal(0);
  protected readonly loading = signal(true);
  private readonly searchTerm = signal<string>('');

  private readonly signatureId = computed(() => this.claGroup().id);
  private readonly orgUid = computed(() => this.accountContext.selectedAccount()?.uid ?? '');

  /**
   * One fetch cycle per (org, signatureId) tuple. Search is NOT on this key — the term filters
   * the already-loaded rows client-side, so a keystroke does not fire a request. The search
   * subscription is set up in `ngOnInit` so the debounced term drives the `filteredRows`
   * computed without needing to be part of the fetch tuple.
   */
  private readonly orgUid$ = toObservable(this.orgUid);
  private readonly signatureId$ = toObservable(this.signatureId);

  private readonly listSignal = toSignal(
    combineLatest([this.orgUid$, this.signatureId$]).pipe(
      distinctUntilChanged(([a1, b1], [a2, b2]) => a1 === a2 && b1 === b2),
      switchMap(([orgUid, signatureId]) => {
        this.fetchGeneration.update((generation) => generation + 1);
        this.loadingMore.set(false);
        this.errorMessage.set(null);
        this.page.set(null);
        if (!orgUid || !signatureId) return of(null as OrgClaActivityLogPage | null);
        this.loading.set(true);
        return this.claService.getActivityLog(orgUid, signatureId).pipe(
          tap((page) => {
            this.page.set(page);
            this.errorMessage.set(null);
          }),
          catchError((error: unknown) => {
            const httpError = error instanceof HttpErrorResponse ? error : null;
            console.error('Failed to load the activity log:', httpError?.status ?? 'unknown', httpError?.message ?? String(error));
            const message =
              httpError && typeof httpError.error?.message === 'string' && httpError.error.message.trim().length > 0
                ? httpError.error.message
                : "We couldn't load the activity log for this agreement.";
            this.page.set(null);
            this.errorMessage.set(message);
            return of(null as OrgClaActivityLogPage | null);
          }),
          finalize(() => this.loading.set(false))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ),
    { initialValue: null as OrgClaActivityLogPage | null }
  );

  // Load-more mutates `page`, so it takes precedence over `listSignal` (which holds only the
  // first page for the current fetch cycle). Reversing this order was a real bug on the sibling
  // acknowledgments tab: a merged page never rendered because `listSignal` shadowed it.
  protected readonly loadedList = computed(() => this.page() ?? this.listSignal());

  /**
   * Rows after client-side filtering.
   *
   * The term matches on the actor and the summary. Comparison is case-insensitive, and
   * accented and unaccented letters compare equal.
   *
   * Timestamps are not searched — a term like "2026" would false-positive on ISO-8601 strings
   * even for rows whose visible date is a different year in the viewer's locale.
   */
  protected readonly filteredRows = computed<OrgClaActivityLogRow[]>(() => this.initFilteredRows());

  protected readonly hasNextPage = computed(() => !!this.loadedList()?.nextKey);
  protected readonly resultCount = computed(() => this.loadedList()?.list.length ?? 0);
  protected readonly hasSearchTerm = computed(() => (this.searchTerm() ?? '').trim().length > 0);
  protected readonly showEmptyState = computed(
    () => !this.loading() && !this.errorMessage() && !this.hasSearchTerm() && (this.loadedList()?.list.length ?? 0) === 0 && !this.hasNextPage()
  );
  protected readonly showFilterEmptyState = computed(() => !this.loading() && !this.errorMessage() && this.hasSearchTerm() && this.filteredRows().length === 0);
  protected readonly showErrorState = computed(() => !!this.errorMessage());
  protected readonly loadingMoreSignal = this.loadingMore.asReadonly();

  public ngOnInit(): void {
    // Subscribe to the debounced search term so keystrokes update `searchTerm` and the
    // `filteredRows` computed re-renders. `startWith` seeds the initial empty term
    // synchronously so the first render is unfiltered without waiting for a debounce window.
    this.filterForm.controls.search.valueChanges
      .pipe(
        debounceTime(CLA_GROUP_SEARCH_DEBOUNCE_MS),
        startWith(this.filterForm.controls.search.value),
        distinctUntilChanged(),
        tap((value) => this.searchTerm.set(value)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /** Fetch the next page from the producer and append its rows to the current list. */
  protected loadMore(): void {
    const list = this.loadedList();
    if (!list?.nextKey || this.loadingMore()) return;
    this.loadingMore.set(true);
    const generation = this.fetchGeneration();
    const orgUid = this.orgUid();
    const claSignatureId = this.signatureId();
    this.claService
      .getActivityLog(orgUid, claSignatureId, { nextKey: list.nextKey })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          // A newer fetch cycle already cleared this flag and may have started its own Load more.
          if (this.fetchGeneration() === generation) this.loadingMore.set(false);
        })
      )
      .subscribe({
        next: (next) => {
          if (this.fetchGeneration() !== generation) return;
          if (orgUid !== this.orgUid() || claSignatureId !== this.signatureId()) return;
          const merged: OrgClaActivityLogPage = {
            ...next,
            signatureId: list.signatureId,
            list: [...list.list, ...next.list],
            resultCount: list.list.length + next.list.length,
            nextKey: next.nextKey,
          };
          this.page.set(merged);
        },
        error: () => {
          if (this.fetchGeneration() !== generation) return;
          this.messageService.add({
            severity: 'error',
            summary: 'Load more failed',
            detail: "We couldn't fetch the next page of activity. Try again in a moment.",
          });
        },
      });
  }

  private initFilteredRows(): OrgClaActivityLogRow[] {
    const list = this.loadedList();
    if (!list) return [];
    const term = (this.searchTerm() ?? '').trim();
    const rows = list.list.map((entry) => this.toRow(entry));
    if (term.length === 0) return rows;
    const foldedTerm = foldForActivitySearch(term);
    return rows.filter((row) => row.searchText.includes(foldedTerm));
  }

  private toRow(entry: OrgClaActivityLogEntry): OrgClaActivityLogRow {
    const actor = entry.actor?.trim() || ORG_CLA_ACTIVITY_LOG_EM_DASH;
    const summary = entry.summary?.trim() || ORG_CLA_ACTIVITY_LOG_EM_DASH;
    const whenLabel = entry.when ? formatClaSignedOnInstant(entry.when) : ORG_CLA_ACTIVITY_LOG_EM_DASH;
    // Precomputed lowercase concat, so the per-keystroke filter is O(rows) rather than
    // O(rows × fields × toLowerCase). A term is matched against actor + summary only —
    // deliberately not the ISO date.
    const searchText = foldForActivitySearch(`${actor}\u0000${summary}`);
    return {
      entry,
      actor,
      summary,
      whenLabel,
      searchText,
    };
  }
}

function foldForActivitySearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase();
}
