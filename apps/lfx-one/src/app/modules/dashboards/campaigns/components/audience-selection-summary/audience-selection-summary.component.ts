// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output, Signal } from '@angular/core';
import { AUDIENCE_LIST_PROCESSING_TYPE_LABELS } from '@lfx-one/shared/constants';
import { AudienceSelectionSummaryItem, AudienceSelectionSummaryRow } from '@lfx-one/shared/interfaces';

/**
 * "What this audience means": every selected list in plain English, so an operator can see who an
 * email goes to -- and who is kept off it -- before attaching the audience.
 *
 * Presentational, like the tab's other children. The container fetches the descriptions
 * (campaign-service renders them deterministically from each list's HubSpot rules) and hands them
 * in; this only arranges them. A list whose description has not arrived yet still shows its name,
 * so the panel never hides a selected list while it loads.
 */
@Component({
  selector: 'lfx-audience-selection-summary',
  imports: [DecimalPipe, NgTemplateOutlet],
  templateUrl: './audience-selection-summary.component.html',
})
export class AudienceSelectionSummaryComponent {
  /** The lists the send goes to. */
  public readonly includes = input.required<readonly AudienceSelectionSummaryItem[]>();
  /** The standard hygiene suppressions (opt-outs, unsubscribes, GDPR, bounces), shown as one group. */
  public readonly standardExcludes = input<readonly AudienceSelectionSummaryItem[]>([]);
  /** Every other excluded list: brand or event suppressions, current registrants, lists marked Exclude. */
  public readonly otherExcludes = input<readonly AudienceSelectionSummaryItem[]>([]);
  /** The edition whose current-registrants list attach will CREATE; '' when none is pending. */
  public readonly pendingRegistrantsEdition = input('');
  public readonly loading = input(false);
  public readonly error = input<string | null>(null);
  /** The panel's title: the selection being built, or the audience already attached to the email. */
  public readonly heading = input('What this audience means');
  /**
   * The heading's element id, which labels the panel. Overridden where a second panel is on the
   * page at once (the newsletter's, on Implement, beside the mounted Audience tab's), because two
   * elements with one id leave `aria-labelledby` pointing at whichever comes first.
   */
  public readonly headingId = input('audience-meaning-heading');
  public readonly retry = output<void>();

  protected readonly includeRows: Signal<AudienceSelectionSummaryRow[]> = this.initRows(this.includes);
  protected readonly standardRows: Signal<AudienceSelectionSummaryRow[]> = this.initRows(this.standardExcludes);
  protected readonly otherRows: Signal<AudienceSelectionSummaryRow[]> = this.initRows(this.otherExcludes);

  /** How many lists keep contacts off the send, counting a registrants list that attach will create. */
  protected readonly excludedCount: Signal<number> = this.initExcludedCount();
  /** The one sentence on top: who the email goes to, and who is kept off. */
  protected readonly headline: Signal<string> = this.initHeadline();
  /** Whether any description is partial, so the panel can say so once rather than per row. */
  protected readonly anyIncomplete: Signal<boolean> = this.initAnyIncomplete();

  private initExcludedCount(): Signal<number> {
    return computed(() => this.standardExcludes().length + this.otherExcludes().length + (this.pendingRegistrantsEdition() === '' ? 0 : 1));
  }

  private initHeadline(): Signal<string> {
    return computed(() => {
      const included = this.includes().length;
      const excluded = this.excludedCount();
      let who: string;
      if (included === 0) {
        who = 'No list is included yet, so this email would go to nobody';
      } else if (included === 1) {
        who = 'This email goes to everyone in the included list';
      } else {
        who = `This email goes to anyone in at least one of the ${included} included lists`;
      }
      if (excluded === 0) {
        return `${who}.`;
      }
      return `${who}, except anyone in ${excluded === 1 ? 'the excluded list' : `any of the ${excluded} excluded lists`}.`;
    });
  }

  private initAnyIncomplete(): Signal<boolean> {
    return computed(() =>
      [...this.includes(), ...this.standardExcludes(), ...this.otherExcludes()].some((item) => this.hasShownSummary(item) && !item.description?.complete)
    );
  }

  private initRows(items: Signal<readonly AudienceSelectionSummaryItem[]>): Signal<AudienceSelectionSummaryRow[]> {
    return computed(() =>
      items().map((item) => {
        const groups = item.description?.groups ?? [];
        const ruleCount = groups.reduce((total, group) => total + group.conditions.length, 0);
        const processingType = (item.description?.processingType ?? '').toUpperCase();
        return {
          item,
          shownDescription: this.hasShownSummary(item) ? item.description : null,
          kindLabel: AUDIENCE_LIST_PROCESSING_TYPE_LABELS[processingType] ?? '',
          expandable: ruleCount > 1,
          ruleCount,
        };
      })
    );
  }

  /**
   * Whether an item carries a description worth showing. A list the describe call did not answer for
   * is recorded with an empty summary so it is not asked for again; it is "could not be read", not a
   * described list with a blank rules line, and its `complete: false` is not a partial description.
   */
  private hasShownSummary(item: AudienceSelectionSummaryItem): item is AudienceSelectionSummaryItem & { description: NonNullable<AudienceSelectionSummaryItem['description']> } {
    return item.description !== null && item.description.summary.trim() !== '';
  }
}
