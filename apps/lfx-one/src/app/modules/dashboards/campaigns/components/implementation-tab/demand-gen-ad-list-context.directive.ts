// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive } from '@angular/core';
import { FormArray, FormGroup } from '@angular/forms';
import { GoogleDemandGenAdControls } from '@lfx-one/shared/interfaces';

/**
 * Types the context of implementation-tab.component.html's `#demandGenAdListTemplate` fragment (#5226):
 * the ad group index (`null` for the single ad group), its ads and their id stem. Without this,
 * `ngTemplateOutletContext`'s context is untyped, so `ads` and every value read from it are `any`
 * under `strictTemplates`. A `static ngTemplateContextGuard` is Angular's documented mechanism for
 * typing an `<ng-template>`'s context; it is never called at runtime, so it returns `true`.
 */
@Directive({ selector: 'ng-template[lfxDemandGenAdListContext]' })
export class DemandGenAdListContextDirective {
  public static ngTemplateContextGuard(
    _dir: DemandGenAdListContextDirective,
    ctx: unknown
  ): ctx is { $implicit: number | null; ads: FormArray<FormGroup<GoogleDemandGenAdControls>>; prefix: string } {
    return true;
  }
}
