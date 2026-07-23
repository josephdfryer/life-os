import React from 'react';

export interface ProgressBarProps {
  value: number;          // 0–100
  color?: string;         // fill color override
  trackColor?: string;
  height?: number;
  style?: React.CSSProperties;
}

/**
 * ProgressBar — thin horizontal bar
 * Usage: <ProgressBar value={72} color="var(--accent)" />
 */
export function ProgressBar({
  value,
  color = 'var(--status-done)',
  trackColor = 'var(--border)',
  height = 4,
  style,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      style={{
        width: '100%',
        height,
        background: trackColor,
        borderRadius: 'var(--radius-pill)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          width: `${clamped}%`,
          height: '100%',
          background: color,
          borderRadius: 'var(--radius-pill)',
          transition: 'width 0.25s ease',
        }}
      />
    </div>
  );
}
