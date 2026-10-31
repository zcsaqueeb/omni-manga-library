import * as React from "react";

/** OmniLibrary brand mark — open book + bookmark on a violet→fuchsia tile.
 * Inline so it renders crisply at any size in the header/footer. */
export function BrandLogo({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  const uid = React.useId().replace(/[:]/g, "");
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="OmniLibrary logo" {...props}>
      <defs>
        <linearGradient id={`bg-${uid}`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="0.55" stopColor="#a855f7" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
        <linearGradient id={`sheen-${uid}`} x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="15" fill={`url(#bg-${uid})`} />
      <rect width="64" height="64" rx="15" fill={`url(#sheen-${uid})`} />

      <path
        d="M32 21.2C28.2 18.5 23.6 17 18 17h-1.6a1.4 1.4 0 0 0-1.4 1.4v24.2A1.4 1.4 0 0 0 16.4 44H18c5.6 0 10.2 1.5 14 4.2 3.8-2.7 8.4-4.2 14-4.2h1.6a1.4 1.4 0 0 0 1.4-1.4V18.4A1.4 1.4 0 0 0 47.6 17H46c-5.6 0-10.2 1.5-14 4.2Z"
        fill="#ffffff"
        opacity="0.97"
      />
      <path d="M32 21.5V48" stroke="#a855f7" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M20.5 25.5c3.4.3 6.4 1.1 9 2.4" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9" />
      <path d="M20.5 31c3.4.3 6.4 1.1 9 2.4" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9" />
      <path d="M43.5 25.5c-3.4.3-6.4 1.1-9 2.4" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9" />
      <path d="M43.5 31c-3.4.3-6.4 1.1-9 2.4" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9" />
      <path
        d="M39 17h7.2v12.6l-3.6-3-3.6 3V17Z"
        fill="#f0abfc"
        stroke="#d946ef"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
