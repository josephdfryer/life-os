import React, { useRef, useState } from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  icon?: React.ReactNode;   // prefix icon
  clearable?: boolean;
  onClear?: () => void;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
}

/**
 * Input — text field with optional icon prefix and clear button
 * Usage: <Input placeholder="Search accounts…" icon={<SearchIcon />} clearable />
 */
export function Input({ icon, clearable, onClear, value, onChange, style, inputStyle, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        border: `1px solid ${focused ? 'var(--ink-4)' : 'var(--border)'}`,
        background: 'var(--surface)',
        padding: '0 10px',
        gap: 8,
        transition: 'border-color 0.12s',
        ...style,
      }}
    >
      {icon && (
        <span style={{ color: 'var(--ink-4)', display: 'flex', flexShrink: 0, fontSize: 13 }}>{icon}</span>
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          fontWeight: 300,
          color: 'var(--ink-2)',
          padding: '8px 0',
          ...inputStyle,
        }}
        {...rest}
      />
      {clearable && value && (
        <span
          onClick={() => { onClear?.(); inputRef.current?.focus(); }}
          style={{ color: 'var(--ink-4)', cursor: 'pointer', fontSize: 13, lineHeight: 1, userSelect: 'none' }}
        >
          ×
        </span>
      )}
    </div>
  );
}
