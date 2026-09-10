// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MENTORSHIP_COMING_SOON_DETAIL, MENTORSHIP_COMING_SOON_TOAST_LIFE } from '@lfx-one/shared/constants';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipComingSoonService } from './mentorship-coming-soon.service';

describe('MentorshipComingSoonService', () => {
  let service: MentorshipComingSoonService;
  let add: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    add = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [MentorshipComingSoonService, { provide: MessageService, useValue: { add } }],
    });

    service = TestBed.inject(MentorshipComingSoonService);
  });

  it('raises the caller summary with the shared stub detail and duration', () => {
    service.notify('Decline Alex Rivera');

    expect(add).toHaveBeenCalledWith({
      severity: 'info',
      summary: 'Decline Alex Rivera',
      detail: MENTORSHIP_COMING_SOON_DETAIL,
      life: MENTORSHIP_COMING_SOON_TOAST_LIFE,
    });
  });

  it('raises one toast per call, so repeated attempts each get feedback', () => {
    service.notify('Create a task for Priya Shah');
    service.notify('Create a task for Priya Shah');

    expect(add).toHaveBeenCalledTimes(2);
  });

  it('passes an empty summary through rather than substituting a default', () => {
    service.notify('');

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: '' }));
  });
});
