// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export enum MeetingVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
  RESTRICTED = 'restricted',
}

export enum MeetingType {
  BOARD = 'Board',
  MAINTAINERS = 'Maintainers',
  MARKETING = 'Marketing',
  TECHNICAL = 'Technical',
  LEGAL = 'Legal',
  OTHER = 'Other',
  NONE = 'None',
}

export enum RecurrenceType {
  DAILY = 1,
  WEEKLY = 2,
  MONTHLY = 3,
}
