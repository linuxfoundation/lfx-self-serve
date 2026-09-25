// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, input, TemplateRef } from '@angular/core';

/** Marks a tab's `<ng-template>` as the body of the shell section whose key it names. */
@Directive({ selector: 'ng-template[lfxHealthMetricsL2Section]' })
export class HealthMetricsL2SectionDirective {
  public readonly template = inject(TemplateRef);

  public readonly key = input.required<string>({ alias: 'lfxHealthMetricsL2Section' });
}
