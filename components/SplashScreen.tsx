import React, { useState, useEffect } from 'react';

interface SplashScreenProps {
  isLoading: boolean;
  onAnimationComplete?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  isLoading,
  onAnimationComplete,
}) => {
  const [stage, setStage] = useState<'drawing' | 'pulsing' | 'exiting' | 'hidden'>('drawing');

  // Stage 1 -> Stage 2: Transition from stroke draw (750ms) to pulsing
  useEffect(() => {
    const drawTimer = setTimeout(() => {
      setStage((prev) => (prev === 'drawing' ? 'pulsing' : prev));
    }, 750);

    return () => clearTimeout(drawTimer);
  }, []);

  // When isLoading becomes false, trigger smooth exit
  useEffect(() => {
    if (!isLoading) {
      // Ensure the initial draw phase has had at least a brief moment (650ms)
      // to avoid an abrupt micro-flash if session verification is near-instant
      const exitTimer = setTimeout(() => {
        setStage('exiting');
        const hideTimer = setTimeout(() => {
          setStage('hidden');
          onAnimationComplete?.();
        }, 400); // match exit transition duration
        return () => clearTimeout(hideTimer);
      }, 650);

      return () => clearTimeout(exitTimer);
    }
  }, [isLoading, onAnimationComplete]);

  if (stage === 'hidden') return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0c0a1f] select-none transition-all duration-400 ease-out ${
        stage === 'exiting'
          ? 'opacity-0 scale-105 pointer-events-none'
          : 'opacity-100 scale-100'
      }`}
      role="status"
      aria-label="Loading E-SYLLAB"
    >
      {/* Background ambient glow */}
      <div className="absolute w-96 h-96 rounded-full bg-purple-600/15 blur-[100px] pointer-events-none animate-pulse" />

      {/* Main Animated Logo Container */}
      <div className="relative z-10 flex flex-col items-center">
        <div
          className={`relative flex items-center justify-center ${
            stage === 'pulsing' || stage === 'exiting' ? 'animate-splash-pulse' : ''
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width="120"
            height="120"
            className="shrink-0 overflow-visible"
            aria-hidden="true"
          >
            <defs>
              {/* Drop Shadow Filter */}
              <filter id="splash-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="8" stdDeviation="16" floodColor="#7C3AED" floodOpacity="0.45" />
              </filter>

              {/* Gradient for outer border trace */}
              <linearGradient id="splash-border-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#A78BFA" />
                <stop offset="50%" stopColor="#8B5CF6" />
                <stop offset="100%" stopColor="#6D28D9" />
              </linearGradient>
            </defs>

            {/* Base Background Squircle (Fill fades in during draw) */}
            <rect
              x="8"
              y="8"
              width="496"
              height="496"
              rx="124"
              fill="#7C3AED"
              className="animate-splash-fill"
            />

            {/* Outer Border Trace (Stroke-dasharray draw) */}
            <rect
              x="8"
              y="8"
              width="496"
              height="496"
              rx="124"
              fill="none"
              stroke="url(#splash-border-grad)"
              strokeWidth="12"
              pathLength="1000"
              strokeDasharray="1000"
              className="animate-splash-stroke"
            />

            {/* Monogram E & Accent Baseline */}
            <g filter="url(#splash-shadow)">
              {/* Bold Geometric "E" Stroke Draw & Materialize */}
              <path
                d="M 148 112 H 368 C 376.8 112 384 119.2 384 128 V 166 C 384 174.8 376.8 182 368 182 H 214 V 218 H 332 C 340.8 218 348 225.2 348 234 V 262 C 348 270.8 340.8 278 332 278 H 214 V 314 H 368 C 376.8 314 384 321.2 384 330 V 368 C 384 376.8 376.8 384 368 384 H 148 C 137 384 128 375 128 364 V 132 C 128 121 137 112 148 112 Z"
                fill="#FFFFFF"
                stroke="#FFFFFF"
                strokeWidth="6"
                pathLength="1000"
                strokeDasharray="1000"
                className="animate-splash-stroke-shield"
              />

              {/* Accent Underline / Anchor Bar */}
              <rect
                x="128"
                y="412"
                width="256"
                height="18"
                rx="9"
                fill="#DDD6FE"
                stroke="#DDD6FE"
                strokeWidth="2"
                pathLength="1000"
                strokeDasharray="1000"
                className="animate-splash-stroke-channel-delayed"
              />
            </g>
          </svg>
        </div>

        {/* Brand Name & Subtitle reveal */}
        <div className="mt-8 flex flex-col items-center text-center animate-splash-text">
          <span className="text-2xl font-extrabold tracking-tight text-white">
            E-SYLLAB
          </span>
          <span className="text-xs font-medium text-purple-300/70 tracking-wider uppercase mt-1">
            Secure Educational Infrastructure
          </span>
        </div>

        {/* Minimal loading dot trail */}
        <div className="mt-6 flex items-center gap-1.5 opacity-60">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
          <span className="w-1.5 h-1.5 rounded-full bg-purple-300" />
          <span className="w-1.5 h-1.5 rounded-full bg-purple-200" />
        </div>
      </div>
    </div>
  );
};
