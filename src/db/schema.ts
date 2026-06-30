import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

// Better Auth tables
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  // Optional login handle. 3-20 chars, lowercase letters/digits/underscore.
  // Empty string means "user signed up without picking one" — they can still
  // log in with email.
  username: varchar("username", { length: 20 }).unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Application tables
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    type: varchar("type", { length: 20 }).notNull().default("paper"), // 'paper' | 'code'
    originalUrl: text("original_url"),
    // === Source tracking (URL-based ingest) ===
    // The original user-supplied URL (arxiv abs / pdf / github / web).
    // Distinct from `originalUrl` above which is a free-form "any source"
    // field. `sourceUrl` is the L1 link the user pasted, kept for the
    // UI ("重新导入此 URL") and for arxiv-version upgrades.
    sourceUrl: text("source_url"),
    // Discriminator for the ingest pipeline: 'arxiv' | 'pdf-url' | 'file'
    // | 'github-repo' | 'web'. New types can be added without a migration.
    sourceType: varchar("source_type", { length: 20 }),
    // Idempotency key. arxiv: "{id}-v{version}"; pdf-url: normalized URL;
    // file: sha1 of file content; github: "{owner}/{repo}@{ref}".
    // Combined with userId it is UNIQUE — used to detect "already imported".
    sourceKey: varchar("source_key", { length: 255 }),
    // Paper metadata fields (null for code projects)
    authors: text("authors"), // JSON array string, e.g. '["Jane Doe","John Smith"]'
    year: integer("year"),
    venue: varchar("venue", { length: 255 }),
    doi: varchar("doi", { length: 255 }),
    abstract: text("abstract"),
    rawText: text("raw_text"), // Original extracted text for reference / search
    nodes: jsonb("nodes").notNull(),
    edges: jsonb("edges").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    isPublic: boolean("is_public").notNull().default(false),
    shareId: varchar("share_id", { length: 36 }),
    // Project parse status: 'parsing' (KG pipeline running) | 'ready' | 'failed'.
    // Default 'ready' so all existing rows are unaffected by the migration.
    // Python parser service sets 'parsing' on document creation, flips to
    // 'ready' when the KG pipeline completes (or 'failed' on error). The
    // dashboard uses this to render a ParsingProjectCard with live progress.
    status: varchar("status", { length: 20 }).notNull().default("ready"),
  },
  (table) => ({
    userIdIdx: index("idx_documents_user_id").on(table.userId),
    userCreatedIdx: index("idx_documents_user_created").on(table.userId, table.createdAt),
    // Uniqueness: (userId, sourceKey) — used by ingest dedup.
    // `sourceKey` is null for old projects imported before this column
    // existed; nulls don't conflict under Postgres' default UNIQUE
    // semantics, so legacy rows are unaffected.
    userSourceKeyUnique: uniqueIndex("uniq_documents_user_source_key").on(
      table.userId,
      table.sourceKey
    ),
    // Type whitelist is enforced at the application layer (api/projects POST).
    // The DB-level CHECK constraint is omitted here so the schema can accept
    // new project types (e.g. 'image' added in Tier 2) without an extra
    // migration round-trip.
  })
);

// AI usage tracking — one row per AI request (ingest, qa, explain, review, compare)
export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    endpoint: varchar("endpoint", { length: 50 }).notNull(), // "ingest", "qa", "explain", "review", "compare"
    tokensUsed: integer("tokens_used").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_usage_user_id").on(table.userId),
    index("idx_usage_user_created").on(table.userId, table.createdAt),
  ]
);

// QA conversation persistence (one conversation per project per user)
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    projectId: varchar("project_id", { length: 36 }).notNull(),
    messages: jsonb("messages").notNull().default([]), // Array of {role, content, timestamp}
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_conversations_user_id").on(table.userId),
    index("idx_conversations_project_id").on(table.projectId),
  ]
);

// User preferences — UI language and AI output language
export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    language: varchar("language", { length: 10 }).notNull().default("en"), // UI language: "en" | "zh"
    aiOutputLanguage: varchar("ai_output_language", { length: 20 }).notNull().default("en"), // AI output language: "en" | "zh" | "ja" | ...
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_user_settings_user_id").on(table.userId),
  ]
);

// Folders — single-level organization, scoped per user
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    color: varchar("color", { length: 20 }).notNull().default("#1C1C1C"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_folders_user_id").on(table.userId),
  ]
);

// Tags — many-to-many organization
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 50 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_tags_user_id").on(table.userId),
  ]
);

// Project ↔ Folder (one folder per project for now)
export const projectFolders = pgTable(
  "project_folders",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.folderId] }),
    index("idx_project_folders_project").on(table.projectId),
    index("idx_project_folders_folder").on(table.folderId),
  ]
);

// Project ↔ Tag (many-to-many)
export const projectTags = pgTable(
  "project_tags",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.tagId] }),
    index("idx_project_tags_project").on(table.projectId),
    index("idx_project_tags_tag").on(table.tagId),
  ]
);

// Project versions — periodic snapshots for history & rollback
export const projectVersions = pgTable(
  "project_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 200 }),
    nodes: jsonb("nodes").notNull(),
    edges: jsonb("edges").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_project_versions_project").on(table.projectId),
    index("idx_project_versions_user_created").on(table.userId, table.createdAt),
  ]
);

// === Concept Graph tables (new pipeline) ===

// 概念图谱主表
export const conceptGraphs = pgTable(
  "concept_graphs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 255 }).notNull(),
    type: varchar("type", { length: 20 }).notNull(),
    concepts: jsonb("concepts").notNull(),
    edges: jsonb("edges").notNull(),
    clusters: jsonb("clusters").notNull(),
    rawText: text("raw_text"),
    // LLM 抽取的章节大纲（思维导图视图用）。可空：代码项目不生成。
    sections: jsonb("sections"),
    // LLM 抽取的论证骨架（论证骨架图视图用）。可空：代码项目不生成。
    skeleton: jsonb("skeleton"),
    authors: text("authors"),
    year: integer("year"),
    venue: varchar("venue", { length: 255 }),
    doi: varchar("doi", { length: 255 }),
    abstract: text("abstract"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    shareId: varchar("share_id", { length: 36 }),
  },
  (table) => [
    index("idx_concept_graphs_user_id").on(table.userId),
    index("idx_concept_graphs_document").on(table.documentId),
    index("idx_concept_graphs_user_created").on(table.userId, table.createdAt),
  ]
);

// 异步 Ingest Job 表
export const conceptGraphJobs = pgTable(
  "concept_graph_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, {
      onDelete: "cascade",
    }),
    status: varchar("status", { length: 20 }).notNull().default("processing"),
    progress: jsonb("progress").notNull().default({ step: "queued", current: 0, total: 5 }),
    graphId: uuid("graph_id"),
    projectId: uuid("project_id"),
    error: text("error"),
    inputType: varchar("input_type", { length: 20 }).notNull(),
    inputUrl: text("input_url"),
    inputFileName: text("input_file_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_concept_graph_jobs_user").on(table.userId),
    index("idx_concept_graph_jobs_status").on(table.status),
    index("idx_concept_graph_jobs_project").on(table.projectId),
  ]
);

// Email verification codes — 6-digit numeric codes sent to the user's inbox
// during sign-up. We store them ourselves (rather than using better-auth's
// built-in token flow) so we can deliver a code instead of a magic link and
// also support the "send again" flow with rate limits.
export const verificationCodes = pgTable(
  "verification_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    // 6-digit numeric code. Stored as text to dodge integer zero-padding issues.
    code: varchar("code", { length: 6 }).notNull(),
    // Hard expiry. Default is 10 minutes after creation.
    expiresAt: timestamp("expires_at").notNull(),
    // Marks a code as used so it can never be reused even if not yet expired.
    consumed: boolean("consumed").notNull().default(false),
    // How many wrong guesses we've seen. Caps at 5 then the code is invalidated.
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_verification_codes_email").on(table.email),
    index("idx_verification_codes_email_active").on(table.email, table.consumed),
  ]
);

// === Source assets (PDF / image-bundle / etc., one row per uploaded blob) ===
// A single document can have multiple assets: the original PDF, the
// extracted image bundle, the arxiv abs page HTML snapshot, etc.
// `metadata` is a jsonb so each `kind` can stash its own fields without
// schema changes (arxiv version, image count, github ref, etc.).
export const documentAssets = pgTable(
  "document_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 30 }).notNull(), // 'pdf' | 'image-bundle' | 'abs-html' | 'code-zip' | ...
    storageUrl: text("storage_url").notNull(), // R2 object key
    size: integer("size").notNull().default(0),
    mime: varchar("mime", { length: 100 }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_document_assets_document").on(table.documentId),
    index("idx_document_assets_doc_kind").on(table.documentId, table.kind),
  ]
);

// === Document links (article-internal references, kept for future use) ===
// Schema in place; link extraction is NOT implemented in this round.
// When implemented, a row stores one rendered link on a PDF/text source:
//   type='internal'   -> targetPage + targetX/Y for in-PDF jumps
//   type='external'   -> externalUrl (arxiv/github/doi)
//   type='cross-doc'  -> targetDocumentId for jumps to other documents
//                        owned by the same user
//   type='reference'  -> bibliography entry; usually externalUrl
export const documentLinks = pgTable(
  "document_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 20 }).notNull(), // 'internal' | 'external' | 'cross-doc' | 'reference'
    anchorText: text("anchor_text"), // Visible text in the source ("Section 3.2", "github.com/foo", ...)
    page: integer("page"), // 1-based page where the link appears
    bbox: jsonb("bbox"), // { x, y, w, h } in PDF coords (optional)
    // Exactly one of the following is populated per row, depending on `type`.
    externalUrl: text("external_url"),
    targetPage: integer("target_page"),
    targetX: integer("target_x"),
    targetY: integer("target_y"),
    targetDocumentId: uuid("target_document_id"),
    // Free-form metadata for the original raw target string (e.g. the
    // annot's /Annot dictionary dump, or the unmatched DOI), useful for
    // debugging & future re-resolution.
    rawTarget: text("raw_target"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_document_links_document").on(table.documentId),
    index("idx_document_links_doc_type").on(table.documentId, table.type),
    index("idx_document_links_target_doc").on(table.targetDocumentId),
  ]
);
