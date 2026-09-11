import { ValidationIssue, ValidatedQuestion } from './types';

export interface DistributionResult {
  issues: ValidationIssue[];
  distribution: {
    categories: Record<string, number>;
    difficulties: Record<string, number>;
    correctIdx: Record<number, number>;
  };
}

export function validateDistribution(
  questions: ValidatedQuestion[],
  options: {
    softBounds?: {
      category?: Record<string, { min: number; max: number }>;
      difficulty?: Record<string, { min: number; max: number }>;
      correctIdx?: Record<number, { min: number; max: number }>;
    };
    globalTargets?: {
      category?: Record<string, number>;
      difficulty?: Record<string, number>;
      correctIdx?: Record<number, number>;
    };
  } = {}
): DistributionResult {
  const issues: ValidationIssue[] = [];
  const { softBounds = {}, globalTargets = {} } = options;

  const categories: Record<string, number> = {};
  const difficulties: Record<string, number> = {};
  const correctIdx: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  questions.forEach((q, index) => {
    categories[q.category] = (categories[q.category] || 0) + 1;
    difficulties[q.difficulty] = (difficulties[q.difficulty] || 0) + 1;
    correctIdx[q.correct_idx] = (correctIdx[q.correct_idx] || 0) + 1;

    // Check per-question soft bounds
    if (softBounds.category?.[q.category]) {
      const bounds = softBounds.category[q.category];
      const current = categories[q.category];
      if (current > bounds.max) {
        issues.push({
          code: 'CATEGORY_SOFT_BOUND_EXCEEDED',
          severity: 'WARNING',
          message: `Category '${q.category}' exceeds soft bound max of ${bounds.max} (current: ${current})`,
          questionIndex: index,
          field: 'category',
        });
      }
    }
    if (softBounds.difficulty?.[q.difficulty]) {
      const bounds = softBounds.difficulty[q.difficulty];
      const current = difficulties[q.difficulty];
      if (current > bounds.max) {
        issues.push({
          code: 'DIFFICULTY_SOFT_BOUND_EXCEEDED',
          severity: 'WARNING',
          message: `Difficulty '${q.difficulty}' exceeds soft bound max of ${bounds.max} (current: ${current})`,
          questionIndex: index,
          field: 'difficulty',
        });
      }
    }
    if (softBounds.correctIdx?.[q.correct_idx]) {
      const bounds = softBounds.correctIdx[q.correct_idx];
      const current = correctIdx[q.correct_idx];
      if (current > bounds.max) {
        issues.push({
          code: 'CORRECT_IDX_SOFT_BOUND_EXCEEDED',
          severity: 'WARNING',
          message: `correct_idx ${q.correct_idx} exceeds soft bound max of ${bounds.max} (current: ${current})`,
          questionIndex: index,
          field: 'correct_idx',
        });
      }
    }
  });

  // Check global targets (for reporting, not blocking)
  if (Object.keys(globalTargets).length > 0) {
    if (globalTargets.category) {
      Object.entries(globalTargets.category).forEach(([cat, target]) => {
        const actual = categories[cat] || 0;
        const tolerance = Math.max(1, Math.round(target * 0.1));
        if (actual < target - tolerance || actual > target + tolerance) {
          issues.push({
            code: 'GLOBAL_CATEGORY_DRIFT',
            severity: 'WARNING',
            message: `Global category '${cat}' drift: ${actual} vs target ${target} (±${tolerance})`,
            field: 'category',
          });
        }
      });
    }
    if (globalTargets.difficulty) {
      Object.entries(globalTargets.difficulty).forEach(([diff, target]) => {
        const actual = difficulties[diff] || 0;
        const tolerance = Math.max(1, Math.round(target * 0.1));
        if (actual < target - tolerance || actual > target + tolerance) {
          issues.push({
            code: 'GLOBAL_DIFFICULTY_DRIFT',
            severity: 'WARNING',
            message: `Global difficulty '${diff}' drift: ${actual} vs target ${target} (±${tolerance})`,
            field: 'difficulty',
          });
        }
      });
    }
    if (globalTargets.correctIdx) {
      Object.entries(globalTargets.correctIdx).forEach(([idxStr, target]) => {
        const idx = parseInt(idxStr, 10);
        const actual = correctIdx[idx] || 0;
        const tolerance = Math.max(1, Math.round(target * 0.1));
        if (actual < target - tolerance || actual > target + tolerance) {
          issues.push({
            code: 'GLOBAL_CORRECT_IDX_DRIFT',
            severity: 'WARNING',
            message: `Global correct_idx ${idx} drift: ${actual} vs target ${target} (±${tolerance})`,
            field: 'correct_idx',
          });
        }
      });
    }
  }

  return {
    issues,
    distribution: { categories, difficulties, correctIdx },
  };
}