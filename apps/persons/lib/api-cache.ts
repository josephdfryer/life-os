/**
 * Simple in-memory cache for API requests to reduce duplicate fetches
 */

type CacheEntry<T> = {
  data: T
  timestamp: number
}

class RequestCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private pendingRequests = new Map<string, Promise<unknown>>()
  private readonly TTL = 60_000 // 1 minute cache TTL

  /**
   * Get cached data if available and not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined
    if (!entry) return null
    
    const age = Date.now() - entry.timestamp
    if (age > this.TTL) {
      this.cache.delete(key)
      return null
    }
    
    return entry.data
  }

  /**
   * Set data in cache
   */
  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    })
  }

  /**
   * Deduplicate concurrent requests to the same endpoint
   */
  async dedupe<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    // Return cached data if available
    const cached = this.get<T>(key)
    if (cached !== null) return cached

    // Return pending request if one exists
    const pending = this.pendingRequests.get(key)
    if (pending) return pending as Promise<T>

    // Create new request
    const request = fetcher()
      .then(data => {
        this.set(key, data)
        this.pendingRequests.delete(key)
        return data
      })
      .catch(error => {
        this.pendingRequests.delete(key)
        throw error
      })

    this.pendingRequests.set(key, request)
    return request
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidate(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear()
    this.pendingRequests.clear()
  }
}

export const apiCache = new RequestCache()

/**
 * Fetch with deduplication and caching
 */
export async function fetchWithCache<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const cacheKey = `${url}:${JSON.stringify(options ?? {})}`
  
  return apiCache.dedupe(cacheKey, async () => {
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response.json()
  })
}

/**
 * Prefetch data in the background
 */
export function prefetch(url: string, options?: RequestInit): void {
  // Non-blocking prefetch
  fetchWithCache(url, options).catch(() => {
    // Ignore errors for prefetch
  })
}
