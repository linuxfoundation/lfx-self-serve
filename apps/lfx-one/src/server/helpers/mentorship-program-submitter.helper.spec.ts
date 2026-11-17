// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { mapMentorshipProgramSubmitter } from './mentorship-program-submitter.helper';

describe('mapMentorshipProgramSubmitter', () => {
  it('keeps the name, email and an http(s) avatar', () => {
    expect(
      mapMentorshipProgramSubmitter({ lfid: 'janedoe', name: ' Jane Doe ', email: ' jane.doe@example.org ', avatar_url: 'https://avatars.example/jane.png' })
    ).toEqual({ name: 'Jane Doe', email: 'jane.doe@example.org', avatarUrl: 'https://avatars.example/jane.png' });
  });

  it('falls back to the LFID for the name and leaves out what upstream omits', () => {
    expect(mapMentorshipProgramSubmitter({ lfid: 'janedoe' })).toEqual({ name: 'janedoe', email: null, avatarUrl: null });
    expect(mapMentorshipProgramSubmitter({ lfid: 'janedoe', name: '  ', email: ' ' })).toEqual({ name: 'janedoe', email: null, avatarUrl: null });
  });

  it('drops an avatar that is not an http(s) URL', () => {
    expect(mapMentorshipProgramSubmitter({ lfid: 'janedoe', avatar_url: 'javascript:alert(1)' }).avatarUrl).toBeNull();
    expect(mapMentorshipProgramSubmitter({ lfid: 'janedoe', avatar_url: 'avatars.example/jane.png' }).avatarUrl).toBeNull();
  });
});
