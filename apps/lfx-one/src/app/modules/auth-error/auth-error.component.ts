// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { HeaderComponent } from '@components/header/header.component';

@Component({
  selector: 'lfx-auth-error',
  imports: [HeaderComponent, CardComponent, ButtonComponent],
  templateUrl: './auth-error.component.html',
})
export class AuthErrorComponent {
  private readonly route = inject(ActivatedRoute);

  private readonly reason: string;

  protected readonly title: string;
  protected readonly description: string;

  public constructor() {
    this.reason = this.route.snapshot.queryParamMap.get('reason') ?? 'failed';
    this.title = this.initTitle();
    this.description = this.initDescription();
  }

  private initTitle(): string {
    switch (this.reason) {
      case 'session':
        return 'Session Could Not Be Saved';
      default:
        return 'Sign-In Required';
    }
  }

  private initDescription(): string {
    switch (this.reason) {
      case 'session':
        return "We couldn't save your session. This is usually temporary — please sign in again.";
      default:
        return 'Your sign-in could not be completed. Please sign in again to continue.';
    }
  }
}
