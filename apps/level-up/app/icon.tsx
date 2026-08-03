import { ImageResponse } from "next/og"

export const size = { width: 512, height: 512 }
export const contentType = "image/png"

export default function Icon() {
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
        <div style={{ color: "#E9E3D7", fontSize: 224, letterSpacing: -6 }}>LU</div>
        <div style={{ background: "#C4522A", height: 8, marginTop: 34, width: 176 }} />
      </div>
    ),
    size,
  )
}
