// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { environment } from '@environments/environment';
import { buildMentorshipPublicUrl } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';

import { MentorshipPublicUrlPipe } from './mentorship-public-url.pipe';

describe('MentorshipPublicUrlPipe', () => {
  const pipe = new MentorshipPublicUrlPipe();
  const id = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';

  it.each(['programs', 'mentees', 'mentors'] as const)('links a UUID to its %s page on the mentorship site', (page) => {
    expect(pipe.transform(id, page)).toBe(buildMentorshipPublicUrl(environment.urls.mentorship, page, id));
  });

  it.each([undefined, null, '', 'prog-1', 'user/1'])('gives null for %j, so the caller shows plain text', (value) => {
    expect(pipe.transform(value, 'mentees')).toBeNull();
  });
});
