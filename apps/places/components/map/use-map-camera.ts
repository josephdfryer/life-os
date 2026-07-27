"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  clampCamera,
  fitCamera,
  panCamera,
  zoomCameraAt,
  type Camera,
} from "./map-computation"

type CoordinateSource = { id: string; latitude?: number; longitude?: number }

export function useMapCamera(sources: CoordinateSource[], initialSearch: string) {
  const [camera, setCamera] = useState<Camera | null>(() => cameraFromParams(new URLSearchParams(initialSearch)))
  const [mapSize, setMapSize] = useState({ width: 820, height: 620 })
  const mapRef = useRef<HTMLElement>(null)
  const cameraFrameRef = useRef<number | null>(null)
  const pendingCameraRef = useRef<((current: Camera) => Camera) | null>(null)
  const fittedCamera = useMemo(
    () => fitCamera(sources, mapSize.width, mapSize.height),
    [sources, mapSize.height, mapSize.width],
  )
  const fittedCameraRef = useRef(fittedCamera)
  useEffect(() => {
    fittedCameraRef.current = fittedCamera
  }, [fittedCamera])

  const applyCamera = useCallback((updater: (current: Camera) => Camera) => {
    setCamera(previous => {
      const current = previous ?? fittedCameraRef.current
      return current ? clampCamera(updater(current)) : previous
    })
  }, [])

  const scheduleCamera = useCallback((updater: (current: Camera) => Camera) => {
    const pending = pendingCameraRef.current
    pendingCameraRef.current = pending ? current => updater(pending(current)) : updater
    if (cameraFrameRef.current !== null) return
    cameraFrameRef.current = requestAnimationFrame(() => {
      const scheduled = pendingCameraRef.current
      pendingCameraRef.current = null
      cameraFrameRef.current = null
      if (scheduled) applyCamera(scheduled)
    })
  }, [applyCamera])

  useEffect(() => {
    const element = mapRef.current
    if (!element) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0) setMapSize({ width: rect.width, height: Math.max(rect.height, 420) })
    })
    observer.observe(element)

    const panBy = (dx: number, dy: number) => scheduleCamera(current => panCamera(current, dx, dy))
    const zoomAt = (delta: number, clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect()
      scheduleCamera(current => zoomCameraAt(current, delta, clientX - rect.left, clientY - rect.top, rect.width, rect.height))
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) zoomAt(-event.deltaY * 0.022, event.clientX, event.clientY)
      else panBy(event.deltaX, event.deltaY)
    }
    let gestureScale = 1
    const onGestureStart = (event: Event) => { event.preventDefault(); gestureScale = 1 }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const gesture = event as Event & { scale: number; clientX: number; clientY: number }
      const delta = Math.log2(gesture.scale / gestureScale)
      gestureScale = gesture.scale
      zoomAt(delta, gesture.clientX, gesture.clientY)
    }
    let dragging = false
    let lastX = 0
    let lastY = 0
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, a")) return
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      element.setPointerCapture(event.pointerId)
      element.style.cursor = "grabbing"
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      panBy(lastX - event.clientX, lastY - event.clientY)
      lastX = event.clientX
      lastY = event.clientY
    }
    const onPointerUp = (event: PointerEvent) => {
      dragging = false
      element.style.cursor = "grab"
      try { element.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    }
    const onDoubleClick = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest("button, input, a")) return
      event.preventDefault()
      zoomAt(1, event.clientX, event.clientY)
    }

    element.style.cursor = "grab"
    element.style.touchAction = "none"
    element.addEventListener("wheel", onWheel, { passive: false })
    element.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false } as AddEventListenerOptions)
    element.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false } as AddEventListenerOptions)
    element.addEventListener("pointerdown", onPointerDown)
    element.addEventListener("pointermove", onPointerMove)
    element.addEventListener("pointerup", onPointerUp)
    element.addEventListener("pointercancel", onPointerUp)
    element.addEventListener("dblclick", onDoubleClick)
    return () => {
      observer.disconnect()
      element.removeEventListener("wheel", onWheel)
      element.removeEventListener("gesturestart", onGestureStart as EventListener)
      element.removeEventListener("gesturechange", onGestureChange as EventListener)
      element.removeEventListener("pointerdown", onPointerDown)
      element.removeEventListener("pointermove", onPointerMove)
      element.removeEventListener("pointerup", onPointerUp)
      element.removeEventListener("pointercancel", onPointerUp)
      element.removeEventListener("dblclick", onDoubleClick)
      if (cameraFrameRef.current !== null) cancelAnimationFrame(cameraFrameRef.current)
    }
  }, [scheduleCamera])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search)
      if (camera) {
        params.set("lat", camera.lat.toFixed(5))
        params.set("lng", camera.lng.toFixed(5))
        params.set("z", camera.zoom.toFixed(2))
      } else {
        params.delete("lat")
        params.delete("lng")
        params.delete("z")
      }
      const query = params.toString()
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [camera])

  useEffect(() => {
    const restoreCamera = () => setCamera(cameraFromParams(new URLSearchParams(window.location.search)))
    window.addEventListener("popstate", restoreCamera)
    return () => window.removeEventListener("popstate", restoreCamera)
  }, [])

  return {
    mapRef,
    mapSize,
    camera,
    activeCamera: camera ?? fittedCamera,
    applyCamera,
    resetCamera: () => setCamera(null),
  }
}

export function cameraFromParams(params: URLSearchParams): Camera | null {
  if (!params.has("lat") || !params.has("lng") || !params.has("z")) return null
  const lat = Number(params.get("lat"))
  const lng = Number(params.get("lng"))
  const zoom = Number(params.get("z"))
  if (![lat, lng, zoom].every(Number.isFinite)) return null
  return clampCamera({ lat, lng, zoom })
}
