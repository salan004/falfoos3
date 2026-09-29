/**
 * Admin Control & Permissions — inline SVG icons.
 *
 * The project has no icon library, so these are real vector icons (not Unicode
 * emoji) used for locked admin sections and the moderator controls.
 */

interface IconProps {
  size?: number;
  className?: string;
  'aria-hidden'?: boolean;
}

export function LockIcon({ size = 22, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest['aria-hidden'] ?? true}
      focusable="false"
    >
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15.2" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ShieldIcon({ size = 22, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest['aria-hidden'] ?? true}
      focusable="false"
    >
      <path d="M12 3l7 3v5.2c0 4.3-2.9 7.6-7 9.3-4.1-1.7-7-5-7-9.3V6l7-3z" />
      <path d="M9.3 12.2l1.9 1.9 3.6-3.8" />
    </svg>
  );
}
