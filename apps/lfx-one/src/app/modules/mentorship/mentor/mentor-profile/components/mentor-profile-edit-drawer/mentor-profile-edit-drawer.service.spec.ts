// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MentorshipMentorProfileDetails } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MentorProfileEditDrawerService } from './mentor-profile-edit-drawer.service';

const PROFILE: MentorshipMentorProfileDetails = {
  aboutMe: '<p>Test introduction</p>',
  skills: ['Go', 'Kubernetes'],
  resumeFileName: 'resume.pdf',
  resumeUrl: 'https://example.com/resume.pdf',
};

describe('MentorProfileEditDrawerService', () => {
  let service: MentorProfileEditDrawerService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [MentorProfileEditDrawerService] });
    service = TestBed.inject(MentorProfileEditDrawerService);
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

    const updated: MentorshipMentorProfileDetails = { ...PROFILE, aboutMe: 'Updated' };
    service.open(updated);

    expect(service.context()).toEqual(updated);
  });
});
