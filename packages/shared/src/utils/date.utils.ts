// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Converts a Date object to ISO date string (YYYY-MM-DD format)
 */
export const formatDateToISOString = (date: Date | null | undefined): string | undefined => {
  if (!date) {
    return undefined;
  }

  return new Date(date).toISOString().split('T')[0];
};

/**
 * Converts a date string to Date object, handling null/undefined values
 */
export const parseISODateString = (dateString: string | null | undefined): Date | null => {
  if (!dateString) {
    return null;
  }

  return new Date(dateString);
};
