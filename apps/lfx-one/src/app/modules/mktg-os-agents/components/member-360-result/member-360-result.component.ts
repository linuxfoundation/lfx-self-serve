// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, formatCurrency, isPlatformBrowser, JsonPipe, NgClass } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { MessageComponent } from '@components/message/message.component';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProjectContextService } from '@services/project-context.service';
import { debounceTime, distinctUntilChanged, map, merge, tap } from 'rxjs';
import {
  ACTION_OWNERS,
  CATEGORY_LABELS,
  CATEGORY_SCORE_KEYS,
  MEMBER_360_HEAT_ORDER,
  MEMBER_360_SORT_COLUMNS,
  MEMBER_360_OWNER_OPTIONS,
  MEMBER_360_TIER_OPTIONS,
  MEMBER_360_RENEWAL_RED_DAYS,
  MEMBER_360_RENEWAL_AMBER_DAYS,
  MEMBER_360_TIER_TONES,
} from '@lfx-one/shared/constants';
import { rankMember360Rows, mktgKitRootPath, mktgRunRouteFor, member360SourceLabel, member360SourceStatusText } from '@lfx-one/shared/utils';
import { TooltipModule } from 'primeng/tooltip';
import { Member360DisplayRow, Member360Envelope, Member360RankingRow, Member360SummaryCard, MktgDocumentListItem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-member-360-result',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    JsonPipe,
    NgClass,
    RouterLink,
    ButtonComponent,
    InputTextComponent,
    SelectComponent,
    MessageComponent,
    TooltipModule,
  ],
  templateUrl: './member-360-result.component.html',
  styleUrl: './member-360-result.component.scss',
})
export class Member360ResultComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly context = inject(ProjectContextService);
  public readonly envelope = input.required<Member360Envelope>();
  public readonly history = input<MktgDocumentListItem[]>([]);
  public readonly documentId = input.required<string>();
  protected readonly owners = ACTION_OWNERS;
  protected readonly tierOptions = MEMBER_360_TIER_OPTIONS;
  protected readonly ownerOptions = MEMBER_360_OWNER_OPTIONS;
  protected readonly columns = MEMBER_360_SORT_COLUMNS;
  protected readonly renewalLegend = `Renewal days: red ≤${MEMBER_360_RENEWAL_RED_DAYS}, amber ${MEMBER_360_RENEWAL_RED_DAYS + 1}–${MEMBER_360_RENEWAL_AMBER_DAYS}.`;
  protected readonly runRoute = computed(() => mktgRunRouteFor('member-360', mktgKitRootPath(this.router.url)));
  protected readonly projectParams = computed(() => ({ project: this.context.activeContext()?.slug ?? null }));
  public readonly filters = new FormGroup({
    tier: new FormControl(this.tierOptions[0].label, { nonNullable: true }),
    owner: new FormControl(this.ownerOptions[0].label, { nonNullable: true }),
    search: new FormControl('', { nonNullable: true }),
  });
  protected readonly sortKey = signal<keyof Member360RankingRow>('engagement_score');
  protected readonly direction = signal<'ascending' | 'descending'>('descending');
  protected readonly expanded = signal<number | null>(null);
  protected readonly notice = signal('');
  protected readonly tooltipDismissed = signal(false);
  private readonly filterValues = toSignal(this.filters.valueChanges.pipe(map(() => this.readFilters())), { initialValue: this.readFilters() });
  protected readonly rows = this.initRows();
  protected readonly summary = computed(() => this.envelope().tabs.summary);
  protected readonly sourcesUsed = computed(() => this.summary().data_coverage.sources_used.map(member360SourceLabel).join(' · '));
  protected readonly sourcesUnavailable = computed(() => this.summary().data_coverage.sources_unavailable.map(member360SourceLabel).join(', '));
  protected readonly cards = this.initCards();
  protected readonly scoreRange = computed(() => {
    const scores = this.envelope().tabs.member_ranking.map((row) => row.engagement_score);
    return scores.length ? `${Math.min(...scores)} to ${Math.max(...scores)}` : '—';
  });
  protected readonly renewals = computed(() =>
    this.envelope().tabs.member_ranking.filter(
      (row) => row.days_to_renewal !== null && row.days_to_renewal >= 0 && row.days_to_renewal <= MEMBER_360_RENEWAL_RED_DAYS
    )
  );
  protected readonly renewalValue = computed(() => this.renewals().reduce((sum, row) => sum + (row.annual_value ?? 0), 0));
  protected readonly tierDistribution = computed(() =>
    Object.entries(this.summary().tier_distribution)
      .map(([tier, count]) => `${count} ${tier.toLowerCase()}`)
      .join(' · ')
  );
  protected readonly teams = computed(() =>
    this.owners.map((owner) => ({
      key: owner.toLowerCase().replace(/ /g, '-'),
      owner,
      actions: this.envelope().tabs.actions_by_team.filter((action) => action.owner === owner),
    }))
  );
  protected readonly method = computed(() => this.envelope().tabs.method);
  protected readonly methodSources = computed(() =>
    this.method().data_sources.map((source) => ({ ...source, label: member360SourceLabel(source.label), statusText: member360SourceStatusText(source.status) }))
  );
  protected readonly weights = computed(() =>
    MEMBER_360_HEAT_ORDER.map((key) => ({ label: CATEGORY_LABELS[key], value: this.method().weights_used[key], original: this.method().weights_default[key] }))
  );

  public constructor() {
    // Restore shared links and browser history without writing another entry.
    let restoring = false;
    let searchPending = false;
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      restoring = true;
      const tier = this.tierOptions.find((option) => option.label === params.get('tier'))?.label ?? this.tierOptions[0].label;
      const owner = this.ownerOptions.find((option) => option.label === params.get('owner'))?.label ?? this.ownerOptions[0].label;
      const search = params.get('search') ?? '';
      if (this.filters.controls.tier.value !== tier) this.filters.controls.tier.setValue(tier);
      if (this.filters.controls.owner.value !== owner) this.filters.controls.owner.setValue(owner);
      // An in-flight query echo must not overwrite newer typing or move its caret.
      const typingEcho = searchPending && this.router.getCurrentNavigation()?.trigger === 'imperative';
      if (!typingEcho && this.filters.controls.search.value !== search) {
        this.filters.controls.search.setValue(search);
        searchPending = false;
      }
      this.sortKey.set(this.columns.find((column) => column.key === params.get('sort'))?.key ?? 'engagement_score');
      this.direction.set(params.get('direction') === 'ascending' ? 'ascending' : 'descending');
      restoring = false;
    });
    merge(this.filters.controls.tier.valueChanges.pipe(distinctUntilChanged()), this.filters.controls.owner.valueChanges.pipe(distinctUntilChanged()))
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (restoring) return;
        const filters = this.readFilters();
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { ...this.projectParams(), tier: filters.tier || null, owner: filters.owner || null },
          queryParamsHandling: 'merge',
        });
      });
    this.filters.controls.search.valueChanges
      .pipe(
        tap(() => {
          if (!restoring) searchPending = true;
        }),
        debounceTime(300),
        takeUntilDestroyed()
      )
      .subscribe((search) => {
        searchPending = false;
        if (search === (this.route.snapshot.queryParamMap.get('search') ?? '')) return;
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { ...this.projectParams(), search: search || null },
          queryParamsHandling: 'merge',
        });
      });
  }

  protected sort(key: keyof Member360RankingRow): void {
    this.direction.set(this.sortKey() === key && this.direction() === 'ascending' ? 'descending' : 'ascending');
    this.sortKey.set(key);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        ...this.projectParams(),
        sort: key === 'engagement_score' ? null : key,
        direction: this.direction() === 'descending' ? null : this.direction(),
      },
      queryParamsHandling: 'merge',
    });
  }
  protected toggle(member: number): void {
    this.expanded.update((current) => (current === member ? null : member));
  }
  protected async copyTeam(owner: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    const actions = this.teams().find((team) => team.owner === owner)?.actions ?? [];
    try {
      await navigator.clipboard.writeText(
        actions
          .map((action) => `${action.member_organization}: ${action.recommended_action} (${action.priority}; ${action.suggested_deadline ?? 'no deadline'})`)
          .join('\n')
      );
      this.notice.set(`${owner} list copied.`);
    } catch {
      this.notice.set('Copy failed. You can select the actions and copy them manually.');
    }
  }
  private initCards() {
    return computed<Member360SummaryCard[]>(() => [
      { key: 'members', label: 'Members scored', value: String(this.summary().member_count), note: '' },
      { key: 'value', label: 'Total membership value', value: this.currency(this.summary().total_membership_value), note: 'list price, from LFX' },
      { key: 'scores', label: 'Score range · tiers', value: this.scoreRange(), note: this.tierDistribution() },
      {
        key: 'renewals',
        label: `Renewals within ${MEMBER_360_RENEWAL_RED_DAYS} days`,
        value: String(this.renewals().length),
        note: `${this.currency(this.renewalValue())} at list price`,
      },
    ]);
  }
  private initRows() {
    return computed<Member360DisplayRow[]>(() => {
      const envelope = this.envelope();
      return rankMember360Rows(envelope.tabs.member_ranking, this.filterValues(), this.sortKey(), this.direction()).map((member) => ({
        member,
        key: envelope.tabs.member_ranking.indexOf(member),
        ...this.trendState(member, envelope),
        heat: MEMBER_360_HEAT_ORDER.map((key) => {
          const value = member[CATEGORY_SCORE_KEYS[key]];
          return { label: CATEGORY_LABELS[key], value, color: this.heatClass(value) };
        }),
        renewalClass: this.renewalClass(member.days_to_renewal),
        tierClass: this.tierClass(member.engagement_tier),
        rationale: envelope.tabs.actions_by_team.find((action) => action.member_organization === member.member_organization)?.supporting_rationale ?? '',
        evidence: envelope.tabs.evidence.filter((evidence) => evidence.member_organization === member.member_organization),
      }));
    });
  }
  private readFilters() {
    const values = this.filters.getRawValue();
    return {
      ...values,
      tier: values.tier === this.tierOptions[0].label ? '' : values.tier,
      owner: values.owner === this.ownerOptions[0].label ? '' : values.owner,
    };
  }
  private trendState(member: Member360RankingRow, envelope: Member360Envelope) {
    const trend = envelope.inputs.prior_run_provided ? member.trend : null;
    const movers = envelope.tabs.summary.movers;
    const delta = [...(movers?.gainers ?? []), ...(movers?.decliners ?? [])].find((row) => row.member_organization === member.member_organization)?.delta;
    let trendClass = '';
    if (trend === '▲') trendClass = 'text-emerald-700';
    if (trend === '▼') trendClass = 'text-red-700';
    return {
      trendText: trend === null || delta === undefined ? (trend ?? '—') : `${trend} ${Math.abs(delta)}`,
      trendClass,
      trendAriaLabel: trend === null ? 'no trend' : null,
      trendState: trend ?? 'none',
    };
  }
  private currency(value: number): string {
    return formatCurrency(value, 'en-US', '$', 'USD', '1.0-0');
  }
  private heatClass(value: number | null): string {
    if (value === null) return 'bg-gray-200';
    if (value >= 80) return 'bg-emerald-700';
    if (value >= 60) return 'bg-emerald-400';
    if (value >= 40) return 'bg-amber-400';
    return 'bg-red-500';
  }
  private renewalClass(days: number | null): string {
    if (days === null) return 'text-gray-500';
    // Renewal colours follow the workbook spec of record, including boundary days.
    if (days <= MEMBER_360_RENEWAL_RED_DAYS) return 'font-bold text-red-700';
    if (days <= MEMBER_360_RENEWAL_AMBER_DAYS) return 'font-semibold text-amber-700';
    return 'text-gray-700';
  }
  private tierClass(tier: Member360RankingRow['engagement_tier']): string {
    const tone = MEMBER_360_TIER_TONES[tier];
    if (tone === 'emerald') return 'bg-emerald-50 text-emerald-800';
    if (tone === 'amber') return 'bg-amber-50 text-amber-800';
    return 'bg-red-50 text-red-800';
  }
}
