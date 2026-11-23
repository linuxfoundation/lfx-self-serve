// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive } from '@angular/core';
import { FormControl } from '@angular/forms';
import type { GoogleDemandGenDemographics } from '@lfx-one/shared/interfaces';

/**
 * Types the context of implementation-tab.component.html's `#demandGenDemographicsTemplate` fragment
 * (linuxfoundation/lfx-v2-campaign-service#498, #518): the ad group index (`null` for the single ad
 * group), that group's demographics control and its Audience control, which the fragment reads to
 * offer the demographics only while no Audience is picked. Typed for the reason
 * `DemandGenAudienceContextDirective` gives; the guard is never called at runtime.
 */
@Directive({ selector: 'ng-template[lfxDemandGenDemographicsContext]' })
export class DemandGenDemographicsContextDirective {
  public static ngTemplateContextGuard(
    _dir: DemandGenDemographicsContextDirective,
    ctx: unknown
  ): ctx is { $implicit: number | null; demographics: FormControl<GoogleDemandGenDemographics>; audience: FormControl<string> } {
    return true;
  }
}
