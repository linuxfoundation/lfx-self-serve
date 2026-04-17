// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RequestType } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-application-success',
  imports: [],
  templateUrl: './application-success.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationSuccessComponent {
  public readonly eventName = input.required<string>();
  public readonly requestType = input.required<RequestType>();

  protected readonly title = computed(() => (this.requestType() === 'visa' ? 'Visa Letter Application Submitted' : 'Travel Fund Application Submitted'));
}
