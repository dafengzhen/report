export interface AppInfo {
  name?: string;
  version?: string;
}

export type BeforeSendHook = (
  record: ReportRecord,
) => null | Promise<null | ReportRecord> | ReportRecord;

export type LogLevel = 'debug' | 'error' | 'fatal' | 'info' | 'warn';

export interface NormalizedError {
  cause?: unknown;
  message: string;
  name: string;
  stack?: string;
}

export interface Reporter {
  clearContext(): void;
  /** Releases resources. Does not send or flush pending data. */
  destroy(): Promise<void>;
  error(error: unknown, data?: unknown, options?: ReportOptions): Promise<ReportResult>;
  event(name: string, data?: unknown, options?: ReportOptions): Promise<ReportResult>;
  /** Delegates to transport.flush(); does nothing if the transport has no flush method. */
  flush(): Promise<void>;
  log(
    level: LogLevel,
    message: string,
    data?: unknown,
    options?: ReportOptions,
  ): Promise<ReportResult>;
  report(name: string, data?: unknown, options?: ReportOptions): Promise<ReportResult>;
  setContext(context: Record<string, unknown>): void;
  setEnabled(enabled: boolean): void;
  use(plugin: ReporterPlugin): () => void;
}

export interface ReporterOptions {
  app?: AppInfo;
  beforeSend?: BeforeSendHook;
  /** Defaults to true. False disables explicit submissions; it does not queue them. */
  enabled?: boolean;
  environment?: string;
  /** Formats report names as `<type>.<name>` or with a caller-provided function. */
  nameFormat?: 'standard' | ((name: string, type: ReportType) => string);
  normalizeError?: (error: unknown) => unknown;
  onError?: (error: Error, record: ReportRecord) => void;
  runtime?: Partial<RuntimeAdapter>;
  /** Required deliberately: creating a reporter never chooses a network destination. */
  transport: ReportTransport;
}

export interface ReporterPlugin {
  /** Observes sent, failed, and filtered reports. Hook failures do not change the result. */
  afterSend?: (record: ReportRecord, result: ReportResult) => Promise<void> | void;
  /** Runs in registration order, after the instance-level beforeSend hook. */
  beforeSend?: BeforeSendHook;
  name: string;
  /** Called only when the plugin is explicitly registered with use(). */
  setup?: (reporter: Reporter) => (() => void) | void;
}

export interface ReportOptions {
  /** Per-report context overrides keys from the instance context. */
  context?: Record<string, unknown>;
  level?: LogLevel;
  /** Overrides the final report name, bypassing the reporter's name format. */
  name?: string;
  tags?: string[];
  /** Overrides the type assigned by the convenience method. */
  type?: ReportType;
}

/** Canonical payload passed through hooks and to the transport. */
export interface ReportRecord<TData = unknown> {
  app?: AppInfo;
  context?: Record<string, unknown>;
  data?: TData;
  environment?: string;
  id: string;
  level?: LogLevel;
  name: string;
  tags?: string[];
  timestamp: number;
  type: ReportType;
}

export type ReportResult =
  | { error: Error; id: string; status: 'failed' }
  | { id: string; status: 'sent' }
  | {
      id?: string;
      reason: 'destroyed' | 'disabled' | 'filtered';
      status: 'skipped';
    };

export interface ReportTransport {
  /** Optional resource cleanup. Must not implicitly flush buffered records. */
  destroy?(): Promise<void> | void;
  /** Optional explicit flush for transports that buffer records. No timer is implied. */
  flush?(): Promise<void>;
  /** Resolves when the supplied record has been sent, optionally as part of a batch. */
  send(record: ReportRecord): Promise<void>;
}

/** Built-in types are conventions; custom business types are also allowed. */
export type ReportType = 'custom' | 'error' | 'event' | 'log' | ({} & string);

export interface RuntimeAdapter {
  /** Called only when the caller explicitly submits a report. */
  createId(): string;
  /** Called only when the caller explicitly submits a report. */
  now(): number;
}
