// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiAvatarItem } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiAvatarGroupComponent } from './avatar-group.component';

const ITEMS: UiAvatarItem[] = [
  { name: 'Nuno Esteves', tone: 'accent' },
  { name: 'Maria Santos', tone: 'feature' },
  { name: 'Alex Moore', tone: 'warning' },
  { name: 'Sam Lee' },
  { name: 'Kim Park' },
  { name: 'Lee Cho' },
  { name: 'Ana Ruiz' },
];

describe('UiAvatarGroupComponent', () => {
  let fixture: ComponentFixture<UiAvatarGroupComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiAvatarGroupComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiAvatarGroupComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('items', ITEMS);
    await fixture.whenStable();
  });

  const avatars = () => Array.from(host.querySelectorAll<HTMLElement>('lfx-ui-avatar'));

  it('is a group', () => {
    expect(host.getAttribute('role')).toBe('group');
  });

  it('shows three avatars and a +4 tile by default', () => {
    expect(avatars().length).toBe(4);
    expect(host.querySelector('[data-testid="ui-avatar-group-more"]')?.textContent?.trim()).toBe('+4');
  });

  it('names the overflow tile', () => {
    expect(host.querySelector('[data-testid="ui-avatar-group-more"]')?.getAttribute('aria-label')).toBe('4 more');
  });

  it('overlaps each avatar by 28% of the size, except the first', () => {
    const [first, second] = avatars();
    expect(first.style.marginLeft).toBe('0px');
    expect(second.style.marginLeft).toBe('-8.96px');
  });

  it('rings every avatar with the page background', () => {
    avatars().forEach((avatar) => expect(avatar.className).toContain('ring-ui-background-100'));
  });

  it('shows no +N tile when everything fits', async () => {
    fixture.componentRef.setInput('limit', 7);
    await fixture.whenStable();

    expect(avatars().length).toBe(7);
    expect(host.querySelector('[data-testid="ui-avatar-group-more"]')).toBeNull();
  });

  it('sizes every avatar', async () => {
    fixture.componentRef.setInput('size', 24);
    await fixture.whenStable();

    avatars().forEach((avatar) => expect(avatar.style.width).toBe('24px'));
  });
});
