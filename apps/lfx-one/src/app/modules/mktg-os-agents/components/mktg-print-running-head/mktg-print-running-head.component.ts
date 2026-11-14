// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { MktgPrintBrand } from '@lfx-one/shared/interfaces';

/** The same project/logo strip for every Marketing OS print section. */
@Component({
  selector: 'lfx-mktg-print-running-head',
  templateUrl: './mktg-print-running-head.component.html',
  host: { class: 'block break-after-avoid' },
})
export class MktgPrintRunningHeadComponent {
  public readonly brand = input.required<MktgPrintBrand>();
  public readonly label = input.required<string>();
  public readonly versionLabel = input('');
}
