// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { BoilerplatesPrintView } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-mktg-boilerplates-print',
  templateUrl: './mktg-boilerplates-print.component.html',
  // Shared brand typography and exact print colour handling, not a second style path.
  styleUrl: '../mktg-framework-print/mktg-framework-print.component.scss',
})
export class MktgBoilerplatesPrintComponent {
  public readonly view = input.required<BoilerplatesPrintView>();
}
