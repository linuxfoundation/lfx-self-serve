// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, Signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { SelectComponent } from '@components/select/select.component';
import { Paginator, PaginatorState } from 'primeng/paginator';
import { Popover, PopoverModule } from 'primeng/popover';
import { SkeletonModule } from 'primeng/skeleton';
import { CardComponent } from '@components/card/card.component';
import { BADGE_FILTER_OPTIONS, BADGE_LABEL, BADGE_STATUS_SELECT_OPTIONS, BADGE_VISIBILITY_SELECT_OPTIONS } from '@lfx-one/shared';
import { BadgeCategory, BadgeState, BadgeStatusFilter, BadgeVisibilityFilter, EnrichedBadge } from '@lfx-one/shared/interfaces';
import { catchError, map, of, startWith, tap } from 'rxjs';

import { BadgesService } from '../../../shared/services/badges.service';
import { BadgeCardComponent } from './components/badge-card/badge-card.component';

const BADGES_PER_PAGE = 12;
const SKELETON_COUNT = 6;

@Component({
  selector: 'lfx-badges-dashboard',
  imports: [BadgeCardComponent, CardComponent, FilterPillsComponent, ReactiveFormsModule, SelectComponent, Paginator, PopoverModule, SkeletonModule],
  templateUrl: './badges-dashboard.component.html',
  styleUrl: './badges-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BadgesDashboardComponent {
  // === Services ===
  private readonly badgesService = inject(BadgesService);

  // === Constants ===
  protected readonly badgeLabelPlural = BADGE_LABEL.plural;
  protected readonly filterOptions = BADGE_FILTER_OPTIONS;
  protected readonly statusSelectOptions = BADGE_STATUS_SELECT_OPTIONS;
  protected readonly visibilitySelectOptions = BADGE_VISIBILITY_SELECT_OPTIONS;
  protected readonly rowsPerPage = BADGES_PER_PAGE;
  protected readonly skeletonItems = Array.from({ length: SKELETON_COUNT });

  // === View Children ===
  protected readonly filtersPopover = viewChild<Popover>('filtersPopover');
  protected readonly pageTopAnchor = viewChild<ElementRef<HTMLElement>>('pageTopAnchor');

  // === Forms ===
  protected readonly statusForm = new FormGroup({
    status: new FormControl<BadgeStatusFilter>('all', { nonNullable: true }),
  });

  protected readonly visibilityForm = new FormGroup({
    visibility: new FormControl<BadgeVisibilityFilter>('all', { nonNullable: true }),
  });

  // === Writable Signals ===
  protected readonly selectedFilter = signal<BadgeCategory | 'all'>('all');
  protected readonly paginatorFirst = signal<number>(0);

  // === Computed Signals ===
  private readonly badgeState: Signal<BadgeState> = this.initializeBadgeState();
  protected readonly loading = computed(() => this.badgeState().loading);
  protected readonly hasError = computed(() => this.badgeState().error);
  private readonly badges = computed(() => this.badgeState().data);
  protected readonly selectedStatusFilter = this.initializeSelectedStatusFilter();
  protected readonly selectedVisibilityFilter = this.initializeSelectedVisibilityFilter();
  protected readonly hasActiveFilters = computed(() => this.selectedStatusFilter() !== 'all' || this.selectedVisibilityFilter() !== 'all');
  protected readonly filterButtonAriaLabel = computed(() => (this.hasActiveFilters() ? 'Open filter options (filters active)' : 'Open filter options'));
  protected readonly filteredBadges = this.initializeFilteredBadges();
  protected readonly filteredBadgesCount = computed(() => this.filteredBadges().length);
  protected readonly badgeCountLabel = this.initializeBadgeCountLabel();
  protected readonly paginatedBadges: Signal<EnrichedBadge[]> = this.initializePaginatedBadges();

  protected onFilterChange(filter: string): void {
    this.selectedFilter.set(filter as BadgeCategory | 'all');
    this.paginatorFirst.set(0);
  }

  protected toggleFiltersPanel(event: MouseEvent): void {
    this.filtersPopover()?.toggle(event);
  }

  protected onPageChange(event: PaginatorState): void {
    this.paginatorFirst.set(event.first ?? 0);
    this.scrollToTop();
  }

  private initializeBadgeState(): Signal<BadgeState> {
    return toSignal(
      this.badgesService.getBadges().pipe(
        map((data): BadgeState => ({ loading: false, error: false, data })),
        catchError((err) => {
          console.error('[badges] Failed to load badges', err);
          return of<BadgeState>({ loading: false, error: true, data: [], errorMessage: err instanceof Error ? err.message : String(err) });
        }),
        startWith<BadgeState>({ loading: true, error: false, data: [] })
      ),
      { initialValue: { loading: true, error: false, data: [] } }
    );
  }

  private initializeSelectedStatusFilter(): Signal<BadgeStatusFilter> {
    return toSignal(this.statusForm.controls.status.valueChanges.pipe(tap(() => this.paginatorFirst.set(0))), {
      initialValue: 'all',
    });
  }

  private initializeSelectedVisibilityFilter(): Signal<BadgeVisibilityFilter> {
    return toSignal(this.visibilityForm.controls.visibility.valueChanges.pipe(tap(() => this.paginatorFirst.set(0))), {
      initialValue: 'all',
    });
  }

  private initializeBadgeCountLabel(): Signal<string> {
    return computed(() => {
      const total = this.filteredBadgesCount();
      if (total === 0) {
        return `Showing 0 to 0 of 0 ${BADGE_LABEL.plural}`;
      }

      const safeFirst = Math.min(this.paginatorFirst(), total - 1);
      const start = safeFirst + 1;
      const end = Math.min(safeFirst + BADGES_PER_PAGE, total);
      const badgeLabel = total === 1 ? BADGE_LABEL.singular : BADGE_LABEL.plural;

      return `Showing ${start} to ${end} of ${total} ${badgeLabel}`;
    });
  }

  private initializeFilteredBadges(): Signal<EnrichedBadge[]> {
    return computed(() => {
      const now = new Date();
      const categoryFilter = this.selectedFilter();
      const statusFilter = this.selectedStatusFilter();
      const visibilityFilter = this.selectedVisibilityFilter();

      // Enrich with isExpired here so it re-evaluates against the current time
      // whenever a filter interaction triggers this computed to re-run
      let result: EnrichedBadge[] = this.badges().map((badge) => ({
        ...badge,
        isExpired: !!badge.expiresDate && new Date(badge.expiresDate) < now,
      }));

      if (categoryFilter !== 'all') {
        result = result.filter((badge) => badge.category === categoryFilter);
      }

      if (statusFilter === 'pending') {
        result = result.filter((badge) => badge.isPending);
      } else if (statusFilter === 'active') {
        result = result.filter((badge) => !badge.isPending && !badge.isExpired);
      } else if (statusFilter === 'expired') {
        result = result.filter((badge) => badge.isExpired);
      }

      if (visibilityFilter === 'public') {
        result = result.filter((badge) => badge.isPublic);
      } else if (visibilityFilter === 'private') {
        result = result.filter((badge) => !badge.isPublic);
      }

      return result;
    });
  }

  private initializePaginatedBadges(): Signal<EnrichedBadge[]> {
    return computed(() => {
      const first = this.paginatorFirst();
      return this.filteredBadges().slice(first, first + BADGES_PER_PAGE);
    });
  }

  private scrollToTop(): void {
    this.pageTopAnchor()?.nativeElement.scrollIntoView({
      behavior: 'auto',
      block: 'start',
    });
  }
}
