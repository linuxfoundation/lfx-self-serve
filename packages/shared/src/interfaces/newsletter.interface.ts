// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type NewsletterStatusTabId = 'draft' | 'sent';

/**
 * Newsletter lifecycle states.
 *
 * `sending` is the transient state between the newsletter-service accepting a
 * send (202) and the background fan-out settling — to `sent` on completion, or
 * back to `draft` when zero recipients could be delivered to. The upstream
 * `status=sent` list filter also matches `sending` rows, so in-flight sends
 * appear on the Sent tab.
 */
export type NewsletterStatus = 'draft' | 'sending' | 'sent';

/**
 * Top-level view shown by the newsletter manage screen.
 *
 * - `review`: summary cards over the saved draft with explicit edit affordances (default on reopen).
 * - `step`: linear stepper (default for create, opt-in for edit when a section's "Edit" is clicked).
 */
export type NewsletterManageViewMode = 'review' | 'step';

export interface NewsletterCommitteeOption {
  label: string;
  value: string;
  category: string;
}

export interface NewsletterRecipientCountPayload {
  committee_uids: string[];
}

export interface NewsletterRecipientCount {
  count: number;
}

export interface NewsletterRecipient {
  email: string;
  first_name?: string;
}

export interface NewsletterRecipientsResponse {
  recipients: NewsletterRecipient[];
}

export interface NewsletterTestSendPayload {
  subject: string;
  body_html: string;
  to_email: string;
  // True when body_html is a layout (block-composer) render — a complete emitter
  // email — so the service dispatches it as-is instead of wrapping it in the
  // legacy email chrome (which would double-wrap it). Omitted/false = simple
  // editor HTML that still needs the chrome envelope.
  is_layout?: boolean;
}

// Render a layout to its final email HTML server-side (the SAME MJML render the
// send path uses), so the composer can show the authoritative sent-email size
// and source instead of estimating from the client preview markup.
export interface NewsletterRenderPreviewPayload {
  body_layout: NewsletterLayout;
  wrapper_content?: Record<string, unknown>;
}

export interface NewsletterRenderPreviewResponse {
  body_html: string;
}

export interface NewsletterSendFailure {
  email: string;
  error: string;
}

/**
 * Response of POST …/newsletters/{uid}/send.
 *
 * The upstream send is asynchronous: acceptance returns the newsletter in
 * `status='sending'` with `sent=0`, and the fan-out completes in a detached
 * background job. Branch on `newsletter.status` — `'sent'` means the send
 * settled synchronously (zero-recipient edge case, or a pre-async upstream).
 */
export interface NewsletterSendResult {
  newsletter: Newsletter;
  group_id: string;
  total_recipients: number;
  sent: number;
  failed: number;
  failures?: NewsletterSendFailure[];
}

export interface Newsletter {
  id: string;
  project_uid: string;
  subject: string;
  body_html: string;
  body_layout?: NewsletterLayout | null;
  ed_reply_email: string;
  committee_uids: string[];
  status: NewsletterStatus;
  sent_at?: string;
  group_id?: string;
  total_recipients: number;
  created_by: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CreateNewsletterRequest {
  subject: string;
  body_html: string;
  body_layout?: NewsletterLayout | null;
  ed_reply_email: string;
  committee_uids: string[];
}

export interface UpdateNewsletterRequest {
  subject: string;
  body_html: string;
  body_layout?: NewsletterLayout | null;
  ed_reply_email: string;
  committee_uids: string[];
}

export interface NewsletterListItem extends Newsletter {
  // The upstream list DTO currently omits both fields (per-newsletter analytics
  // require a separate /analytics call); the list page derives the displayed
  // values client-side. Kept optional for forward-compat should upstream ever
  // inline them.
  unique_opens?: number;
  open_rate?: number;
}

export interface NewsletterListResponse {
  newsletters: NewsletterListItem[];
  next_page_token?: string;
}

export interface NewsletterListParams {
  status?: NewsletterStatus;
  page_token?: string;
}

export interface NewsletterDailyOpens {
  date: string;
  opens: number;
  unique_opens: number;
}

export interface NewsletterAnalytics {
  newsletter_id: string;
  subject: string;
  status: NewsletterStatus;
  sent_at?: string;
  total_recipients: number;
  delivered: number;
  failed: number;
  // Best-effort list of recipient addresses that failed delivery. Derived upstream from
  // per-recipient email-service status records; may lag or be shorter than `failed` (which
  // comes from the engagement rollup), and may be absent on older upstream deployments.
  failed_recipients?: string[];
  total_opens: number;
  unique_opens: number;
  open_rate: number;
  daily_opens: NewsletterDailyOpens[];
  last_event_at?: string;
}

export interface NewsletterRow extends NewsletterListItem {
  openRateLabel: string;
  /** UI-populated: true while the row's analytics fetch is in flight. */
  openRatePending: boolean;
  openRateTooltip: string;
  /** UI-populated: screen-reader label combining the open-rate value and its tooltip context. */
  openRateAria: string;
  recipientsLabel: string;
  groupsLabel: string;
}

export interface NewsletterChartDataset {
  label: string;
  data: number[];
  borderColor: string;
  backgroundColor: string;
  tension: number;
  fill: boolean;
}

export interface NewsletterChartData {
  labels: string[];
  datasets: NewsletterChartDataset[];
}

// ---------------------------------------------------------------------------
// Gatewaze-style editor: structured layout + template manifest (spec 004 §8)
// ---------------------------------------------------------------------------

/**
 * The editable field types the block-composer fields panel knows how to render.
 * Mirrors the `type` discriminator in each block's parsed SCHEMA comment.
 * `slot` is the container child-list marker and is not rendered as an input.
 */
export type NewsletterFieldType = 'text' | 'textarea' | 'richtext' | 'number' | 'array' | 'image' | 'select' | 'slot';

/** One option of a `select` field: the value stored and the label shown. */
export interface NewsletterFieldOption {
  label: string;
  value: string;
}

/**
 * A single editable field in a block's schema. `fields` describes the per-item
 * shape of an `array` field (each array item is an object keyed by these field
 * names). `default` seeds an empty control when the block is first edited.
 */
export interface NewsletterFieldDefinition {
  type: NewsletterFieldType;
  label?: string;
  default?: unknown;
  /** For `array` fields: the nested per-item field definitions. */
  fields?: Record<string, NewsletterFieldDefinition>;
  /** For `select` fields: the selectable options. */
  options?: NewsletterFieldOption[];
}

/**
 * JSON Schema describing a block's editable fields, keyed by field name. Authored
 * in the declarative templates pulled at build time and rendered into form
 * controls by the editor's fields panel.
 */
export type NewsletterFieldSchema = Record<string, NewsletterFieldDefinition>;

/**
 * A field definition flattened with its key — the view-model the fields panel
 * iterates over to render one control per field.
 */
export interface NewsletterFieldEntry extends NewsletterFieldDefinition {
  key: string;
}

/**
 * A block instance in a newsletter's structured layout. Blocks are recursive: a
 * container block nests child blocks via `blocks`. This is the unified model —
 * there is no separate "brick" type; everything is a block.
 */
export interface NewsletterBlock {
  block_type: string;
  content: Record<string, unknown>;
  blocks?: NewsletterBlock[];
}

/**
 * The structured layout the editor saves and the server renders to MJML →
 * body_html. Persisted as body_layout (JSONB) on the newsletter.
 */
export interface NewsletterLayout {
  wrapper_key: string;
  /**
   * Which embedded block library (template set) this layout was composed from.
   * The newsletter-service persists it and renders the email from that library
   * (LFXV2-2747); an empty/omitted key renders from the default library, so
   * layouts saved before per-newsletter selection stay valid.
   */
  template_key?: string;
  blocks: NewsletterBlock[];
}

/** Palette entry describing one block type (from the build-time template pull). */
export interface NewsletterBlockManifestEntry {
  block_type: string;
  label: string;
  description?: string;
  category?: string;
  icon?: string;
  schema: NewsletterFieldSchema;
  /** True when this block can nest child blocks (a container block). */
  is_container?: boolean;
  /** For container blocks: the block types allowed as children. */
  allowed_block_types?: string[];
  /**
   * Raw declarative template HTML (the element tree, SCHEMA comment stripped)
   * bundled at build time. The client-side renderer parses + binds it to draw a
   * styled preview on the composer canvas. Optional: absent when a manifest is
   * generated without templates (older asset versions).
   */
  template?: string;
}

/** Provenance of the template manifest (the pinned, build-time template repo). */
export interface NewsletterTemplateSource {
  repo: string;
  commit: string;
}

/** One entry in the newsletter service's embedded template catalog. */
export interface NewsletterTemplateInfo {
  key: string;
  label: string;
}

/** Response of GET /projects/{uid}/newsletters/templates. */
export interface NewsletterTemplatesResponse {
  templates: NewsletterTemplateInfo[];
}

/** A category bucket of palette entries for the block-composer palette. */
export interface NewsletterBlockPaletteGroup {
  category: string;
  entries: NewsletterBlockManifestEntry[];
}

/**
 * The left-rail tabs of the block-composer editor (Gatewaze-Puck parity). The
 * rail switches the sidebar between the block palette and the canvas outline.
 * Field editing lives in the persistent right sidebar, not a rail tab.
 */
export type NewsletterComposerTab = 'blocks' | 'outline';

/**
 * Which body editor the content step shows: the structured block composer
 * (authors `body_layout`) or the simple rich-text + AI editor (authors
 * `body_html`). Selectable per newsletter; the two are mutually exclusive so
 * only one body representation is ever the source of truth.
 */
export type NewsletterEditorMode = 'blocks' | 'simple';

/** One rail tab descriptor (id, label, icon, disabled state). */
export interface NewsletterComposerTabDef {
  id: NewsletterComposerTab;
  label: string;
  icon: string;
  disabled?: boolean;
}

/**
 * Block-composer canvas view-model: a NewsletterBlock plus a stable local `id`
 * (for CDK drag-drop trackBy / drop-list correlation), the resolved palette
 * `label`, and an `isContainer` convenience flag. Projected back to a
 * NewsletterBlock when the composer emits its NewsletterLayout.
 */
export interface NewsletterComposerBlock {
  id: string;
  block_type: string;
  label: string;
  isContainer: boolean;
  content: Record<string, unknown>;
  children?: NewsletterComposerBlock[];
}

/**
 * Position + state of the composer's floating block toolbar (the dark pill that
 * hovers over the selected canvas block — block label + duplicate / delete, and
 * the rich-text B/I/U/link controls when a richtext field is focused). `top` /
 * `left` are pixel offsets relative to the canvas' positioned container.
 * `richtextActive` toggles the formatting controls.
 */
export interface NewsletterComposerToolbarState {
  blockId: string;
  label: string;
  top: number;
  left: number;
  isContainer: boolean;
  richtextActive: boolean;
}

/**
 * The block palette + field schemas bundled into the app at build time from the
 * hard-coded template repo (spec 004 §6.3, Phase 1).
 */
export interface NewsletterTemplateManifest {
  wrapper_key: string;
  wrapper_keys?: string[];
  blocks: NewsletterBlockManifestEntry[];
  source?: NewsletterTemplateSource;
  /**
   * Raw page-chrome wrapper template HTML (header / footer + a
   * `<slot name="body" />` where the composed blocks render). Bundled at build
   * time for the client-side preview. Optional: absent when no wrapper template
   * was found at generation time.
   */
  wrapper?: string;
}
