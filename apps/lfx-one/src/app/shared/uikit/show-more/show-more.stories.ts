// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiShowMoreComponent } from './show-more.component';

const meta: Meta<UiShowMoreComponent> = {
  title: 'Uikit/ShowMore',
  component: UiShowMoreComponent,
  args: { expanded: false, hiddenCount: 12, controls: 'more-rows', noBorder: false },
  render: (args) => ({ props: args, template: `<lfx-ui-show-more ${argsToTemplate(args)} />` }),
};
export default meta;
type Story = StoryObj<UiShowMoreComponent>;

export const Default: Story = {};
export const Expanded: Story = { args: { expanded: true } };
export const NoBorder: Story = { args: { noBorder: true } };
export const NoBorderExpanded: Story = { args: { noBorder: true, expanded: true } };
export const WithoutCount: Story = { args: { hiddenCount: 0 } };
export const RevealingRows: Story = {
  render: () => ({
    props: {
      expanded: false,
      onExpandedChange(this: { expanded: boolean }, value: boolean): void {
        this.expanded = value;
        // Move focus to the first revealed row once it is rendered.
        if (value) setTimeout(() => document.getElementById('first-extra')?.focus());
      },
    },
    template: `
      <div class="max-w-[600px] text-copy-14 text-ui-neutral-900">
        <ul class="mb-4 divide-y divide-ui-neutral-alpha-200">
          <li class="py-3">Mailing list sync</li>
          <li class="py-3">Calendar import</li>
          <li class="py-3">GitHub webhook</li>
        </ul>
        @if (expanded) {
          <ul id="more-rows" class="mb-4 divide-y divide-ui-neutral-alpha-200">
            <li id="first-extra" tabindex="-1" class="py-3 focus-visible:shadow-focus focus-visible:outline-none">Slack digest</li>
            <li class="py-3">Billing export</li>
          </ul>
        }
        <lfx-ui-show-more [expanded]="expanded" (expandedChange)="onExpandedChange($event)" [hiddenCount]="2" controls="more-rows" />
      </div>
    `,
  }),
};
