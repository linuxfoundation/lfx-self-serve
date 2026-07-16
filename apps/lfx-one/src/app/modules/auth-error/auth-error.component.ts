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
  protected readonly loginHref: string;

  public constructor() {
    this.reason = this.route.snapshot.queryParamMap.get('reason') ?? 'failed';
    this.title = this.initTitle();
    this.description = this.initDescription();
    this.loginHref = this.initLoginHref();
  }

  private initTitle(): string {
    switch (this.reason) {
      case 'session':
        return 'Session Invalid or Expired';
      default:
        return 'Sign-In Required';
    }
  }

  private initDescription(): string {
    switch (this.reason) {
      case 'session':
        return 'Your session is invalid or has expired. Please sign in again to continue.';
      default:
        return 'Your sign-in could not be completed. Please sign in again to continue.';
    }
  }

  private initLoginHref(): string {
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    return returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login';
  }
}
