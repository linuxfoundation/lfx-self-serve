// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
import { UiTooltipDirective } from './tooltip.directive';

const meta: Meta<UiTooltipDirective> = {
  title: 'Uikit/Tooltip',
  component: UiTooltipDirective,
  decorators: [moduleMetadata({ imports: [UiTooltipDirective, UiButtonComponent] })],
  args: { text: 'Copy link', title: '', shortcut: [], side: 'top', delay: 300, disabled: false },
  render: (args) => ({
    // Storybook copies props onto the directive instance, so nest them to keep `disabled` and the other signal inputs intact.
    props: { cfg: args },
    template: `
      <div class="flex justify-center p-[96px]">
        <lfx-ui-button
          variant="outline-neutral"
          icon="fa-light fa-link"
          [iconOnly]="true"
          ariaLabel="Copy link"
          [lfxUiTooltip]="cfg.text"
          [lfxUiTooltipTitle]="cfg.title"
          [lfxUiTooltipShortcut]="cfg.shortcut"
          [lfxUiTooltipSide]="cfg.side"
          [lfxUiTooltipDelay]="cfg.delay"
          [lfxUiTooltipDisabled]="cfg.disabled" />
      </div>`,
  }),
};
export default meta;
type Story = StoryObj<UiTooltipDirective>;

/** One line of text above an icon-only button. Hover it or tab to it. */
export const Default: Story = {};
/** A key-cap shortcut after the text. */
export const WithShortcut: Story = { args: { shortcut: ['⌘', 'C'] } };
/** A bold title with a smaller description; up to 240px wide. */
export const Rich: Story = {
  args: { title: 'Health score', text: 'Weighted from contributor activity, release cadence and issue response time over 90 days.' },
};
export const Bottom: Story = { args: { side: 'bottom' } };
export const Left: Story = { args: { side: 'left' } };
export const Right: Story = { args: { side: 'right' } };
/** On the focusable element itself, so the screen-reader description is read when it takes focus. */
export const OnNativeButton: Story = {
  render: () => ({
    template: `
      <div class="flex justify-center p-[96px]">
        <button type="button" lfxUiTooltip="Copy link" class="edge inline-flex h-ui-medium w-ui-medium items-center justify-center rounded-ui-sm bg-ui-background-100 focus-visible:shadow-focus focus-visible:outline-none">
          <i class="fa-light fa-link" aria-hidden="true"></i><span class="sr-only">Share</span>
        </button>
      </div>`,
  }),
};
/** Tooltips can explain why a control is off. A disabled button gets no pointer events, so the directive sits on a wrapper. */
export const OnDisabledControl: Story = {
  render: () => ({
    template: `
      <div class="flex justify-center p-[96px]">
        <span class="inline-flex" tabindex="0" lfxUiTooltip="Only owners can delete projects">
          <lfx-ui-button variant="outline-neutral" icon="fa-light fa-trash-can" [iconOnly]="true" ariaLabel="Delete project" [disabled]="true" />
        </span>
      </div>`,
  }),
};
/** With no room above the host, the tooltip flips below it. */
export const FlipsAtTheEdge: Story = {
  render: () => ({
    template: `
      <div class="flex justify-center">
        <lfx-ui-button variant="outline-neutral" icon="fa-light fa-link" [iconOnly]="true" ariaLabel="Copy link" lfxUiTooltip="Flipped below the button" />
      </div>`,
  }),
};
