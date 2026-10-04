"use client";

import { useEffect } from "react";
import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  detail,
  confirmText = "确认删除",
  cancelText = "取消",
  isDanger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="confirm-modal-overlay"
      onClick={e => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="confirm-modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <div className="confirm-modal-header">
          <div className={`confirm-modal-icon ${isDanger ? "danger" : "warning"}`}>
            {isDanger ? <Trash2 size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div>
            <h3 id="confirm-modal-title">{title}</h3>
            <p className="confirm-modal-desc">{message}</p>
          </div>
        </div>
        {detail && <div className="confirm-modal-detail">{detail}</div>}
        <div className="confirm-modal-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={isDanger ? "btn-action-danger-solid" : "primary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy && <LoaderCircle className="spin" size={14} />}
            <span>{busy ? "正在处理…" : confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
