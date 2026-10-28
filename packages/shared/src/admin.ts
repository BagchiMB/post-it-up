/**
 * Admin JSON API types (`/admin/api/*`, cookie auth). Shapes match apps/server/src/admin/*.
 * See docs/api-contract.md → "Admin API (complete)".
 */

export type ModelRef = { id: string; name: string; structuredOutputs?: boolean };

export type BalanceStatus = {
  status: 'ok' | 'low' | 'empty' | 'unknown';
  /** Account balance = total_credits − total_usage (never the key's spending limit). */
  balanceUsd?: number;
  keyLimitUsd?: number | null;
  isFreeTier?: boolean;
  checkedAt: number | null;
};

/** `GET /admin/api/login-status` (no auth). */
export type AdminLoginStatus = { enabled: boolean };

export type AdminSession = {
  signedIn: true;
  username: string | null;
  lastLoginAt: number | null;
  lastLoginIp: string | null;
  weakPassword: boolean;
  loginEnabled: boolean;
  openrouter: { balance: BalanceStatus };
};

export type KeyInfo = {
  limit: number | null;
  limitRemaining: number | null;
  usage: number;
  usageDaily?: number;
  usageWeekly?: number;
  usageMonthly?: number;
  isFreeTier: boolean;
  freeRequests?: { used: number; limit: number; remaining: number };
};

/** `source: 'credits'`: total/used/remaining/balance are the account; `'key'`: /credits failed, key numbers instead. */
export type Credits = {
  source: 'credits' | 'key';
  total?: number;
  used: number;
  remaining?: number | null;
  usageDaily?: number;
  usageWeekly?: number;
  usageMonthly?: number;
  balance?: number;
  key?: KeyInfo;
};

export type CheckResult = {
  id: string;
  label: string;
  ok: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
};

export type ChecksRun = { at: number; results: CheckResult[] } | null;

export type AdminOverview = {
  credits: Credits | null;
  creditsError: string | null;
  spendToday: { costUsd: number; calls: number };
  tasksToday: number;
  failedCalls24h: { count: number; since: number };
  status: { openRouterKey: boolean; spotifyApp: boolean };
  balance: BalanceStatus;
  /** Set while OpenRouter chat calls fail for lack of credits. */
  aiOutOfCredits: { lastFailureAt: number } | null;
  model: ModelRef;
  spotify: { connected: number; slotsUsed: number; cap: number; pendingRequests: number };
  lastChecks: ChecksRun;
};

export type AdminStatus = {
  server: { version: string; node: string; uptimeSec: number };
  database: {
    schemaVersion: number;
    expectedVersion: number;
    fileSize: number;
    backups: number;
    lastBackupAt: number | null;
    backupsDir: string;
  };
  checks: { id: string; label: string }[];
  lastRun: ChecksRun;
};

export type StepKey =
  'shortlist' | 'final_post' | 'song_clip' | 'song_clip_estimate' | 'song_change';

export type AdminSettings = {
  model: ModelRef;
  stepModels: Partial<Record<StepKey, ModelRef>>;
  dailyJobLimit: number;
  clipLengths: number[];
  dailyMusicChangeLimit: number;
  logRetentionDays: number;
  spotifyUserCap: number;
  spotifyOwnerUserId: string | null;
  lowFitThreshold: number;
  lowBalanceUsd: number;
  openRouterKey: { set: boolean; hint?: string };
  spotify: { appCredentials: boolean };
};

/** `PUT /admin/api/settings` (partial). `stepModels[k] = null` resets that step to the default. */
export type AdminSettingsPatch = Partial<
  Omit<AdminSettings, 'openRouterKey' | 'spotify' | 'stepModels' | 'model'> & {
    model: { id: string; name?: string; structuredOutputs?: boolean };
    stepModels: Partial<
      Record<StepKey, { id: string; name?: string; structuredOutputs?: boolean } | null>
    >;
  }
>;

export type ListedModel = {
  id: string;
  name: string;
  /** USD per 1M tokens; null for auto-routers (variable price). */
  inputPrice: number | null;
  outputPrice: number | null;
  structuredOutputs: boolean;
  vision: boolean;
  router?: boolean;
};

export type StepModelRow = {
  key: StepKey;
  label: string;
  description: string;
  vision: boolean;
  model: ModelRef | null;
  effective: { id: string; name: string };
  last30d: {
    calls: number;
    avgCostUsd: number;
    avgPromptTokens: number;
    avgCompletionTokens: number;
  };
};

export type AdminIntegrations = {
  openrouter: { set: boolean; hint?: string; balance: BalanceStatus };
  spotify: {
    clientId?: string;
    secretSet: boolean;
    secretHint?: string;
    /** The iOS bundle ID (APP_BUNDLE_ID), for the "switching Spotify apps" note. */
    appBundleId?: string;
  };
};

export type AdminUsage = {
  credits: Credits | null;
  byDay: { day: string; cost: number; calls: number }[];
  byUser: { userId: string; email: string; cost: number; posts: number }[];
  byStep: { key: string; cost: number; calls: number }[];
  byModel: {
    model: string;
    routedModel: string | null;
    cost: number;
    calls: number;
    posts: number;
    posted: number;
    postedRate: number | null;
  }[];
};

export type AdminUser = {
  id: string;
  email: string;
  name?: string;
  createdAt: number;
  spotify: boolean;
  postsToday: number;
  postsTotal: number;
  posted: number;
  spendUsd: number;
};

export type AdminSpotifyAccessItem = {
  userId: string;
  email: string;
  name?: string;
  access:
    | { status: 'none' }
    | { status: 'requested' | 'approved'; spotifyEmail: string; at: number; name?: string }
    | { status: 'declined'; at: number; note?: string };
  connected: boolean;
};

export type AdminPromptPlaceholder = { name: string; description: string };
export type AdminPromptVersion = { version: number; body: string; note: string; createdAt: number };

export type AdminPrompt = {
  key: StepKey;
  title: string;
  description: string;
  placeholders: AdminPromptPlaceholder[];
  active: AdminPromptVersion | null;
  versionCount: number;
};

export type AdminPromptDetail = AdminPrompt & {
  model: { id: string; name: string; isDefault: boolean };
};

export type AdminPromptVersionRow = AdminPromptVersion & {
  active: boolean;
  jobs: number;
  failed: number;
  posted: number;
};

export type AdminAccount = {
  username: string;
  updatedAt: number;
  lastLoginAt: number | null;
  lastLoginIp: string | null;
  previousLoginAt: number | null;
  previousLoginIp: string | null;
  weakPassword: boolean;
} | null;

export type LogRow = {
  id: string;
  at: number;
  integration: string;
  operation: string;
  userId: string | null;
  userEmail: string | null;
  jobId: string | null;
  method: string;
  path: string;
  statusCode: number | null;
  ok: boolean;
  durationMs: number;
  costUsd: number | null;
  model: string | null;
  error: string | null;
};

export type LogPage = { rows: LogRow[]; nextCursor: string | null };

// Database browser (/admin/api/db/*) --------------------------------------------------------

export type DbTables = {
  schemaVersion: number;
  expectedVersion: number;
  fileSize: number;
  backups: number;
  lastBackupAt: number | null;
  tables: { name: string; rows: number; size: number | null }[];
};

export type DbStructure = {
  table: string;
  columns: {
    name: string;
    type: string;
    notNull: boolean;
    default: string | null;
    primaryKey: boolean;
    masked: boolean;
    json: boolean;
  }[];
  indexes: { name: string; unique: boolean; origin: string; columns: string[] }[];
};

export type DbRelation = {
  from: string;
  fromColumn: string;
  to: string;
  toColumn: string;
  inferred: boolean;
};

/** Rows include `__rowid`; secret values are "••••". */
export type DbRows = {
  table: string;
  columns: { name: string; masked: boolean; json: boolean }[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
};

export type DbRow = {
  table: string;
  row: Record<string, unknown>;
  outgoing: {
    column: string;
    table: string;
    toColumn: string;
    value: unknown;
    inferred: boolean;
  }[];
  incoming: { table: string; column: string; value: unknown; inferred: boolean; count: number }[];
};

export type DbWritePreview = {
  preview: {
    action: 'insert' | 'update' | 'delete';
    table: string;
    affected: number | null;
    needsAffectAll?: boolean;
  };
  confirmToken: string;
};

export type DbQueryResponse =
  | {
      kind: 'read';
      columns: string[];
      rows: unknown[][];
      rowCount: number;
      truncated: boolean;
      durationMs: number;
      limits: { maxRows: number; timeoutMs: number };
    }
  | ({ kind: 'preview' } & DbWritePreview)
  | { kind: 'write'; changes: number; durationMs: number };

export type DbWriteMode = { on: false } | { on: true; until: number; backedUp: boolean };

export type DbAuditEntry = {
  id: number;
  at: number;
  admin: string;
  table: string;
  rowKey: unknown;
  action: 'insert' | 'update' | 'delete';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  sql: string;
};
