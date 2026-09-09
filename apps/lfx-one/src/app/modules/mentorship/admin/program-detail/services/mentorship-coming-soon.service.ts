// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { MENTORSHIP_COMING_SOON_TOAST_LIFE, MENTORSHIP_PROGRAM_DETAIL_COMING_SOON } from '@lfx-one/shared/constants';
import { MessageService } from 'primeng/api';

/**
 * Every write action on the program-detail tabs is stubbed until the mentorship service
 * exists. One place to say so, rather than the same toast payload in each tab — delete
 * this along with the last caller once the endpoints land.
 */
@Injectable({ providedIn: 'root' })
export class MentorshipComingSoonService {
  private readonly messageService = inject(MessageService);

  /** `summary` names the attempted action, e.g. `Decline Alex Rivera`. */
  public notify(summary: string): void {
    this.messageService.add({
      severity: 'info',
      summary,
      detail: MENTORSHIP_PROGRAM_DETAIL_COMING_SOON,
      life: MENTORSHIP_COMING_SOON_TOAST_LIFE,
    });
  }
}
