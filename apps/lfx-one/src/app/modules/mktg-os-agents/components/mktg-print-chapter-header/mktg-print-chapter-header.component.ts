// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

/** One Inter/number/accent-rule title for every family print chapter. */
@Component({
  selector: 'lfx-mktg-print-chapter-header',
  templateUrl: './mktg-print-chapter-header.component.html',
  styleUrl: '../../mktg-framework-print/mktg-framework-print.component.scss',
  host: { class: 'block break-after-avoid lfx-print-chapter-accent', '[style.--mfp-chapter-accent]': 'accent()' },
})
export class MktgPrintChapterHeaderComponent {
  public readonly number = input.required<string>();
  public readonly title = input.required<string>();
  /** Explicit shared token: do not inherit an asset root's neutral reset. */
  public readonly accent = input.required<string>();
}
