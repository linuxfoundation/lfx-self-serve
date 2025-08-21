// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Timezone option interface for dropdown components
 * @description Structured timezone data with human-readable labels and IANA identifiers
 */
export interface TimezoneOption {
  /** Human-readable timezone label */
  label: string;
  /** IANA timezone identifier value */
  value: string;
  /** UTC offset string representation */
  offset: string;
}

/**
 * Comprehensive list of timezone options for global meeting scheduling
 * @description Organized by region with major cities and their UTC offsets
 * @readonly
 * @example
 * // Use in timezone selection dropdown
 * <LfxDropdown options={TIMEZONES} placeholder="Select timezone" />
 *
 * // Find specific timezone
 * const nyTimezone = TIMEZONES.find(tz => tz.value === 'America/New_York');
 */
export const TIMEZONES: TimezoneOption[] = [
  // UTC
  { label: 'UTC', value: 'UTC', offset: '+00:00' },

  // Americas
  { label: 'Eastern Time - New York', value: 'America/New_York', offset: '-05:00' },
  { label: 'Central Time - Chicago', value: 'America/Chicago', offset: '-06:00' },
  { label: 'Mountain Time - Denver', value: 'America/Denver', offset: '-07:00' },
  { label: 'Pacific Time - Los Angeles', value: 'America/Los_Angeles', offset: '-08:00' },
  { label: 'Alaska Time', value: 'America/Anchorage', offset: '-09:00' },
  { label: 'Hawaii Time', value: 'Pacific/Honolulu', offset: '-10:00' },
  { label: 'Atlantic Time - Halifax', value: 'America/Halifax', offset: '-04:00' },
  { label: 'Newfoundland Time', value: 'America/St_Johns', offset: '-03:30' },
  { label: 'Argentina - Buenos Aires', value: 'America/Argentina/Buenos_Aires', offset: '-03:00' },
  { label: 'Brazil - São Paulo', value: 'America/Sao_Paulo', offset: '-03:00' },
  { label: 'Chile - Santiago', value: 'America/Santiago', offset: '-03:00' },
  { label: 'Colombia - Bogotá', value: 'America/Bogota', offset: '-05:00' },
  { label: 'Mexico - Mexico City', value: 'America/Mexico_City', offset: '-06:00' },
  { label: 'Peru - Lima', value: 'America/Lima', offset: '-05:00' },
  { label: 'Venezuela - Caracas', value: 'America/Caracas', offset: '-04:00' },

  // Europe
  { label: 'Western European Time - London', value: 'Europe/London', offset: '+00:00' },
  { label: 'Central European Time - Berlin', value: 'Europe/Berlin', offset: '+01:00' },
  { label: 'Central European Time - Paris', value: 'Europe/Paris', offset: '+01:00' },
  { label: 'Central European Time - Amsterdam', value: 'Europe/Amsterdam', offset: '+01:00' },
  { label: 'Central European Time - Brussels', value: 'Europe/Brussels', offset: '+01:00' },
  { label: 'Central European Time - Madrid', value: 'Europe/Madrid', offset: '+01:00' },
  { label: 'Central European Time - Rome', value: 'Europe/Rome', offset: '+01:00' },
  { label: 'Central European Time - Zurich', value: 'Europe/Zurich', offset: '+01:00' },
  { label: 'Eastern European Time - Athens', value: 'Europe/Athens', offset: '+02:00' },
  { label: 'Eastern European Time - Helsinki', value: 'Europe/Helsinki', offset: '+02:00' },
  { label: 'Eastern European Time - Bucharest', value: 'Europe/Bucharest', offset: '+02:00' },
  { label: 'Moscow Time', value: 'Europe/Moscow', offset: '+03:00' },
  { label: 'Turkey - Istanbul', value: 'Europe/Istanbul', offset: '+03:00' },

  // Africa
  { label: 'South Africa - Johannesburg', value: 'Africa/Johannesburg', offset: '+02:00' },
  { label: 'Egypt - Cairo', value: 'Africa/Cairo', offset: '+02:00' },
  { label: 'Nigeria - Lagos', value: 'Africa/Lagos', offset: '+01:00' },
  { label: 'Kenya - Nairobi', value: 'Africa/Nairobi', offset: '+03:00' },
  { label: 'Morocco - Casablanca', value: 'Africa/Casablanca', offset: '+01:00' },

  // Middle East
  { label: 'Israel - Jerusalem', value: 'Asia/Jerusalem', offset: '+02:00' },
  { label: 'Saudi Arabia - Riyadh', value: 'Asia/Riyadh', offset: '+03:00' },
  { label: 'UAE - Dubai', value: 'Asia/Dubai', offset: '+04:00' },
  { label: 'Qatar - Doha', value: 'Asia/Qatar', offset: '+03:00' },

  // Asia
  { label: 'India - Kolkata', value: 'Asia/Kolkata', offset: '+05:30' },
  { label: 'Pakistan - Karachi', value: 'Asia/Karachi', offset: '+05:00' },
  { label: 'Bangladesh - Dhaka', value: 'Asia/Dhaka', offset: '+06:00' },
  { label: 'Sri Lanka - Colombo', value: 'Asia/Colombo', offset: '+05:30' },
  { label: 'Nepal - Kathmandu', value: 'Asia/Kathmandu', offset: '+05:45' },
  { label: 'Kazakhstan - Almaty', value: 'Asia/Almaty', offset: '+06:00' },
  { label: 'Thailand - Bangkok', value: 'Asia/Bangkok', offset: '+07:00' },
  { label: 'Vietnam - Ho Chi Minh City', value: 'Asia/Ho_Chi_Minh', offset: '+07:00' },
  { label: 'Indonesia - Jakarta', value: 'Asia/Jakarta', offset: '+07:00' },
  { label: 'Malaysia - Kuala Lumpur', value: 'Asia/Kuala_Lumpur', offset: '+08:00' },
  { label: 'Singapore', value: 'Asia/Singapore', offset: '+08:00' },
  { label: 'Philippines - Manila', value: 'Asia/Manila', offset: '+08:00' },
  { label: 'China - Shanghai', value: 'Asia/Shanghai', offset: '+08:00' },
  { label: 'China - Beijing', value: 'Asia/Shanghai', offset: '+08:00' },
  { label: 'Hong Kong', value: 'Asia/Hong_Kong', offset: '+08:00' },
  { label: 'Taiwan - Taipei', value: 'Asia/Taipei', offset: '+08:00' },
  { label: 'South Korea - Seoul', value: 'Asia/Seoul', offset: '+09:00' },
  { label: 'Japan - Tokyo', value: 'Asia/Tokyo', offset: '+09:00' },

  // Oceania
  { label: 'Australia - Perth', value: 'Australia/Perth', offset: '+08:00' },
  { label: 'Australia - Adelaide', value: 'Australia/Adelaide', offset: '+09:30' },
  { label: 'Australia - Darwin', value: 'Australia/Darwin', offset: '+09:30' },
  { label: 'Australia - Brisbane', value: 'Australia/Brisbane', offset: '+10:00' },
  { label: 'Australia - Sydney', value: 'Australia/Sydney', offset: '+10:00' },
  { label: 'Australia - Melbourne', value: 'Australia/Melbourne', offset: '+10:00' },
  { label: 'Australia - Hobart', value: 'Australia/Hobart', offset: '+10:00' },
  { label: 'New Zealand - Auckland', value: 'Pacific/Auckland', offset: '+12:00' },
  { label: 'New Zealand - Wellington', value: 'Pacific/Auckland', offset: '+12:00' },
  { label: 'Fiji', value: 'Pacific/Fiji', offset: '+12:00' },

  // Pacific Islands
  { label: 'Guam', value: 'Pacific/Guam', offset: '+10:00' },
  { label: 'Samoa', value: 'Pacific/Apia', offset: '+13:00' },
  { label: 'Tahiti', value: 'Pacific/Tahiti', offset: '-10:00' },
];
