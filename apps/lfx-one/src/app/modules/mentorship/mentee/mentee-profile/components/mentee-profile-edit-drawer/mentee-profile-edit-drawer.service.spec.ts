// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MentorshipMenteeProfileDetails } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MenteeProfileEditDrawerService } from './mentee-profile-edit-drawer.service';

const PROFILE: MentorshipMenteeProfileDetails = {
  aboutMe: '<p>Test introduction</p>',
  skillsHave: ['Go', 'Python'],
  skillsWant: ['Kubernetes'],
  resumeFileName: 'resume.pdf',
  resumeUrl: 'https://example.com/resume.pdf',
};

describe('MenteeProfileEditDrawerService', () => {
  let service: MenteeProfileEditDrawerService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [MenteeProfileEditDrawerService] });
    service = TestBed.inject(MenteeProfileEditDrawerService);
  });

  it('starts closed with no context', () => {
    expect(service.isOpen()).toBe(false);
    expect(service.context()).toBeNull();
  });

  it('open sets context and flips isOpen', () => {
    service.open(PROFILE);

    expect(service.isOpen()).toBe(true);
    expect(service.context()).toEqual(PROFILE);
  });

  it('close clears context and flips isOpen', () => {
    service.open(PROFILE);
    service.close();

    expect(service.isOpen()).toBe(false);
    expect(service.context()).toBeNull();
  });

  it('replaces context when open is called a second time', () => {
    service.open(PROFILE);

    const updated: MentorshipMenteeProfileDetails = { ...PROFILE, aboutMe: 'Updated' };
    service.open(updated);

    expect(service.context()).toEqual(updated);
  });
});
