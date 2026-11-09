// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe, formatCurrency, formatDate, isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { MessageComponent } from '@components/message/message.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProjectContextService } from '@services/project-context.service';
import { debounceTime, distinctUntilChanged, map, merge, tap } from 'rxjs';
import {
  CATEGORY_LABELS,
  CATEGORY_SCORE_KEYS,
  MEMBER_360_HEAT_ORDER,
  MEMBER_360_SORT_COLUMNS,
  MEMBER_360_OWNER_OPTIONS,
  MEMBER_360_TIER_OPTIONS,
  MEMBER_360_RENEWAL_RED_DAYS,
  MEMBER_360_RENEWAL_AMBER_DAYS,
  MEMBER_360_TIER_TONES,
  MEMBER_360_FOLDED_ROWS,
} from '@lfx-one/shared/constants';
import {
  rankMember360Rows,
  mktgKitRootPath,
  mktgRunRouteFor,
  member360ActionTeams,
  member360ActionText,
  member360EvidenceGroups,
  member360EvidenceSource,
  member360QuarterLabel,
  member360SourceLabel,
  member360SourceStatusText,
  member360TierGroupLabel,
  member360WeightRows,
} from '@lfx-one/shared/utils';
import { TooltipModule } from 'primeng/tooltip';
import { Member360DisplayRow, Member360Envelope, Member360RankingRow, Member360SummaryCard, MktgDocumentListItem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-member-360-result',
  imports: [
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    NgClass,
    RouterLink,
    ButtonComponent,
    InputTextComponent,
    SelectComponent,
    MessageComponent,
    MarkdownRendererComponent,
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
  protected readonly tierOptions = MEMBER_360_TIER_OPTIONS;
  protected readonly ownerOptions = MEMBER_360_OWNER_OPTIONS;
  protected readonly columns = MEMBER_360_SORT_COLUMNS;
  protected readonly renewalLegend = `Renewal days: red ≤${MEMBER_360_RENEWAL_RED_DAYS}, amber ${MEMBER_360_RENEWAL_RED_DAYS + 1}–${MEMBER_360_RENEWAL_AMBER_DAYS}.`;
  public readonly runRoute = computed(() => mktgRunRouteFor('member-360', mktgKitRootPath(this.router.url)));
  public readonly projectParams = computed(() => ({ project: this.context.activeContext()?.slug ?? null }));
  public readonly filters = new FormGroup({
    tier: new FormControl(this.tierOptions[0].label, { nonNullable: true }),
    owner: new FormControl(this.ownerOptions[0].label, { nonNullable: true }),
    search: new FormControl('', { nonNullable: true }),
  });
  protected readonly sortKey = signal<keyof Member360RankingRow>('engagement_score');
  protected readonly direction = signal<'ascending' | 'descending'>('descending');
  protected readonly expanded = signal<number | null>(null);
  protected readonly notice = signal('');
  public readonly workbookFilename = computed(() => `Member360_${this.envelope().project}_${this.envelope().period.label}.xlsx`);
  protected readonly tooltipDismissed = signal(false);
  private readonly filterValues = toSignal(this.filters.valueChanges.pipe(map(() => this.readFilters())), { initialValue: this.readFilters() });
  protected readonly rows = this.initRows();
  protected readonly runSummary = computed(() => (this.envelope().summary_markdown || '').trim());
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
  protected readonly renewalKnownValue = computed(() => this.renewals().reduce((sum, row) => (row.annual_value === null ? sum : sum + row.annual_value), 0));
  protected readonly renewalUnknownCount = computed(() => this.renewals().filter((row) => row.annual_value === null).length);
  protected readonly tierDistribution = computed(() =>
    Object.entries(this.summary().tier_distribution)
      .map(([tier, count]) => `${count} ${tier.toLowerCase()}`)
      .join(' · ')
  );
  private readonly foldedRows = MEMBER_360_FOLDED_ROWS;
  /** Lists opened past their first rows ("team:sales", "evidence:events", "notes"); every list starts folded. */
  protected readonly unfolded = signal<ReadonlySet<string>>(new Set());
  protected readonly teams = computed(() =>
    member360ActionTeams(this.envelope().tabs.actions_by_team).map((team) => {
      const rows = team.actions.map((action) => ({
        action,
        text: member360ActionText(action),
        dueText: this.dayText(action.suggested_deadline),
        priorityClass: this.priorityClass(action.priority),
      }));
      return {
        ...team,
        nextDueText: this.dayText(team.nextDue),
        priorityCounts: team.priorityCounts.map((count) => ({ ...count, priorityClass: this.priorityClass(count.priority) })),
        rows,
        fold: this.foldView(`team:${team.key}`, rows, `Show all ${rows.length} actions`),
      };
    })
  );
  protected readonly evidenceGroups = computed(() =>
    member360EvidenceGroups(this.envelope().tabs.evidence).map((group) => {
      const rows = group.rows.map((row) => ({ ...row, sourceText: member360EvidenceSource(row.source) }));
      return { ...group, rows, fold: this.foldView(`evidence:${group.key}`, rows, `Show all ${rows.length}`) };
    })
  );
  protected readonly notes = computed(() => {
    const notes = this.method().notes;
    return this.foldView('notes', notes, `Show all ${notes.length} notes`);
  });
  protected readonly method = computed(() => this.envelope().tabs.method);
  protected readonly methodSources = computed(() =>
    this.method().data_sources.map((source) => ({ ...source, label: member360SourceLabel(source.label), statusText: member360SourceStatusText(source.status) }))
  );
  protected readonly weights = computed(() => member360WeightRows(this.method()));
  /** Peer-median columns: the scoring categories any tier baseline reports, in heat order. */
  protected readonly medianColumns = computed(() =>
    MEMBER_360_HEAT_ORDER.filter((key) => this.method().tier_baselines.some((baseline) => baseline.medians[key] !== undefined)).map((key) => ({
      key,
      label: CATEGORY_LABELS[key],
    }))
  );
  protected readonly baselines = computed(() => {
    const envelope = this.envelope();
    const projectName = envelope.lfx_project_name ?? envelope.project_name;
    return this.method().tier_baselines.map((baseline) => ({
      ...baseline,
      label: member360TierGroupLabel(baseline.baseline_group, projectName),
      medianValues: this.medianColumns().map((column) => baseline.medians[column.key] ?? null),
    }));
  });
  protected readonly decayText = computed(() =>
    this.method()
      .quarter_decay.map((decay) => `${decay.quarter.replace(/^(\d{4})-(Q\d)$/, '$2')} ${decay.factor}×`)
      .join(' · ')
  );
  protected readonly historyRows = computed(() => this.history().map((run) => ({ ...run, quarter: member360QuarterLabel(run.createdAt) })));

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
  protected toggleFold(key: string): void {
    this.unfolded.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  protected async copyTeam(owner: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    const rows = this.teams().find((team) => team.owner === owner)?.rows ?? [];
    try {
      await navigator.clipboard.writeText(
        rows.map(({ action, text }) => `${action.member_organization}: ${text} (${action.priority}; ${action.suggested_deadline ?? 'no deadline'})`).join('\n')
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
        note: this.renewalNote(),
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
  /** A folded list's view: its first rows until opened, and the toggle's state and label; reads the fold signal, so callers are computed. */
  private foldView<T>(key: string, rows: readonly T[], showAllLabel: string) {
    const open = this.unfolded().has(key);
    return {
      key,
      open,
      visible: open ? rows : rows.slice(0, this.foldedRows),
      foldable: rows.length > this.foldedRows,
      toggleLabel: open ? 'Show fewer' : showAllLabel,
    };
  }
  /** "20 Nov" for an ISO day; any other deadline the agent wrote is shown as written. */
  private dayText(day: string | null): string | null {
    if (day === null) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDate(day, 'd MMM', 'en-US') : day;
  }
  private priorityClass(priority: string): string {
    if (priority === 'High') return 'bg-red-50 text-red-800';
    if (priority === 'Medium') return 'bg-amber-50 text-amber-800';
    return 'bg-gray-100 text-gray-700';
  }
  private renewalNote(): string {
    const count = this.renewals().length;
    const unknown = this.renewalUnknownCount();
    if (count === 0) return `No renewals within ${MEMBER_360_RENEWAL_RED_DAYS} days`;
    if (unknown === count) return `No list-price value for ${count === 1 ? 'this renewal' : `these ${count} renewals`}`;
    const amount = this.currency(this.renewalKnownValue());
    if (unknown > 0) return `${amount} known at list price · ${unknown} without a value`;
    return `${amount} at list price`;
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
