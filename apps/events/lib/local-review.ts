export function localReviewEnabled() {
  return process.env.LIFE_OS_LOCAL_REVIEW === "1" && process.env.NODE_ENV !== "production"
}