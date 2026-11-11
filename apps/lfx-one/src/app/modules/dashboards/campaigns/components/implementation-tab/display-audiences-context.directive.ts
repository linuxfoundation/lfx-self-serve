// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive } from '@angular/core';

import type { GoogleDisplayAudienceControls } from '@lfx-one/shared/interfaces';

/**
 * Types the context of implementation-tab.component.html's `#displayAudiencesTemplate` fragment (#5262):
 * the target's id stem (`single`, or a named group's index) and its four list controls. See
 * `DemandGenAudienceContextDirective` for why a `static ngTemplateContextGuard` is used; it is never called
 * at runtime, so it returns `true`.
 */
@Directive({ selector: 'ng-template[lfxDisplayAudiencesContext]' })
export class DisplayAudiencesContextDirective {
  public static ngTemplateContextGuard(
    _dir: DisplayAudiencesContextDirective,
    ctx: unknown
  ): ctx is { $implicit: string; audiences: GoogleDisplayAudienceControls } {
    return true;
  }
}
