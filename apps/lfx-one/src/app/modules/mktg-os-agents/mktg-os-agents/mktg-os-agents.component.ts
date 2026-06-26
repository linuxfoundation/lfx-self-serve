// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { MKTG_OS_AGENTS_LABEL } from '@lfx-one/shared/constants';

// Placeholder landing for the dark-launched Marketing OS marketplace (LFXAI-96).
// The marketplace UI and per-agent chat land in later stories (LFXAI-98 / LFXAI-99).
@Component({
  selector: 'lfx-mktg-os-agents',
  imports: [CardComponent],
  templateUrl: './mktg-os-agents.component.html',
})
export class MktgOsAgentsComponent {
  // === Constants ===
  protected readonly labels = MKTG_OS_AGENTS_LABEL;
}
