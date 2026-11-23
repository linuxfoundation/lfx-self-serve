// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiHoverCardDirective } from './hover-card.directive';

const meta: Meta<UiHoverCardDirective> = {
  title: 'Uikit/HoverCard',
  component: UiHoverCardDirective,
  decorators: [moduleMetadata({ imports: [UiHoverCardDirective] })],
  args: { width: 280, side: 'top', delay: 200, padding: 'default' },
  render: (args) => ({
    // Storybook copies props onto the directive instance, so nest them to keep the signal inputs intact.
    props: { cfg: args },
    template: `
      <div class="flex justify-center p-[160px]">
        <a
          href="#"
          class="rounded-ui-sm px-[12px] py-[8px] text-ui-neutral-900 shadow-small focus:outline-none focus-visible:shadow-focus"
          [lfxUiHoverCard]="card"
          [lfxUiHoverCardWidth]="cfg.width"
          [lfxUiHoverCardSide]="cfg.side"
          [lfxUiHoverCardDelay]="cfg.delay"
          [lfxUiHoverCardPadding]="cfg.padding">Kubernetes Contributor</a>
        <ng-template #card>
          <div class="flex flex-col gap-[8px]">
            <span class="text-[15px] font-semibold leading-[20px]">Kubernetes Contributor</span>
            <span class="text-[12px] leading-[17px] text-ui-neutral-600">Earned by contributing code, docs or reviews to a Kubernetes repository.</span>
            <span class="flex items-center gap-[6px] text-[11px] leading-[16px] text-ui-neutral-600"><i class="fa-light fa-calendar" aria-hidden="true"></i>Issued May 2024 · The Linux Foundation</span>
          </div>
        </ng-template>
      </div>`,
  }),
};
export default meta;
type Story = StoryObj<UiHoverCardDirective>;

/** A 280px card above the link. Hover it or tab to it; it stays open while the pointer is over the card, and Escape closes it. */
export const Default: Story = {};
/** Tries the bottom first. */
export const Bottom: Story = { args: { side: 'bottom' } };
