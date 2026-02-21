interface RetroData {
  branch?: string;
  retro?: string;
  prSummary?: string;
}

interface RetroModalProps {
  data: RetroData;
  onClose: () => void;
}

export function RetroModal({ data, onClose }: RetroModalProps) {
  return (
    <div className="checkpoint-overlay">
      <div className="checkpoint-modal retro-modal">
        <div className="checkpoint-modal-title">Sprint Complete</div>
        {data.branch && <div className="retro-branch">{data.branch}</div>}
        {data.retro && <div className="retro-body">{data.retro}</div>}
        {data.prSummary && (
          <div className="retro-pr-wrap">
            <div className="retro-pr-label">PR Summary</div>
            <pre className="retro-pr">{data.prSummary}</pre>
          </div>
        )}
        <div className="checkpoint-modal-actions">
          <button className="checkpoint-approve-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
