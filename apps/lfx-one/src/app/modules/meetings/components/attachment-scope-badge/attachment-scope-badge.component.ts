// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { AttachmentScope } from '@lfx-one/shared/interfaces';

/**
 * Pill that says which occurrences a meeting attachment applies to.
 * @description An attachment is either scoped to one occurrence of a recurring meeting or applies to the whole
 * series. Callers render this only for recurring meetings, where the distinction means something.
 */
@Component({
  selector: 'lfx-attachment-scope-badge',
  templateUrl: './attachment-scope-badge.component.html',
})
export class AttachmentScopeBadgeComponent {
  public readonly scope = input.required<AttachmentScope>();

  protected readonly isOccurrence = computed(() => this.scope() === 'occurrence');
  protected readonly label = computed(() => (this.isOccurrence() ? 'This occurrence' : 'All occurrences'));
}
