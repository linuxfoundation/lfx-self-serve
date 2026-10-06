// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IntercomService } from '@services/intercom.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LogoutLinkDirective } from './logout-link.directive';

@Component({
  selector: 'lfx-logout-link-test-host',
  imports: [LogoutLinkDirective],
  template: '<a lfxLogoutLink href="#logout">Logout</a>',
})
class TestHostComponent {}

describe('LogoutLinkDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let shutdown: ReturnType<typeof vi.fn>;

  const logoutLink = (): HTMLAnchorElement => {
    const el = fixture.nativeElement.querySelector('[lfxLogoutLink]');
    if (!el) throw new Error('no logout link rendered');
    return el as HTMLAnchorElement;
  };

  beforeEach(async () => {
    shutdown = vi.fn();

    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [{ provide: IntercomService, useValue: { shutdown } }],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    await fixture.whenStable();
  });

  it('shuts Intercom down on click without cancelling the logout navigation', () => {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });

    logoutLink().dispatchEvent(click);

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(click.defaultPrevented).toBe(false);
  });
});
