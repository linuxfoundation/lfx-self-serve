// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from '../button/button.component';
import { UiTooltipDirective } from './tooltip.directive';

const meta: Meta<UiTooltipDirective> = {
  title: 'Uikit/Tooltip',
  component: UiTooltipDirective,
  decorators: [moduleMetadata({ imports: [UiTooltipDirective, UiButtonComponent] })],
  args: { text: 'Copy link', title: '', icon: '', shortcut: [], side: 'top', delay: 300, disabled: false },
  render: (args) => ({
    // Storybook copies props onto the directive instance, so nest them to keep `disabled` and the other signal inputs intact.
    props: { cfg: args },
    template: `
      <div class="flex justify-center p-[96px]">
        <button
          type="button"
          class="inline-flex h-ui-medium w-[40px] items-center justify-center rounded-ui-sm border border-ui-neutral-alpha-300 bg-ui-background-100 text-ui-neutral-900 hover:bg-ui-neutral-alpha-50 focus:outline-none focus-visible:shadow-[0_0_0_4px] focus-visible:shadow-ui-accent-100 forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[color:Highlight]"
          [attr.aria-label]="cfg.text"
          [lfxUiTooltip]="cfg.text"
          [lfxUiTooltipTitle]="cfg.title"
          [lfxUiTooltipIcon]="cfg.icon"
          [lfxUiTooltipShortcut]="cfg.shortcut"
          [lfxUiTooltipSide]="cfg.side"
          [lfxUiTooltipDelay]="cfg.delay"
          [lfxUiTooltipDisabled]="cfg.disabled">
          <i class="fa-light fa-link" aria-hidden="true"></i>
        </button>
      </div>`,
  }),
};
export default meta;
type Story = StoryObj<UiTooltipDirective>;

/** One line of text above an icon-only button. Hover it or tab to it. The directive sits on the native button, so the description reaches screen readers. */
export const Default: Story = {};
/** A key-cap shortcut after the text. */
export const WithShortcut: Story = { args: { shortcut: ['⌘', 'C'] } };
/** A bold title with a smaller description; up to 240px wide. */
export const Rich: Story = {
  args: { title: 'Health score', text: 'Weighted from contributor activity, release cadence and issue response time over 90 days.' },
};
/** A white 11px icon before the title. */
export const RichWithIcon: Story = {
  args: { title: 'Restricted', icon: 'fa-solid fa-lock', text: 'Only invited people can join' },
};
export const Bottom: Story = { args: { side: 'bottom' } };
export const Left: Story = { args: { side: 'left' } };
export const Right: Story = { args: { side: 'right' } };
/** Tooltips can explain why a control is off. A disabled button takes no focus, so the directive sits on a focusable wrapper. */
export const OnDisabledControl: Story = {
  render: () => ({
    template: `
      <div class="flex justify-center p-[96px]">
        <span class="inline-flex" tabindex="0" lfxUiTooltip="Only owners can delete projects">
          <lfx-ui-button size="large" variant="secondary" icon="fa-light fa-trash-can" [iconOnly]="true" ariaLabel="Delete project" [disabled]="true" />
        </span>
      </div>`,
  }),
};
/** With no room above the host, the tooltip flips below it. */
export const FlipsAtTheEdge: Story = {
  render: () => ({
    template: `
      <div class="flex justify-center">
        <lfx-ui-button size="large" variant="secondary" icon="fa-light fa-link" [iconOnly]="true" ariaLabel="Share" lfxUiTooltip="Flipped below the button" />
      </div>`,
  }),
};
