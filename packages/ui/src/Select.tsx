"use client";

import React, { useState } from 'react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  style?: React.CSSProperties;
}

/**
 * Select — styled native select
 * Usage:
 *   <Select value={stage} onChange={e => setStage(e.target.value)}>
 *     <option value="discovery">Discovery</option>
 *     <option value="proposal">Proposal</option>
 *   </Select>
 */
export function Select({ style, children, ...rest }: SelectProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div style={{ position: 'relative', display: 'inline-block', ...style }}>
      <select
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          background: 'var(--surface)',
          border: `1px solid ${focused ? 'var(--cognac, var(--accent))' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          boxShadow: focused ? '0 0 0 3px var(--cognac-soft, var(--accent-soft))' : 'var(--shadow-sm)',
          outline: 'none',
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          color: 'var(--ink)',
          padding: '10px 36px 10px 14px',
          width: '100%',
          cursor: 'pointer',
          transition: 'border-color 0.12s, box-shadow 0.12s',
        }}
        {...rest}
      >
        {children}
      </select>
      {/* chevron */}
      <span
        style={{
          position: 'absolute',
          right: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          color: 'var(--ink-4)',
          fontSize: 11,
          fontFamily: 'var(--font-body)',
        }}
      >
        ▾
      </span>
    </div>
  );
}
