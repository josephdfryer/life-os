"use client"

import { useState, useRef } from "react"

type Props = {
  onFiles: (files: File[]) => void
  disabled?: boolean
}

const ACCEPTED = [".json", ".txt", ".mbox", ".pdf"]

export default function DropZone({ onFiles, disabled }: Props) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer.files).filter(f =>
      ACCEPTED.some(ext => f.name.endsWith(ext))
    )
    if (files.length) onFiles(files)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length) onFiles(files)
    e.target.value = ""
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "12px",
        padding: "40px 24px",
        textAlign: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        background: dragging ? "var(--accent-soft)" : "transparent",
        transition: "all 0.15s",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED.join(",")}
        onChange={handleChange}
        style={{ display: "none" }}
      />
      <div style={{ fontSize: "28px", marginBottom: "10px" }}>↑</div>
      <div style={{ color: "var(--ink)", fontSize: "14px", marginBottom: "6px" }}>
        Drop files here or click to browse
      </div>
      <div style={{ color: "var(--ink-3)", fontSize: "11px" }}>
        Supports .json, .txt, .mbox, .pdf
      </div>
    </div>
  )
}
