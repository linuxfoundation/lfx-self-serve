// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive } from '@angular/core';
import { FormControl } from '@angular/forms';

/**
 * Types the context of implementation-tab.component.html's `#demandGenAudienceTemplate` fragment (#5244):
 * the ad group index (`null` for the single ad group) and that group's Audience control, passed in so
 * the fragment reads it rather than calling a method on every change-detection pass. Without this,
 * `ngTemplateOutletContext`'s context is untyped, so the control would be `any` under `strictTemplates`.
 * A `static ngTemplateContextGuard` is Angular's documented mechanism for typing an `<ng-template>`'s
 * context; it is never called at runtime, so it returns `true`.
 */
@Directive({ selector: 'ng-template[lfxDemandGenAudienceContext]' })
export class DemandGenAudienceContextDirective {
  public static ngTemplateContextGuard(
    _dir: DemandGenAudienceContextDirective,
    ctx: unknown
  ): ctx is { $implicit: number | null; audience: FormControl<string> } {
    return true;
  }
}
