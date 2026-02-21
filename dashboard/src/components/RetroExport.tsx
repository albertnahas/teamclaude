import { useState } from "react";

interface RetroExportProps {
  retroAvailable: boolean;
  sprintId?: string;
}

type Toast = { message: string; ok: boolean };

export function RetroExport({ retroAvailable, sprintId }: RetroExportProps) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [gistLoading, setGistLoading] = useState(false);

  function showToast(message: string, ok: boolean) {
    setToast({ message, ok });
    setTimeout(() => setToast(null), 2500);
  }

  async function copyMd() {
    const url = sprintId ? `/api/history/${sprintId}/retro?format=md` : "/api/retro?format=md";
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Not available");
      await navigator.clipboard.writeText(await res.text());
      showToast("Markdown copied", true);
    } catch {
      showToast("Failed to copy", false);
    }
  }

  async function copyJson() {
    const url = sprintId ? `/api/history/${sprintId}/retro?format=json` : "/api/retro?format=json";
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Not available");
      await navigator.clipboard.writeText(await res.text());
      showToast("JSON copied", true);
    } catch {
      showToast("Failed to copy", false);
    }
  }

  async function openGist() {
    setGistLoading(true);
    try {
      const body = sprintId ? JSON.stringify({ sprintId }) : undefined;
      const res = await fetch("/api/retro/gist", {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : {},
        body,
      });
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Failed");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      showToast(err.message ?? "Gist creation failed", false);
    } finally {
      setGistLoading(false);
    }
  }

  function viewSvg() {
    window.open("/api/velocity.svg", "_blank", "noopener,noreferrer");
  }

  const disabled = !retroAvailable;

  return (
    <div className="retro-export-toolbar">
      <button
        className="retro-export-btn"
        onClick={copyMd}
        disabled={disabled}
        title="Copy retro as Markdown"
      >
        Copy MD
      </button>
      <button
        className="retro-export-btn"
        onClick={copyJson}
        disabled={disabled}
        title="Copy retro as JSON"
      >
        Copy JSON
      </button>
      <button
        className="retro-export-btn"
        onClick={openGist}
        disabled={disabled || gistLoading}
        title="Publish retro to GitHub Gist"
      >
        {gistLoading ? "Creating..." : "Open Gist"}
      </button>
      <button
        className="retro-export-btn retro-export-btn--secondary"
        onClick={viewSvg}
        title="Open velocity chart SVG"
      >
        View SVG
      </button>

      {toast && (
        <span className={`retro-export-toast ${toast.ok ? "retro-export-toast--ok" : "retro-export-toast--err"}`}>
          {toast.message}
        </span>
      )}
    </div>
  );
}
