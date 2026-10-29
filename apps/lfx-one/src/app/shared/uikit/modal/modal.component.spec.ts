// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, inject, TemplateRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiModalConfig } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UiButtonComponent } from '../button/button.component';
import { UiModalComponent } from './modal.component';
import { UiModalService } from './modal.service';

const HOST_TEMPLATE = `
  <button id="opener" (click)="open(tpl)">Open</button>
  <ng-template #tpl>
    <lfx-ui-modal heading="Create Committee" [subtitle]="subtitle" [size]="size" [sticky]="sticky" [singleAction]="single">
      <input id="name" />
      <input id="slug" />
      <div modalInset id="inset">Create a mailing list</div>
      <ng-container modalActions>
        <button id="cancel" type="button">Cancel</button>
        <button id="create" type="button">Create Committee</button>
        <lfx-ui-button id="ui-single">Done</lfx-ui-button>
      </ng-container>
    </lfx-ui-modal>
  </ng-template>
`;

@Component({ selector: 'lfx-ui-test-host', template: '' })
class TestHostComponent {
  public config: UiModalConfig = {};
  public size: 'sm' | 'md' = 'md';
  public sticky = false;
  public single = false;
  public subtitle = 'Committees get their own meetings.';

  private readonly modal = inject(UiModalService);

  public open(template: TemplateRef<unknown>): void {
    this.modal.open(template, this.config);
  }
}

@Component({
  selector: 'lfx-ui-test-content',
  imports: [UiModalComponent],
  template: '<lfx-ui-modal heading="Hello">{{ data }}</lfx-ui-modal>',
})
class TestContentComponent {
  public readonly data = inject(DIALOG_DATA);
  public readonly ref = inject(DialogRef);
}

describe('UiModalComponent and UiModalService', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let container: HTMLElement;
  let opener: HTMLButtonElement;

  const dialog = () => container.querySelector('.cdk-dialog-container') as HTMLElement | null;
  const modal = () => container.querySelector('[data-testid="ui-modal"]') as HTMLElement | null;
  const byId = (id: string) => container.querySelector(`#${id}`) as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  };
  const open = async (configure: (host: TestHostComponent) => void = () => undefined) => {
    configure(fixture.componentInstance);
    opener.focus();
    opener.click();
    await settle();
  };
  const pressEscape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    // Set here because an inline template this long trips component-max-inline-declarations.
    TestBed.overrideComponent(TestHostComponent, { set: { imports: [UiModalComponent, UiButtonComponent], template: HOST_TEMPLATE } });
    fixture = TestBed.createComponent(TestHostComponent);
    document.body.appendChild(fixture.nativeElement);
    container = TestBed.inject(OverlayContainer).getContainerElement();
    opener = fixture.nativeElement.querySelector('#opener');
    await fixture.whenStable();
  });

  afterEach(() => {
    delete (document.documentElement as unknown as Record<string, unknown>)['scrollHeight'];
    fixture.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  it('opens a named modal dialog with the title, subtitle, body, inset and actions', async () => {
    await open();

    expect(dialog()?.getAttribute('role')).toBe('dialog');
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    const title = container.querySelector('[data-testid="ui-modal-title"]') as HTMLElement;
    expect(title.textContent).toBe('Create Committee');
    expect(dialog()?.getAttribute('aria-labelledby')).toBe(title.id);
    expect(container.querySelector('[data-testid="ui-modal-subtitle"]')?.textContent).toBe('Committees get their own meetings.');
    expect(container.querySelector('[data-testid="ui-modal-body"] #name')).not.toBeNull();
    expect(container.querySelector('[data-testid="ui-modal-inset"] #inset')).not.toBeNull();
    expect(container.querySelector('[data-testid="ui-modal-actions"] #create')).not.toBeNull();
  });

  it('dims the page with the ui-overlay backdrop', async () => {
    await open();

    expect(container.querySelector('.cdk-overlay-backdrop')?.className).toContain('bg-ui-overlay');
  });

  it('uses the 540px size by default, 420px for sm, and the large radius', async () => {
    await open();
    expect(modal()?.className).toContain('w-[540px]');
    expect(modal()?.className).toContain('rounded-ui-lg');
  });

  it('switches to the sm width', async () => {
    await open((host) => (host.size = 'sm'));
    expect(modal()?.className).toContain('w-[420px]');
  });

  it('can use the alertdialog role, described by its subtitle', async () => {
    await open((host) => (host.config = { role: 'alertdialog' }));
    expect(dialog()?.getAttribute('role')).toBe('alertdialog');
    const subtitle = container.querySelector('[data-testid="ui-modal-subtitle"]') as HTMLElement;
    expect(dialog()?.getAttribute('aria-describedby')).toBe(subtitle.id);
  });

  it('does not point an alertdialog at a subtitle that is not there', async () => {
    await open((host) => {
      host.config = { role: 'alertdialog' };
      host.subtitle = '';
    });
    expect(dialog()?.getAttribute('role')).toBe('alertdialog');
    expect(dialog()?.hasAttribute('aria-describedby')).toBe(false);
  });

  it('does not describe a plain dialog', async () => {
    await open();
    expect(dialog()?.getAttribute('aria-describedby')).toBeNull();
  });

  it('puts the focus trap around the modal and moves focus to the autoFocus target', async () => {
    // jsdom has no layout, so the CDK does not see inputs as tabbable; the first-tabbable default is checked in Storybook.
    await open((host) => (host.config = { autoFocus: '#name' }));

    expect(document.activeElement).toBe(byId('name'));
    expect(container.querySelectorAll('.cdk-focus-trap-anchor').length).toBe(2);
  });

  it('focuses the element the autoFocus selector names, such as Cancel in a destructive confirm', async () => {
    await open((host) => (host.config = { autoFocus: '#cancel' }));
    expect(document.activeElement).toBe(byId('cancel'));
  });

  it('closes on Escape and gives focus back to the opener', async () => {
    await open();
    pressEscape();
    await settle();

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('ignores an Escape that something else already handled', async () => {
    await open();
    const event = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true });
    event.preventDefault();
    document.body.dispatchEvent(event);
    await settle();

    expect(dialog()).not.toBeNull();
  });

  it('ignores Escape pressed with a modifier key', async () => {
    await open();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, shiftKey: true, bubbles: true, cancelable: true }));
    await settle();

    expect(dialog()).not.toBeNull();
  });

  it('closes on a backdrop click', async () => {
    await open();
    (container.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();
    await settle();

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('ignores Escape when closeOnEscape is false but still closes on the backdrop', async () => {
    await open((host) => (host.config = { closeOnEscape: false }));
    pressEscape();
    await settle();
    expect(dialog()).not.toBeNull();

    (container.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();
    await settle();
    expect(dialog()).toBeNull();
  });

  it('ignores the backdrop when closeOnBackdropClick is false but still closes on Escape', async () => {
    await open((host) => (host.config = { closeOnBackdropClick: false }));
    (container.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();
    await settle();
    expect(dialog()).not.toBeNull();

    pressEscape();
    await settle();
    expect(dialog()).toBeNull();
  });

  it('locks page scroll while open and releases it on close', async () => {
    // The CDK only blocks scrolling when the page can scroll, and jsdom has no layout, so fake a tall page (removed in afterEach).
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
    await open();
    expect(document.documentElement.classList).toContain('cdk-global-scrollblock');

    pressEscape();
    await settle();
    expect(document.documentElement.classList).not.toContain('cdk-global-scrollblock');
  });

  it('hides the inset band and the footer when nothing is projected into them', async () => {
    const bare = TestBed.createComponent(UiModalComponent);
    bare.componentRef.setInput('heading', 'Bare');
    await bare.whenStable();
    const el = bare.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="ui-modal-inset"]')?.matches(':empty')).toBe(true);
    expect(el.querySelector('[data-testid="ui-modal-actions"]')?.matches(':empty')).toBe(true);
    // Without a dialog nothing traps focus, so the layout claims no dialog or modal semantics.
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('aria-modal')).toBeNull();
    expect(el.getAttribute('aria-labelledby')).toBeNull();
  });

  it('sticky keeps the title outside the scrolling body', async () => {
    await open((host) => (host.sticky = true));

    expect(container.querySelector('[data-testid="ui-modal-body"] [data-testid="ui-modal-title"]')).toBeNull();
    expect(container.querySelector('[data-testid="ui-modal-title"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ui-modal-body"]')?.className).toContain('overflow-auto');
  });

  it('singleAction stretches the footer button', async () => {
    await open((host) => (host.single = true));
    const actions = container.querySelector('[data-testid="ui-modal-actions"]');
    expect(actions?.className).toContain('[&>*]:flex-1');
    expect(actions?.className).toContain('[&_button]:w-full');
    // jsdom does not resolve the arbitrary child selectors, so check what they target: the rendered button component is a direct child
    // of the footer (flex-1) and holds a real button (w-full). The measured width is checked in Storybook.
    const host = byId('ui-single');
    expect(host.parentElement).toBe(actions);
    expect(host.querySelector('button')).not.toBeNull();
  });

  it('opens a component with data and returns the close result', async () => {
    await settle();
    const ref = TestBed.inject(UiModalService).open<string, string, TestContentComponent>(TestContentComponent, { data: 'payload' });
    let result: string | undefined;
    ref.closed.subscribe((r) => (result = r));
    await settle();

    expect(modal()?.textContent).toContain('payload');
    expect(dialog()?.getAttribute('aria-labelledby')).toBe(container.querySelector('[data-testid="ui-modal-title"]')?.id);
    ref.componentInstance?.ref.close('done');
    await settle();
    expect(result).toBe('done');
    expect(dialog()).toBeNull();
  });
});
