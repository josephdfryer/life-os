export function localReviewEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.LIFE_OS_LOCAL_REVIEW === "1"
}
