import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalLine {
  agentName: string;
  paneIndex: number;
  content: string;
}

interface TerminalViewProps {
  agentName: string;
  lines: TerminalLine[];
  onBack: () => void;
  /** 0-based pane index selected, or null for all */
  paneIndex: number | null;
  availablePanes: { agentName: string | null; paneIndex: number }[];
}

export function TerminalView({ agentName, lines, onBack, paneIndex, availablePanes }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [selectedPane, setSelectedPane] = useState<number | null>(paneIndex);

  const agentPanes = availablePanes.filter(
    (p) => p.agentName === agentName || p.agentName === null
  );

  // Initialise terminal once
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#000000",
        foreground: "#e8edf5",
        cursor: "#06b6d4",
        selectionBackground: "rgba(6,182,212,0.3)",
      },
      fontFamily: "IBM Plex Mono, Fira Code, monospace",
      fontSize: 12,
      lineHeight: 1.4,
      scrollback: 5000,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Write new lines to terminal, resetting on pane switch
  const writtenRef = useRef(0);
  const prevPaneRef = useRef(selectedPane);
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    // Reset on pane switch
    if (prevPaneRef.current !== selectedPane) {
      prevPaneRef.current = selectedPane;
      term.clear();
      writtenRef.current = 0;
    }

    const filtered = selectedPane === null
      ? lines.filter((l) => l.agentName === agentName)
      : lines.filter((l) => l.agentName === agentName && l.paneIndex === selectedPane);

    // If filter shrunk (shouldn't happen outside pane switch), reset
    if (filtered.length < writtenRef.current) {
      term.clear();
      writtenRef.current = 0;
    }

    for (let i = writtenRef.current; i < filtered.length; i++) {
      term.write(filtered[i].content);
    }
    writtenRef.current = filtered.length;
  }, [lines, agentName, selectedPane]);

  // Handle resize
  useEffect(() => {
    const fit = fitRef.current;
    if (!fit) return;
    const ro = new ResizeObserver(() => fit.fit());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const paneHint =
    agentPanes.length > 1
      ? `${agentPanes.length} panes`
      : agentPanes[0]
        ? `pane ${agentPanes[0].paneIndex}`
        : "";

  return (
    <div className="terminal-view active">
      <div className="terminal-header">
        <button className="terminal-back-btn" onClick={onBack}>
          ← Back
        </button>
        <span className="terminal-agent-name">{agentName}</span>
        {agentPanes.length > 1 && (
          <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
            <button
              className="terminal-back-btn"
              style={selectedPane === null ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
              onClick={() => setSelectedPane(null)}
            >
              All
            </button>
            {agentPanes.map((p) => (
              <button
                key={p.paneIndex}
                className="terminal-back-btn"
                style={selectedPane === p.paneIndex ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
                onClick={() => setSelectedPane(p.paneIndex)}
              >
                {p.paneIndex}
              </button>
            ))}
          </div>
        )}
        {paneHint && (
          <span className="terminal-pane-hint">{paneHint}</span>
        )}
      </div>
      <div className="terminal-container" ref={containerRef} />
    </div>
  );
}
