// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { Certification } from '@lfx-one/shared/interfaces';

import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

@Component({
  selector: 'lfx-certification-card',
  imports: [ButtonComponent, CardComponent, DatePipe],
  templateUrl: './certification-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CertificationCardComponent {
  // ─── Inputs ────────────────────────────────────────────────────────────────
  public readonly cert = input.required<Certification>();

  // ─── Computed Signals ──────────────────────────────────────────────────────
  protected readonly hasImage: Signal<boolean> = this.initHasImage();
  protected readonly expiryClasses: Signal<string> = this.initExpiryClasses();

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initHasImage(): Signal<boolean> {
    return computed(() => !!this.cert().imageUrl);
  }

  private initExpiryClasses(): Signal<string> {
    return computed(() => {
      const { expiryDate, status } = this.cert();
      if (status === 'expired') return 'text-red-600 font-medium';
      if (!expiryDate) return 'text-gray-700';
      const msUntilExpiry = new Date(expiryDate).getTime() - Date.now();
      if (msUntilExpiry <= 0) return 'text-red-600 font-medium';
      if (msUntilExpiry <= NINETY_DAYS_MS) return 'text-amber-600 font-medium';
      return 'text-gray-700';
    });
  }
}
