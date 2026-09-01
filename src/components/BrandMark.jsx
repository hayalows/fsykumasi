export function BrandMark({ compact = false }) {
  return (
    <span className={compact ? "brand-symbol compact" : "brand-symbol"} aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img">
        <path d="M10 48C8 42 9 34 13 27L27 5c3-5 9-6 14-3l10 6c5 3 7 9 5 14L45 47c-2 5-7 8-13 8H22c-6 0-10-2-12-7Z" fill="#BED7A7" />
        <path d="M21 52c-6-2-9-8-6-14L28 12c3-6 10-8 15-4l10 8c4 3 5 9 3 13L46 50c-2 4-6 6-11 6H27c-2 0-4-1-6-2Z" fill="#C4E9F5" />
        <path d="M16 50 34 18c2-4 8-4 10 0l17 29c3 5-1 11-7 11H23c-6 0-10-4-7-8Z" fill="#005175" />
        <circle cx="49" cy="12" r="9" fill="#FCB449" />
      </svg>
    </span>
  );
}
