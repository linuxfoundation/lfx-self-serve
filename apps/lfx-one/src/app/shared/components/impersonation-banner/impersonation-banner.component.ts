// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { ImpersonationService } from '@services/impersonation.service';
import { UserService } from '@services/user.service';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-impersonation-banner',
  imports: [ButtonComponent],
  templateUrl: './impersonation-banner.component.html',
})
export class ImpersonationBannerComponent {
  private readonly impersonationService = inject(ImpersonationService);
  protected readonly userService = inject(UserService);

  protected stopImpersonation(): void {
    this.impersonationService
      .stopImpersonation()
      .pipe(take(1))
      .subscribe(() => {
        window.location.reload();
      });
  }
}
