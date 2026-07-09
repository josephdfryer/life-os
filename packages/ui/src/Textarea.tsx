"use client";

import React, { useRef, useState, useEffect } from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  maxChars?: number;
  style?: React.CSSProperties;
}

/**
 * Textarea — auto-grow, optional char count
 * Usage: <Textarea placeholder="Add a note…" maxChars={280} />
 */
export function Textarea({ maxChars, value, onChange, style, ...rest }: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const charCount = typeof value === 'string' ? value.length : 0;

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  }, [value]);

  return (
    <div style={{ position: 'relative', ...style }}>
      <textarea
        ref={ref}
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          background: 'var(--surface)',
          border: `1px solid ${focused ? 'var(--ink-4)' : 'var(--border)'}`,
          outline: 'none',
          resize: 'none',
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          fontWeight: 300,
          color: 'var(--ink-2)',
          padding: '8px 10px',
          lineHeight: 1.7,
          minHeight: 72,
          overflow: 'hidden',
          transition: 'border-color 0.12s',
          boxSizing: 'border-box',
        }}
        {...rest}
      />
      {maxChars != null && (
        <span
          style={{
            position: 'absolute',
            bottom: 8,
            right: 10,
            fontFamily: 'var(--font-mono)',
            fontSize: 8,
            letterSpacing: '0.06em',
            color: charCount > maxChars ? 'var(--accent)' : 'var(--ink-4)',
          }}
        >
          {charCount}/{maxChars}
        </span>
      )}
    </div>
  );
}
