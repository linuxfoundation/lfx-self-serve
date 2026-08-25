// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { OrgUpdateRequest } from '@lfx-one/shared/interfaces';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgProfileService } from './org-profile.service';

describe('OrgProfileService', () => {
  let service: OrgProfileService;
  let httpGet: ReturnType<typeof vi.fn>;
  let httpPut: ReturnType<typeof vi.fn>;
  let httpPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    httpGet = vi.fn().mockReturnValue(of({}));
    httpPut = vi.fn().mockReturnValue(of({}));
    httpPost = vi.fn().mockReturnValue(of({}));
    TestBed.configureTestingModule({
      providers: [{ provide: HttpClient, useValue: { get: httpGet, put: httpPut, post: httpPost } }],
    });
    service = TestBed.inject(OrgProfileService);
  });

  it('getCanonicalRecord GETs the uid-encoded record endpoint', () => {
    service.getCanonicalRecord('001/weird uid').subscribe();
    expect(httpGet).toHaveBeenCalledWith(`/api/orgs/uid/${encodeURIComponent('001/weird uid')}`);
  });

  it('getAddresses GETs the uid-encoded addresses endpoint', () => {
    service.getAddresses('001Dn00000ExAmPleA').subscribe();
    expect(httpGet).toHaveBeenCalledWith('/api/orgs/uid/001Dn00000ExAmPleA/addresses');
  });

  it('updateOrg PUTs the payload to the uid-encoded record endpoint', () => {
    const payload = { name: 'Acme' } as OrgUpdateRequest;
    service.updateOrg('001Dn00000ExAmPleA', payload).subscribe();
    expect(httpPut).toHaveBeenCalledWith('/api/orgs/uid/001Dn00000ExAmPleA', payload);
  });

  it('uploadLogo POSTs the raw file with its own content-type to the logo endpoint', () => {
    const file = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    service.uploadLogo('001Dn00000ExAmPleA', file).subscribe();
    expect(httpPost).toHaveBeenCalledWith('/api/orgs/uid/001Dn00000ExAmPleA/logo', file, { headers: { 'Content-Type': 'image/png' } });
  });
});
