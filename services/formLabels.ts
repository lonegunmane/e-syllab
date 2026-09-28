/**
 * Zambia School Standard Terminology Helpers
 * Form 1, Form 2, Form 3, Form 4, Form 5 (Secondary School)
 * Classes: Class A, Class B, Class C
 */

export const FORM_OPTIONS = ['Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5'] as const;
export const CLASS_LETTERS = ['A', 'B', 'C'] as const;
export const CLASS_OPTIONS = ['Class A', 'Class B', 'Class C'] as const;

export const GRADE_TO_FORM_MAP: Record<string, string> = {
  'Grade 8': 'Form 1',
  'Grade 9': 'Form 2',
  'Grade 10': 'Form 3',
  'Grade 11': 'Form 4',
  'Grade 12': 'Form 5',
  'GRADE_8': 'Form 1',
  'GRADE_9': 'Form 2',
  'GRADE_10': 'Form 3',
  'GRADE_11': 'Form 4',
  'GRADE_12': 'Form 5',
  '8': 'Form 1',
  '9': 'Form 2',
  '10': 'Form 3',
  '11': 'Form 4',
  '12': 'Form 5',
  'All Grades': 'All Forms',
};

/**
 * Normalizes legacy Grade strings (e.g. "Grade 9", "GRADE_10", "Grade 10A") to standard Zambian Forms ("Form 2", "Form 3", "Form 3A").
 */
export function normalizeGradeToForm(val?: string | null): string {
  if (!val) return '';
  const trimmed = val.trim();

  if (GRADE_TO_FORM_MAP[trimmed]) {
    return GRADE_TO_FORM_MAP[trimmed];
  }

  // Regex replacement for patterns like "Grade 8A", "Grade 10-A", "GRADE_9"
  const match = trimmed.match(/^(?:grade|form)[_\s-]*(\d+)(.*)$/i);
  if (match) {
    const num = match[1];
    const suffix = match[2] ? match[2].trim() : '';
    const formNum = num === '8' ? '1' : num === '9' ? '2' : num === '10' ? '3' : num === '11' ? '4' : num === '12' ? '5' : num;
    return `Form ${formNum}${suffix ? ' ' + suffix.replace(/^[-_\s]+/, '') : ''}`.trim();
  }

  return trimmed;
}

/**
 * Compares two grade/form strings, treating legacy "Grade 10" and "Form 3" as equivalent matches.
 */
export function formsMatch(a?: string | null, b?: string | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const cleanA = a.trim();
  const cleanB = b.trim();

  if (cleanA.toLowerCase() === cleanB.toLowerCase()) return true;

  const isAllA = cleanA === 'All Forms' || cleanA === 'All Grades' || cleanA === 'All Classes' || cleanA === 'ALL';
  const isAllB = cleanB === 'All Forms' || cleanB === 'All Grades' || cleanB === 'All Classes' || cleanB === 'ALL';
  if (isAllA || isAllB) return true;

  const normA = normalizeGradeToForm(cleanA).toLowerCase();
  const normB = normalizeGradeToForm(cleanB).toLowerCase();

  return normA === normB;
}

/**
 * Restricts selectable classes strictly to Class A, Class B, Class C (filtering out Class D and Class E).
 */
export function filterValidClasses(classes?: string[] | null): string[] {
  if (!classes || !Array.isArray(classes)) return ['Class A', 'Class B', 'Class C'];
  const disallowed = new Set(['D', 'E', 'Class D', 'Class E', 'd', 'e', 'class d', 'class e']);
  const filtered = classes.filter(c => !disallowed.has(c.trim()));
  return filtered.length > 0 ? filtered : ['Class A', 'Class B', 'Class C'];
}
