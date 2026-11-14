// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiCollapseItemComponent } from './collapse-item.component';
import { UiCollapseComponent } from './collapse.component';

const meta: Meta<UiCollapseComponent> = {
  title: 'Uikit/Collapse',
  component: UiCollapseComponent,
  subcomponents: { UiCollapseItemComponent },
  decorators: [moduleMetadata({ imports: [UiCollapseItemComponent] })],
  args: { open: [], exclusive: false, size: 'default' },
  render: (args) => ({
    props: args,
    template: `
      <div class="max-w-[640px]">
        <lfx-ui-collapse ${argsToTemplate(args)}>
          <lfx-ui-collapse-item value="join" title="Who can join a committee?">
            Any member organization can nominate people. Maintainers approve requests from individuals.
          </lfx-ui-collapse-item>
          <lfx-ui-collapse-item value="votes" title="How are votes counted?">
            One vote per member seat, counted when the voting window closes.
          </lfx-ui-collapse-item>
        </lfx-ui-collapse>
      </div>`,
  }),
};
export default meta;
type Story = StoryObj<UiCollapseComponent>;

/** Plain-text sections, all closed. */
export const Default: Story = {};
export const FirstOpen: Story = { args: { open: ['join'] } };
export const Exclusive: Story = { args: { exclusive: true, open: ['join'] } };
export const Small: Story = {
  args: { size: 'small' },
  render: (args) => ({
    props: args,
    template: `
      <div class="max-w-[640px]">
        <lfx-ui-collapse ${argsToTemplate(args)}>
          <lfx-ui-collapse-item value="advanced" title="Advanced settings">Webhook URL, retention and export options.</lfx-ui-collapse-item>
        </lfx-ui-collapse>
      </div>`,
  }),
};
/** The section is projected content, so it can hold a link and a list. */
export const RichContent: Story = {
  args: { open: ['rules'] },
  render: (args) => ({
    props: args,
    template: `
      <div class="max-w-[640px]">
        <lfx-ui-collapse ${argsToTemplate(args)}>
          <lfx-ui-collapse-item value="rules" title="How are votes counted?">
            <p>See the <a class="underline" href="#rules">voting rules</a> for the details.</p>
            <ul class="mt-[8px] list-disc pl-[20px]">
              <li>One vote per member seat</li>
              <li>Counted when the voting window closes</li>
            </ul>
          </lfx-ui-collapse-item>
        </lfx-ui-collapse>
      </div>`,
  }),
};
/** An item with no group toggles on its own. */
export const StandaloneItem: Story = {
  render: () => ({
    props: {},
    template: `<div class="max-w-[640px]"><lfx-ui-collapse-item value="solo" title="Standalone item">It works as a single toggle.</lfx-ui-collapse-item></div>`,
  }),
};
