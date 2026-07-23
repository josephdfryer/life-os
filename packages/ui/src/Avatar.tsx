import React from 'react';

export type AvatarSize = 'sm' | 'md' | 'lg';

const sizeMap: Record<AvatarSize, { box: number; font: number }> = {
  sm: { box: 24, font: 10 },
  md: { box: 36, font: 13 },
  lg: { box: 52, font: 18 },
};

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  color?: string;        // background override
  textColor?: string;
  style?: React.CSSProperties;
}

/**
 * Avatar — initials-based
 * Usage: <Avatar name="Kenji Lee" size="md" />
 */
export function Avatar({ name, size = 'md', color, textColor, style }: AvatarProps) {
  const initials = name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const { box, font } = sizeMap[size];

  return (
    <div
      style={{
        width: box,
        height: box,
        borderRadius: '50%',
        background: color ?? 'var(--border)',
        color: textColor ?? 'var(--ink-2)',
        fontFamily: 'var(--font-body)',
        fontSize: font,
        letterSpacing: '0.06em',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        userSelect: 'none',
        ...style,
      }}
    >
      {initials}
    </div>
  );
}
