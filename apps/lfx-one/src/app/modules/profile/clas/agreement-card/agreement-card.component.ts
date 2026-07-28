// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MyClaAgreement } from '@lfx-one/shared/interfaces';

import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';

/**
 * Presentational row for a single signed CLA in the My CLAs list. ICLA rows expose a
 * Download PDF action (emitted via `download` — the parent resolves the short-lived URL
 * and opens it on click); ECLA rows show "Covered by Corporate CLA (CCLA)" and no PDF.
 */
@Component({
  selector: 'lfx-agreement-card',
  imports: [DatePipe, BadgeComponent, ButtonComponent],
  templateUrl: './agreement-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgreementCardComponent {
  public readonly agreement = input.required<MyClaAgreement>();
  /** True while this row's PDF URL is being resolved (parent-driven). */
  public readonly downloading = input<boolean>(false);

  /** Emitted when the user clicks Download PDF; payload is the signatureID. */
  public readonly download = output<string>();

  protected readonly kindSeverity = computed(() => (this.agreement().kind === 'ICLA' ? 'info' : 'secondary'));

  protected readonly statusLabel = computed(() => {
    switch (this.agreement().status) {
      case 'valid':
        return 'Valid';
      case 'superseded':
        return 'Superseded';
      default:
        return 'No longer valid';
    }
  });

  protected readonly statusSeverity = computed(() => {
    switch (this.agreement().status) {
      case 'valid':
        return 'success';
      case 'superseded':
        return 'warn';
      default:
        return 'secondary';
    }
  });

  protected onDownload(): void {
    this.download.emit(this.agreement().id);
  }
}
