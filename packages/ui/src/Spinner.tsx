import React from 'react';

export interface SpinnerProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}

/**
 * Spinner — inline loading indicator
 * Usage: <Spinner size={20} />
 */
export function Spinner({ size = 18, color = 'currentColor', style }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      style={{
        animation: 'ui-spin 0.7s linear infinite',
        flexShrink: 0,
        color: color,
        ...style,
      }}
    >
      <style>{`@keyframes ui-spin { to { transform: rotate(360deg); } }`}</style>
      <circle
        cx="9"
        cy="9"
        r="7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="30"
        strokeDashoffset="10"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}
