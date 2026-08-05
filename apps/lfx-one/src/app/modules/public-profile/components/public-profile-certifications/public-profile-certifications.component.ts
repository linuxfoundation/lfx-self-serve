// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { PublicProfileCertification } from '@lfx-one/shared/interfaces';

import { PublicProfileDateRangePipe } from '../../pipes/public-profile-date-range.pipe';

@Component({
  selector: 'lfx-public-profile-certifications',
  imports: [PublicProfileDateRangePipe],
  templateUrl: './public-profile-certifications.component.html',
})
export class PublicProfileCertificationsComponent {
  public readonly certifications = input<PublicProfileCertification[]>([]);
}
