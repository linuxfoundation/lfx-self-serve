// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { BEHAVIORAL_CLASS_CONFIG, COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import type {
  BehavioralClassDisplayConfig,
  GroupBehavioralClass,
  OrgDropdownOption,
  OrgLensGroupClassTile,
  OrgLensGroupSummary,
  OrgLensGroupsResponse,
  OrgLensGroupVm,
} from '@lfx-one/shared/interfaces';
import { downloadCsv, getGroupBehavioralClass, localDateStamp } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, debounceTime, distinctUntilChanged, filter, map, of, skip, switchMap, tap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { PersonDetailDrawerComponent } from '@components/person-detail-drawer/person-detail-drawer.component';
import { SelectComponent } from '@components/select/select.component';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensGroupsService } from '@services/org-lens-groups.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';

import { GroupSeatHoldersDrawerComponent } from './components/group-seat-holders-drawer/group-seat-holders-drawer.component';

@Component({
  selector: 'lfx-org-groups',
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    GroupSeatHoldersDrawerComponent,
    InputTextComponent,
    NgTemplateOutlet,
    PersonDetailDrawerComponent,
    RouterLink,
    SelectComponent,
    SkeletonModule,
    TagComponent,
    TooltipModule,
  ],
  templateUrl: './org-groups.component.html',
})
export class OrgGroupsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly orgNavigationService = inject(OrgNavigationService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);
  private readonly groupsService = inject(OrgLensGroupsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly committeeLabel = COMMITTEE_LABEL;
  protected readonly behavioralClassConfig = BEHAVIORAL_CLASS_CONFIG;
  // Hoisted so the template never calls .toLowerCase() on every change-detection pass (frontend-checklist §4).
  protected readonly committeeLabelPluralLower = COMMITTEE_LABEL.plural.toLowerCase();
  protected readonly committeeLabelSingularLower = COMMITTEE_LABEL.singular.toLowerCase();

  // ── Filter bar (client-side over the already-loaded roster; GH-1778) ───────
  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>(this.route.snapshot.queryParamMap.get('q') ?? '', { nonNullable: true }),
    foundation: new FormControl<string>(this.route.snapshot.queryParamMap.get('foundation') ?? '', { nonNullable: true }),
    type: new FormControl<GroupBehavioralClass | ''>(this.initTypeFromUrl(), { nonNullable: true }),
  });

  protected readonly companyName = computed(() => this.accountContext.selectedAccount().accountName);
  protected readonly orgUid = computed(() => this.accountContext.selectedAccount().uid ?? '');

  // Total Groups + Total Seats — the two fixed tiles in the template that visibleClassTiles()
  // doesn't cover. Keep in sync with the stat-strip markup.
  private readonly fixedStatTileCount = 2;

  // Placeholder count for the loading skeletons, derived from BEHAVIORAL_CLASS_CONFIG (one entry
  // per GroupBehavioralClass member) rather than a hand-maintained literal, so the true max
  // rendered tile count (2 fixed + every behavioral class non-zero) can't silently drift out of
  // sync with the type if a class is ever added — see statGridClass for how the grid layout
  // tracks this same value. Per GH-1779's "skeleton tile count matches the rendered tile count"
  // acceptance criterion, the skeleton and loaded grid only ever diverge on the zero-classes edge
  // case (per dealako's PR #1790 review).
  protected readonly statSkeletonTiles: readonly number[] = Array.from(
    { length: Object.keys(BEHAVIORAL_CLASS_CONFIG).length + this.fixedStatTileCount },
    (_, i) => i + 1
  );

  // Mobile fixed at 2 columns, sm+ fixed at 3. At `lg:` and up, both the skeleton and the loaded
  // grid switch to one equal-width column per tile via --cols — the skeleton binds it to
  // statSkeletonTiles.length (see the template), the loaded grid to statTileCount() (2-8, since a
  // class only tiles when non-zero). Sharing one grid class means the two can never drift out of
  // sync on layout, only on --cols' value while data is still loading — the tightest live case is
  // not the roomiest: at 7-8 tiles columns get narrow enough for a longer label to wrap. Accepted
  // deliberately, since a static per-count cap would reintroduce the ragged trailing row this grid
  // exists to avoid. The value is a plain --cols integer rather than a repeat(min(var(--cols),N))
  // clamp because CSS Grid requires an integer repeat count and silently drops the whole
  // declaration otherwise (see events-summary-section.component.html for the same constraint).
  private readonly statGridBase = 'grid grid-cols-2 gap-4 sm:grid-cols-3';
  protected readonly statGridClass = `${this.statGridBase} lg:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]`;

  // ── Auth / access guards (mirrors org-meetings pattern) ───────────────────
  protected readonly hasNoOrgAccess: Signal<boolean> = computed(
    () => this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded() && !this.accountContext.hasOrgSelectorAccess()
  );

  protected readonly loaded: Signal<boolean> = computed(
    () => this.hasNoOrgAccess() || (this.orgNavigationService.loaded() && this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded())
  );

  // Committee-service B2B endpoints are scoped by org uid, not the Snowflake accountId — mirrors
  // org-people/committee-members. Gate and fetch key both use uid.
  protected readonly hasCompany: Signal<boolean> = computed(() => !!this.accountContext.selectedAccount().uid);

  // ── Data ──────────────────────────────────────────────────────────────────
  protected readonly fetchError = signal(false);
  private readonly groupsLoadingState = signal(false);

  private readonly filterValues = this.initFilterValues();

  // Loading: initial (undefined) OR explicit flag set during org-switch (null stays after an error,
  // so groupsData() === undefined alone would miss the reload-after-error skeleton).
  protected readonly groupsLoading = computed(() => this.hasCompany() && (this.groupsData() === undefined || this.groupsLoadingState()));

  // Single source of truth for "there's a roster to show controls over" — shared by the filter bar and
  // the result line so the two conditions can't drift apart.
  protected readonly showRoster: Signal<boolean> = computed(() => !this.groupsLoading() && this.groups().length > 0);

  // Shared with the constructor's org-switch filter reset below — mirrors committee-members' orgUid$.
  private readonly orgUid$ = toObservable(computed(() => this.accountContext.selectedAccount().uid)).pipe(
    filter((id): id is string => !!id),
    distinctUntilChanged()
  );

  private readonly groupsData: Signal<OrgLensGroupsResponse | null | undefined> = this.initGroupsData();

  protected readonly groups: Signal<OrgLensGroupSummary[]> = computed(() => this.groupsData()?.groups ?? []);
  // Not read from the template — filteredGroups() is what the @for actually iterates.
  private readonly groupsWithClass: Signal<OrgLensGroupVm[]> = this.initGroupsWithClass();
  protected readonly totalGroups: Signal<number> = computed(() => this.groupsData()?.total_groups ?? 0);
  protected readonly totalSeats: Signal<number> = computed(() => this.groupsData()?.total_seats ?? 0);

  private readonly behavioralClassCounts: Signal<Record<GroupBehavioralClass, number>> = this.initBehavioralClassCounts();
  protected readonly visibleClassTiles: Signal<OrgLensGroupClassTile[]> = this.initVisibleClassTiles();

  protected readonly statTileCount: Signal<number> = computed(() => this.visibleClassTiles().length + this.fixedStatTileCount);

  protected readonly isFiltering: Signal<boolean> = this.initIsFiltering();
  private readonly foundationLabelsBySlug: Signal<Map<string, string>> = this.initFoundationLabelsBySlug();
  protected readonly foundationOptions: Signal<OrgDropdownOption[]> = this.initFoundationOptions();
  protected readonly typeOptions: Signal<OrgDropdownOption[]> = this.initTypeOptions();
  protected readonly filteredGroups: Signal<OrgLensGroupVm[]> = this.initFilteredGroups();
  // Single source of truth for the export button's disabled state and its tooltip/aria explanation,
  // so every binding that reads it can't drift apart (mirrors showRoster's rationale above).
  protected readonly hasNoRowsToExport: Signal<boolean> = computed(() => this.filteredGroups().length === 0);
  protected readonly noRowsToExportLabel = 'No rows to export';

  // ── Seat holders drawer (GH-1780) ──────────────────────────────────────────
  protected readonly seatHoldersDrawerVisible = signal(false);
  protected readonly selectedGroup = signal<OrgLensGroupVm | null>(null);

  public constructor() {
    // State → URL, mirrors org-projects' filterForm.valueChanges → router.navigate pattern. `merge`
    // preserves unrelated params (e.g. ?project=, utm_*); null at default lets merge strip an owned key.
    // valueChanges never emits the form's initial (already URL-seeded) value, so this never navigates on mount.
    this.filterForm.valueChanges.pipe(debounceTime(150), takeUntilDestroyed()).subscribe(() => {
      const v = this.filterForm.getRawValue();
      const target = { q: v.search.trim() || null, foundation: v.foundation || null, type: v.type || null };
      void this.router.navigate([], { relativeTo: this.route, queryParams: target, queryParamsHandling: 'merge', replaceUrl: true });
    });

    // A filter value from the previous org (e.g. its foundation slug) would almost never match the
    // next org's roster. `skip(1)` so the URL-seeded initial filter survives first load — only an
    // actual org switch clears it, mirroring committee-members' resetAllState() on orgUid$.
    // Also closes the seat-holders drawer: OrgGroupsComponent isn't destroyed on an org switch, so
    // a drawer left open would otherwise keep the previous org's selectedGroup (and, via its own
    // orgUid-keyed cache, would just show the new org's roster filtered by the old org's committeeUid).
    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => {
      this.clearFilters();
      this.seatHoldersDrawerVisible.set(false);
      this.selectedGroup.set(null);
    });
  }

  protected clearFilters(): void {
    this.filterForm.reset({ search: '', foundation: '', type: '' });
  }

  protected onSeatHoldersClick(group: OrgLensGroupVm): void {
    this.selectedGroup.set(group);
    this.seatHoldersDrawerVisible.set(true);
  }

  // Exports the currently filtered (not the full) roster, in the same order the list renders —
  // filteredGroups() is exactly what the template's @for iterates, unsorted client-side. Deliberately
  // no "Total Seats" column: the only per-row candidate (total_members) is unpopulated upstream (#1792)
  // and isn't even a field on OrgLensGroupSummary; the response-level total_seats is an org-wide
  // aggregate, not a per-row value.
  protected exportCsv(): void {
    const rows = this.filteredGroups();
    if (!rows.length) {
      return;
    }
    const header = [this.committeeLabel.singular, 'Foundation', 'Type', 'Our Seats', `${this.committeeLabel.singular} UID`];
    const body = rows.map((g) => [g.name, g.projectLabel, BEHAVIORAL_CLASS_CONFIG[g.cls].label, g.org_seat_count, g.uid]);
    // accountSlug is normalized to '' (not null/undefined) during org-switch/enrichment windows
    // (see account-context.service.ts's PLACEHOLDER_ACCOUNT and toAccount()) — `||`, not `??`, so
    // that empty string also falls back rather than producing a bare "org-lens-groups--<date>.csv".
    const slug = this.accountContext.selectedAccount().accountSlug || 'org';
    downloadCsv(`org-lens-groups-${slug}-${localDateStamp()}.csv`, [header, ...body]);
  }

  private initGroupsData(): Signal<OrgLensGroupsResponse | null | undefined> {
    return toSignal(
      this.orgUid$.pipe(
        tap(() => {
          this.groupsLoadingState.set(true);
          this.fetchError.set(false);
        }),
        switchMap((id) =>
          this.groupsService.getGroups(id).pipe(
            tap(() => this.groupsLoadingState.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load org groups:', error);
              this.fetchError.set(true);
              this.groupsLoadingState.set(false);
              return of(null);
            })
          )
        ),
        takeUntilDestroyed()
      )
    );
  }

  private initGroupsWithClass(): Signal<OrgLensGroupVm[]> {
    return computed(() =>
      this.groups().map((g) => {
        const cls = getGroupBehavioralClass(g.category);
        const projectLabel = g.project_name || g.project_slug || '';
        const seatWord = g.org_seat_count === 1 ? 'seat' : 'seats';
        const ariaLabel = `${g.name}, ${BEHAVIORAL_CLASS_CONFIG[cls].label}, ${g.org_seat_count} ${seatWord}` + (projectLabel ? `, ${projectLabel}` : '');
        // See org-groups.component.html for why this links to /org/memberships, not /org/projects.
        const projectAriaLabel = projectLabel ? `View ${projectLabel} membership details` : '';
        const seatHoldersTriggerAriaLabel = `View ${g.org_seat_count} seat holder${g.org_seat_count === 1 ? '' : 's'} for ${g.name}`;
        return { ...g, cls, projectLabel, ariaLabel, projectAriaLabel, seatHoldersTriggerAriaLabel };
      })
    );
  }

  private initBehavioralClassCounts(): Signal<Record<GroupBehavioralClass, number>> {
    return computed(() => {
      const counts: Record<GroupBehavioralClass, number> = {
        'governing-board': 0,
        'oversight-committee': 0,
        'working-group': 0,
        'special-interest-group': 0,
        'ambassador-program': 0,
        other: 0,
      };
      for (const g of this.groupsWithClass()) {
        counts[g.cls]++;
      }
      return counts;
    });
  }

  private initIsFiltering(): Signal<boolean> {
    return computed(() => {
      const v = this.filterValues();
      return v.search.trim().length > 0 || !!v.foundation || !!v.type;
    });
  }

  // Resolved name always wins over a slug fallback, regardless of which group of a shared foundation
  // is seen first — enrichment is still resolved per-committee server-side, so an unenriched group can
  // sort ahead of an enriched sibling. Shared by the Foundation select (labels) and search (so an
  // unenriched group still matches its foundation's resolved name, not just its own slug). Mirrors
  // org-projects' bySlug map. `projectLabel` (project_name || project_slug) comes from groupsWithClass().
  private initFoundationLabelsBySlug(): Signal<Map<string, string>> {
    return computed(() => {
      const bySlug = new Map<string, string>();
      for (const g of this.groupsWithClass()) {
        if (!g.project_slug) continue;
        if (g.project_name || !bySlug.has(g.project_slug)) bySlug.set(g.project_slug, g.projectLabel);
      }
      return bySlug;
    });
  }

  private initFoundationOptions(): Signal<OrgDropdownOption[]> {
    return computed(() => {
      const options = [...this.foundationLabelsBySlug().entries()]
        .sort((a, b) => a[1].localeCompare(b[1], 'en-US'))
        .map(([slug, label]) => ({ label, value: slug }));
      return [{ label: 'All foundations', value: '' }, ...options];
    });
  }

  private initTypeOptions(): Signal<OrgDropdownOption[]> {
    return computed(() => {
      const counts = this.behavioralClassCounts();
      const entries = Object.entries(this.behavioralClassConfig) as [GroupBehavioralClass, BehavioralClassDisplayConfig][];
      const present = entries.filter(([key]) => counts[key] > 0);
      return [{ label: 'All types', value: '' }, ...present.map(([key, cfg]) => ({ label: `${cfg.label} (${counts[key]})`, value: key }))];
    });
  }

  private initFilteredGroups(): Signal<OrgLensGroupVm[]> {
    return computed(() => {
      const v = this.filterValues();
      const q = v.search.trim().toLowerCase();
      const foundation = v.foundation;
      const type = v.type;

      const labelsBySlug = this.foundationLabelsBySlug();
      return this.groupsWithClass().filter((g) => {
        if (foundation && g.project_slug !== foundation) return false;
        if (type && g.cls !== type) return false;
        // Match on the resolved-per-foundation label (so an unenriched group still matches a search for
        // its foundation's resolved name, see initFoundationLabelsBySlug) and on the raw slug too, as a
        // convenience for a search term that happens to be the technical slug rather than the display name.
        const label = (g.project_slug && labelsBySlug.get(g.project_slug)) || g.projectLabel;
        const slug = g.project_slug ?? '';
        if (q && !g.name.toLowerCase().includes(q) && !label.toLowerCase().includes(q) && !slug.toLowerCase().includes(q)) return false;
        return true;
      });
    });
  }

  // Mirrors committee-members' inline debounce pattern — no shared debounce helper exists in the repo.
  // `valueChanges` is typed `Partial<...>` by Angular's typed forms even though every control here is
  // non-nullable, so re-read via getRawValue() to keep a fully-typed value (no `search: string | undefined`).
  private initFilterValues(): Signal<{ search: string; foundation: string; type: GroupBehavioralClass | '' }> {
    return toSignal(
      this.filterForm.valueChanges.pipe(
        debounceTime(150),
        map(() => this.filterForm.getRawValue())
      ),
      { initialValue: this.filterForm.getRawValue() }
    );
  }

  // Only `type` needs enum validation — it's the one param with a real finite domain (the 6
  // GroupBehavioralClass keys). search/foundation are free strings: a bogus value just matches
  // nothing, never throws.
  private initTypeFromUrl(): GroupBehavioralClass | '' {
    const raw = this.route.snapshot.queryParamMap.get('type');
    const validKeys = new Set(Object.keys(this.behavioralClassConfig));
    return raw && validKeys.has(raw) ? (raw as GroupBehavioralClass) : '';
  }

  // Sorted descending by count so the strip reads largest-class-first, not `BEHAVIORAL_CLASS_CONFIG`
  // key order — except `other`, pinned last regardless of count: it's a catch-all (raw category
  // "Committee" lands here alongside true miscellany), and leading with it would tell the reader
  // less than the specific classes it groups. Filters out any class with zero groups —
  // governing-board is usually 0 here since the BFF drops the exact "Board" category, but a
  // broader board-ish category (e.g. "Governing Board") can still classify as governing-board and
  // get its own tile; the filter is generic on count, not a governing-board special case.
  private initVisibleClassTiles(): Signal<OrgLensGroupClassTile[]> {
    return computed(() => {
      const counts = this.behavioralClassCounts();
      return (Object.keys(counts) as GroupBehavioralClass[])
        .map((cls) => ({ cls, count: counts[cls] }))
        .filter((tile) => tile.count > 0)
        .sort((a, b) => (a.cls === 'other' ? 1 : 0) - (b.cls === 'other' ? 1 : 0) || b.count - a.count);
    });
  }
}
