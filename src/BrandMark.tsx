// Logo: a parts sheet — three spec rows, the first one marked.
export function BrandMark() {
  return <svg className="brand-mark-svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect className="brand-mark-tile" width="32" height="32" rx="9" />
    <rect className="brand-mark-dot" x="7.5" y="8.5" width="4" height="4" rx="1.2" />
    <rect className="brand-mark-row" x="14" y="9" width="10.5" height="3" rx="1.5" />
    <rect className="brand-mark-row dim" x="7.5" y="14.5" width="17" height="3" rx="1.5" />
    <rect className="brand-mark-row dim" x="7.5" y="20" width="12" height="3" rx="1.5" />
  </svg>;
}
