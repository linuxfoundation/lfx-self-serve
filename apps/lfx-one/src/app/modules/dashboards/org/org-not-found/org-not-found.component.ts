// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

/**
 * Org Lens dead end (spec 050 US4, FR-022/FR-022a): the address named an organization that does not
 * exist, that the viewer cannot read, or that Org Lens cannot serve right now. Static copy only —
 * no `AccountContextService`, no HTTP, no route params — so nothing here can tell "unknown" from
 * "no access" (DR-002) or leak the organization behind the address.
 */
@Component({
  selector: 'lfx-org-not-found',
  imports: [RouterLink, ButtonComponent, CardComponent],
  templateUrl: './org-not-found.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgNotFoundComponent {}
