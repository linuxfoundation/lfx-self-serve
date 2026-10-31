// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiOptionGroupComponent } from '../select/option-group.component';
import { UiOptionSeparatorComponent } from '../select/option-separator.component';
import { UiOptionComponent } from '../select/option.component';
import { UiMultiSelectComponent } from './multi-select.component';

// Plain rows: `label` is the content when none is projected.
const ENVIRONMENTS = `
  <lfx-ui-option value="prod" label="Production" />
  <lfx-ui-option value="preview" label="Preview" />
  <lfx-ui-option value="staging" label="Staging" disabled />
  <lfx-ui-option value="dev" label="Development" />`;

const meta: Meta<UiMultiSelectComponent> = {
  title: 'Uikit/MultiSelect',
  component: UiMultiSelectComponent,
  subcomponents: { UiOptionComponent, UiOptionGroupComponent, UiOptionSeparatorComponent },
  decorators: [moduleMetadata({ imports: [UiMultiSelectComponent, UiOptionComponent, UiOptionGroupComponent, UiOptionSeparatorComponent] })],
  args: { label: 'Environments', size: 'medium' },
  render: (args) => ({
    props: args,
    template: `<div class="w-[300px]"><lfx-ui-multi-select ${argsToTemplate(args)}>${ENVIRONMENTS}</lfx-ui-multi-select></div>`,
  }),
};
export default meta;
type Story = StoryObj<UiMultiSelectComponent>;

export const Default: Story = {};
export const SomePicked: Story = { args: { values: ['prod', 'preview'] } };
export const Disabled: Story = { args: { disabled: true, values: ['prod'] } };
export const NoVisibleLabel: Story = { args: { label: '', ariaLabel: 'Environments' } };
export const AllSizes: Story = {
  render: (args) => ({
    props: args,
    template: `
      <div class="flex w-[300px] flex-col gap-4">
        <lfx-ui-multi-select size="tiny" label="Tiny, 24px" [values]="['prod']">${ENVIRONMENTS}</lfx-ui-multi-select>
        <lfx-ui-multi-select size="small" label="Small, 32px" [values]="['prod']">${ENVIRONMENTS}</lfx-ui-multi-select>
        <lfx-ui-multi-select size="medium" label="Medium, 40px" [values]="['prod']">${ENVIRONMENTS}</lfx-ui-multi-select>
      </div>`,
  }),
};

/** Titles and separators between rows, as in the select. */
export const Groups: Story = {
  args: { label: 'Regions' },
  render: (args) => ({
    props: args,
    template: `
      <div class="w-[300px]">
        <lfx-ui-multi-select ${argsToTemplate(args)}>
          <lfx-ui-option-group label="Europe">
            <lfx-ui-option value="lisbon" label="Lisbon" />
            <lfx-ui-option value="paris" label="Paris" />
          </lfx-ui-option-group>
          <lfx-ui-option-separator />
          <lfx-ui-option-group label="Asia">
            <lfx-ui-option value="tokyo" label="Tokyo" />
            <lfx-ui-option value="seoul" label="Seoul" disabled />
          </lfx-ui-option-group>
        </lfx-ui-multi-select>
      </div>`,
  }),
};
