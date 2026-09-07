// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { OrgClaGroup } from '@lfx-one/shared/interfaces';
import type { TagSeverity } from '@lfx-one/shared/interfaces';

import { TagComponent } from '@components/tag/tag.component';

/** Status label and severity, keyed by the server-derived status. */
const STATUS_DISPLAY: Record<OrgClaGroup['status'], { label: string; severity: TagSeverity }> = {
  signed: { label: 'Signed', severity: 'success' },
  sanctioned: { label: 'Sanctioned', severity: 'danger' },
};

/**
 * One corporate CLA on the Organization Lens EasyCLA list (#1978).
 *
 * Presentational only — it takes a row and renders it, injecting no service and holding no state,
 * so the page's retrieval and paging logic and this card's display rules are testable apart.
 */
@Component({
  selector: 'lfx-org-easycla-card',
  imports: [TagComponent],
  templateUrl: './org-easycla-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaCardComponent {
  public readonly claGroup = input.required<OrgClaGroup>();

  protected readonly status = computed(() => STATUS_DISPLAY[this.claGroup().status]);

  /**
   * Coverage as the approved design frames it: name the project when there is exactly one,
   * otherwise name the foundation and say how many projects are covered.
   *
   * Static text, not a link. The design's chip opens a coverage dialog that ships with the
   * agreement detail view; a chip styled as actionable that does nothing reads as a bug, so it
   * stays plain until there is somewhere for it to go.
   */
  protected readonly coverageChips = computed<string[]>(() => {
    const { projects, foundationName } = this.claGroup();

    if (projects.length === 0) return [];
    if (projects.length === 1) return [projects[0].projectName];

    const projectsChip = `Covers ${projects.length} projects`;
    return foundationName ? [foundationName, projectsChip] : [projectsChip];
  });

  protected readonly managersLabel = computed(() => {
    const count = this.claGroup().claManagersCount;
    return `CLA Manager${count === 1 ? '' : 's'}`;
  });

  /**
   * The approval-criteria count — how many rules decide who may be covered.
   *
   * The CLA service returns no such count, so this is always absent and the card shows an em dash
   * under the label rather than a number. It is deliberately not filled from the employee
   * acknowledgement count, which counts the people covered rather than the rules covering them;
   * a real number under a label naming a different quantity is worse than a visible gap. A zero
   * would be worse still — it would assert the agreement approves nobody.
   */
  protected readonly approvalCriteriaValue = computed(() => {
    const count = this.claGroup().approvalCriteriaCount;
    return count === undefined ? '—' : String(count);
  });
}
