interface CheckpointModalProps {
  checkpoint: { taskId: string; taskSubject: string };
  onApprove: () => void;
  onSkip: () => void;
}

export function CheckpointModal({ checkpoint, onApprove, onSkip }: CheckpointModalProps) {
  return (
    <div className="checkpoint-overlay">
      <div className="checkpoint-modal">
        <div className="checkpoint-modal-title">Checkpoint</div>
        <div className="checkpoint-modal-task">
          Task #{checkpoint.taskId} — {checkpoint.taskSubject}
        </div>
        <div className="checkpoint-modal-desc">
          This task is ready for your review. Approve to continue the sprint, or skip to move on.
        </div>
        <div className="checkpoint-modal-actions">
          <button className="checkpoint-skip-btn" onClick={onSkip}>
            Skip
          </button>
          <button className="checkpoint-approve-btn" onClick={onApprove}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
