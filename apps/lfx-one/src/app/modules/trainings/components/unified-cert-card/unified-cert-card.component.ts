// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { ButtonSeverity, UnifiedCertification, UnifiedCertState } from '@lfx-one/shared/interfaces';
import { COURSE_URL_PREFIX, CONTINUE_LEARNING_URL, ENROLL_AGAIN_URL, ENROLL_AGAIN_URL_PREFIX } from '@lfx-one/shared/constants';

import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

const EXPIRY_CLASS_BY_STATE: Partial<Record<UnifiedCertState, string>> = {
  'expiring-soon': 'text-amber-600 font-medium',
  'enrolled-cert-expired': 'text-red-600 font-medium',
  'cert-expired': 'text-red-600 font-medium',
};

@Component({
  selector: 'lfx-unified-cert-card',
  imports: [ButtonComponent, CardComponent, DatePipe],
  templateUrl: './unified-cert-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnifiedCertCardComponent {
  // ─── Inputs ────────────────────────────────────────────────────────────────
  public readonly cert = input.required<UnifiedCertification>();

  // ─── Computed Signals ──────────────────────────────────────────────────────
  protected readonly hasImage = computed(() => !!this.cert().imageUrl);
  protected readonly stateBadge: Signal<{ label: string; classes: string } | null> = this.initStateBadge();
  protected readonly metaFields: Signal<{ label: string; value: string; classes?: string }[]> = this.initMetaFields();
  protected readonly primaryAction: Signal<{ label: string; href: string; icon?: string; severity?: ButtonSeverity } | null> = this.initPrimaryAction();
  protected readonly secondaryAction: Signal<{ label: string; href: string; icon?: string } | null> = this.initSecondaryAction();
  protected readonly continueLearningUrl: Signal<string> = this.initContinueLearningUrl();
  protected readonly enrollAgainUrl: Signal<string> = this.initEnrollAgainUrl();

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initStateBadge(): Signal<{ label: string; classes: string } | null> {
    return computed(() => {
      const state = this.cert().state;
      const badges: Partial<Record<UnifiedCertState, { label: string; classes: string }>> = {
        'expiring-soon': { label: 'Expiring Soon', classes: 'bg-amber-50 border border-amber-200 text-amber-700' },
        'enrolled-cert-expired': { label: 'Cert Expired', classes: 'bg-red-50 border border-red-200 text-red-700' },
        'cert-expired': { label: 'Expired', classes: 'bg-red-50 border border-red-200 text-red-700' },
      };
      return badges[state] ?? null;
    });
  }

  private initMetaFields(): Signal<{ label: string; value: string; classes?: string }[]> {
    return computed(() => {
      const cert = this.cert();
      const fields: { label: string; value: string; classes?: string }[] = [];

      if (cert.issuedDate) {
        fields.push({ label: 'Date Earned', value: cert.issuedDate });
      }

      if (cert.expiryDate) {
        const expiryClasses = EXPIRY_CLASS_BY_STATE[cert.state] ?? 'text-gray-700';
        fields.push({ label: 'Valid Until', value: cert.expiryDate, classes: expiryClasses });
      } else if (cert.certId) {
        fields.push({ label: 'Valid Until', value: 'No Expiry', classes: 'text-gray-700' });
      }

      if (cert.certificateId) {
        fields.push({ label: 'Certificate ID', value: cert.certificateId });
      }

      return fields;
    });
  }

  private initPrimaryAction(): Signal<{ label: string; href: string; icon?: string; severity?: ButtonSeverity } | null> {
    return computed(() => {
      const cert = this.cert();
      const renewUrl = cert.isActiveEnrollment ? this.continueLearningUrl() : this.enrollAgainUrl();
      switch (cert.state) {
        case 'certified-active':
        case 'cert-only':
          return cert.downloadUrl ? { label: 'Download', href: cert.downloadUrl, icon: 'fa-light fa-arrow-down-to-line', severity: 'secondary' } : null;
        case 'expiring-soon':
        case 'enrolled-cert-expired':
          return { label: 'Renew Now', href: renewUrl };
        case 'cert-expired':
          return { label: 'Renew Now', href: renewUrl };
        default:
          return null;
      }
    });
  }

  private initSecondaryAction(): Signal<{ label: string; href: string; icon?: string } | null> {
    return computed(() => {
      const cert = this.cert();
      if ((cert.state === 'cert-expired' || cert.state === 'expiring-soon') && cert.downloadUrl) {
        return { label: 'Download', href: cert.downloadUrl, icon: 'fa-light fa-arrow-down-to-line' };
      }
      return null;
    });
  }

  private initContinueLearningUrl(): Signal<string> {
    return computed(() => {
      const slug = this.cert().courseSlug;
      return slug ? `${COURSE_URL_PREFIX}${slug}` : CONTINUE_LEARNING_URL;
    });
  }

  private initEnrollAgainUrl(): Signal<string> {
    return computed(() => {
      const slug = this.cert().courseSlug;
      return slug ? `${ENROLL_AGAIN_URL_PREFIX}${slug}` : ENROLL_AGAIN_URL;
    });
  }
}
