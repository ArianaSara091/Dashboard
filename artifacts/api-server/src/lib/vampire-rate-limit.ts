import type { RequestHandler } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let operations = 0;

export function memoryRateLimit(
  name: string,
  limit: number,
  windowMs: number,
): RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip ?? "unknown"}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    operations += 1;
    if (operations % 500 === 0) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
      if (buckets.size > 20_000) buckets.clear();
    }

    if (bucket.count > limit) {
      res.setHeader(
        "Retry-After",
        Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      );
      res.status(429).json({ error: "Too many requests. Try again shortly." });
      return;
    }
    next();
  };
}
