// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CAMPAIGN_PLATFORMS } from '@lfx-one/shared/constants';
import type {
  CampaignPlatform,
  CreativeSlotCoverageGroup,
  CreativeSlotCoverageRow,
  CreativeSlotAssignment,
  CreativeSlotCoverageState,
  CreativeSlotGap,
} from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { catchError, map, of, startWith, switchMap, timer } from 'rxjs';

/** Platform ids in the order the brief's own platform picker shows them, so the grid reads in the same order. */
const PLATFORM_ORDER: readonly string[] = CAMPAIGN_PLATFORMS.map((platform) => platform.id);

/** Open rows first: what an operator still has to do is the reason this grid exists. */
const STATUS_ORDER: Readonly<Record<CreativeSlotCoverageRow['status'], number>> = { missing: 0, short: 1, filled: 2 } as const;

/**
 * Which of a brief's stored images fill which platform image slots, and what is still missing.
 *
 * Reads `get-asset-plan` itself rather than taking a plan as an input: the plan is derived from the
 * library and the platform selection, both of which change while the operator is on this tab, and a
 * grid that re-read only when the tab remounted would show a stale answer about a library the
 * operator had just changed.
 *
 * TWO honesty rules shape what this renders, both of them consequences of the upstream contract:
 *
 *  - Only platforms that PUBLISH slot rules appear in the plan's `platforms`; a platform with none
 *    is dropped from the request rather than refused. So a selection answered with an empty plan
 *    means "nothing is known about these platforms", not "this library can launch" — and the two
 *    are named apart below, never collapsed into a reassuring empty state.
 *  - `unclassified` names assets whose DIMENSIONS were never recorded, not assets of the wrong
 *    shape. They are neither counted against a slot nor reported as failing one, and a backfill
 *    makes them classifiable without the operator touching anything, so they are reported as
 *    unknown rather than as a problem to fix.
 */
@Component({
  selector: 'lfx-creative-slot-grid',
  templateUrl: './creative-slot-grid.component.html',
  styleUrl: './creative-slot-grid.component.scss',
})
export class CreativeSlotGridComponent {
  // === Injections ===
  private readonly campaignService = inject(CampaignService);

  // === Inputs ===
  public readonly projectSlug = input('');
  /** Empty until the brief is saved — campaign-service has nothing to plan against before then. */
  public readonly briefId = input('');
  /**
   * The platforms the operator picked. Sent on the request and compared against the plan's echo,
   * so a platform the service publishes no slot rules for can be named as such.
   */
  public readonly platforms = input<readonly CampaignPlatform[]>([]);
  /** Bumped by the host when an upload adds an asset to the library, to re-read the plan. */
  public readonly reloadToken = input(0);
  /**
   * The plan slots the host can fill (#4825), as `platform/channel/slot` built from an assignment's own
   * fields. The grid has no fields of its own, so it offers "Use suggested images" only when the plan
   * suggests an image for one of these — a plan whose suggestions are all for another platform or a
   * channel not on screen would otherwise get a button that fills nothing.
   */
  public readonly suggestionTargets = input<readonly string[]>([]);
  /** What the host did with the last suggestions it was handed, or `''`. Shown and announced here, beside the button. */
  public readonly applyResult = input('');
  /**
   * Bumped by the host on every apply. Two applies can end in the same sentence, and a live region
   * whose text does not change announces nothing, so this is what makes the second one heard.
   */
  public readonly applySeq = input(0);

  // === Outputs ===
  /**
   * The plan's assignments that name at least one stored image, for the host to apply. Which of them
   * it takes — and that it fills only empty fields — is the host's decision, not the grid's.
   */
  public readonly applySuggested = output<CreativeSlotAssignment[]>();

  // === Signals ===
  /** Bumped by Refresh. Part of the request identity, so each press is one more read. */
  private readonly attempts = signal(0);

  // === Computed Signals ===
  protected readonly state: Signal<CreativeSlotCoverageState> = this.initState();
  protected readonly groups: Signal<CreativeSlotCoverageGroup[]> = this.initGroups();
  protected readonly unplannedPlatforms: Signal<string[]> = this.initUnplannedPlatforms();
  protected readonly openCount: Signal<number> = computed(() => this.groups().reduce((total, group) => total + group.openCount, 0));
  protected readonly liveMessage: Signal<string> = this.initLiveMessage();
  /** The apply result as the live region announces it: emptied, then refilled on the next tick, per apply. */
  protected readonly applyAnnouncement: Signal<string> = this.initApplyAnnouncement();
  /** The ready plan's assignments that name an image for a slot the host can fill — what "Use suggested images" hands over. */
  protected readonly suggestions: Signal<CreativeSlotAssignment[]> = this.initSuggestions();

  // === Protected Methods ===
  protected applySuggestions(): void {
    const suggestions = this.suggestions();
    if (suggestions.length > 0) {
      this.applySuggested.emit(suggestions);
    }
  }

  protected refresh(): void {
    if (this.state().status !== 'loading') {
      this.attempts.update((n) => n + 1);
    }
  }

  // === Private Initializers ===
  /**
   * The request's identity. Compared by VALUE so a parent that hands over a new array holding the
   * same platforms does not cost a re-read of an answer that cannot have changed.
   */
  private initRequest(): Signal<{ projectSlug: string; briefId: string; platforms: string[]; attempt: number }> {
    return computed(
      () => ({
        projectSlug: this.projectSlug(),
        briefId: this.briefId(),
        // Sorted so the identity is the SET of platforms: reordering the picker is not a new question.
        platforms: [...this.platforms()].sort(),
        attempt: this.reloadToken() + this.attempts(),
      }),
      {
        // Both lists are sorted above, so an element-wise walk settles set equality. Compared this
        // way rather than by joining: no separator can collide with a platform id.
        equal: (a, b) =>
          a.projectSlug === b.projectSlug &&
          a.briefId === b.briefId &&
          a.attempt === b.attempt &&
          a.platforms.length === b.platforms.length &&
          a.platforms.every((platform, index) => platform === b.platforms[index]),
      }
    );
  }

  /**
   * One read per request. `switchMap` drops an answer the operator has moved past, so a slow read
   * cannot paint over a newer one.
   *
   * An unaddressable request — no project, no saved brief, or no platform picked — stays `idle`
   * rather than becoming an empty `ready` plan, because an empty plan with no gaps is exactly how
   * a launch-ready library reads.
   */
  private initState(): Signal<CreativeSlotCoverageState> {
    const idle: CreativeSlotCoverageState = { status: 'idle', plan: null, message: '' };
    return toSignal(
      toObservable(this.initRequest()).pipe(
        switchMap((target) => {
          if (target.projectSlug === '' || target.briefId === '' || target.platforms.length === 0) {
            return of(idle);
          }
          return this.campaignService.getCreativeAssetPlan(target.projectSlug, target.briefId, target.platforms).pipe(
            map((plan): CreativeSlotCoverageState => ({ status: 'ready', plan, message: '' })),
            catchError((error: unknown) =>
              of<CreativeSlotCoverageState>({
                status: 'error',
                plan: null,
                message: extractErrorMessage(error, 'Failed to load image slot coverage'),
              })
            ),
            startWith<CreativeSlotCoverageState>({ status: 'loading', plan: null, message: '' })
          );
        })
      ),
      { initialValue: idle }
    );
  }

  /**
   * Assignments and gaps folded into one row per slot, grouped by platform and channel.
   *
   * The fold is the whole point: a slot holding one of the two images it needs appears in BOTH
   * lists, and rendering them separately would show the same slot twice with two different answers.
   * Channel is part of the grouping because Google's Performance Max, Demand Gen and Display each
   * publish their own `logo` slot with different rules — collapsing them would merge three distinct
   * requirements into one row.
   */
  private initGroups(): Signal<CreativeSlotCoverageGroup[]> {
    return computed(() => {
      const plan = this.state().plan;
      if (!plan) {
        return [];
      }

      // Only gaps that NAME a slot can be folded into an assignment row. A gap with no `slot_key`
      // is a requirement spanning several slots and keeps a row of its own. Upstream omits the
      // field for those rather than sending an empty one, so absent and empty are normalized to
      // the same thing once here instead of being re-tested in three different shapes below.
      const slotGaps = new Map<string, CreativeSlotGap>();
      for (const gap of plan.gaps) {
        const slotKey = gap.slotKey ?? '';
        if (slotKey !== '' && !slotGaps.has(slotKey)) {
          slotGaps.set(slotKey, gap);
        }
      }

      const groups = new Map<string, CreativeSlotCoverageGroup>();
      // Every row key already pushed. `track row.key` in the template needs these unique, so a key
      // is claimed when its row is pushed rather than only when an assignment folded a gap away.
      const emitted = new Set<string>();

      for (const assignment of plan.assignments) {
        // Claimed on this side too, not just below. Upstream states one assignment per slot, but
        // nothing between here and the wire enforces it, and a repeated `slot_key` would push two
        // rows carrying the same `track` key — the NG0955 crash the gap loop already guards.
        if (emitted.has(assignment.slotKey)) {
          continue;
        }
        const gap = slotGaps.get(assignment.slotKey);
        emitted.add(assignment.slotKey);
        const filled = assignment.assetIds.length;
        this.push(groups, assignment.platform, assignment.channel, {
          key: assignment.slotKey,
          label: assignment.label,
          requirement: assignment.requirement,
          filled,
          need: gap?.need ?? 0,
          reason: gap?.reason ?? '',
          status: this.statusOf(filled, gap !== undefined),
          statusLabel: this.statusLabelOf(filled, gap !== undefined),
          countText: assignment.minCount > 0 ? `${filled} of ${assignment.minCount} needed` : `${filled} stored`,
        });
      }

      for (const gap of plan.gaps) {
        const slotKey = gap.slotKey ?? '';
        // A cross-slot rule has no slot to key on; its label is what distinguishes it. Prefixed
        // because an unprefixed `platform/channel/label` is the same shape as an upstream
        // `slot_key`, and a rule whose label matched a sibling slot's wire name would then collide
        // with that slot's row and be dropped instead of rendered.
        const key = slotKey === '' ? `rule:${gap.platform}/${gap.channel ?? ''}/${gap.label}` : slotKey;
        if (emitted.has(key)) {
          continue;
        }
        emitted.add(key);
        this.push(groups, gap.platform, gap.channel, {
          key,
          label: gap.label,
          requirement: '',
          filled: 0,
          need: gap.need,
          reason: gap.reason,
          status: 'missing',
          statusLabel: 'Missing',
          // Only a named slot can state a count; a cross-slot rule has no single slot to count in.
          countText: slotKey === '' ? '' : `0 of ${gap.need} needed`,
        });
      }

      return [...groups.values()]
        .map((group) => ({
          ...group,
          rows: [...group.rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
          openCount: group.rows.filter((row) => row.status !== 'filled').length,
        }))
        .sort((a, b) => this.platformRank(a.key) - this.platformRank(b.key) || a.key.localeCompare(b.key));
    });
  }

  /**
   * The picked platforms the plan came back WITHOUT.
   *
   * Upstream drops a platform it publishes no slot rules for instead of refusing the request, so
   * without this line a Reddit-only selection would answer "no gaps" — which an operator would
   * read as a library that is ready to launch.
   */
  private initUnplannedPlatforms(): Signal<string[]> {
    return computed(() => {
      const plan = this.state().plan;
      if (!plan) {
        return [];
      }
      const planned = new Set(plan.platforms);
      return this.platforms()
        .filter((platform) => !planned.has(platform))
        .map((platform) => this.platformLabel(platform));
    });
  }

  /**
   * What a screen reader hears each time the answer changes.
   *
   * The ANSWER is announced, not just the wait: the read is asynchronous and its outcome — covered,
   * still short, or nothing known — is the whole reason the panel is on the tab. An empty plan is
   * named as "nothing to report" rather than as coverage, for the same reason the visible branch
   * does: a plan with no gaps is also exactly how a launch-ready library reads.
   */
  private initLiveMessage(): Signal<string> {
    return computed(() => {
      const state = this.state();
      if (state.status === 'loading') {
        return 'Checking which image slots this library covers.';
      }
      if (state.status === 'error') {
        return state.message;
      }
      if (state.status !== 'ready') {
        return '';
      }
      if (this.groups().length === 0) {
        return 'No image slots to report for the platforms you picked.';
      }
      const open = this.openCount();
      if (open === 0) {
        // The visible pair carries this caveat in two elements — the amber unplanned banner sits
        // directly above the green one — but this region is `aria-atomic` on a single sentence, so
        // a listener would hear only the covered half. Full coverage of the platforms that HAVE
        // rules is the exact case where "covered" is most likely to be heard as launch-ready.
        const unplanned = this.unplannedPlatforms();
        if (unplanned.length > 0) {
          return `Every image slot below is covered, but no image slot rules are published yet for ${unplanned.join(', ')}.`;
        }
        return 'Every image slot below is covered.';
      }
      // Worded as the visible count line is, so the two cannot drift into saying different things
      // about the same number. "an image" is the floor, not the total: a slot that is PARTLY
      // covered is counted here too, and what it is short of is one more image.
      return open === 1 ? '1 image slot still needs an image.' : `${open} image slots still need an image.`;
    });
  }

  /**
   * Every apply clears the region and refills it a tick later, so a result that repeats the previous
   * one is announced again: a polite live region speaks only when its contents CHANGE, and the empty
   * render in between is that change. The visible line reads `applyResult` directly and never blinks.
   */
  private initApplyAnnouncement(): Signal<string> {
    const apply = computed(() => ({ seq: this.applySeq(), text: this.applyResult() }));
    return toSignal(
      toObservable(apply).pipe(
        switchMap(({ text }) =>
          text === ''
            ? of('')
            : timer(0).pipe(
                map(() => text),
                startWith('')
              )
        )
      ),
      { initialValue: '' }
    );
  }

  private initSuggestions(): Signal<CreativeSlotAssignment[]> {
    return computed(() => {
      const state = this.state();
      if (state.status !== 'ready' || !state.plan) return [];
      const targets = new Set(this.suggestionTargets());
      return state.plan.assignments.filter(
        (assignment) => assignment.assetIds.length > 0 && targets.has(`${assignment.platform}/${assignment.channel ?? ''}/${assignment.slot}`)
      );
    });
  }

  // === Private Helpers ===
  private push(groups: Map<string, CreativeSlotCoverageGroup>, platform: string, channel: string | undefined, row: CreativeSlotCoverageRow): void {
    const key = channel ? `${platform}/${channel}` : platform;
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
      return;
    }
    groups.set(key, {
      key,
      label: channel ? `${this.platformLabel(platform)} · ${this.channelLabel(channel)}` : this.platformLabel(platform),
      rows: [row],
      openCount: 0,
    });
  }

  private statusOf(filled: number, short: boolean): CreativeSlotCoverageRow['status'] {
    if (!short) {
      return 'filled';
    }
    return filled > 0 ? 'short' : 'missing';
  }

  private statusLabelOf(filled: number, short: boolean): string {
    if (!short) {
      return 'Covered';
    }
    return filled > 0 ? 'Partly covered' : 'Missing';
  }

  /**
   * `PERFORMANCE_MAX` reads as `Performance Max`.
   *
   * The channel arrives as Google's own enum spelling — campaign-service's `design/brief.go`
   * documents the field as carrying `"PERFORMANCE_MAX"`, `"DEMAND_GEN"` and `"DISPLAY"` — which is
   * a wire value, not operator copy, and rendering it raw would shout a constant at the operator.
   * Converted rather than looked up in a table, so a channel Google adds later still reads as a
   * name and there is no list here to keep in step with upstream.
   */
  private channelLabel(channel: string): string {
    return channel
      .split('_')
      .filter((word) => word !== '')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /** The platform id upstream uses is the one the picker uses, so a plan row joins without translation. */
  private platformLabel(platform: string): string {
    return CAMPAIGN_PLATFORMS.find((option) => option.id === platform)?.label ?? platform;
  }

  private platformRank(groupKey: string): number {
    const rank = PLATFORM_ORDER.indexOf(groupKey.split('/')[0]);
    return rank === -1 ? PLATFORM_ORDER.length : rank;
  }
}
