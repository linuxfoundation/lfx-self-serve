// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountSettingsComponent } from './account-settings.component';

/**
 * Guards issue #2177's deep-link consolidation: profile.routes.ts redirects the legacy
 * /profile/email(s)/password pages into /profile/settings with a fragment, and this component
 * reads that fragment to set the active TOC section (and, once email data has loaded, re-scroll).
 */
describe('AccountSettingsComponent — fragment deep-link (#2177)', () => {
  let fragment$: Subject<string | null>;
  let fixture: ComponentFixture<AccountSettingsComponent>;

  beforeEach(async () => {
    fragment$ = new Subject<string | null>();

    const userServiceMock = {
      impersonating: signal(true), // skips the developer-token fetch — irrelevant to this suite
      getUserEmails: vi.fn(() => of(null)),
    };

    TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' }, // no DOM in this suite — scrollToSection's document access is guarded
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} }, fragment: fragment$ } },
        { provide: UserService, useValue: userServiceMock },
        { provide: ConfirmationService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    // Empty template: exercise the constructor's fragment pipeline without the full section markup.
    TestBed.overrideComponent(AccountSettingsComponent, { set: { template: '', imports: [] } });

    fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('defaults activeSection to email-settings before any fragment arrives', () => {
    expect(fixture.componentInstance.activeSection()).toBe('email-settings');
  });

  it('sets activeSection when a known fragment arrives', () => {
    fragment$.next('password');
    expect(fixture.componentInstance.activeSection()).toBe('password');
  });

  it('ignores an unknown fragment, leaving activeSection unchanged', () => {
    fragment$.next('password');
    fragment$.next('not-a-real-section');
    expect(fixture.componentInstance.activeSection()).toBe('password');
  });

  it('ignores a null fragment', () => {
    fragment$.next('developer-settings');
    fragment$.next(null);
    expect(fixture.componentInstance.activeSection()).toBe('developer-settings');
  });
});
