import React from 'react';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const variantBase: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: 'var(--accent)', color: '#fff', border: '1px solid transparent' },
  ghost:   { background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--border)' },
  danger:  { background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)' },
};

const sizeBase: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: '5px 12px', fontSize: 9 },
  md: { padding: '8px 16px', fontSize: 11 },
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  style?: React.CSSProperties;
}

/**
 * Button — primary / ghost / danger, sm/md, with loading state
 * Usage: <Button variant="primary" size="md">Save</Button>
 *        <Button variant="ghost" loading>Saving…</Button>
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  style,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      style={{
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        borderRadius: 0,
        transition: 'opacity 0.12s',
        ...variantBase[variant],
        ...sizeBase[size],
        ...style,
      }}
      {...rest}
    >
      {loading && <Spinner size={10} />}
      {children}
    </button>
  );
}

// inline spinner used by Button — also exported from Spinner.tsx
function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      style={{ animation: 'spin 0.7s linear infinite', flexShrink: 0 }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="24" strokeDashoffset="8" strokeLinecap="round" />
    </svg>
  );
}
