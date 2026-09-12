// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';

import type { AudienceLastSentEmail, AudienceListBrief, AudienceMasterListBrief } from '@lfx-one/shared/interfaces';

/**
 * "Who did we send this to last time" — past sends for this event, plus master lists already built.
 *
 * The fastest correct answer to the question the legacy tool was built around, and the reason a
 * rebuild is often unnecessary: an existing master list can be reused outright.
 */
@Component({
  selector: 'lfx-audience-last-sent',
  imports: [DatePipe],
  templateUrl: './audience-last-sent.component.html',
  styleUrl: './audience-last-sent.component.scss',
})
export class AudienceLastSentComponent {
  // === Inputs ===
  public readonly emails = input<readonly AudienceLastSentEmail[]>([]);
  public readonly masterLists = input<readonly AudienceMasterListBrief[]>([]);
  public readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  public readonly loading = input(false);
  public readonly disabled = input(false);
  /**
   * Fetch failures, kept separate per section because the two load independently.
   *
   * Without these, an outage and a portal that genuinely holds nothing render the identical empty
   * arm — so "No past marketing email for this event was found in HubSpot" asserts a verified
   * absence on a branch that also runs when the request failed. Same contract as the suppression
   * grid's `failed`; the consequence here is a wasted rebuild rather than a compliance gap, which
   * is why it is a distinct message and not a blocker.
   */
  /** Owned by the existing-masters request, which runs independently of `loading` (last-sent). */
  public readonly mastersLoading = input(false);
  public readonly mastersFailed = input(false);
  public readonly emailsFailed = input(false);

  // === Outputs ===
  /** Add one of a past send's lists to the inclusion set. */
  public readonly addList = output<AudienceListBrief>();
  /** Add an already-built master list to the inclusion set. */
  public readonly addMasterList = output<AudienceMasterListBrief>();

  // === Protected Methods ===
  protected isSelected(listId: string): boolean {
    return this.selectedIds().has(listId);
  }

  protected sizeLabel(size?: number): string {
    return size === undefined ? 'size unknown' : `${size.toLocaleString('en-US')} contacts`;
  }

  protected onAddList(list: AudienceListBrief): void {
    // A missing list is unusable, not merely unlabelled: `missing` means the v3 lookup AND the
    // legacy-id recovery both failed, so there is no list behind the id to include.
    if (!this.disabled() && !list.missing) {
      this.addList.emit(list);
    }
  }

  protected onAddMasterList(list: AudienceMasterListBrief): void {
    if (!this.disabled()) {
      this.addMasterList.emit(list);
    }
  }
}
