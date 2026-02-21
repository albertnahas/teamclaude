import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { WebhookConfig, NotificationPayload } from "./notifications.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `tc-notif-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSprintYml(dir: string, content: string) {
  writeFileSync(join(dir, ".sprint.yml"), content, "utf-8");
}

// ─── Config parsing ───────────────────────────────────────────────────────────

describe("loadWebhookConfig", () => {
  let dir: string;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns null when no .sprint.yml exists", async () => {
    const { loadWebhookConfig } = await import("./notifications.js");
    expect(loadWebhookConfig(dir)).toBeNull();
  });

  it("returns null when no notifications section", async () => {
    const { loadWebhookConfig } = await import("./notifications.js");
    writeSprintYml(dir, "agents:\n  model: sonnet\n");
    expect(loadWebhookConfig(dir)).toBeNull();
  });

  it("returns null when webhook URL is missing from notifications section", async () => {
    const { loadWebhookConfig } = await import("./notifications.js");
    writeSprintYml(dir, "notifications:\n  events: [sprint_started]\n");
    expect(loadWebhookConfig(dir)).toBeNull();
  });

  it("returns null for invalid (non-http/https) URL", async () => {
    const { loadWebhookConfig } = await import("./notifications.js");
    writeSprintYml(dir, "notifications:\n  webhook: ftp://example.com/hook\n");
    expect(loadWebhookConfig(dir)).toBeNull();
  });

  it("returns null for malformed YAML that produces no URL match", async () => {
    const { loadWebhookConfig } = await import("./notifications.js");
    writeSprintYml(dir, "notifications:\n  !!invalid yaml {{{");
    expect(loadWebhookConfig(dir)).toBeNull();
  });

  it("loads valid config with http URL", async () => {
    const { loadWebhookConfig } = await import("./notifications.js");
    writeSprintYml(dir, [
      "notifications:",
      "  webhook: https://hooks.slack.com/services/T00/B00/xxx",
    ].join("\n"));
    const cfg = loadWebhookConfig(dir);
    expect(cfg).not.toBeNull();
    expect(cfg!.url).toBe("https://hooks.slack.com/services/T00/B00/xxx");
  });

  it("defaults to all events when events array is omitted", async () => {
    const { loadWebhookConfig } = await import("./notifications.js");
    writeSprintYml(dir, "notifications:\n  webhook: https://example.com/hook\n");
    const cfg = loadWebhookConfig(dir);
    expect(cfg!.events).toEqual([]);
  });

  it("parses inline events array", async () => {
    const { loadWebhookConfig } = await import("./notifications.js");
    writeSprintYml(dir, [
      "notifications:",
      "  webhook: https://example.com/hook",
      "  events: [task_escalated, sprint_complete]",
    ].join("\n"));
    const cfg = loadWebhookConfig(dir);
    expect(cfg!.events).toEqual(["task_escalated", "sprint_complete"]);
  });

  it("filters out unknown event names", async () => {
    const { loadWebhookConfig } = await import("./notifications.js");
    writeSprintYml(dir, [
      "notifications:",
      "  webhook: https://example.com/hook",
      "  events: [task_escalated, unknown_event, sprint_complete]",
    ].join("\n"));
    const cfg = loadWebhookConfig(dir);
    expect(cfg!.events).toEqual(["task_escalated", "sprint_complete"]);
  });

  it("parses custom headers", async () => {
    const { loadWebhookConfig } = await import("./notifications.js");
    writeSprintYml(dir, [
      "notifications:",
      "  webhook: https://example.com/hook",
      "  headers:",
      '    Authorization: "Bearer secret-token"',
      "    X-Team: myteam",
    ].join("\n"));
    const cfg = loadWebhookConfig(dir);
    expect(cfg!.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "X-Team": "myteam",
    });
  });

  it("returns no headers key when headers block is absent", async () => {
    const { loadWebhookConfig } = await import("./notifications.js");
    writeSprintYml(dir, "notifications:\n  webhook: https://example.com/hook\n");
    const cfg = loadWebhookConfig(dir);
    expect(cfg!.headers).toBeUndefined();
  });
});

// ─── Payload formatters ───────────────────────────────────────────────────────

describe("formatSlackPayload", () => {
  it("returns attachments with correct color for task_escalated", async () => {
    const { formatSlackPayload } = await import("./notifications.js");
    const payload: NotificationPayload = {
      event: "task_escalated",
      timestamp: new Date().toISOString(),
      project: "my-project",
      data: { taskId: "1", reason: "stuck" },
    };
    const result = formatSlackPayload(payload) as any;
    expect(result.attachments).toBeDefined();
    expect(result.attachments[0].color).toBe("#cc0000");
    expect(result.attachments[0].title).toContain("task escalated");
  });

  it("returns attachments with correct color for sprint_complete", async () => {
    const { formatSlackPayload } = await import("./notifications.js");
    const payload: NotificationPayload = {
      event: "sprint_complete",
      timestamp: new Date().toISOString(),
      project: "my-project",
      data: {},
    };
    const result = formatSlackPayload(payload) as any;
    expect(result.attachments[0].color).toBe("#36a64f");
  });

  it("includes project field in attachments", async () => {
    const { formatSlackPayload } = await import("./notifications.js");
    const payload: NotificationPayload = {
      event: "sprint_started",
      timestamp: new Date().toISOString(),
      project: "awesome-project",
      data: {},
    };
    const result = formatSlackPayload(payload) as any;
    const fields: any[] = result.attachments[0].fields;
    expect(fields.some((f: any) => f.title === "project" && f.value === "awesome-project")).toBe(true);
  });

  it("maps data keys to fields", async () => {
    const { formatSlackPayload } = await import("./notifications.js");
    const payload: NotificationPayload = {
      event: "task_completed",
      timestamp: new Date().toISOString(),
      project: "proj",
      data: { taskId: "5", agent: "eng-1" },
    };
    const result = formatSlackPayload(payload) as any;
    const fields: any[] = result.attachments[0].fields;
    expect(fields.some((f: any) => f.title === "taskId" && f.value === "5")).toBe(true);
    expect(fields.some((f: any) => f.title === "agent" && f.value === "eng-1")).toBe(true);
  });
});

describe("formatDiscordPayload", () => {
  it("returns embeds with correct numeric color for task_escalated", async () => {
    const { formatDiscordPayload } = await import("./notifications.js");
    const payload: NotificationPayload = {
      event: "task_escalated",
      timestamp: new Date().toISOString(),
      project: "my-project",
      data: {},
    };
    const result = formatDiscordPayload(payload) as any;
    expect(result.embeds).toBeDefined();
    // #cc0000 → 13369344
    expect(result.embeds[0].color).toBe(parseInt("cc0000", 16));
  });

  it("includes project and data as inline fields", async () => {
    const { formatDiscordPayload } = await import("./notifications.js");
    const payload: NotificationPayload = {
      event: "sprint_started",
      timestamp: new Date().toISOString(),
      project: "proj",
      data: { cycle: "2" },
    };
    const result = formatDiscordPayload(payload) as any;
    const fields: any[] = result.embeds[0].fields;
    expect(fields.some((f: any) => f.name === "project")).toBe(true);
    expect(fields.some((f: any) => f.name === "cycle")).toBe(true);
    expect(fields.every((f: any) => f.inline === true)).toBe(true);
  });

  it("sets title from event name with spaces", async () => {
    const { formatDiscordPayload } = await import("./notifications.js");
    const payload: NotificationPayload = {
      event: "sprint_complete",
      timestamp: new Date().toISOString(),
      project: "proj",
      data: {},
    };
    const result = formatDiscordPayload(payload) as any;
    expect(result.embeds[0].title).toBe("sprint complete");
  });
});

describe("formatGenericPayload", () => {
  it("returns the payload unchanged", async () => {
    const { formatGenericPayload } = await import("./notifications.js");
    const payload: NotificationPayload = {
      event: "checkpoint_hit",
      timestamp: "2026-01-01T00:00:00.000Z",
      project: "proj",
      data: { taskId: "3" },
    };
    expect(formatGenericPayload(payload)).toBe(payload);
  });
});

describe("auto-detection of format in dispatchWebhook", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const makePayload = (event = "sprint_started" as const): NotificationPayload => ({
    event,
    timestamp: new Date().toISOString(),
    project: "proj",
    data: {},
  });

  it("uses Slack format for hooks.slack.com URLs", async () => {
    const { dispatchWebhook } = await import("./notifications.js");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    const cfg: WebhookConfig = {
      url: "https://hooks.slack.com/services/T00/B00/xxx",
      events: [],
    };
    await dispatchWebhook(cfg, makePayload());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toHaveProperty("attachments");
  });

  it("uses Discord format for discord.com/api/webhooks URLs", async () => {
    const { dispatchWebhook } = await import("./notifications.js");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    const cfg: WebhookConfig = {
      url: "https://discord.com/api/webhooks/123/abc",
      events: [],
    };
    await dispatchWebhook(cfg, makePayload());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toHaveProperty("embeds");
  });

  it("uses generic format for other URLs", async () => {
    const { dispatchWebhook } = await import("./notifications.js");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    const cfg: WebhookConfig = {
      url: "https://custom.example.com/webhook",
      events: [],
    };
    await dispatchWebhook(cfg, makePayload());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toHaveProperty("event");
    expect(body).toHaveProperty("project");
  });
});

// ─── Dispatcher ───────────────────────────────────────────────────────────────

describe("dispatchWebhook", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const cfg: WebhookConfig = { url: "https://example.com/hook", events: [] };
  const payload: NotificationPayload = {
    event: "sprint_started",
    timestamp: new Date().toISOString(),
    project: "proj",
    data: {},
  };

  it("returns true on successful 2xx POST", async () => {
    const { dispatchWebhook } = await import("./notifications.js");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    const result = await dispatchWebhook(cfg, payload);
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends Content-Type application/json header", async () => {
    const { dispatchWebhook } = await import("./notifications.js");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    await dispatchWebhook(cfg, payload);
    const opts = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("merges custom headers into request", async () => {
    const { dispatchWebhook } = await import("./notifications.js");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    const cfgWithHeaders: WebhookConfig = {
      ...cfg,
      headers: { Authorization: "Bearer tok" },
    };
    await dispatchWebhook(cfgWithHeaders, payload);
    const opts = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
  });

  it("returns false on non-2xx response after all retries", async () => {
    const { dispatchWebhook } = await import("./notifications.js");
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    const promise = dispatchWebhook(cfg, payload);
    // Advance through all retry delays
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries: fails twice then succeeds on third attempt", async () => {
    const { dispatchWebhook } = await import("./notifications.js");
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    const promise = dispatchWebhook(cfg, payload);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not throw on network error — returns false", async () => {
    const { dispatchWebhook } = await import("./notifications.js");
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    const promise = dispatchWebhook(cfg, payload);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(false);
  });

  it("handles timeout by aborting the request and retrying", async () => {
    const { dispatchWebhook } = await import("./notifications.js");
    // Simulate timeout: fetch rejects with AbortError
    vi.mocked(fetch).mockRejectedValue(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    const promise = dispatchWebhook(cfg, payload);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

// ─── notifyWebhook (convenience) ─────────────────────────────────────────────

describe("notifyWebhook", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("no-ops when no webhook config (no .sprint.yml)", async () => {
    // Use a directory without .sprint.yml
    const emptyDir = makeTmpDir();
    try {
      const mod = await import("./notifications.js");
      mod.initNotifications(emptyDir, "proj");
      mod.notifyWebhook("sprint_started", {});
      // No fetch calls expected
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("no-ops when event is not in subscribed events list", async () => {
    const dir = makeTmpDir();
    try {
      writeSprintYml(dir, [
        "notifications:",
        "  webhook: https://example.com/hook",
        "  events: [sprint_complete]",
      ].join("\n"));
      const mod = await import("./notifications.js");
      mod.initNotifications(dir, "proj");
      mod.notifyWebhook("sprint_started", {});
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fires fetch when config has empty events (default = all events allowed)", async () => {
    const dir = makeTmpDir();
    try {
      writeSprintYml(dir, "notifications:\n  webhook: https://example.com/hook\n");
      const mod = await import("./notifications.js");
      mod.initNotifications(dir, "proj");
      // empty events array means 0 subscriptions — notifyWebhook checks includes()
      // which returns false for any event, so fetch should NOT be called
      mod.notifyWebhook("sprint_started", {});
      // events:[] means nothing subscribed
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fires fetch when event matches subscribed events", async () => {
    const dir = makeTmpDir();
    try {
      writeSprintYml(dir, [
        "notifications:",
        "  webhook: https://example.com/hook",
        "  events: [sprint_started, task_escalated]",
      ].join("\n"));
      const mod = await import("./notifications.js");
      mod.initNotifications(dir, "proj");
      mod.notifyWebhook("sprint_started", { teamName: "alpha" });
      // fire-and-forget: allow microtasks to run
      await vi.runAllTimersAsync();
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
