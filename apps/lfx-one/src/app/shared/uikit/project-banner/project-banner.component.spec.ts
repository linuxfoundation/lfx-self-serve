// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiProjectBannerComponent } from './project-banner.component';

@Component({
  selector: 'lfx-ui-project-banner-test-host',
  imports: [UiProjectBannerComponent],
  template: `<lfx-ui-project-banner
    >Your last payment failed.<button banner-action type="button" data-testid="host-action">Update Payment</button></lfx-ui-project-banner
  >`,
})
class HostComponent {}

describe('UiProjectBannerComponent', () => {
  let fixture: ComponentFixture<UiProjectBannerComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiProjectBannerComponent, HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiProjectBannerComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('is a status region with a decorative icon', () => {
    expect(host.getAttribute('role')).toBe('status');
    expect(host.querySelector('[data-testid="ui-project-banner-icon"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is the info-blue default with a 48px band and a bottom rule', () => {
    expect(host.className).toContain('min-h-[48px]');
    expect(host.className).toContain('after:h-px');
    expect(host.className).toContain('bg-ui-accent-50');
    expect(host.className).toContain('text-ui-accent-700');
    expect(host.className).toContain('after:bg-ui-accent-200');
  });

  it.each([
    ['success', 'bg-ui-success-50', 'text-ui-success-700', 'after:bg-ui-success-200', 'fa-circle-check'],
    ['warning', 'bg-ui-warning-50', 'text-ui-warning-700', 'after:bg-ui-warning-200', 'fa-triangle-exclamation'],
    ['error', 'bg-ui-danger-50', 'text-ui-danger-700', 'after:bg-ui-danger-200', 'fa-circle-exclamation'],
    ['gray', 'bg-ui-background-200', 'text-ui-neutral-900', 'after:bg-ui-neutral-alpha-200', 'fa-circle-info'],
  ] as const)('colours the %s variant', async (variant, fill, text, rule, icon) => {
    fixture.componentRef.setInput('variant', variant);
    await fixture.whenStable();

    expect(host.className).toContain(fill);
    expect(host.className).toContain(text);
    expect(host.className).toContain(rule);
    expect(host.querySelector('i')?.className).toContain(icon);
  });

  it('stays a status region for every variant unless announce is set', async () => {
    fixture.componentRef.setInput('variant', 'error');
    await fixture.whenStable();
    expect(host.getAttribute('role')).toBe('status');

    fixture.componentRef.setInput('announce', '');
    await fixture.whenStable();
    expect(host.getAttribute('role')).toBe('alert');

    fixture.componentRef.setInput('variant', 'warning');
    await fixture.whenStable();
    expect(host.getAttribute('role')).toBe('status');
  });

  it('replaces the default icon', async () => {
    fixture.componentRef.setInput('icon', 'fa-light fa-credit-card');
    await fixture.whenStable();

    expect(host.querySelector('i')?.className).toBe('fa-light fa-credit-card');
  });

  it('projects the sentence and one action after it', async () => {
    const withAction = TestBed.createComponent(HostComponent);
    await withAction.whenStable();
    const el = withAction.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="ui-project-banner-message"]')?.textContent).toContain('Your last payment failed.');
    expect(el.querySelector('lfx-ui-project-banner > [data-testid="host-action"]')?.textContent).toBe('Update Payment');
  });
});
