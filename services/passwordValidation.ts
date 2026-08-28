export interface PasswordRule {
  id: 'length' | 'lowercase' | 'uppercase' | 'number' | 'special';
  label: string;
  met: boolean;
}

export interface PasswordValidationResult {
  isValid: boolean;
  rules: PasswordRule[];
  missingRequirements: string[];
  errorMessage: string;
  strengthScore: number; // 0 to 5
}

/**
 * Validates password strength according to E-SYLLAB security policy:
 * - 6–15 characters long
 * - At least one lowercase letter (a-z)
 * - At least one uppercase letter (A-Z)
 * - At least one number (0-9)
 * - At least one special character (symbol/punctuation)
 */
export function validatePassword(password: string): PasswordValidationResult {
  const pwd = typeof password === 'string' ? password : '';

  const lengthMet = pwd.length >= 6 && pwd.length <= 15;
  const lowerMet = /[a-z]/.test(pwd);
  const upperMet = /[A-Z]/.test(pwd);
  const numberMet = /\d/.test(pwd);
  const specialMet = /[^A-Za-z0-9]/.test(pwd);

  const rules: PasswordRule[] = [
    { id: 'length', label: '6–15 characters long', met: lengthMet },
    { id: 'lowercase', label: 'At least one lowercase letter (a–z)', met: lowerMet },
    { id: 'uppercase', label: 'At least one uppercase letter (A–Z)', met: upperMet },
    { id: 'number', label: 'At least one number (0–9)', met: numberMet },
    { id: 'special', label: 'At least one special character (!@#$%^&*)', met: specialMet },
  ];

  const missingRequirements: string[] = [];
  if (!lengthMet) {
    missingRequirements.push('be 6-15 characters long');
  }
  if (!lowerMet) {
    missingRequirements.push('include at least one lowercase letter');
  }
  if (!upperMet) {
    missingRequirements.push('include at least one uppercase letter');
  }
  if (!numberMet) {
    missingRequirements.push('include at least one number');
  }
  if (!specialMet) {
    missingRequirements.push('include at least one special character');
  }

  const isValid = lengthMet && lowerMet && upperMet && numberMet && specialMet;
  const strengthScore = [lengthMet, lowerMet, upperMet, numberMet, specialMet].filter(Boolean).length;

  let errorMessage = '';
  if (!isValid) {
    const hasLength = !lengthMet;
    const otherMissing = missingRequirements
      .filter((m) => m !== 'be 6-15 characters long')
      .map((m) => m.replace(/^include /, ''));

    if (hasLength && otherMissing.length === 0) {
      errorMessage = 'Password must be 6-15 characters long.';
    } else if (hasLength && otherMissing.length > 0) {
      if (otherMissing.length === 1) {
        errorMessage = `Password must be 6-15 characters long and include ${otherMissing[0]}.`;
      } else {
        const last = otherMissing[otherMissing.length - 1];
        const rest = otherMissing.slice(0, -1).join(', ');
        errorMessage = `Password must be 6-15 characters long and include ${rest}, and ${last}.`;
      }
    } else {
      if (otherMissing.length === 1) {
        errorMessage = `Password must include ${otherMissing[0]}.`;
      } else {
        const last = otherMissing[otherMissing.length - 1];
        const rest = otherMissing.slice(0, -1).join(', ');
        errorMessage = `Password must include ${rest} and ${last}.`;
      }
    }
  }

  return {
    isValid,
    rules,
    missingRequirements,
    errorMessage,
    strengthScore,
  };
}
