type MapOperation = "viewport" | "clustering" | "coordinate_projection"

export function measureMapOperation<T>(
  operation: MapOperation,
  itemCount: number,
  run: () => T,
  slowThresholdMs = 16,
) {
  const startedAt = performance.now()
  const result = run()
  const durationMs = performance.now() - startedAt
  if (durationMs >= slowThresholdMs) {
    console.warn("[places-map] slow operation", {
      operation,
      itemCount,
      durationMs: Math.round(durationMs * 10) / 10,
    })
  }
  return result
}
