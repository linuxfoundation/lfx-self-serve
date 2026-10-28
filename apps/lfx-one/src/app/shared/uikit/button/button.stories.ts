// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideRouter } from '@angular/router';
import { applicationConfig, argsToTemplate, type Meta, type StoryObj } from '@storybook/angular';

import { UiButtonComponent } from './button.component';

const meta: Meta<UiButtonComponent> = {
  title: 'Uikit/Button',
  component: UiButtonComponent,
  decorators: [applicationConfig({ providers: [provideRouter([])] })],
  args: { variant: 'primary', size: 'md', icon: '', trailingIcon: '', iconOnly: false, disabled: false, fullWidth: false, type: 'button', ariaLabel: '' },
  render: (args) => ({ props: args, template: `<lfx-ui-button ${argsToTemplate(args)}>Button</lfx-ui-button>` }),
};
export default meta;
type Story = StoryObj<UiButtonComponent>;

export const Primary: Story = {};
export const OutlineNeutral: Story = { args: { variant: 'outline-neutral' } };
export const OutlineAccent: Story = { args: { variant: 'outline-accent' } };
export const GhostNeutral: Story = { args: { variant: 'ghost-neutral' } };
export const GhostAccent: Story = { args: { variant: 'ghost-accent' } };
export const Destructive: Story = { args: { variant: 'destructive' } };
export const GhostDestructive: Story = { args: { variant: 'ghost-destructive' } };
export const Recording: Story = { args: { variant: 'recording', icon: 'fa-light fa-play' } };
export const Small: Story = { args: { size: 'sm' } };
export const Large: Story = { args: { size: 'lg' } };
export const WithLeadingIcon: Story = { args: { icon: 'fa-light fa-plus' } };
export const WithTrailingIcon: Story = { args: { variant: 'outline-neutral', size: 'sm', trailingIcon: 'fa-light fa-chevron-right' } };
export const WithBothIcons: Story = { args: { icon: 'fa-light fa-video', trailingIcon: 'fa-light fa-chevron-right' } };
export const IconOnly: Story = {
  args: { variant: 'outline-neutral', iconOnly: true, icon: 'fa-light fa-angle-right', trailingIcon: 'fa-light fa-chevron-right', ariaLabel: 'Next' },
  render: (args) => ({ props: args, template: `<lfx-ui-button ${argsToTemplate(args)} />` }),
};
export const Disabled: Story = { args: { disabled: true } };
export const FullWidth: Story = { args: { fullWidth: true } };
export const AsLink: Story = {
  args: { variant: 'outline-accent', link: '/meetings' },
};

/** Every variant at every size, for visual comparison. */
export const Matrix: Story = {
  render: () => ({
    template: `
      <div style="display:flex;flex-direction:column;gap:12px">
        @for (size of ['sm', 'md', 'lg']; track size) {
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
            @for (variant of ['primary','outline-neutral','outline-accent','ghost-neutral','ghost-accent','destructive','ghost-destructive','recording']; track variant) {
              <lfx-ui-button [variant]="variant" [size]="size" icon="fa-light fa-plus">{{ variant }}</lfx-ui-button>
            }
          </div>
        }
      </div>`,
    moduleMetadata: { imports: [UiButtonComponent] },
  }),
};
