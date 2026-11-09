import type {
  LogLevel,
  Reporter,
  ReporterOptions,
  ReporterPlugin,
  ReportOptions,
  ReportRecord,
  ReportResult,
  RuntimeAdapter,
} from './types.js';

import { normalizeError as defaultNormalizeError, safeToString } from './normalize-error.js';
import { defaultRuntime } from './runtime.js';

interface RegisteredPlugin {
  active: boolean;
  cleanup?: () => void;
  plugin: ReporterPlugin;
}

class ReporterImpl implements Reporter {
  private readonly app: ReporterOptions['app'] | undefined;
  private readonly beforeSend?: ReporterOptions['beforeSend'];
  private context: Record<string, unknown> = {};
  private destroyed = false;
  private enabled: boolean;
  private readonly environment: string | undefined;
  private readonly nameFormat?: ReporterOptions['nameFormat'];
  private readonly normalizeError: (error: unknown) => unknown;
  private readonly onError?: ReporterOptions['onError'];
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly runtime: RuntimeAdapter;
  private readonly transport: ReporterOptions['transport'];

  constructor(options: ReporterOptions) {
    if (!options?.transport || typeof options.transport.send !== 'function') {
      throw new TypeError('createReporter requires a transport with send(record).');
    }

    this.transport = options.transport;
    this.app = options.app ? { ...options.app } : undefined;
    this.environment = options.environment;
    this.enabled = options.enabled ?? true;
    this.beforeSend = options.beforeSend;
    this.nameFormat = options.nameFormat;
    this.onError = options.onError;
    this.normalizeError = options.normalizeError ?? defaultNormalizeError;
    this.runtime = {
      createId: options.runtime?.createId ?? defaultRuntime.createId,
      now: options.runtime?.now ?? defaultRuntime.now,
    };
  }

  clearContext(): void {
    this.assertNotDestroyed();
    this.context = {};
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    let firstError: Error | undefined;
    for (const entry of [...this.plugins.values()].reverse()) {
      if (!entry.active) {
        continue;
      }
      entry.active = false;
      try {
        entry.cleanup?.();
      } catch (error) {
        firstError ??= toError(error);
      }
    }
    this.plugins.clear();

    try {
      // Deliberately does not call flush().
      await this.transport.destroy?.();
    } catch (error) {
      firstError ??= toError(error);
    }

    if (firstError) {
      throw firstError;
    }
  }

  error(error: unknown, data?: unknown, options: ReportOptions = {}): Promise<ReportResult> {
    let normalized: unknown;
    try {
      normalized = this.normalizeError(error);
    } catch (cause) {
      normalized = defaultNormalizeError(cause);
    }

    return this.report(
      'error',
      { error: normalized, ...(data !== undefined ? { details: data } : {}) },
      { ...options, level: options.level ?? 'error', type: options.type ?? 'error' },
    );
  }

  event(name: string, data?: unknown, options: ReportOptions = {}): Promise<ReportResult> {
    return this.report(name, data, { ...options, type: options.type ?? 'event' });
  }

  async flush(): Promise<void> {
    this.assertNotDestroyed();
    await this.transport.flush?.();
  }

  log(
    level: LogLevel,
    message: string,
    data?: unknown,
    options: ReportOptions = {},
  ): Promise<ReportResult> {
    return this.report(
      'log',
      { message, ...(data !== undefined ? { details: data } : {}) },
      { ...options, level, type: options.type ?? 'log' },
    );
  }

  async report(name: string, data?: unknown, options: ReportOptions = {}): Promise<ReportResult> {
    const overrideName = options.name;
    let reportName = overrideName === undefined ? name : overrideName;
    assertName(reportName);

    if (this.destroyed) {
      return { reason: 'destroyed', status: 'skipped' };
    }
    if (!this.enabled) {
      return { reason: 'disabled', status: 'skipped' };
    }

    const type = options.type ?? 'custom';
    if (overrideName === undefined && this.nameFormat !== undefined) {
      reportName = this.nameFormat === 'standard' ? `${type}.${name}` : this.nameFormat(name, type);
      assertName(reportName);
    }

    const record: ReportRecord = {
      id: this.runtime.createId(),
      name: reportName,
      timestamp: this.runtime.now(),
      type,
      ...(this.app ? { app: { ...this.app } } : {}),
      ...(this.environment !== undefined ? { environment: this.environment } : {}),
      ...(options.level ? { level: options.level } : {}),
      ...(data !== undefined ? { data } : {}),
      ...(options.tags ? { tags: [...options.tags] } : {}),
      context: {
        ...this.context,
        ...options.context,
      },
    };

    const plugins = [...this.plugins.values()].filter((entry) => entry.active);
    let outgoing: null | ReportRecord = record;
    let result: ReportResult;
    try {
      if (this.beforeSend) {
        outgoing = await this.beforeSend(outgoing);
      }

      for (const entry of plugins) {
        if (outgoing === null) {
          break;
        }
        if (entry.active && entry.plugin.beforeSend) {
          outgoing = await entry.plugin.beforeSend(outgoing);
        }
      }

      if (outgoing === null) {
        result = { id: record.id, reason: 'filtered', status: 'skipped' };
      } else if (this.destroyed) {
        result = { id: record.id, reason: 'destroyed', status: 'skipped' };
      } else {
        await this.transport.send(outgoing);
        result = { id: record.id, status: 'sent' };
      }
    } catch (cause) {
      const error = toError(cause);
      this.notifyError(error, outgoing ?? record);
      result = { error, id: record.id, status: 'failed' };
    }
    await this.notifyAfterSend(plugins, outgoing ?? record, result);
    return result;
  }

  setContext(context: Record<string, unknown>): void {
    this.assertNotDestroyed();
    this.context = { ...this.context, ...context };
  }

  setEnabled(enabled: boolean): void {
    this.assertNotDestroyed();
    this.enabled = enabled;
  }

  use(plugin: ReporterPlugin): () => void {
    this.assertNotDestroyed();
    if (!plugin || typeof plugin.name !== 'string' || plugin.name.trim() === '') {
      throw new TypeError('A plugin must have a non-empty name.');
    }
    const name = plugin.name;
    if (this.plugins.has(name)) {
      throw new Error(`A plugin named "${name}" is already registered.`);
    }

    const entry: RegisteredPlugin = { active: false, plugin };
    this.plugins.set(name, entry);
    try {
      const cleanup = plugin.setup?.(this);
      if (this.destroyed) {
        cleanup?.();
      } else {
        entry.cleanup = cleanup || undefined;
        entry.active = true;
      }
    } catch (error) {
      this.plugins.delete(name);
      throw error;
    }

    return () => {
      if (!entry.active) {
        return;
      }
      entry.active = false;
      this.plugins.delete(name);
      entry.cleanup?.();
    };
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('Reporter has been destroyed.');
    }
  }

  private async notifyAfterSend(
    plugins: RegisteredPlugin[],
    record: ReportRecord,
    result: ReportResult,
  ): Promise<void> {
    for (const entry of plugins) {
      if (!entry.active) {
        continue;
      }
      try {
        if (entry.plugin.afterSend) {
          await entry.plugin.afterSend(record, result);
        }
      } catch (cause) {
        this.notifyError(toError(cause), record);
      }
    }
  }

  private notifyError(error: Error, record: ReportRecord): void {
    try {
      this.onError?.(error, record);
    } catch {
      // Error observers must not replace the original reporting result.
    }
  }
}

export function createReporter(options: ReporterOptions): Reporter {
  return new ReporterImpl(options);
}

function assertName(name: string): void {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('Report name must be a non-empty string.');
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(safeToString(value));
}
