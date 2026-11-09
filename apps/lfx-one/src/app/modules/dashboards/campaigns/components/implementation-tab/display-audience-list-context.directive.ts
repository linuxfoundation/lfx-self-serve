// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive } from '@angular/core';
import { FormControl } from '@angular/forms';

import type { GoogleDisplayAudienceKind } from '@lfx-one/shared/interfaces';

/**
 * Types the context of implementation-tab.component.html's `#displayAudienceListTemplate` fragment (#5262):
 * the list's id stem (`single`, a group index, or `excluded`), its kind, which picks the options offered,
 * its label, and the control holding its resource names, passed in so the fragment reads it rather than
 * calling a method on every change-detection pass. See `DemandGenAudienceContextDirective` for why a
 * `static ngTemplateContextGuard` is used; it is never called at runtime, so it returns `true`.
 */
@Directive({ selector: 'ng-template[lfxDisplayAudienceListContext]' })
export class DisplayAudienceListContextDirective {
  public static ngTemplateContextGuard(
    _dir: DisplayAudienceListContextDirective,
    ctx: unknown
  ): ctx is { $implicit: string; kind: GoogleDisplayAudienceKind; label: string; list: FormControl<string[]> } {
    return true;
  }
}
