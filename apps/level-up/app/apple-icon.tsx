import { ImageResponse } from "next/og"

// The Add to Home Screen icon on iOS. Generated rather than committed as a
// binary so it stays in the design system: concrete ground, one vermillion
// rule, no gradient, no rounded corner (iOS applies its own mask).
export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#1E1C18",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <div style={{ color: "#E9E3D7", fontSize: 78, letterSpacing: -2 }}>LU</div>
        <div style={{ background: "#C4522A", height: 3, marginTop: 12, width: 62 }} />
      </div>
    ),
    size,
  )
}
