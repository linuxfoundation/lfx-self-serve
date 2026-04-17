// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OffsetPaginatedResponse } from './api.interface';

/**
 * The set of valid status filter values for foundation events.
 * Raw EVENT_STATUS DB values ('Active', 'Planned', 'Pending', 'Completed') are passed
 * directly as SQL bind parameters. 'coming-soon' is a synthetic sentinel that the server
 * maps to `EVENT_STATUS IN ('Pending', 'Planned')`.
 */
export type EventStatusFilter = 'Active' | 'Planned' | 'Pending' | 'Completed' | 'coming-soon';

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
  /** ISO 8601 event start date string (e.g. "2026-11-10T00:00:00.000Z") — used for date-range filtering */
  startDate: string;
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
  /** Raw EVENT_STATUS value from the database (e.g. 'Active', 'Planned', 'Completed') */
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
  /** Display label derived from raw status (e.g. 'Active' → 'Registration Open') */
  displayStatus: string | null;
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
 * Step identifiers for the visa letter application dialog
 */
export type VisaRequestStep = 'select-event' | 'terms' | 'apply';

/**
 * Step identifiers for the travel fund application dialog
 */
export type TravelFundStep = 'select-event' | 'terms' | 'about-me' | 'expenses';

/**
 * Represents the render state of a single step in a multi-step dialog's step indicator
 */
export interface DialogStepState {
  id: string;
  label: string;
  number: number;
  isActive: boolean;
  isCompleted: boolean;
}

/**
 * Parameters for fetching event requests (visa letters or travel fund) from the API
 */
export interface GetEventRequestsParams {
  eventId?: string;
  projectName?: string;
  searchQuery?: string;
  status?: string;
  sortField?: string;
  pageSize?: number;
  offset?: number;
  sortOrder?: 'ASC' | 'DESC';
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
  /** When true, only events the user has registered for are returned */
  registeredOnly?: boolean;
  /** ISO 8601 date string — include only events starting on or after this date */
  startDateFrom?: string;
  /** ISO 8601 date string — include only events starting on or before this date */
  startDateTo?: string;
  /** Filter events by country (e.g. "United States") */
  country?: string;
}

/**
 * Parameters for fetching event organizations from the API
 */
export interface GetEventOrganizationsParams {
  projectName?: string;
  /** When true, returns only foundations from the user's registered past events */
  isPast?: boolean;
}

/**
 * Parameters for fetching foundation events from the API
 */
export interface GetEventsParams {
  isPast?: boolean;
  eventId?: string;
  projectNames?: string[];
  searchQuery?: string;
  /** Filter by event status. See {@link EventStatusFilter} for supported values. */
  status?: EventStatusFilter;
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
 * Raw row returned from ANALYTICS.PLATINUM_LFX_ONE.EVENT_REGISTRATIONS for visa letter requests
 */
export interface VisaRequestRow {
  EVENT_ID: string;
  EVENT_NAME: string;
  EVENT_URL: string | null;
  EVENT_LOCATION: string | null;
  EVENT_CITY: string | null;
  EVENT_COUNTRY: string | null;
  /** Date the visa letter was applied for */
  APPLICATION_DATE: Date | string | null;
  /** Visa letter request status. Actual Snowflake values: "Submitted", "Approved", "Denied", "Expired" */
  REQUEST_STATUS: string;
  TOTAL_RECORDS: number;
}

/**
 * Visa letter request item for the My Events visa-letters tab
 */
export interface VisaRequest {
  /** Unique event identifier */
  id: string;
  /** Event display name */
  name: string;
  /** External event URL */
  url: string;
  /** Human-readable location string (e.g. "Salt Lake City, UT") */
  location: string;
  /** Human-readable application date string (e.g. "Jan 15, 2026") */
  applicationDate: string;
  /** Visa letter request status (e.g. "Submitted", "Approved", "Denied", "Expired") */
  status: string;
}

/**
 * Paginated API response for visa letter requests
 */
export type VisaRequestsResponse = OffsetPaginatedResponse<VisaRequest>;

/**
 * Travel fund request item — identical shape to VisaRequest (event name, location, application date, status)
 */
export type TravelFundRequest = VisaRequest;

/**
 * Paginated API response for travel fund requests
 */
export type TravelFundRequestsResponse = OffsetPaginatedResponse<TravelFundRequest>;

/**
 * Valid sort order values for event queries
 */
export type EventSortOrder = 'ASC' | 'DESC';

/**
 * Server-side options for fetching event requests (visa letters or travel fund) — required pagination/sort fields
 */
export interface GetEventRequestsOptions {
  eventId?: string;
  projectName?: string;
  searchQuery?: string;
  status?: string;
  sortField?: string;
  pageSize: number;
  offset: number;
  sortOrder: EventSortOrder;
}

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
  /** When true, only events the user has registered for are returned */
  registeredOnly?: boolean;
  /** ISO 8601 date string — include only events starting on or after this date */
  startDateFrom?: string;
  /** ISO 8601 date string — include only events starting on or before this date */
  startDateTo?: string;
  /** Filter events by country (e.g. "United States") */
  country?: string;
  /** Project slugs from persona detection — scopes upcoming events to affiliated projects */
  affiliatedProjectSlugs?: string[];
}

/**
 * Response for distinct event countries
 */
export interface GetUpcomingCountriesResponse {
  data: string[];
}

/**
 * Server-side options for fetching foundation events (required pagination/sort fields)
 */
export interface GetEventsOptions {
  isPast?: boolean;
  eventId?: string;
  projectNames?: string[];
  searchQuery?: string;
  /** Filter by event status. See {@link EventStatusFilter} for supported values. */
  status?: EventStatusFilter;
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
  /** When true, returns only foundations from the authenticated user's registered past events */
  isPast?: boolean;
  /** Project slugs from persona detection — scopes upcoming foundations to affiliated projects */
  affiliatedProjectSlugs?: string[];
}

// ---------------------------------------------------------------------------
// Travel Fund Application
// ---------------------------------------------------------------------------

export interface TravelFundAboutMe {
  firstName: string;
  lastName: string;
  email: string;
  citizenshipCountry: string;
  profileLink: string;
  company: string;
  organizationID?: string;
  canReceiveFunds: string;
  travelFromCountry: string;
  openSourceInvolvement: string;
  isLgbtqia: boolean;
  isWoman: boolean;
  isPersonWithDisability: boolean;
  isDiversityOther: boolean;
  preferNotToAnswer: boolean;
  attendingForCompany: string;
  willingToBlog: string;
}

export interface TravelFundExpenses {
  airfareCost: number;
  airfareNotes: string;
  hotelCost: number;
  hotelNotes: string;
  groundTransportCost: number;
  groundTransportNotes: string;
  estimatedTotal: number;
}

export interface TravelFundApplication {
  eventId: string;
  eventName: string;
  termsAccepted: boolean;
  /** Salesforce user record ID — client-provided in the request shape; the server should ignore it and derive/validate the effective user from the session */
  userId: string;
  aboutMe: TravelFundAboutMe;
  expenses: TravelFundExpenses;
}

export interface TravelFundApplicationResponse {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Visa Request Application
// ---------------------------------------------------------------------------

/** Who pays for the attendee's accommodation — maps to attendeeAccommodationPaidBy in the user-service API */
export type AttendeeAccommodationPaidBy = 'delegate' | 'delegates_company' | 'the_linux_foundation' | 'cncf';

/** Attendee role at the event — maps to attendeeType in the user-service API */
export type AttendeeType = 'attendee' | 'speaker';

export interface VisaRequestApplicantInfo {
  firstName: string;
  lastName: string;
  email: string;
  passportNumber: string;
  /** Country of citizenship — maps to birthCountry in the user-service API */
  citizenshipCountry: string;
  passportExpiryDate: Date | null;
  embassyCity: string;
  /** Organization ID — selected from the autocomplete component */
  organizationID: string;
  company: string;
  mailingAddress: string;
  /** Who pays for the attendee's accommodation */
  attendeeAccommodationPaidBy: AttendeeAccommodationPaidBy;
  /** Attendee role at the event */
  attendeeType: AttendeeType;
  /** Date of birth */
  birthDate: Date | null;
}

export interface VisaRequestApplication {
  eventId: string;
  eventName: string;
  termsAccepted: boolean;
  /** Salesforce user record ID — ignored by the server; the server derives this from the authenticated session via the API Gateway profile */
  userId: string;
  applicantInfo: VisaRequestApplicantInfo;
}

export interface VisaRequestApplicationResponse {
  success: boolean;
  message: string;
}

export type RequestType = 'visa' | 'travel-fund';
export type TimeFilterValue = 'any' | 'this-month' | 'next-3-months';

// ---------------------------------------------------------------------------
// Organization Search
// ---------------------------------------------------------------------------

/**
 * A single organization result from the API Gateway organization search endpoint.
 * Only ID and Name are surfaced — the upstream response contains many additional fields.
 */
export interface OrgSearchResult {
  id: string;
  name: string;
}

/**
 * Response for organization name search
 */
export interface OrgSearchResponse {
  data: OrgSearchResult[];
}

// ---------------------------------------------------------------------------
// Salesforce ID
// ---------------------------------------------------------------------------

/**
 * Response from the /api/user/salesforce-id endpoint.
 */
export interface SalesforceIdResponse {
  id: string;
}
