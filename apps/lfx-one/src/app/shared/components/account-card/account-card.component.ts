// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { Component, inject, input } from '@angular/core';

/**
 * One card of an Account & Settings page (#6067): an optional logo before the title (`[accountCardLeading]`), a 16px title with an
 * optional badge beside it (`[accountCardTitleSuffix]`), an optional subtitle, a right-hand slot for the card's action
 * (`[accountCardActions]`), then its content.
 */
@Component({
  selector: 'lfx-account-card',
  templateUrl: './account-card.component.html',
  host: { class: 'block' },
})
export class AccountCardComponent {
  public readonly heading = input.required<string>();
  public readonly subtitle = input<string>('');
  /** Prefix for the card's test ids, e.g. `account-personal-info`. */
  public readonly testId = input<string>('account-card');

  protected readonly headingId = inject(_IdGenerator).getId('lfx-account-card-heading-');
}
