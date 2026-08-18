import React from 'react';

interface LogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
  showText?: boolean;
  className?: string;
  iconClassName?: string;
  textClassName?: string;
  subtitle?: string;
}

/**
 * Pure SVG Logo Icon for E-SYLLAB
 * Combines:
 * - Protective Shield (Security & Blockchain Trust)
 * - Open Book & Learning Wings (Education & Curriculum)
 * - "E" Monogram with Checkmark (Verification)
 */
export const LogoIcon: React.FC<{ size?: number | string; className?: string }> = ({
  size = 32,
  className = '',
}) => {
  const pixelSize = typeof size === 'number' ? `${size}px` : size;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={pixelSize}
      height={pixelSize}
      className={`shrink-0 ${className}`}
      aria-label="E-SYLLAB Icon"
      role="img"
    >
      <defs>
        <linearGradient id="esyllab-bg-grad-jsx" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="50%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#5B21B6" />
        </linearGradient>

        <linearGradient id="esyllab-e-grad-jsx" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#EDE9FE" />
        </linearGradient>

        <linearGradient id="esyllab-accent-grad-jsx" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#DDD6FE" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#A78BFA" stopOpacity="0.85" />
        </linearGradient>

        <filter id="esyllab-mark-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#3B0764" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* Brand Base Squircle */}
      <rect width="512" height="512" rx="128" fill="url(#esyllab-bg-grad-jsx)" />
      <rect x="6" y="6" width="500" height="500" rx="122" fill="none" stroke="#FFFFFF" strokeWidth="4" strokeOpacity="0.2" />

      {/* Bold Geometric Letter "E" */}
      <g filter="url(#esyllab-mark-shadow)">
        <path
          d="M 148 112 H 368 C 376.8 112 384 119.2 384 128 V 166 C 384 174.8 376.8 182 368 182 H 214 V 218 H 332 C 340.8 218 348 225.2 348 234 V 262 C 348 270.8 340.8 278 332 278 H 214 V 314 H 368 C 376.8 314 384 321.2 384 330 V 368 C 384 376.8 376.8 384 368 384 H 148 C 137 384 128 375 128 364 V 132 C 128 121 137 112 148 112 Z"
          fill="url(#esyllab-e-grad-jsx)"
        />

        {/* Subtle Top-Arm Light Glint Highlight */}
        <path
          d="M 152 114 H 366 C 374 114 380 120 380 128 V 132 C 380 124 374 118 366 118 H 152 C 142 118 134 126 134 136 V 132 C 134 122 142 114 152 114 Z"
          fill="#FFFFFF"
          fillOpacity="0.6"
        />

        {/* Sleek Character Accent Underline / Anchor */}
        <rect
          x="128"
          y="412"
          width="256"
          height="18"
          rx="9"
          fill="url(#esyllab-accent-grad-jsx)"
        />
      </g>
    </svg>
  );
};

export const Logo: React.FC<LogoProps> = ({
  size = 'md',
  showText = true,
  className = '',
  iconClassName = '',
  textClassName = '',
  subtitle,
}) => {
  const sizeMap = {
    xs: { icon: 24, text: 'text-sm', sub: 'text-[9px]' },
    sm: { icon: 28, text: 'text-base', sub: 'text-[10px]' },
    md: { icon: 36, text: 'text-xl', sub: 'text-[11px]' },
    lg: { icon: 48, text: 'text-2xl', sub: 'text-xs' },
    xl: { icon: 64, text: 'text-3xl', sub: 'text-sm' },
  };

  const config = typeof size === 'number' ? { icon: size, text: 'text-xl', sub: 'text-xs' } : sizeMap[size] || sizeMap.md;

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <LogoIcon size={config.icon} className={iconClassName} />
      {showText && (
        <div className="flex flex-col">
          <span className={`font-extrabold tracking-tight text-white leading-none ${config.text} ${textClassName}`}>
            E-SYLLAB
          </span>
          {subtitle && (
            <span className={`font-semibold tracking-wider uppercase text-purple-300/80 mt-1 ${config.sub}`}>
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
export default Logo;
