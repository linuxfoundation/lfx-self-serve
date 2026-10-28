// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { FaqPrintView } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-mktg-faq-print',
  templateUrl: './mktg-faq-print.component.html',
  styleUrl: '../mktg-framework-print/mktg-framework-print.component.scss',
})
export class MktgFaqPrintComponent {
  public readonly view = input.required<FaqPrintView>();
}
