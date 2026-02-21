import { useEffect, useRef, useState } from "react";

interface Memory {
  id: string;
  role: string;
  key: string;
  value: string;
  sprintId: string | null;
  createdAt: number;
  accessCount: number;
  lastAccessed: number | null;
}

interface MemoryViewerProps {
  onClose: () => void;
}

export function MemoryViewer({ onClose }: MemoryViewerProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState("");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const load = (q: string, role: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    else if (role) params.set("role", role);
    const url = params.toString() ? `/api/memories?${params}` : "/api/memories";
    fetch(url)
      .then((r) => r.json())
      .then((data: Memory[]) => setMemories(data))
      .catch(() => setMemories([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(search, filterRole);
  }, [search, filterRole]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const handleDelete = (id: string) => {
    fetch(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then(() => setMemories((prev) => prev.filter((m) => m.id !== id)))
      .catch(() => {});
  };

  const roles = Array.from(new Set(memories.map((m) => m.role))).sort();

  return (
    <div className="checkpoint-overlay" onClick={onClose}>
      <div
        className="checkpoint-modal"
        style={{ maxWidth: 720, width: "95%", maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 0 16px" }}>
          <div className="checkpoint-modal-title" style={{ flex: 1 }}>Agent Memories</div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              borderRadius: 4,
              padding: "2px 10px",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
          >
            Close
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexShrink: 0 }}>
          <input
            ref={searchRef}
            type="text"
            className="task-search-input"
            placeholder="Search memories..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setFilterRole(""); }}
            onKeyDown={(e) => { if (e.key === "Escape") { if (search) setSearch(""); else onClose(); } }}
            style={{ flex: 1 }}
          />
          {roles.length > 1 && !search && (
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="memory-role-filter"
            >
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {loading ? (
            <div className="empty-state">Loading...</div>
          ) : memories.length === 0 ? (
            <div className="empty-state">
              {search || filterRole ? "No memories match your filter." : "No memories yet."}
            </div>
          ) : (
            <table className="history-table memory-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Sprint</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {memories.map((m) => (
                  <tr key={m.id} className="history-data-row">
                    <td><span className="history-agent-tag">{m.role}</span></td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{m.key}</td>
                    <td style={{ maxWidth: 260, wordBreak: "break-word" }}>{m.value}</td>
                    <td style={{ fontSize: 10, color: "var(--text-muted)" }}>{m.sprintId ?? "—"}</td>
                    <td style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                    <td>
                      <button
                        className="memory-delete-btn"
                        onClick={() => handleDelete(m.id)}
                        title="Delete memory"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
