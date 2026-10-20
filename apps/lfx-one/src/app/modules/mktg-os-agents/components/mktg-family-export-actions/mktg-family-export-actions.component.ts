// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';

/** Named integration slot for family exports. Wiring belongs to the export item. */
@Component({
  selector: 'lfx-mktg-family-export-actions',
  imports: [ButtonComponent],
  templateUrl: './mktg-family-export-actions.component.html',
  host: { class: 'block', '[attr.data-family-id]': 'familyId()' },
})
export class MktgFamilyExportActionsComponent {
  public readonly familyId = input.required<string>();
}
