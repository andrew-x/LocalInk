import day from "@/lib/dayjs";

export type LogLevel = "info" | "error";
export type LogDetails = Record<string, unknown>;

export type Logger = {
  error: (message: string, details?: LogDetails) => void;
  info: (message: string, details?: LogDetails) => void;
};

const LOG_PREFIX = "LocalInk";
const TIMESTAMP_FORMAT = "YYYY-MM-DD HH:mm:ss.SSS Z";

export const logger = createLogger();

export function createLogger(scope?: string): Logger {
  return {
    error(message, details) {
      writeLog("error", scope, message, details);
    },
    info(message, details) {
      writeLog("info", scope, message, details);
    },
  };
}

function writeLog(
  level: LogLevel,
  scope: string | undefined,
  message: string,
  details: LogDetails | undefined,
) {
  const formattedMessage = scope ? `${scope}:${message}` : message;
  const logPayload = {
    timestamp: day().format(TIMESTAMP_FORMAT),
    ...(details ? normalizeDetails(details) : {}),
  };

  const consoleMethod = level === "error" ? console.error : console.info;

  consoleMethod(
    `[${LOG_PREFIX}] ${level.toUpperCase()} ${formattedMessage}`,
    logPayload,
  );
}

function normalizeDetails(details: LogDetails): LogDetails {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      normalizeLogValue(value, new WeakSet()),
    ]),
  );
}

function normalizeLogValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  if (value instanceof Error) {
    seen.add(value);
    return normalizeError(value);
  }

  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((item) => normalizeLogValue(item, seen));
  }

  if (isPlainObject(value)) {
    seen.add(value);

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeLogValue(item, seen),
      ]),
    );
  }

  return value;
}

function normalizeError(error: Error) {
  const normalizedError: LogDetails = {
    name: error.name,
  };

  return normalizedError;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}
