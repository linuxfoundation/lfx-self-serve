// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { SURVEY_RESPONSES_PAGE_SIZE } from '@lfx-one/shared/constants';
import { NpsBand, Survey, SurveyResponseItem } from '@lfx-one/shared/interfaces';
import { getNpsBand, getResponseComment, getResponseDeliveryTimestamp } from '@lfx-one/shared/utils';
import { SurveyService } from '@services/survey.service';
import { TooltipModule } from 'primeng/tooltip';
import { combineLatest, debounceTime, distinctUntilChanged, finalize, map, merge, of, scan, startWith, Subject, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-survey-responses-list',
  imports: [DatePipe, ReactiveFormsModule, InputTextComponent, SelectComponent, TooltipModule],
  templateUrl: './survey-responses-list.component.html',
  styleUrl: './survey-responses-list.component.scss',
})
export class SurveyResponsesListComponent {
  // === Services ===
  private readonly surveyService = inject(SurveyService);

  // === Inputs ===
  public readonly surveyId = input<string | null>(null);
  /** Parent survey — supplies header counts and committee/project labels for grouping. */
  public readonly survey = input<Survey | null>(null);
  /** Optional project scope for multi-project surveys. */
  public readonly projectUid = input<string | null>(null);

  // === Constants ===
  protected readonly npsOptions = [
    { label: 'All', value: 'all' },
    { label: 'Promoters (9-10)', value: 'promoter' },
    { label: 'Passives (7-8)', value: 'passive' },
    { label: 'Detractors (0-6)', value: 'detractor' },
  ];
  protected readonly commentOptions = [
    { label: 'All', value: 'all' },
    { label: 'With comment', value: 'with' },
    { label: 'Without comment', value: 'without' },
  ];
  protected readonly deliveryOptions = [
    { label: 'All', value: 'all' },
    { label: 'Responded', value: 'responded' },
    { label: 'Clicked', value: 'clicked' },
    { label: 'Opened', value: 'opened' },
    { label: 'Delivered', value: 'delivered' },
    { label: 'Failed', value: 'failed' },
    { label: 'Pending', value: 'pending' },
  ];

  // === Forms ===
  public filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    nps: new FormControl<string>('all', { nonNullable: true }),
    comment: new FormControl<string>('all', { nonNullable: true }),
    delivery: new FormControl<string>('all', { nonNullable: true }),
  });

  // === Refresh / pagination triggers ===
  private readonly loadMore$ = new Subject<void>();

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(false);
  protected readonly loadingMore = signal<boolean>(false);
  private readonly pageToken = signal<string | undefined>(undefined);
  private readonly sortField = signal<string>('');
  private readonly sortDir = signal<number>(1);
  private readonly collapsedGroups = signal<Set<string>>(new Set<string>());

  // === Derived Signals (from API) ===
  protected readonly responses: Signal<SurveyResponseItem[]> = this.initResponses();

  // === Filter Signals (client-side over loaded rows) ===
  private readonly searchTerm: Signal<string> = this.initSearchTerm();
  private readonly npsFilter: Signal<string> = this.toControlSignal('nps');
  private readonly commentFilter: Signal<string> = this.toControlSignal('comment');
  private readonly deliveryFilter: Signal<string> = this.toControlSignal('delivery');

  // === Computed Signals ===
  protected readonly hasMore: Signal<boolean> = computed(() => !!this.pageToken());
  protected readonly filteredResponses: Signal<SurveyResponseItem[]> = this.initFilteredResponses();
  protected readonly groups: Signal<{ key: string; label: string; count: number; items: SurveyResponseItem[] }[]> = this.initGroups();
  protected readonly respondedCount: Signal<number> = this.initRespondedCount();
  protected readonly totalRecipients: Signal<number> = this.initTotalRecipients();
  protected readonly isFiltered: Signal<boolean> = computed(
    () => this.searchTerm() !== '' || this.npsFilter() !== 'all' || this.commentFilter() !== 'all' || this.deliveryFilter() !== 'all'
  );

  // === Public Methods ===
  public loadMore(): void {
    if (this.hasMore() && !this.loadingMore()) {
      this.loadMore$.next();
    }
  }

  // === Protected Methods ===
  protected isGroupCollapsed(key: string): boolean {
    return this.collapsedGroups().has(key);
  }

  protected toggleGroup(key: string): void {
    this.collapsedGroups.update((set) => {
      const next = new Set(set);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  protected onSort(field: string): void {
    if (this.sortField() === field) {
      this.sortDir.update((d) => d * -1);
    } else {
      this.sortField.set(field);
      this.sortDir.set(1);
    }
  }

  protected sortIcon(field: string): string {
    if (this.sortField() !== field) {
      return 'fa-light fa-arrow-up-arrow-down text-slate-300';
    }
    return this.sortDir() === 1 ? 'fa-light fa-arrow-up-short-wide text-slate-600' : 'fa-light fa-arrow-down-wide-short text-slate-600';
  }

  protected recipientName(item: SurveyResponseItem): string {
    const name = `${item.first_name ?? ''} ${item.last_name ?? ''}`.trim();
    return name || item.username || item.email || 'Unknown recipient';
  }

  protected deliveryTimestamp(item: SurveyResponseItem): string | null {
    return getResponseDeliveryTimestamp(item);
  }

  protected comment(item: SurveyResponseItem): string | null {
    return getResponseComment(item);
  }

  protected npsBandClass(value: number | null | undefined): string {
    const band: NpsBand | null = getNpsBand(value);
    if (band === 'promoter') return 'text-green-700';
    if (band === 'passive') return 'text-yellow-700';
    if (band === 'detractor') return 'text-red-700';
    return 'text-slate-400';
  }

  // === Private Initializers ===
  private initResponses(): Signal<SurveyResponseItem[]> {
    const firstPage$ = combineLatest([toObservable(this.surveyId), toObservable(this.projectUid)]).pipe(
      switchMap(([id, projectUid]) => {
        this.pageToken.set(undefined);
        if (!id) {
          this.loading.set(false);
          return of({ data: [] as SurveyResponseItem[], token: undefined, reset: true });
        }
        this.loading.set(true);
        return this.surveyService.getSurveyResponses(id, SURVEY_RESPONSES_PAGE_SIZE, undefined, projectUid ?? undefined).pipe(
          map((page) => ({ data: page.data, token: this.normalizeToken(page.meta.page_token), reset: true })),
          finalize(() => this.loading.set(false))
        );
      })
    );

    const nextPage$ = this.loadMore$.pipe(
      switchMap(() => {
        const id = this.surveyId();
        const token = this.pageToken();
        if (!id || !token) {
          return of({ data: [] as SurveyResponseItem[], token: undefined, reset: false });
        }
        this.loadingMore.set(true);
        return this.surveyService.getSurveyResponses(id, SURVEY_RESPONSES_PAGE_SIZE, token, this.projectUid() ?? undefined).pipe(
          map((page) => ({ data: page.data, token: this.normalizeToken(page.meta.page_token), reset: false })),
          finalize(() => this.loadingMore.set(false))
        );
      })
    );

    return toSignal(
      merge(firstPage$, nextPage$).pipe(
        tap((result) => this.pageToken.set(result.token)),
        scan((acc, result) => (result.reset ? result.data : [...acc, ...result.data]), [] as SurveyResponseItem[])
      ),
      { initialValue: [] as SurveyResponseItem[] }
    );
  }

  private initSearchTerm(): Signal<string> {
    const control = this.filterForm.controls.search;
    return toSignal(
      control.valueChanges.pipe(
        startWith(control.value),
        debounceTime(300),
        distinctUntilChanged(),
        map((value) => (value ?? '').trim().toLowerCase())
      ),
      { initialValue: '' }
    );
  }

  private toControlSignal(controlName: 'nps' | 'comment' | 'delivery'): Signal<string> {
    const control = this.filterForm.controls[controlName];
    return toSignal(control.valueChanges.pipe(startWith(control.value), distinctUntilChanged()), { initialValue: control.value });
  }

  private initFilteredResponses(): Signal<SurveyResponseItem[]> {
    return computed(() => {
      let rows = this.responses();

      const term = this.searchTerm();
      if (term) {
        rows = rows.filter(
          (r) =>
            this.recipientName(r).toLowerCase().includes(term) ||
            (r.email ?? '').toLowerCase().includes(term) ||
            (r.organization?.name ?? '').toLowerCase().includes(term)
        );
      }

      const nps = this.npsFilter();
      if (nps !== 'all') {
        rows = rows.filter((r) => !!r.response_datetime && getNpsBand(r.nps_value) === nps);
      }

      const comment = this.commentFilter();
      if (comment === 'with') {
        rows = rows.filter((r) => getResponseComment(r) !== null);
      } else if (comment === 'without') {
        rows = rows.filter((r) => getResponseComment(r) === null);
      }

      const delivery = this.deliveryFilter();
      if (delivery !== 'all') {
        rows = rows.filter((r) => (r.response_status ?? '').toLowerCase() === delivery);
      }

      return this.sortRows(rows);
    });
  }

  private initGroups(): Signal<{ key: string; label: string; count: number; items: SurveyResponseItem[] }[]> {
    return computed(() => {
      const survey = this.survey();
      const grouped = new Map<string, SurveyResponseItem[]>();

      for (const item of this.filteredResponses()) {
        const key = item.committee_uid || 'ungrouped';
        const bucket = grouped.get(key);
        if (bucket) {
          bucket.push(item);
        } else {
          grouped.set(key, [item]);
        }
      }

      return [...grouped.entries()].map(([key, items]) => {
        const committee = survey?.committees?.find((c) => c.committee_uid === key);
        const projectName = committee?.project_name || items[0]?.project?.name || '';
        const committeeName = committee?.committee_name || '';
        const label = [projectName, committeeName].filter(Boolean).join(' | ') || 'Responses';
        // When filters/search are active, show the count of visible rows so the
        // header matches what's rendered. When unfiltered, prefer the authoritative
        // total from the survey aggregate (covers recipients not yet loaded).
        const count = this.isFiltered() ? items.length : (committee?.total_recipients ?? items.length);
        return { key, label, count, items };
      });
    });
  }

  private initRespondedCount(): Signal<number> {
    return computed(() => {
      const survey = this.survey();
      if (survey && typeof survey.total_responses === 'number') {
        return survey.total_responses;
      }
      return this.responses().filter((r) => !!r.response_datetime && r.response_datetime.trim() !== '').length;
    });
  }

  private initTotalRecipients(): Signal<number> {
    return computed(() => {
      const survey = this.survey();
      if (survey && typeof survey.total_recipients === 'number' && survey.total_recipients > 0) {
        return survey.total_recipients;
      }
      return this.responses().length;
    });
  }

  // === Private Helpers ===
  private sortRows(rows: SurveyResponseItem[]): SurveyResponseItem[] {
    const field = this.sortField();
    if (!field) {
      return rows;
    }
    const dir = this.sortDir();
    return [...rows].sort((a, b) => {
      const av = this.sortValue(a, field);
      const bv = this.sortValue(b, field);
      // Infinity is the sentinel for missing/non-responded values — always sort last.
      if (av === Infinity && bv === Infinity) return 0;
      if (av === Infinity) return 1;
      if (bv === Infinity) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  private sortValue(item: SurveyResponseItem, field: string): string | number {
    switch (field) {
      case 'recipient':
        return this.recipientName(item).toLowerCase();
      case 'organization':
        return (item.organization?.name ?? '').toLowerCase();
      case 'delivery':
        return (item.response_status ?? '').toLowerCase();
      case 'responseDate': {
        const ts = item.response_datetime ? new Date(item.response_datetime).getTime() : NaN;
        return isNaN(ts) ? Infinity : ts;
      }
      case 'nps':
        // Missing/non-responded scores always sort last regardless of direction.
        return typeof item.nps_value === 'number' && !!item.response_datetime ? item.nps_value : Infinity;
      case 'comment':
        return (getResponseComment(item) ?? '').toLowerCase();
      default:
        return '';
    }
  }

  /** Upstream returns an empty page_token on the last page; normalize that to undefined. */
  private normalizeToken(token: string | undefined): string | undefined {
    return token && token.trim() !== '' ? token : undefined;
  }
}
