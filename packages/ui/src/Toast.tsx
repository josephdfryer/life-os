"use client";

import React, { useEffect, useRef, useState } from 'react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastProps {
  message: string;
  variant?: ToastVariant;
  duration?: number;      // ms before auto-dismiss. 0 = no auto-dismiss
  onDismiss?: () => void;
  style?: React.CSSProperties;
}

const variantMeta: Record<ToastVariant, { label: string; color: string }> = {
  success: { label: 'ok',    color: 'var(--status-done)' },
  error:   { label: 'error', color: 'var(--accent)' },
  info:    { label: 'info',  color: 'var(--ink-4)' },
};

/**
 * Toast — auto-dismissing notification
 * Usage: <Toast message="Saved." variant="success" onDismiss={() => setShow(false)} />
 *
 * Position it with a fixed container in your app shell; this component is the
 * toast itself, not the container.
 */
export function Toast({ message, variant = 'info', duration = 4000, onDismiss, style }: ToastProps) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { label, color } = variantMeta[variant];

  useEffect(() => {
    if (duration > 0) {
      timer.current = setTimeout(() => {
        setVisible(false);
        onDismiss?.();
      }, duration);
    }
    return () => clearTimeout(timer.current);
  }, [duration, onDismiss]);

  if (!visible) return null;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${color}`,
        padding: '10px 14px',
        minWidth: 240,
        maxWidth: 360,
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 8,
          letterSpacing: '0.14em',
          color,
          textTransform: 'uppercase',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          fontWeight: 300,
          color: 'var(--ink-2)',
          flex: 1,
        }}
      >
        {message}
      </span>
      <span
        onClick={() => { setVisible(false); onDismiss?.(); }}
        style={{ color: 'var(--ink-4)', cursor: 'pointer', fontSize: 13, lineHeight: 1, userSelect: 'none' }}
      >
        ×
      </span>
    </div>
  );
}

/**
 * ToastStack — fixed container, bottom-right
 * Wrap your app with this and manage toasts via state.
 */
export function ToastStack({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 9999,
      }}
    >
      {children}
    </div>
  );
}
