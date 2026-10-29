// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { environment } from '@environments/environment';
import { MentorshipPublicPage } from '@lfx-one/shared/interfaces';
import { buildMentorshipPublicUrl, isUuid } from '@lfx-one/shared/utils';

/**
 * An id's page on the public mentorship site (`programs`, `mentees` or `mentors`), or `null` unless the id is a UUID,
 * so a caller shows plain text rather than a broken link.
 */
@Pipe({
  name: 'mentorshipPublicUrl',
})
export class MentorshipPublicUrlPipe implements PipeTransform {
  public transform(id: string | null | undefined, page: MentorshipPublicPage): string | null {
    return id && isUuid(id) ? buildMentorshipPublicUrl(environment.urls.mentorship, page, id) : null;
  }
}
