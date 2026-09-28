// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgHealthPopupComponent } from './org-health-popup.component';

describe('OrgHealthPopupComponent', () => {
  let fixture: ComponentFixture<OrgHealthPopupComponent>;
  let component: OrgHealthPopupComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OrgHealthPopupComponent], providers: [provideNoopAnimations()] }).compileComponents();
    fixture = TestBed.createComponent(OrgHealthPopupComponent);
    component = fixture.componentInstance;
  });

  const setInputs = (inputs: Record<string, unknown>): void => {
    Object.entries(inputs).forEach(([name, value]) => fixture.componentRef.setInput(name, value));
  };

  it('renders a partial score as label + (score/max) with a dotted remainder and no partial suffix', () => {
    setInputs({ label: 'healthy', score: 52, maxScore: 65, maintainer: 30, security: null, development: 22 });

    expect(component['labelText']()).toBe('Healthy');
    expect(component['scoreText']()).toBe('(52/65)');
    expect(component['barFillPercent']()).toBe(52);
    expect(component['barMissingPercent']()).toBe(35);
    const rows = component['rows']();
    expect(rows.find((r) => r.key === 'security')).toMatchObject({ score: '— ', max: 35 });
    expect(rows.find((r) => r.key === 'maintainer')).toMatchObject({ score: '30', max: 40 });
    expect(rows.find((r) => r.key === 'development')).toMatchObject({ score: '22', max: 25 });
  });

  it('has no dotted remainder for a score out of 100', () => {
    setInputs({ label: 'excellent', score: 88, maxScore: 100, maintainer: 35, security: 30, development: 23 });

    expect(component['scoreText']()).toBe('(88/100)');
    expect(component['barFillPercent']()).toBe(88);
    expect(component['barMissingPercent']()).toBe(0);
  });

  it('defaults a missing max score to 100', () => {
    setInputs({ label: 'excellent', score: 88, maxScore: null });

    expect(component['scoreText']()).toBe('(88/100)');
    expect(component['barMissingPercent']()).toBe(0);
  });

  it('is unavailable without a label', () => {
    setInputs({ label: null, score: 52 });

    expect(component['available']()).toBe(false);
  });
});
