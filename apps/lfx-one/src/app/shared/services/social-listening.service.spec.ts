// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ProjectContext, SocialListeningAccessResponse } from '@lfx-one/shared/interfaces';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectContextService } from './project-context.service';
import { SocialListeningService } from './social-listening.service';

const foundationA: ProjectContext = { uid: 'a-uid', name: 'A', slug: 'a' };
const foundationB: ProjectContext = { uid: 'b-uid', name: 'B', slug: 'b' };
const foundationC: ProjectContext = { uid: 'c-uid', name: 'C', slug: 'c' };

describe('SocialListeningService group grant', () => {
  const selectedFoundation = signal<ProjectContext | null>(foundationA);
  const selectedFoundationSfid = signal<string | null>(null);
  let service: SocialListeningService;

  beforeEach(() => {
    selectedFoundation.set(foundationA);
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: {} },
        { provide: ProjectContextService, useValue: { selectedFoundation, selectedFoundationSfid } },
      ],
    });
    service = TestBed.inject(SocialListeningService);
    service.groupGrant.set({ foundation: foundationA, foundationSfid: 'a-sfid' });
    TestBed.tick();
  });

  it('re-probes the grant when a group member switches foundation without leaving the page', () => {
    const getAccess = vi
      .spyOn(service, 'getAccess')
      .mockReturnValue(of({ canView: true, reason: 'group-member', foundation: foundationB, foundationSfid: 'b-sfid' }));

    selectedFoundation.set(foundationB);
    TestBed.tick();

    expect(getAccess).toHaveBeenCalledWith('b');
    expect(service.foundationSfid()).toBe('b-sfid');
  });

  it('drops the answer for a foundation the member already left', () => {
    const pending = new Subject<SocialListeningAccessResponse>();
    vi.spyOn(service, 'getAccess').mockReturnValue(pending);

    selectedFoundation.set(foundationB);
    TestBed.tick();
    selectedFoundation.set(foundationA);
    TestBed.tick();
    pending.next({ canView: true, reason: 'group-member', foundation: foundationB, foundationSfid: 'b-sfid' });

    expect(service.groupGrant()?.foundation.uid).toBe('a-uid');
    expect(service.foundationSfid()).toBe('a-sfid');
  });

  it('keeps probing after a denied foundation, so a later opted-in foundation still gets its grant', () => {
    const getAccess = vi
      .spyOn(service, 'getAccess')
      .mockReturnValueOnce(of({ canView: false, reason: 'none' }))
      .mockReturnValueOnce(of({ canView: true, reason: 'group-member', foundation: foundationC, foundationSfid: 'c-sfid' }));

    selectedFoundation.set(foundationB);
    TestBed.tick();
    expect(service.foundationSfid()).toBeNull();

    selectedFoundation.set(foundationC);
    TestBed.tick();

    expect(getAccess).toHaveBeenLastCalledWith('c');
    expect(service.foundationSfid()).toBe('c-sfid');
  });

  it('does not probe for a user without a group grant', () => {
    service.groupGrant.set(null);
    const getAccess = vi.spyOn(service, 'getAccess');

    selectedFoundation.set(foundationB);
    TestBed.tick();

    expect(getAccess).not.toHaveBeenCalled();
  });
});
