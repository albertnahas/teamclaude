import { useState, useEffect } from "react";
import type { Theme } from "../hooks/useTheme";

interface SetupConfig {
  engineers: number;
  includePM: boolean;
  cycles: number;
}

interface SprintTemplate {
  id: string;
  name: string;
  description: string;
  agents: { roles: string[]; model?: string };
  cycles: number;
  roadmap: string;
}

interface SetupPhaseProps {
  onLaunch: (roadmap: string, config: SetupConfig) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

const ROLE_COLORS: Record<string, string> = {
  engineer: "var(--accent)",
  qa: "var(--green)",
  pm: "var(--purple)",
  "security-auditor": "var(--amber)",
};

function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? "var(--text-muted)";
}

function configFromTemplate(template: SprintTemplate): SetupConfig {
  const roles = template.agents.roles;
  const engineers = roles.filter((r) => r === "engineer").length || 1;
  const includePM = roles.includes("pm");
  return { engineers, includePM, cycles: template.cycles };
}

export function SetupPhase({ onLaunch, theme, onToggleTheme }: SetupPhaseProps) {
  const [roadmap, setRoadmap] = useState("");
  const [config, setConfig] = useState<SetupConfig>({ engineers: 1, includePM: false, cycles: 1 });
  const [templates, setTemplates] = useState<SprintTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null); // null = "Custom"

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((data: SprintTemplate[]) => setTemplates(data))
      .catch(() => {});
  }, []);

  function selectTemplate(t: SprintTemplate) {
    setSelectedTemplate(t.id);
    setRoadmap(t.roadmap);
    setConfig(configFromTemplate(t));
  }

  function selectCustom() {
    setSelectedTemplate(null);
    setRoadmap("");
    setConfig({ engineers: 1, includePM: false, cycles: 1 });
  }

  const handleLaunch = () => onLaunch(roadmap, config);

  return (
    <div className="setup-phase">
      <div className="setup-top">
        <span className="setup-title">Sprint</span>
        <span className="setup-subtitle">AI-powered sprint management</span>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          style={{ marginLeft: "auto" }}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>

      {/* Template picker row */}
      <div className="setup-templates">
        {/* Custom card */}
        <button
          className={`template-card template-card--custom ${selectedTemplate === null ? "template-card--selected" : ""}`}
          onClick={selectCustom}
        >
          <div className="template-card-name">Custom</div>
          <div className="template-card-desc">Start from a blank roadmap</div>
        </button>

        {templates.map((t) => (
          <button
            key={t.id}
            className={`template-card ${selectedTemplate === t.id ? "template-card--selected" : ""}`}
            onClick={() => selectTemplate(t)}
          >
            <div className="template-card-name">{t.name}</div>
            <div className="template-card-desc">{t.description}</div>
            <div className="template-card-chips">
              {t.agents.roles.map((role, i) => (
                <span
                  key={i}
                  className="template-role-chip"
                  style={{ borderColor: roleColor(role), color: roleColor(role) }}
                >
                  {role}
                </span>
              ))}
            </div>
            <div className="template-card-meta">
              {t.cycles} cycle{t.cycles !== 1 ? "s" : ""}
            </div>
          </button>
        ))}
      </div>

      <div className="setup-main">
        <div className="setup-panel">
          <div className="panel-label">Team Config</div>
          <div className="setup-controls">
            <div className="setup-control">
              <span>Engineers</span>
              <div className="stepper">
                <button
                  className="stepper-btn"
                  onClick={() => setConfig((c) => ({ ...c, engineers: Math.max(1, c.engineers - 1) }))}
                >
                  −
                </button>
                <span>{config.engineers}</span>
                <button
                  className="stepper-btn"
                  onClick={() => setConfig((c) => ({ ...c, engineers: Math.min(8, c.engineers + 1) }))}
                >
                  +
                </button>
              </div>
            </div>
            <div className="setup-control">
              <span>Include PM</span>
              <button
                className={`toggle-btn ${config.includePM ? "active" : ""}`}
                onClick={() => setConfig((c) => ({ ...c, includePM: !c.includePM }))}
              >
                {config.includePM ? "ON" : "OFF"}
              </button>
            </div>
            <div className="setup-control">
              <span>Cycles</span>
              <div className="stepper">
                <button
                  className="stepper-btn"
                  onClick={() => setConfig((c) => ({ ...c, cycles: Math.max(1, c.cycles - 1) }))}
                >
                  −
                </button>
                <span>{config.cycles}</span>
                <button
                  className="stepper-btn"
                  onClick={() => setConfig((c) => ({ ...c, cycles: Math.min(10, c.cycles + 1) }))}
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="setup-panel setup-roadmap">
          <div className="panel-label">Roadmap</div>
          <textarea
            value={roadmap}
            onChange={(e) => setRoadmap(e.target.value)}
            placeholder="Describe what you want to build..."
          />
        </div>
      </div>

      <div className="setup-bottom">
        <button className="launch-btn" onClick={handleLaunch} disabled={!roadmap.trim()}>
          Launch Sprint
        </button>
      </div>
    </div>
  );
}
