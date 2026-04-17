// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * NOTE: Property names in these interfaces intentionally use PascalCase to match the upstream
 * API Gateway response contract (Salesforce-backed). This deviates from the project's camelCase
 * convention; the casing must be preserved to correctly deserialize the raw JSON response.
 * @source API Gateway /user-service/v1/me endpoint
 * @see https://api-gw.dev.platform.linuxfoundation.org/user-service/v1/api-docs#tag/me (ReDoc UI)
 * @see https://api-gw.dev.platform.linuxfoundation.org/user-service/swagger.json (OpenAPI spec)
 */

/**
 * Account associated with an API Gateway user profile
 * @description Organization/company account linked to the user's profile record
 */
export interface ApiGatewayUserAccount {
  /** Account record ID */
  ID: string;
  /** URL to the organization's logo image */
  LogoURL: string;
  /** Organization display name */
  Name: string;
  /** Organization website URL */
  Website: string;
}

/**
 * A single data privacy visibility attribute
 * @description Controls visibility of a specific profile attribute (e.g. email, location)
 */
export interface ApiGatewayProfileAttribute {
  /** The profile attribute key (e.g. "user_emails", "user_location") */
  AttributeKey: string;
  /** The visibility value (e.g. "public", "visible") */
  AttributeValue: string;
  /** Unique identifier for this attribute record */
  id: string;
}

/**
 * Data privacy visibility settings for a user profile
 * @description Contains profile attribute visibility preferences
 */
export interface ApiGatewayDataPrivacyVisibility {
  /** List of profile attribute visibility settings */
  ProfileAttributes: ApiGatewayProfileAttribute[];
}

/**
 * Email record associated with a user profile
 * @description Represents a single email address with its status and subscription info
 */
export interface ApiGatewayUserEmail {
  /** Whether this email address is active */
  Active: boolean;
  /** The email address string */
  EmailAddress: string;
  /** Email record ID */
  ID: string;
  /** Whether this record has been soft-deleted */
  IsDeleted: boolean;
  /** Whether this is the user's primary email */
  IsPrimary: boolean;
  /** Whether this email address has been verified */
  IsVerified: boolean;
  /** Systems this email is subscribed to (e.g. "TI", "Groups.io") */
  SubscribedSystem: string[];
}

/**
 * User profile returned from the API Gateway /v1/me endpoint
 * @description Represents the full user profile as returned by the API Gateway
 */
export interface ApiGatewayUserProfile {
  /** Account linked to this user */
  Account: ApiGatewayUserAccount;
  /** Physical address (may be empty) */
  Address: Record<string, unknown>;
  /** User's biography or description */
  Bio: string;
  /** ISO 8601 timestamp when the record was created */
  CreatedDate: string;
  /** Data privacy visibility settings for profile attributes */
  DataPrivacyVisibility: ApiGatewayDataPrivacyVisibility;
  /** Whether this user should not be called */
  DoNotCall: boolean;
  /** Whether this user has opted out of email */
  EmailOptOut: boolean;
  /** List of email addresses associated with this user */
  Emails: ApiGatewayUserEmail[];
  /** User's first name */
  FirstName: string;
  /** User record ID */
  ID: string;
  /** Whether this user's profile is publicly visible */
  IsPublic: boolean;
  /** ISO 8601 timestamp of the last modification */
  LastModifiedDate: string;
  /** User's last name */
  LastName: string;
  /** URL to the user's avatar/logo image */
  LogoURL: string;
  /** User's full display name */
  Name: string;
  /** Permissions associated with this user (may be null) */
  Permissions: unknown;
  /** User's phone number */
  Phone: string;
  /** Record type (e.g. "contact") */
  Type: string;
  /** User's username/handle */
  Username: string;
}
