import { useState } from 'react';

/**
 * Official FalFoos branding asset path. The image file is added later; until
 * then the component falls back cleanly to the "FalFoos" wordmark — no
 * placeholder glyphs, no fake logo.
 *
 * Phase 12b: `wordmarkFallback={false}` renders NOTHING when the image is
 * missing — used by the header, which owns its own single brand label
 * (prevents the duplicated «FalFoos FalFoos»).
 */
export const FALFOOS_LOGO_PATH = '/assets/images/branding/falfoos-logo.png';

interface BrandLogoProps {
  size?: number;
  wordmarkFallback?: boolean;
  className?: string;
}

export function BrandLogo({ size = 34, wordmarkFallback = true, className }: BrandLogoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    if (!wordmarkFallback) return null;
    return <span className="brand-text">FalFoos</span>;
  }

  return (
    <img
      className={`brand-logo${className ? ` ${className}` : ''}`}
      src={FALFOOS_LOGO_PATH}
      alt="FalFoos"
      width={size + 16}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}
