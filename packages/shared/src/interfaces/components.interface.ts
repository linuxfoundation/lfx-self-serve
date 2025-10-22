// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChartData, ChartOptions } from 'chart.js';

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

/**
 * Message severity level options
 * @description Available severity levels for message components
 */
export interface MessageSeverityOptions {
  /** Message severity level indicating urgency or type */
  severity: 'info' | 'success' | 'warn' | 'error' | 'secondary' | 'contrast';
}

/**
 * Message size options
 * @description Available sizes for message components
 */
export interface MessageSizeOptions {
  /** Message size variant */
  size: 'small' | 'large';
}

/**
 * Message variant style options
 * @description Available visual styles for message components
 */
export interface MessageVariantOptions {
  /** Message visual style variant */
  variant: 'text' | 'outlined' | 'simple';
}

/**
 * Complete message component properties
 * @description Configuration for LFX message wrapper component
 */
export interface MessageProps {
  /** Message severity level */
  severity?: MessageSeverityOptions['severity'];
  /** Message text content */
  text?: string;
  /** Whether message can be closed manually */
  closable?: boolean;
  /** Whether to escape HTML in message content */
  escape?: boolean;
  /** Message size variant */
  size?: MessageSizeOptions['size'];
  /** Visual style variant */
  variant?: MessageVariantOptions['variant'];
  /** Custom icon class or name */
  icon?: string;
  /** Close icon class or name */
  closeIcon?: string;
  /** Show animation transition options */
  showTransitionOptions?: string;
  /** Hide animation transition options */
  hideTransitionOptions?: string;
  /** Auto-dismiss time in milliseconds */
  life?: number;
  /** Inline styles object */
  style?: Record<string, string | number> | null;
  /** Additional CSS classes */
  styleClass?: string;
  /** Accessibility label */
  ariaLabel?: string;
}

/**
 * Sidebar menu item configuration
 * @description Structure for sidebar navigation menu items
 */
export interface SidebarMenuItem {
  /** Display label for menu item */
  label: string;
  /** Icon class or name */
  icon: string;
  /** Router link path */
  routerLink?: string;
  /** External URL */
  url?: string;
  /** Badge content for notifications */
  badge?: string | number;
  /** Badge severity for styling */
  badgeSeverity?: BadgeSeverityOptions['severity'];
  /** Whether item is disabled */
  disabled?: boolean;
  /** Command to execute on click */
  command?: () => void;
  /** Child menu items for nested navigation */
  items?: SidebarMenuItem[];
  /** Test ID for e2e testing (computed from label if not provided) */
  testId?: string;
}

/**
 * Sidebar component properties
 * @description Configuration for LFX sidebar navigation component
 */
export interface SidebarProps {
  /** Menu items to display */
  items: SidebarMenuItem[];
  /** Whether sidebar is collapsed */
  collapsed?: boolean;
  /** Additional CSS classes */
  styleClass?: string;
}

/**
 * Progress item for dashboard metrics
 * @description Structure for progress tracking items
 */
export interface ProgressItem {
  /** Metric label */
  label: string;
  /** Metric value */
  value: string;
  /** Trend direction indicator */
  trend: 'up' | 'down';
}

/**
 * Progress item with chart data for dashboard metrics
 * @description Extended progress item with Chart.js configuration
 * @note ChartData and ChartOptions types should be imported from chart.js
 */
export interface ProgressItemWithChart extends ProgressItem {
  /** Chart type - line or bar */
  chartType: 'line' | 'bar';
  /** Chart.js data configuration - supports line and bar charts */
  chartData: ChartData<'line' | 'bar'>;
  /** Chart.js options configuration - supports line and bar charts */
  chartOptions: ChartOptions<'line' | 'bar'>;
  /** Optional subtitle text displayed below the value */
  subtitle?: string;
}

/**
 * Pending action item for task list
 * @description Structure for pending action items
 */
export interface PendingActionItem {
  /** Action type (e.g., Issue, PR, Review) */
  type: string;
  /** Project or repository badge */
  badge: string;
  /** Action description text */
  text: string;
  /** Icon class for the action type */
  icon: string;
  /** Color theme for the action */
  color: 'amber' | 'blue' | 'green' | 'purple';
  /** Button text */
  buttonText: string;
}

/**
 * Meeting item for schedule display
 * @description Structure for meeting information
 */
export interface MeetingItem {
  /** Meeting title */
  title: string;
  /** Meeting time/date */
  time: string;
  /** Number of attendees */
  attendees: number;
}

/**
 * Project item for project list
 * @description Structure for project information
 */
export interface ProjectItem {
  /** Project name */
  name: string;
  /** Project logo URL */
  logo?: string;
  /** User's role in project */
  role: string;
  /** User's affiliations */
  affiliations: string[];
  /** Code activity data for chart */
  codeActivities: number[];
  /** Non-code activity data for chart */
  nonCodeActivities: number[];
  /** Project status */
  status: 'active' | 'archived';
}

/**
 * Dashboard meeting card feature flags
 * @description Enabled features for a meeting displayed on dashboard
 */
export interface DashboardMeetingFeatures {
  /** YouTube auto-upload enabled */
  youtubeAutoUploads?: boolean;
  /** Recording enabled */
  recordingEnabled: boolean;
  /** Transcripts enabled */
  transcriptsEnabled?: boolean;
  /** AI summary enabled */
  aiSummary?: boolean;
  /** Chat enabled */
  chatEnabled?: boolean;
}

/**
 * Dashboard meeting card properties
 * @description Configuration for dashboard meeting card component
 */
export interface DashboardMeetingCardProps {
  /** Unique meeting identifier */
  id: string;
  /** Meeting title */
  title: string;
  /** Meeting date string */
  date: string;
  /** Meeting time string */
  time: string;
  /** Meeting type category */
  meetingType: string;
  /** Whether meeting is private */
  isPrivate: boolean;
  /** Enabled meeting features */
  features: DashboardMeetingFeatures;
  /** Project name (optional) */
  project?: string;
}
