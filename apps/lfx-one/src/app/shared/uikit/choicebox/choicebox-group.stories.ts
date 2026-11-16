// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { argsToTemplate, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { UiBadgeComponent } from '../badge/badge.component';
import { UiChoiceboxGroupComponent } from './choicebox-group.component';
import { UiChoiceboxComponent } from './choicebox.component';

const meta: Meta<UiChoiceboxGroupComponent> = {
  title: 'Uikit/Choicebox',
  component: UiChoiceboxGroupComponent,
  subcomponents: { UiChoiceboxComponent },
  argTypes: {
    type: { control: 'inline-radio', options: ['radio', 'checkbox'] },
    columns: { control: 'inline-radio', options: [1, 2, 3] },
  },
  decorators: [moduleMetadata({ imports: [UiChoiceboxComponent, UiBadgeComponent, ReactiveFormsModule] })],
  args: { label: 'Membership Tier', ariaLabel: '', type: 'radio', columns: 2, name: '', disabled: false, value: 'platinum', values: [] },
  render: (args) => ({
    props: args,
    template: `
      <div class="max-w-[640px]">
        <lfx-ui-choicebox-group ${argsToTemplate(args)}>
          <lfx-ui-choicebox value="platinum" label="Platinum" description="Includes a governing board seat and 10 training passes.">
            <lfx-ui-badge size="sm">Board seat</lfx-ui-badge>
          </lfx-ui-choicebox>
          <lfx-ui-choicebox value="gold" label="Gold" description="Elects board representatives and gets 5 training passes." />
          <lfx-ui-choicebox value="silver" label="Silver" description="Joins committees and votes in member elections." />
          <lfx-ui-choicebox value="associate" label="Associate" description="For non-profits and academic institutions." [disabled]="true" disabledReason="Only for academic institutions" />
        </lfx-ui-choicebox-group>
      </div>`,
  }),
};
export default meta;
type Story = StoryObj<UiChoiceboxGroupComponent>;

/** Single choice: arrow keys move and select within the group. */
export const Radio: Story = {};
/** Multiple choice: Space toggles the focused tile. */
export const Checkbox: Story = { args: { type: 'checkbox', label: 'Deployment Targets', value: null, values: ['gold'] } };
export const NothingChosen: Story = { args: { value: null } };
export const OneColumn: Story = { args: { columns: 1 } };
export const ThreeColumns: Story = { args: { columns: 3 } };
export const DisabledGroup: Story = { args: { disabled: true } };
export const WithoutLegend: Story = { args: { label: '', ariaLabel: 'Membership tier' } };

/** A reactive-forms control holds a string for radio and a string array for checkbox. */
export const ReactiveForm: Story = {
  render: () => ({
    props: { tier: new FormControl<string | null>('gold'), targets: new FormControl<string[]>(['cloud']) },
    template: `
      <div class="flex max-w-[640px] flex-col gap-[24px]">
        <lfx-ui-choicebox-group label="Membership Tier" [columns]="2" [formControl]="tier">
          <lfx-ui-choicebox value="gold" label="Gold" description="Elects board representatives." />
          <lfx-ui-choicebox value="silver" label="Silver" description="Joins committees and votes." />
        </lfx-ui-choicebox-group>
        <span class="copy-13 text-ui-neutral-600">Tier: {{ tier.value }}</span>
        <lfx-ui-choicebox-group label="Deployment Targets" type="checkbox" [columns]="2" [formControl]="targets">
          <lfx-ui-choicebox value="cloud" label="Cloud" description="Runs on the shared cluster." />
          <lfx-ui-choicebox value="edge" label="Edge" description="Runs close to your users." />
        </lfx-ui-choicebox-group>
        <span class="copy-13 text-ui-neutral-600">Targets: {{ targets.value }}</span>
      </div>`,
  }),
};
