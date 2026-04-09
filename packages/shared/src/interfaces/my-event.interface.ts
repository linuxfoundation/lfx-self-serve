// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OffsetPaginatedResponse } from './api.interface';

/**
 * Event item for the My Events dashboard
 */
export interface MyEvent {
  /** Unique event identifier */
  id: string;
  /** Event display name */
  name: string;
  /** External event URL */
  url: string;
  /** Event registration URL */
  registrationUrl: string | null;
  /** Foundation short name (e.g. "CNCF", "OpenSSF") */
  foundation: string;
  /** Human-readable date string (e.g. "Nov 10–13, 2026") */
  date: string;
  /** Human-readable location string (e.g. "Salt Lake City, UT") */
  location: string;
  /** User's role at the event (e.g. "Speaker", "Attendee", "Organizer"); empty string when not registered */
  role: string;
  /** Registration status (e.g. "Registered", "Not Registered", "Attended") */
  status: string;
  /** Whether the current user has registered for this event */
  isRegistered: boolean;
}

/**
 * Raw row returned from ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS
 */
export interface MyEventRow {
  EVENT_ID: string;
  EVENT_NAME: string;
  EVENT_START_DATE: Date | string;
  EVENT_END_DATE: Date | string | null;
  EVENT_LOCATION: string | null;
  EVENT_CITY: string | null;
  EVENT_COUNTRY: string | null;
  PROJECT_ID: string;
  PROJECT_NAME: string;
  PROJECT_SLUG: string;
  ACCOUNT_NAME: string;
  ACCOUNT_LOGO_URL: string | null;
  /** Null when the user has not registered for this event */
  USER_ROLE: string | null;
  /** Null when the user has not registered for this event */
  REGISTRATION_STATUS: string | null;
  TF_REQUEST_STATUS: string | null;
  VL_REQUEST_STATUS: string | null;
  /** Null when the user has not registered for this event */
  GROSS_REVENUE: number | null;
  /** Null when the user has not registered for this event */
  TAX_AMOUNT: number | null;
  /** Null when the user has not registered for this event */
  NET_REVENUE: number | null;
  IS_PAST_EVENT: boolean;
  EVENT_URL: string | null;
  EVENT_REGISTRATION_URL: string | null;
  /** Null when the user has not registered for this event */
  USER_ATTENDED: number | null;
  /** True when the user has registered for this event */
  IS_REGISTERED: boolean;
  TOTAL_RECORDS: number;
}

/**
 * Paginated API response for my events
 */
export type MyEventsResponse = OffsetPaginatedResponse<MyEvent>;

/**
 * Raw row returned from ANALYTICS.SILVER_DIM.EVENTS
 */
export interface EventRow {
  EVENT_ID: string;
  EVENT_NAME: string;
  EVENT_CATEGORY: string | null;
  EVENT_START_DATE: Date | string;
  EVENT_END_DATE: Date | string | null;
  EVENT_LOCATION: string | null;
  EVENT_CITY: string | null;
  EVENT_COUNTRY: string | null;
  EVENT_STATUS: string | null;
  IS_PAST_EVENT: boolean;
  EVENT_URL: string | null;
  EVENT_REGISTRATION_URL: string | null;
  ATTENDEES: number | null;
  TOTAL_RECORDS: number;
}

/**
 * Event item for the Foundation Events dashboard
 */
export interface FoundationEvent {
  /** Unique event identifier */
  id: string;
  /** Event display name */
  name: string;
  /** Event category (e.g. "Conference", "Summit") */
  category: string | null;
  /** External event URL */
  url: string;
  /** Event registration URL */
  registrationUrl: string | null;
  /** Human-readable date string (e.g. "Nov 10–13, 2026") */
  date: string;
  /** Human-readable location string (e.g. "Salt Lake City, UT") */
  location: string;
  /** Event status (e.g. "Published", "Cancelled") */
  status: string | null;
  /** Whether the event is in the past */
  isPast: boolean;
  /** Number of attendees (only populated for past events) */
  attendees: number | null;
}

/**
 * Foundation event with computed action properties for the events table
 */
export interface FoundationEventWithActions extends FoundationEvent {
  actionLabel: string;
  isOutlined: boolean;
}

/**
 * Paginated API response for foundation events
 */
export type EventsResponse = OffsetPaginatedResponse<FoundationEvent>;

/**
 * Response for distinct event organizations (ACCOUNT_NAME values)
 */
export interface MyEventOrganizationsResponse {
  data: string[];
}

/**
 * Sort change event emitted by the events table
 */
export interface SortChangeEvent {
  field: string;
}

/**
 * Page change event emitted by the events table
 */
export interface PageChangeEvent {
  offset: number;
  pageSize: number;
}

/**
 * Tab identifier for the events list component
 */
export type EventTabId = 'upcoming' | 'past' | 'visa-letters' | 'travel-funding';

/**
 * Tab definition for the events list component
 */
export interface EventTab {
  id: EventTabId;
  label: string;
  countKey?: 'upcoming' | 'past';
}

/**
 * Parameters for fetching my events from the API
 */
export interface GetMyEventsParams {
  isPast?: boolean;
  eventId?: string;
  projectName?: string;
  searchQuery?: string;
  role?: string;
  status?: string;
  sortField?: string;
  pageSize?: number;
  offset?: number;
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Parameters for fetching event organizations from the API
 */
export interface GetEventOrganizationsParams {
  projectName?: string;
}

/**
 * Parameters for fetching foundation events from the API
 */
export interface GetEventsParams {
  isPast?: boolean;
  eventId?: string;
  projectNames?: string[];
  searchQuery?: string;
  sortField?: string;
  pageSize?: number;
  offset?: number;
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Parameters for fetching certificate from the API
 */
export interface GetCertificateParams {
  eventId: string;
}

export interface PDFTemplateDetails {
  address: string;
  link: string;
  name: string;
  desc: string;
  onBehalf: string;
  logo: string;
  signature: string;
  signatureText: string;
}

export interface CertificateEventRow {
  EVENT_NAME: string;
  EVENT_START_DATE: Date | string;
  EVENT_END_DATE: Date | string | null;
  EVENT_LOCATION: string | null;
  EVENT_CITY: string | null;
  EVENT_COUNTRY: string | null;
  PROJECT_ID: string;
}

export interface CertificateData {
  eventId: string;
  userEmail: string;
  userName: string;
}

/**
 * Valid sort order values for event queries
 */
export type EventSortOrder = 'ASC' | 'DESC';

/**
 * Server-side options for fetching user events (required pagination/sort fields)
 */
export interface GetMyEventsOptions {
  isPast?: boolean;
  eventId?: string;
  projectName?: string;
  searchQuery?: string;
  role?: string;
  status?: string;
  sortField?: string;
  pageSize: number;
  offset: number;
  sortOrder: EventSortOrder;
}

/**
 * Server-side options for fetching foundation events (required pagination/sort fields)
 */
export interface GetEventsOptions {
  isPast?: boolean;
  eventId?: string;
  projectNames?: string[];
  searchQuery?: string;
  sortField?: string;
  pageSize: number;
  offset: number;
  sortOrder: EventSortOrder;
}

/**
 * Server-side options for fetching distinct event organizations
 */
export interface GetEventOrganizationsOptions {
  projectName?: string;
}
