export function BrandMark({ compact = false }) {
  return (
    <span className={compact ? "brand-symbol compact" : "brand-symbol"}>
      <img src="/brand/2026-theme-identifier-full-color.png" alt="2026 Walk with Me theme identifier" />
    </span>
  );
}
