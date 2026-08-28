import React, { useMemo } from 'react';
import { Check, Circle } from 'lucide-react';
import { validatePassword } from '../services/passwordValidation';

interface PasswordStrengthIndicatorProps {
  password: string;
  className?: string;
  showAlways?: boolean;
}

export const PasswordStrengthIndicator: React.FC<PasswordStrengthIndicatorProps> = ({
  password,
  className = '',
  showAlways = false,
}) => {
  const result = useMemo(() => validatePassword(password), [password]);
  const hasTyped = password.length > 0;

  // Determine strength level & color (Always execute hooks at the top level before any early return)
  const strengthMeta = useMemo(() => {
    if (result.strengthScore <= 2) {
      return {
        label: 'Weak',
        color: 'text-rose-400',
        barBg: 'bg-rose-500',
        border: 'border-rose-500/20',
      };
    }
    if (result.strengthScore <= 4) {
      return {
        label: 'Moderate',
        color: 'text-amber-400',
        barBg: 'bg-amber-500',
        border: 'border-amber-500/20',
      };
    }
    return {
      label: 'Strong',
      color: 'text-emerald-400',
      barBg: 'bg-emerald-500',
      border: 'border-emerald-500/20',
    };
  }, [result.strengthScore]);

  if (!hasTyped && !showAlways) {
    return null;
  }

  return (
    <div className={`p-3.5 bg-black/25 backdrop-blur-sm rounded-xl border border-white/10 text-xs space-y-2.5 transition-all animate-in fade-in duration-200 ${className}`}>
      {/* Header & Strength Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-semibold">
          <span className="text-slate-400">Security Requirements</span>
          {hasTyped && (
            <span className={`font-bold uppercase tracking-wider text-[10px] ${strengthMeta.color}`}>
              {strengthMeta.label} ({result.strengthScore}/5)
            </span>
          )}
        </div>

        {/* 5-segment strength bar */}
        <div className="grid grid-cols-5 gap-1 h-1.5 w-full">
          {[1, 2, 3, 4, 5].map((seg) => (
            <div
              key={seg}
              className={`h-full rounded-full transition-all duration-300 ${
                hasTyped && seg <= result.strengthScore
                  ? strengthMeta.barBg
                  : 'bg-white/10'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Rules Checklist */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
        {result.rules.map((rule) => (
          <div
            key={rule.id}
            className={`flex items-center gap-1.5 text-[11px] transition-colors duration-200 ${
              rule.met ? 'text-emerald-300 font-medium' : 'text-slate-400'
            }`}
          >
            {rule.met ? (
              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" strokeWidth={2.5} />
            ) : (
              <Circle className="w-3 h-3 text-slate-500 shrink-0 opacity-60" strokeWidth={2} />
            )}
            <span className="leading-tight">{rule.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
export default PasswordStrengthIndicator;
