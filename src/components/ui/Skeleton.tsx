// Loading placeholder — shimmer bars replacing "Loading…" text where a shape
// hint helps. Respects prefers-reduced-motion via the global CSS guard.
export function Skeleton({ lines = 3, height = '2.2rem' }: { lines?: number; height?: string }) {
  return (
    <div className="skeleton-stack" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height, opacity: 1 - i * 0.18 }}
        />
      ))}
    </div>
  )
}
