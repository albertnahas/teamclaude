import { useEffect, useRef } from "react";
import type { Message } from "../types";

interface MessageFeedProps {
  messages: Message[];
}

// Protocol tag → CSS class mapping (mirrors ui.html .proto-* classes)
const PROTOCOL_COLORS: Record<string, { bg: string; color: string }> = {
  TASK_ASSIGNED:    { bg: "#1e3a5f", color: "#60a5fa" },
  READY_FOR_REVIEW: { bg: "#1a3a2a", color: "#4ade80" },
  APPROVED:         { bg: "#14532d", color: "#22c55e" },
  REQUEST_CHANGES:  { bg: "#451a03", color: "#fb923c" },
  RESUBMIT:         { bg: "#1a3a2a", color: "#86efac" },
  ESCALATE:         { bg: "#450a0a", color: "#f87171" },
  ROADMAP_READY:    { bg: "#2e1065", color: "#c4b5fd" },
  CYCLE_COMPLETE:   { bg: "#1e3a5f", color: "#60a5fa" },
  SPRINT_COMPLETE:  { bg: "#1e3a5f", color: "#60a5fa" },
  ACCEPTANCE:       { bg: "#14532d", color: "#22c55e" },
  NEXT_CYCLE:       { bg: "#2e1065", color: "#c4b5fd" },
};

const SENDER_COLORS: Record<string, string> = {
  manager:   "#60a5fa",
  engineer:  "#4ade80",
  pm:        "#c4b5fd",
  system:    "var(--text-secondary)",
};

function senderColor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("manager")) return SENDER_COLORS.manager;
  if (lower.includes("engineer")) return SENDER_COLORS.engineer;
  if (lower.includes("pm") || lower.includes("product")) return SENDER_COLORS.pm;
  if (lower === "system") return SENDER_COLORS.system;
  return "var(--accent)";
}

function extractProtocolTag(content: string): string | null {
  for (const tag of Object.keys(PROTOCOL_COLORS)) {
    if (content.startsWith(tag)) return tag;
  }
  return null;
}

function MessageRow({ message }: { message: Message }) {
  const tag = extractProtocolTag(message.content);
  const tagStyle = tag ? PROTOCOL_COLORS[tag] : null;

  return (
    <div className="message-row">
      <div className="message-meta">
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: senderColor(message.from) }}>
          {message.from}
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>→</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-secondary)" }}>
          {message.to}
        </span>
        {tag && tagStyle && (
          <span
            className="message-protocol"
            style={{ background: tagStyle.bg, color: tagStyle.color }}
          >
            {tag}
          </span>
        )}
        <span className="message-time">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </div>
      <div className="message-content">{message.content}</div>
    </div>
  );
}

export function MessageFeed({ messages }: MessageFeedProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // Only auto-scroll if already near the bottom
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div className="panel messages-panel">
      <div className="panel-header">
        <span>Messages</span>
        {messages.length > 0 && (
          <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
            {messages.length}
          </span>
        )}
      </div>
      <div className="messages-list" ref={listRef}>
        {messages.length === 0 ? (
          <div className="empty-state">No messages yet</div>
        ) : (
          messages.map((msg) => <MessageRow key={msg.id} message={msg} />)
        )}
      </div>
    </div>
  );
}
