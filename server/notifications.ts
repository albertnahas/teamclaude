import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// --- Types ---

export type NotificationEvent =
  | "sprint_started"
  | "task_escalated"
  | "task_completed"
  | "sprint_complete"
  | "checkpoint_hit"
  | "token_budget_exceeded";

export interface WebhookConfig {
  url: string;
  events: NotificationEvent[];
  headers?: Record<string, string>;
}

export interface NotificationPayload {
  event: NotificationEvent;
  timestamp: string;
  project: string;
  data: Record<string, unknown>;
}

// --- Validation ---

const VALID_EVENTS = new Set<string>([
  "sprint_started",
  "task_escalated",
  "task_completed",
  "sprint_complete",
  "checkpoint_hit",
  "token_budget_exceeded",
]);

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidEvent(event: string): event is NotificationEvent {
  return VALID_EVENTS.has(event);
}

// --- Config parsing ---

/**
 * Load webhook config from .sprint.yml notifications section.
 * Returns null if not configured or config is invalid.
 */
export function loadWebhookConfig(cwd: string = process.cwd()): WebhookConfig | null {
  const sprintYml = join(cwd, ".sprint.yml");
  if (!existsSync(sprintYml)) return null;

  let raw: string;
  try {
    raw = readFileSync(sprintYml, "utf-8");
  } catch {
    return null;
  }

  // Extract the notifications block
  const sectionMatch = raw.match(/^notifications\s*:\s*\n((?:[ \t]+.+\n?)*)/m);
  if (!sectionMatch) return null;

  const block = sectionMatch[1];

  // Parse webhook URL
  const urlMatch = block.match(/[ \t]+webhook\s*:\s*(.+)/);
  if (!urlMatch) return null;
  const url = urlMatch[1].trim().replace(/^["']|["']$/g, "");
  if (!isValidUrl(url)) return null;

  // Parse events list: supports inline [a, b] or block list
  let events: NotificationEvent[] = [];
  const eventsInlineMatch = block.match(/[ \t]+events\s*:\s*\[([^\]]*)\]/);
  if (eventsInlineMatch) {
    events = eventsInlineMatch[1]
      .split(",")
      .map((e) => e.trim().replace(/^["']|["']$/g, ""))
      .filter(isValidEvent);
  } else {
    const eventsBlockMatch = block.match(/[ \t]+events\s*:\s*\n((?:[ \t]+-\s*.+\n?)*)/);
    if (eventsBlockMatch) {
      events = eventsBlockMatch[1]
        .split("\n")
        .map((line) => line.replace(/^[ \t]+-\s*/, "").trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
        .filter(isValidEvent);
    }
  }

  // Parse optional headers block
  const headersMatch = block.match(/[ \t]+headers\s*:\s*\n((?:[ \t]+\S.+\n?)*)/);
  const headers: Record<string, string> = {};
  if (headersMatch) {
    for (const line of headersMatch[1].split("\n")) {
      const m = line.match(/[ \t]+(\S[^:]*?)\s*:\s*"?([^"\n]+?)"?\s*$/);
      if (m) headers[m[1].trim()] = m[2].trim();
    }
  }

  return {
    url,
    events,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

// --- Payload formatters ---

const EVENT_COLORS: Record<NotificationEvent, string> = {
  sprint_started: "#0088ff",
  task_completed: "#36a64f",
  sprint_complete: "#36a64f",
  task_escalated: "#cc0000",
  checkpoint_hit: "#0088ff",
  token_budget_exceeded: "#cc0000",
};

const EVENT_EMOJIS: Record<NotificationEvent, string> = {
  sprint_started: ":rocket:",
  task_completed: ":white_check_mark:",
  sprint_complete: ":tada:",
  task_escalated: ":warning:",
  checkpoint_hit: ":checkered_flag:",
  token_budget_exceeded: ":rotating_light:",
};

export function formatSlackPayload(payload: NotificationPayload): object {
  const color = EVENT_COLORS[payload.event];
  const emoji = EVENT_EMOJIS[payload.event];
  const title = `${emoji} ${payload.event.replace(/_/g, " ")}`;
  const fields = Object.entries(payload.data).map(([key, value]) => ({
    title: key,
    value: String(value),
    short: true,
  }));

  return {
    attachments: [
      {
        color,
        title,
        fields: [{ title: "project", value: payload.project, short: true }, ...fields],
        footer: "TeamClaude",
        ts: Math.floor(new Date(payload.timestamp).getTime() / 1000),
      },
    ],
  };
}

export function formatDiscordPayload(payload: NotificationPayload): object {
  const color = parseInt(EVENT_COLORS[payload.event].slice(1), 16);
  const fields = [
    { name: "project", value: payload.project, inline: true },
    ...Object.entries(payload.data).map(([name, value]) => ({
      name,
      value: String(value),
      inline: true,
    })),
  ];

  return {
    embeds: [
      {
        title: payload.event.replace(/_/g, " "),
        color,
        fields,
        timestamp: payload.timestamp,
        footer: { text: "TeamClaude" },
      },
    ],
  };
}

export function formatGenericPayload(payload: NotificationPayload): object {
  return payload;
}

function detectFormat(url: string): "slack" | "discord" | "generic" {
  if (url.includes("hooks.slack.com")) return "slack";
  if (url.includes("discord.com/api/webhooks")) return "discord";
  return "generic";
}

function buildBody(url: string, payload: NotificationPayload): object {
  const format = detectFormat(url);
  if (format === "slack") return formatSlackPayload(payload);
  if (format === "discord") return formatDiscordPayload(payload);
  return formatGenericPayload(payload);
}

// --- Convenience notifier ---

let _webhookConfig: WebhookConfig | null = null;
let _project: string = "";

/** Call once at server start to load config and set project name. */
export function initNotifications(cwd: string, project: string) {
  _webhookConfig = loadWebhookConfig(cwd);
  _project = project;
}

/**
 * Fire-and-forget webhook notification.
 * No-ops if no config or event is not subscribed.
 */
export function notifyWebhook(
  event: NotificationEvent,
  data: Record<string, unknown>
): void {
  if (!_webhookConfig) return;
  if (!_webhookConfig.events.includes(event)) return;

  const payload: NotificationPayload = {
    event,
    timestamp: new Date().toISOString(),
    project: _project,
    data,
  };

  dispatchWebhook(_webhookConfig, payload).catch(() => {});
}

// --- Dispatcher ---

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const REQUEST_TIMEOUT_MS = 5000;

/**
 * POST payload to webhook URL with exponential backoff retry (3 attempts).
 * Returns true on 2xx, false on all failures.
 */
export async function dispatchWebhook(
  config: WebhookConfig,
  payload: NotificationPayload
): Promise<boolean> {
  const body = JSON.stringify(buildBody(config.url, payload));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...config.headers,
  };

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(config.url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
        if (res.ok) return true;
        console.error(`[notifications] webhook ${res.status} on attempt ${attempt + 1}`);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      console.error(`[notifications] webhook error on attempt ${attempt + 1}:`, err);
    }
    if (attempt < RETRY_DELAYS_MS.length - 1) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  return false;
}
