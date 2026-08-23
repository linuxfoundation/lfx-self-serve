// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { BEHAVIORAL_CLASS_CONFIG, COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import type {
  BehavioralClassDisplayConfig,
  GroupBehavioralClass,
  OrgDropdownOption,
  OrgLensGroupSummary,
  OrgLensGroupsResponse,
  OrgLensGroupVm,
} from '@lfx-one/shared/interfaces';
import { getGroupBehavioralClass } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, debounceTime, distinctUntilChanged, filter, map, of, skip, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensGroupsService } from '@services/org-lens-groups.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';

@Component({
  selector: 'lfx-org-groups',
  imports: [EmptyStateComponent, InputTextComponent, NgTemplateOutlet, ReactiveFormsModule, RouterLink, SelectComponent, SkeletonModule, TagComponent],
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

  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');

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
  protected readonly groupsWithClass: Signal<OrgLensGroupVm[]> = this.initGroupsWithClass();
  protected readonly totalGroups: Signal<number> = computed(() => this.groupsData()?.total_groups ?? 0);
  protected readonly totalSeats: Signal<number> = computed(() => this.groupsData()?.total_seats ?? 0);

  protected readonly behavioralClassCounts: Signal<Record<GroupBehavioralClass, number>> = this.initBehavioralClassCounts();

  protected readonly isFiltering: Signal<boolean> = this.initIsFiltering();
  private readonly foundationLabelsBySlug: Signal<Map<string, string>> = this.initFoundationLabelsBySlug();
  protected readonly foundationOptions: Signal<OrgDropdownOption[]> = this.initFoundationOptions();
  protected readonly typeOptions: Signal<OrgDropdownOption[]> = this.initTypeOptions();
  protected readonly filteredGroups: Signal<OrgLensGroupVm[]> = this.initFilteredGroups();

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
    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => this.clearFilters());
  }

  protected clearFilters(): void {
    this.filterForm.reset({ search: '', foundation: '', type: '' });
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
        return { ...g, cls, projectLabel, ariaLabel, projectAriaLabel };
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
      const options = [...this.foundationLabelsBySlug().entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([slug, label]) => ({ label, value: slug }));
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
}
