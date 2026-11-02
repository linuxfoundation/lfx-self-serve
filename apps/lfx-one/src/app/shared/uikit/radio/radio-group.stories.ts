// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiRadioGroupComponent } from './radio-group.component';
import { UiRadioComponent } from './radio.component';

const meta: Meta<UiRadioGroupComponent> = {
  title: 'Uikit/Radio',
  component: UiRadioGroupComponent,
  subcomponents: { UiRadioComponent },
  decorators: [moduleMetadata({ imports: [UiRadioComponent, ReactiveFormsModule] })],
  args: { label: 'Visibility', ariaLabel: '', name: '', disabled: false, value: 'public' },
  render: (args) => ({
    props: args,
    template: `
      <lfx-ui-radio-group ${argsToTemplate(args)}>
        <lfx-ui-radio value="public" label="Public" />
        <lfx-ui-radio value="members" label="Members only" />
        <lfx-ui-radio value="private" label="Private" />
        <lfx-ui-radio value="enterprise" label="Enterprise (disabled)" [disabled]="true" />
      </lfx-ui-radio-group>`,
  }),
};
export default meta;
type Story = StoryObj<UiRadioGroupComponent>;

export const Default: Story = {};
export const NothingChosen: Story = { args: { value: null } };
export const DisabledGroup: Story = { args: { disabled: true } };
export const WithoutLegend: Story = { args: { label: '', ariaLabel: 'Visibility' } };

export const ReactiveForm: Story = {
  render: () => ({
    props: { control: new FormControl('members') },
    template: `
      <div class="flex flex-col gap-[12px]">
        <lfx-ui-radio-group label="Visibility" [formControl]="control">
          <lfx-ui-radio value="public" label="Public" />
          <lfx-ui-radio value="members" label="Members only" />
          <lfx-ui-radio value="private" label="Private" />
        </lfx-ui-radio-group>
        <span class="copy-13 text-ui-neutral-600">Control value: {{ control.value }}</span>
      </div>`,
  }),
};
