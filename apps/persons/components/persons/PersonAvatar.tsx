import { initials } from "@/lib/colors"

type Props = {
  first: string
  last: string
  color: string | null
  colorSoft: string | null
  size?: number
  fontSize?: number
}

export default function PersonAvatar({
  first,
  last,
  color,
  colorSoft,
  size = 36,
  fontSize = 13,
}: Props) {
  const bg = colorSoft ?? "#eeebe3"
  const fg = color ?? "#4a4640"
  const text = initials(first, last)

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: bg,
      color: fg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize,
      fontWeight: 500,
      letterSpacing: "0.02em",
      flexShrink: 0,
      border: `1.5px solid ${fg}22`,
    }}>
      {text}
    </div>
  )
}
