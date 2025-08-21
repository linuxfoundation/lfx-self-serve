// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Badge severity level options
 * @description Available color schemes for badge components
 */
export interface BadgeSeverityOptions {
  /** Badge color scheme indicating status or priority */
  severity: 'info' | 'success' | 'warn' | 'danger' | 'secondary' | 'contrast';
}

/**
 * Badge size options
 * @description Available sizes for badge components
 */
export interface BadgeSizeOptions {
  /** Badge size variant */
  size: 'small' | 'large' | 'xlarge';
}

/**
 * Complete badge component properties
 * @description Configuration for LFX badge wrapper component
 */
export interface BadgeProps {
  /** Badge content (text or number) */
  value: string | number;
  /** Color scheme for the badge */
  severity: BadgeSeverityOptions['severity'];
  /** Size variant for the badge */
  size: BadgeSizeOptions['size'];
  /** Additional CSS classes */
  styleClass: string;
  /** Whether the badge is disabled */
  badgeDisabled: boolean;
}

/**
 * Button severity level options
 * @description Available color schemes for button components
 */
export interface ButtonSeverityOptions {
  /** Button color scheme indicating action type */
  severity: 'success' | 'info' | 'warn' | 'danger' | 'help' | 'primary' | 'secondary' | 'contrast' | null | undefined;
}

/**
 * Button icon position options
 * @description Available positions for button icons relative to text
 */
export interface ButtonIconPositionOptions {
  /** Icon placement position */
  iconPos: 'left' | 'right' | 'top' | 'bottom';
}

/**
 * Button size options
 * @description Available sizes for button components
 */
export interface ButtonSizeOptions {
  /** Button size variant */
  size: 'small' | 'large' | undefined;
}

/**
 * Button variant style options
 * @description Available visual styles for button components
 */
export interface ButtonVariantOptions {
  /** Button visual style variant */
  variant: 'outlined' | 'text' | undefined;
}

/**
 * Complete button component properties
 * @description Configuration for LFX button wrapper component
 */
export interface ButtonProps {
  /** Color scheme for the button */
  severity?: ButtonSeverityOptions['severity'];
  /** Icon position relative to text */
  iconPos?: ButtonIconPositionOptions['iconPos'];
  /** Button size variant */
  size?: ButtonSizeOptions['size'];
  /** Visual style variant */
  variant?: ButtonVariantOptions['variant'];
  /** Button text label */
  label?: string;
  /** Icon class or name */
  icon?: string;
  /** Button type attribute */
  type?: string;
  /** Whether button is disabled */
  disabled?: boolean;
  /** Whether button shows loading state */
  loading?: boolean;
  /** Loading spinner icon */
  loadingIcon?: string;
  /** Tab index for keyboard navigation */
  tabindex?: number;
  /** Whether button should auto-focus */
  autofocus?: boolean;
  /** Whether button has raised appearance */
  raised?: boolean;
  /** Whether button has rounded corners */
  rounded?: boolean;
  /** Whether button uses text style */
  text?: boolean;
  /** Whether button uses plain style */
  plain?: boolean;
  /** Whether button uses outlined style */
  outlined?: boolean;
  /** Whether button appears as a link */
  link?: boolean;
  /** Whether button takes full width */
  fluid?: boolean;
  /** Inline styles object */
  style?: Record<string, string | number> | null;
  /** Additional CSS classes */
  styleClass?: string;
  /** Badge content for button */
  badge?: string;
  /** Badge CSS classes */
  badgeClass?: string;
  /** Badge color scheme */
  badgeSeverity?: BadgeSeverityOptions['severity'];
  /** Accessibility label */
  ariaLabel?: string;
}

/**
 * Avatar size options
 * @description Available sizes for avatar components
 */
export interface AvatarSizeOptions {
  /** Avatar size variant */
  size: 'normal' | 'large' | 'xlarge';
}

/**
 * Avatar shape options
 * @description Available shapes for avatar components
 */
export interface AvatarShapeOptions {
  /** Avatar geometric shape */
  shape: 'square' | 'circle';
}

/**
 * Complete avatar component properties
 * @description Configuration for LFX avatar wrapper component
 */
export interface AvatarProps {
  /** Text label for avatar (initials) */
  label?: string;
  /** Icon class or name for avatar */
  icon?: string;
  /** Image URL for avatar */
  image?: string;
  /** Avatar size variant */
  size?: AvatarSizeOptions['size'];
  /** Avatar shape variant */
  shape?: AvatarShapeOptions['shape'];
  /** Inline styles object */
  style?: Record<string, string | number> | null;
  /** Additional CSS classes */
  styleClass?: string;
  /** Accessibility label */
  ariaLabel?: string;
}

/**
 * Time picker size options
 * @description Available sizes for time picker components
 */
export interface TimePickerSizeOptions {
  /** Time picker size variant */
  size: 'small' | 'large';
}

/**
 * Complete time picker component properties
 * @description Configuration for LFX time picker wrapper component
 */
export interface TimePickerProps {
  /** Input field label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether input is disabled */
  disabled?: boolean;
  /** Whether input is required */
  required?: boolean;
  /** Input size variant */
  size?: TimePickerSizeOptions['size'];
}
