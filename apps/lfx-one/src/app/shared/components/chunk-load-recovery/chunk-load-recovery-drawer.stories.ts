// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, TemplateRef } from '@angular/core';
import { provideRouter } from '@angular/router';
import { applicationConfig, type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';
import { MessageService } from 'primeng/api';

// The story-only tsconfig does not include the app's ambient integration typings.
import type {} from '../../../../types/window';
import { ChunkLoadRecoveryService } from '../../services/chunk-load-recovery.service';
import { IntercomService } from '../../services/intercom.service';
import { UiDrawerComponent } from '../../uikit/drawer/drawer.component';
import { UiDrawerService } from '../../uikit/drawer/drawer.service';
import { ChunkLoadRecoveryComponent } from './chunk-load-recovery.component';

/** Browser integration harness: no auth/API requests and no automatic refresh. */
@Component({
  selector: 'lfx-recovery-drawer-story',
  imports: [ChunkLoadRecoveryComponent, UiDrawerComponent],
  providers: [ChunkLoadRecoveryService, MessageService, { provide: IntercomService, useValue: { openMessenger: () => undefined } }],
  templateUrl: './chunk-load-recovery-drawer.story-host.html',
})
class DrawerRecoveryStoryComponent {
  private readonly drawer = inject(UiDrawerService);
  private readonly recovery = inject(ChunkLoadRecoveryService);

  protected open(template: TemplateRef<unknown>): void {
    this.drawer.open(template);
  }

  protected showRecovery(): void {
    // Bare NG0750 deliberately requests manual recovery, never an automatic reload.
    const accepted = this.recovery.handleError(Object.assign(new Error('NG0750'), { code: -750 }));
    if (!accepted) throw new Error('The recovery harness did not supply a recognized deferred-load error');
  }
}

const meta: Meta<DrawerRecoveryStoryComponent> = {
  title: 'Components/ChunkLoadRecovery/In CDK drawer',
  component: DrawerRecoveryStoryComponent,
  decorators: [applicationConfig({ providers: [provideRouter([])] }), moduleMetadata({ imports: [DrawerRecoveryStoryComponent] })],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<DrawerRecoveryStoryComponent>;

/** Run at desktop or phone viewport sizes: recovery remains visible below a scrollable draft, inside the real CDK focus trap. */
export const VisibleRecovery: Story = {
  play: async ({ canvasElement }) => {
    const document = canvasElement.ownerDocument;
    const browser = document.defaultView!;
    const waitFor = async (condition: () => boolean): Promise<void> => {
      for (let frame = 0; frame < 120; frame++) {
        if (condition()) return;
        await new Promise<void>((resolve) => browser.requestAnimationFrame(() => resolve()));
      }
      throw new Error('Drawer recovery did not reach the expected browser state');
    };
    canvasElement.querySelector<HTMLButtonElement>('[data-testid="open-recovery-drawer"]')!.click();
    await waitFor(() => !!document.querySelector('lfx-ui-drawer'));
    const drawer = document.querySelector<HTMLElement>('lfx-ui-drawer')!;
    const draft = drawer.querySelector<HTMLInputElement>('[data-testid="drawer-recovery-draft"]')!;
    draft.value = 'Keep the unsaved browser draft';
    draft.focus();
    // Programmatic click leaves focus in the edit, as an async dependency failure would.
    drawer.querySelector<HTMLButtonElement>('[data-testid="show-drawer-recovery"]')!.click();
    await waitFor(() => !!drawer.querySelector('[data-testid="chunk-load-recovery"]'));
    await waitFor(() => !drawer.querySelector('[data-testid="chunk-load-recovery"]')!.classList.contains('fixed'));
    await Promise.all((drawer.getAnimations?.() ?? []).map((animation) => animation.finished));
    const panel = drawer.querySelector<HTMLElement>('[data-testid="chunk-load-recovery"]')!;
    const reload = panel.querySelector<HTMLButtonElement>('[data-testid="chunk-load-recovery-reload"] button')!;
    const support = panel.querySelector<HTMLButtonElement>('[data-testid="chunk-load-recovery-support"] button')!;
    for (const action of [reload, support]) {
      const rect = action.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.top < 0 || rect.left < 0 || rect.bottom > browser.innerHeight || rect.right > browser.innerWidth) {
        throw new Error('CDK drawer recovery action is outside the viewport');
      }
    }
    if (document.activeElement !== draft || draft.value !== 'Keep the unsaved browser draft')
      throw new Error('Recovery replaced the draft or stole editable focus');
    const body = drawer.querySelector<HTMLElement>('[data-testid="ui-drawer-body"]')!;
    if (body.scrollHeight <= body.clientHeight) throw new Error('The long drawer body should scroll independently above recovery');
    const overlay = drawer.closest('.cdk-dialog-container')!;
    const anchors = overlay.parentElement!.querySelectorAll<HTMLElement>('.cdk-focus-trap-anchor');
    if (anchors.length !== 2) throw new Error('The CDK focus trap is missing');
    anchors[0]!.focus();
    if (document.activeElement !== support) throw new Error('Reverse keyboard wrapping cannot reach recovery');
    anchors[1]!.focus();
    if (!overlay.contains(document.activeElement)) throw new Error('Forward keyboard wrapping left the CDK dialog');
  },
};
