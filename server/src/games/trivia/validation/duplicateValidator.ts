import { ValidationIssue, ValidatedQuestion } from './types';

export interface DuplicateCheckResult {
  issues: ValidationIssue[];
  exactDuplicates: Array<{ indices: number[]; question: string }>;
  hashDuplicates: Array<{ hash: string; indices: number[] }>;
  legacyCollisions: number;
  pilotCollisions: number;
  previousBatchCollisions: number;
  duplicateHashes: Set<string>;
}

export function checkDuplicates(
  questions: ValidatedQuestion[],
  options: {
    legacyHashes?: Set<string>;
    pilotHashes?: Set<string>;
    previousBatchHashes?: Set<string>;
  } = {}
): DuplicateCheckResult {
  const issues: ValidationIssue[] = [];
  const { legacyHashes = new Set(), pilotHashes = new Set(), previousBatchHashes = new Set() } = options;

  // Exact duplicates (question + choices + category + difficulty)
  const exactSeen = new Map<string, number[]>();
  questions.forEach((q, i) => {
    const key = `${q.normalized.question}|${q.normalized.choices.join('|')}|${q.normalized.category}|${q.normalized.difficulty}`;
    if (!exactSeen.has(key)) exactSeen.set(key, []);
    exactSeen.get(key)!.push(i);
  });

  const exactDuplicates: Array<{ indices: number[]; question: string }> = [];
  exactSeen.forEach((indices, key) => {
    if (indices.length > 1) {
      exactDuplicates.push({ indices, question: questions[indices[0]].question });
      indices.forEach(idx => {
        issues.push({
          code: 'EXACT_DUPLICATE',
          severity: 'ERROR',
          message: `Exact duplicate of question at index ${indices[0]}`,
          questionIndex: idx,
          field: 'question',
        });
      });
    }
  });

  // Hash duplicates (intra-batch)
  const hashSeen = new Map<string, number[]>();
  questions.forEach((q, i) => {
    if (!hashSeen.has(q.hash)) hashSeen.set(q.hash, []);
    hashSeen.get(q.hash)!.push(i);
  });

  const hashDuplicates: Array<{ hash: string; indices: number[] }> = [];
  hashSeen.forEach((indices, hash) => {
    if (indices.length > 1) {
      hashDuplicates.push({ hash, indices });
      indices.forEach(idx => {
        issues.push({
          code: 'HASH_DUPLICATE',
          severity: 'ERROR',
          message: `Hash duplicate of question at index ${indices[0]}`,
          questionIndex: idx,
          field: 'hash',
        });
      });
    }
  });

  // Legacy collisions
  let legacyCollisions = 0;
  questions.forEach((q, i) => {
    if (legacyHashes.has(q.hash)) {
      legacyCollisions++;
      issues.push({
        code: 'LEGACY_COLLISION',
        severity: 'ERROR',
        message: 'Question hash collides with legacy dataset',
        questionIndex: i,
        field: 'hash',
      });
    }
  });

  // Pilot collisions
  let pilotCollisions = 0;
  questions.forEach((q, i) => {
    if (pilotHashes.has(q.hash)) {
      pilotCollisions++;
      issues.push({
        code: 'PILOT_COLLISION',
        severity: 'ERROR',
        message: 'Question hash collides with pilot dataset',
        questionIndex: i,
        field: 'hash',
      });
    }
  });

  // Previous batch collisions
  let previousBatchCollisions = 0;
  questions.forEach((q, i) => {
    if (previousBatchHashes.has(q.hash)) {
      previousBatchCollisions++;
      issues.push({
        code: 'PREVIOUS_BATCH_COLLISION',
        severity: 'ERROR',
        message: 'Question hash collides with previously approved batch',
        questionIndex: i,
        field: 'hash',
      });
    }
  });

  // Collect all duplicate hashes
  const duplicateHashes = new Set<string>();
  hashDuplicates.forEach(d => duplicateHashes.add(d.hash));
  exactDuplicates.forEach(d => duplicateHashes.add(questions[d.indices[0]].hash));
  questions.forEach(q => {
    if (legacyHashes.has(q.hash) || pilotHashes.has(q.hash) || previousBatchHashes.has(q.hash)) {
      duplicateHashes.add(q.hash);
    }
  });

  return {
    issues,
    exactDuplicates,
    hashDuplicates,
    legacyCollisions,
    pilotCollisions,
    previousBatchCollisions,
    duplicateHashes,
  };
}