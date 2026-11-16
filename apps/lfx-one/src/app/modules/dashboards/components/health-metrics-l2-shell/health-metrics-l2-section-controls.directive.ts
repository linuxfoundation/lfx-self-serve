// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, input, TemplateRef } from '@angular/core';

/** Marks a tab's `<ng-template>` as the header controls (select, switch, toggle) of the shell section whose key it names. */
@Directive({ selector: 'ng-template[lfxHealthMetricsL2SectionControls]' })
export class HealthMetricsL2SectionControlsDirective {
  public readonly template = inject(TemplateRef);

  public readonly key = input.required<string>({ alias: 'lfxHealthMetricsL2SectionControls' });
}
