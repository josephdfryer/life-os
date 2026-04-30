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
          border: `1px solid ${focused ? 'var(--ink-4)' : 'var(--border)'}`,
          outline: 'none',
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          fontWeight: 300,
          color: 'var(--ink-2)',
          padding: '7px 32px 7px 10px',
          width: '100%',
          cursor: 'pointer',
          transition: 'border-color 0.12s',
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
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
        }}
      >
        ▾
      </span>
    </div>
  );
}
