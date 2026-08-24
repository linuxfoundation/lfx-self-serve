// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive } from '@angular/core';
import { WeeklyBriefSourceChip } from '@lfx-one/shared/interfaces';

/**
 * Types the `let-chip="chip"` context on weekly-brief-card.component.html's recursive
 * `#sourceChipTpl` fragment (LFXV2-3335). Without this, `ngTemplateOutletContext`'s context
 * type is untyped, so `chip` is `any` throughout the fragment — the one place in this
 * template that opts out of `strictTemplates`. A `static ngTemplateContextGuard` is Angular's
 * documented mechanism for typing an `<ng-template>`'s context; it's never actually called at
 * runtime (hence returning `true` unconditionally), it exists purely for the type checker.
 */
@Directive({ selector: 'ng-template[lfxSourceChipContext]' })
export class SourceChipContextDirective {
  public static ngTemplateContextGuard(_dir: SourceChipContextDirective, ctx: unknown): ctx is { chip: WeeklyBriefSourceChip } {
    return true;
  }
}
