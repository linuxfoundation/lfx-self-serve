// Copyright (c) 2025 The Linux Foundation and each contributor.
// SPDX-License-Identifier: MIT

// Badge interfaces
export interface BadgeSeverityOptions {
  severity: "info" | "success" | "warn" | "danger" | "secondary" | "contrast";
}

export interface BadgeSizeOptions {
  size: "small" | "large" | "xlarge";
}

export interface BadgeProps {
  value: string | number;
  severity: BadgeSeverityOptions["severity"];
  size: BadgeSizeOptions["size"];
  styleClass: string;
  badgeDisabled: boolean;
}

// Button interfaces
export interface ButtonSeverityOptions {
  severity: "success" | "info" | "warn" | "danger" | "help" | "primary" | "secondary" | "contrast" | null | undefined;
}

export interface ButtonIconPositionOptions {
  iconPos: "left" | "right" | "top" | "bottom";
}

export interface ButtonSizeOptions {
  size: "small" | "large" | undefined;
}

export interface ButtonVariantOptions {
  variant: "outlined" | "text" | undefined;
}

export interface ButtonProps {
  severity?: ButtonSeverityOptions["severity"];
  iconPos?: ButtonIconPositionOptions["iconPos"];
  size?: ButtonSizeOptions["size"];
  variant?: ButtonVariantOptions["variant"];
  label?: string;
  icon?: string;
  type?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingIcon?: string;
  tabindex?: number;
  autofocus?: boolean;
  raised?: boolean;
  rounded?: boolean;
  text?: boolean;
  plain?: boolean;
  outlined?: boolean;
  link?: boolean;
  fluid?: boolean;
  style?: Record<string, string | number> | null;
  styleClass?: string;
  badge?: string;
  badgeClass?: string;
  badgeSeverity?: BadgeSeverityOptions["severity"];
  ariaLabel?: string;
}

// Avatar interfaces
export interface AvatarSizeOptions {
  size: "normal" | "large" | "xlarge";
}

export interface AvatarShapeOptions {
  shape: "square" | "circle";
}

export interface AvatarProps {
  label?: string;
  icon?: string;
  image?: string;
  size?: AvatarSizeOptions["size"];
  shape?: AvatarShapeOptions["shape"];
  style?: Record<string, string | number> | null;
  styleClass?: string;
  ariaLabel?: string;
}
