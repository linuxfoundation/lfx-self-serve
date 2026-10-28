// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { BoilerplatesPrintView } from '@lfx-one/shared/interfaces';
import { MktgPrintRunningHeadComponent } from '../components/mktg-print-running-head/mktg-print-running-head.component';

@Component({
  selector: 'lfx-mktg-boilerplates-print',
  imports: [MktgPrintRunningHeadComponent],
  templateUrl: './mktg-boilerplates-print.component.html',
  // Shared brand typography and exact print colour handling, not a second style path.
  styleUrl: '../mktg-framework-print/mktg-framework-print.component.scss',
})
export class MktgBoilerplatesPrintComponent {
  public readonly view = input.required<BoilerplatesPrintView>();
  public readonly number = input.required<string>();
  public readonly projectName = input.required<string>();
}
