// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiCollapseSize } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiCollapseItemComponent } from './collapse-item.component';
import { UiCollapseComponent } from './collapse.component';

@Component({
  selector: 'lfx-ui-collapse-test-items',
  imports: [UiCollapseItemComponent],
  template: `<lfx-ui-collapse-item value="join" title="Join">Any member.</lfx-ui-collapse-item>
    <lfx-ui-collapse-item value="votes" title="Votes">One vote per seat.</lfx-ui-collapse-item>`,
})
class TestItemsComponent {}

@Component({
  selector: 'lfx-ui-collapse-test-host',
  imports: [UiCollapseComponent, TestItemsComponent],
  template: `<lfx-ui-collapse [(open)]="open" [exclusive]="exclusive()" [size]="size()"><lfx-ui-collapse-test-items /></lfx-ui-collapse>`,
})
class TestHostComponent {
  public readonly open = signal<string[]>([]);
  public readonly exclusive = signal(false);
  public readonly size = signal<UiCollapseSize>('default');
}

@Component({
  selector: 'lfx-ui-collapse-attr-test-host',
  imports: [UiCollapseComponent, TestItemsComponent],
  template: `<lfx-ui-collapse exclusive><lfx-ui-collapse-test-items /></lfx-ui-collapse>`,
})
class AttrTestHostComponent {}

@Component({
  selector: 'lfx-ui-collapse-solo-test-host',
  imports: [UiCollapseItemComponent],
  template: `<lfx-ui-collapse-item value="solo" title="Advanced settings">Webhook URL.</lfx-ui-collapse-item>`,
})
class SoloTestHostComponent {}

@Component({
  selector: 'lfx-ui-collapse-rich-test-host',
  imports: [UiCollapseComponent, UiCollapseItemComponent],
  template: `<lfx-ui-collapse [open]="['r']"
    ><lfx-ui-collapse-item value="r" title="T"><a href="#r">R</a> <b>B</b></lfx-ui-collapse-item></lfx-ui-collapse
  >`,
})
class RichTestHostComponent {}

describe('UiCollapseComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: HTMLElement;
  let cmp: TestHostComponent;

  const triggers = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="ui-collapse-trigger"]'));
  const panels = () => Array.from(host.querySelectorAll<HTMLElement>('[data-testid="ui-collapse-panel"]'));
  const chevrons = () => Array.from(host.querySelectorAll<HTMLElement>('[data-testid="ui-collapse-chevron"]'));
  const expanded = () => triggers().map((t) => t.getAttribute('aria-expanded'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, RichTestHostComponent, AttrTestHostComponent, SoloTestHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.nativeElement as HTMLElement;
    cmp = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('renders closed items with their sections hidden but still in the DOM', () => {
    expect(triggers()).toHaveLength(2);
    expect(expanded()).toEqual(['false', 'false']);
    expect(panels().map((p) => p.hidden)).toEqual([true, true]);
    expect(panels()[0].textContent).toContain('Any member.');
    expect(host.querySelector('lfx-ui-collapse')?.className).toContain('border-t');
    expect(host.querySelector('lfx-ui-collapse-item')?.className).toContain('border-b');
  });

  it('opens and closes on click and flips the chevron', async () => {
    triggers()[0].click();
    await fixture.whenStable();

    expect(expanded()).toEqual(['true', 'false']);
    expect(panels()[0].hidden).toBe(false);
    expect(chevrons()[0].className).toContain('rotate-180');
    expect(chevrons()[0].className).toContain('duration-ui-slow');
    expect(chevrons()[0].className).toContain('ease-ui-standard');
    expect(chevrons()[1].className).not.toContain('rotate-180');

    triggers()[0].click();
    await fixture.whenStable();

    expect(expanded()).toEqual(['false', 'false']);
    expect(panels()[0].hidden).toBe(true);
    expect(chevrons()[0].className).not.toContain('rotate-180');
  });

  it('lets several items stay open by default', async () => {
    triggers()[0].click();
    triggers()[1].click();
    await fixture.whenStable();

    expect(cmp.open()).toEqual(['join', 'votes']);
  });

  it('keeps one item open at a time when exclusive', async () => {
    cmp.exclusive.set(true);
    await fixture.whenStable();
    triggers()[0].click();
    triggers()[1].click();
    await fixture.whenStable();

    expect(cmp.open()).toEqual(['votes']);
    expect(expanded()).toEqual(['false', 'true']);
  });

  it('writes open changes back and reads them in (two-way)', async () => {
    triggers()[1].click();
    await fixture.whenStable();
    expect(cmp.open()).toEqual(['votes']);

    cmp.open.set(['join']);
    await fixture.whenStable();
    expect(expanded()).toEqual(['true', 'false']);
  });

  it('uses real buttons, so Enter and Space activate them natively', () => {
    for (const trigger of triggers()) {
      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger.getAttribute('type')).toBe('button');
      expect(trigger.hasAttribute('disabled')).toBe(false);
      expect(trigger.tabIndex).toBe(0);
    }
  });

  it('wires the button and region with unique ids', () => {
    triggers().forEach((trigger, i) => {
      expect(trigger.getAttribute('aria-controls')).toBe(panels()[i].id);
      expect(panels()[i].getAttribute('role')).toBe('region');
      expect(panels()[i].getAttribute('aria-labelledby')).toBe(trigger.id);
    });
    expect(panels()[0].id).not.toBe(panels()[1].id);
    expect(triggers()[0].id).not.toBe(triggers()[1].id);
  });

  it('does not leave the title attribute on the item host', () => {
    expect(host.querySelector('lfx-ui-collapse-item')?.hasAttribute('title')).toBe(false);
  });

  it('renders rich projected content in the section', async () => {
    const rich = TestBed.createComponent(RichTestHostComponent);
    await rich.whenStable();
    const panel = (rich.nativeElement as HTMLElement).querySelector('[data-testid="ui-collapse-panel"]') as HTMLElement;

    expect(panel.querySelector('a')?.getAttribute('href')).toBe('#r');
    expect(panel.querySelector('b')?.textContent).toBe('B');
    expect(panel.hidden).toBe(false);
  });

  it('uses the 20px heading and 24px padding by default', () => {
    expect(triggers()[0].className).toContain('heading-20');
    expect(triggers()[0].className).toContain('py-[24px]');
    expect(panels()[0].className).toContain('copy-16');
    expect(panels()[0].className).toContain('pb-[24px]');
    expect(panels()[0].className).toContain('text-ui-neutral-600');
  });

  it('uses the 14px label and 12px padding when the group is small', async () => {
    cmp.size.set('small');
    await fixture.whenStable();

    expect(triggers()[0].className).toContain('label-14');
    expect(triggers()[0].className).toContain('font-medium');
    expect(triggers()[0].className).toContain('py-[12px]');
    expect(panels()[0].className).toContain('copy-14');
    expect(panels()[0].className).toContain('pb-[12px]');
  });

  it('treats a bare exclusive attribute as true', async () => {
    const attr = TestBed.createComponent(AttrTestHostComponent);
    await attr.whenStable();
    const buttons = Array.from((attr.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-testid="ui-collapse-trigger"]'));
    buttons[0].click();
    await attr.whenStable();
    buttons[1].click();
    await attr.whenStable();

    expect(buttons.map((b) => b.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
  });

  it('works as a single toggle without a group', async () => {
    const solo = TestBed.createComponent(SoloTestHostComponent);
    await solo.whenStable();
    const el = solo.nativeElement as HTMLElement;
    const trigger = el.querySelector<HTMLButtonElement>('[data-testid="ui-collapse-trigger"]') as HTMLButtonElement;
    const panel = el.querySelector<HTMLElement>('[data-testid="ui-collapse-panel"]') as HTMLElement;

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    expect(trigger.className).toContain('heading-20');
    expect(trigger.textContent).toContain('Advanced settings');

    trigger.click();
    await solo.whenStable();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);

    trigger.click();
    await solo.whenStable();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
