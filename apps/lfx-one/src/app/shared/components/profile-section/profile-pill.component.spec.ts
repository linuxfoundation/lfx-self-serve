// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProfilePillComponent } from './profile-pill.component';

// The host template is set in the TestBed below: inline templates are capped at three lines.
const HOST_TEMPLATE = `
    <lfx-profile-pill [name]="name()" [imageUrl]="image()" [href]="href()" [hoverCard]="withCard() ? card : null" tile="image">
      <span data-testid="detail">The Linux Foundation</span>
    </lfx-profile-pill>
    <ng-template #card><p>Issued May 2024</p></ng-template>
`;

@Component({
  selector: 'lfx-test-host',
  template: '',
})
class TestHostComponent {
  public readonly name = signal('kubernetes Contributor');
  public readonly image = signal('https://images.example.test/badge.png');
  public readonly href = signal<string | null>('https://www.credly.example.test/badges/1');
  public readonly withCard = signal(false);
}

describe('ProfilePillComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  const pill = () => fixture.nativeElement.querySelector('[data-testid="profile-pill"]') as HTMLElement;

  beforeEach(() => {
    fixture = TestBed.configureTestingModule({ imports: [TestHostComponent] })
      .overrideComponent(TestHostComponent, { set: { imports: [ProfilePillComponent], template: HOST_TEMPLATE } })
      .createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  it('links to the badge in a new tab, with the name and detail line', () => {
    expect(pill().tagName).toBe('A');
    expect(pill().getAttribute('href')).toBe('https://www.credly.example.test/badges/1');
    expect(pill().getAttribute('target')).toBe('_blank');
    expect(pill().getAttribute('rel')).toBe('noopener noreferrer');
    expect(fixture.nativeElement.querySelector('[data-testid="profile-pill-name"]')?.textContent).toBe('kubernetes Contributor');
    expect(pill().querySelector('[data-testid="detail"]')?.textContent).toBe('The Linux Foundation');
    expect(pill().querySelector('img')?.getAttribute('src')).toBe('https://images.example.test/badge.png');
  });

  it('is a plain tile without a link, focusable only when it opens a card', () => {
    fixture.componentInstance.href.set(null);
    fixture.detectChanges();
    expect(pill().tagName).toBe('DIV');
    expect(pill().hasAttribute('tabindex')).toBe(false);

    fixture.componentInstance.withCard.set(true);
    fixture.detectChanges();
    expect(pill().getAttribute('tabindex')).toBe('0');
  });

  it("shows the name's first letter when there is no picture", () => {
    fixture.componentInstance.image.set('');
    fixture.detectChanges();

    expect(pill().querySelector('img')).toBeNull();
    expect(pill().textContent).toContain('K');
  });
});
