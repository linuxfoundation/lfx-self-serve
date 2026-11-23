// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ORG_LENS_ROI_DEFAULT_METHOD, ORG_LENS_ROI_METHOD_DESCRIPTIONS, ORG_LENS_ROI_METHODS } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgRoiSettingsDrawerComponent } from './org-roi-settings-drawer.component';

describe('OrgRoiSettingsDrawerComponent', () => {
  let fixture: ComponentFixture<OrgRoiSettingsDrawerComponent>;

  /** The drawer renders through a PrimeNG overlay, so queries run against the document, not the host. */
  const button = (method: string): HTMLButtonElement | null => document.querySelector(`[data-testid="org-roi-settings-method-${method}"]`);

  beforeEach(async () => {
    // The PrimeNG drawer animates its panel, so the test needs an animations provider to render it.
    await TestBed.configureTestingModule({ imports: [OrgRoiSettingsDrawerComponent], providers: [provideNoopAnimations()] }).compileComponents();
    fixture = TestBed.createComponent(OrgRoiSettingsDrawerComponent);
    fixture.componentRef.setInput('method', ORG_LENS_ROI_DEFAULT_METHOD);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
  });

  it('describes every method it offers, so neither option is an unexplained label', () => {
    for (const method of ORG_LENS_ROI_METHODS) {
      expect(button(method)?.textContent).toContain(ORG_LENS_ROI_METHOD_DESCRIPTIONS[method]);
    }
  });

  /** Taken from the constant, so a change of default moves the badge with it. */
  it('marks the default method and only the default method', () => {
    const badged = ORG_LENS_ROI_METHODS.filter((method) => button(method)?.textContent?.includes('Default'));
    expect(badged).toEqual([ORG_LENS_ROI_DEFAULT_METHOD]);
  });

  it('holds the method control alone — the cost rates moved to the model overview', () => {
    expect(document.querySelector('[data-testid="org-roi-settings-method"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="org-roi-settings-rates"]')).toBeNull();
  });

  it('reports a new selection and leaves a repeat selection alone', () => {
    const other = ORG_LENS_ROI_METHODS.find((method) => method !== ORG_LENS_ROI_DEFAULT_METHOD)!;

    button(ORG_LENS_ROI_DEFAULT_METHOD)?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.method()).toBe(ORG_LENS_ROI_DEFAULT_METHOD);

    button(other)?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.method()).toBe(other);
  });
});
