import fs from 'fs';
import path from 'path';
import { computeQuestionHash, normalizeForHash } from './trivia-hash';

interface LegacyQuestion {
  category: string;
  question: string;
  choices: string[];
  correctAnswer: string;
  difficulty: string;
}

export function readLegacyQuestions(): LegacyQuestion[] {
  const legacyPath = path.resolve('src/data/trivia-questions.json');
  if (!fs.existsSync(legacyPath)) {
    console.warn('WARNING: Legacy file not found at', legacyPath);
    return [];
  }
  const raw = fs.readFileSync(legacyPath, 'utf-8');
  return JSON.parse(raw);
}

export function computeLegacyHashes(questions: LegacyQuestion[]): Set<string> {
  const hashes = new Set<string>();
  questions.forEach(q => {
    const hash = computeQuestionHash(q.question, q.choices, q.category, q.difficulty);
    hashes.add(hash);
  });
  return hashes;
}

export function convertLegacyToPilot(q: LegacyQuestion): {
  question: string;
  choices: string[];
  correct_idx: number;
  category: string;
  difficulty: string;
  language: string;
} {
  const correctAnswerMap: Record<string, number> = {
    '1': 0,
    '2': 1,
    '3': 2,
    '4': 3,
  };

  return {
    question: q.question,
    choices: q.choices,
    correct_idx: correctAnswerMap[q.correctAnswer] ?? 0,
    category: q.category,
    difficulty: q.difficulty,
    language: 'ar',
  };
}

export function analyzeLegacy(): {
  total: number;
  uniqueHashes: number;
  categories: Record<string, number>;
  difficulties: Record<string, number>;
  correctIdxDistribution: Record<number, number>;
  hashes: string[];
} {
  const questions = readLegacyQuestions();
  const hashes = questions.map(q => computeQuestionHash(q.question, q.choices, q.category, q.difficulty));
  const uniqueHashes = new Set(hashes);

  const categories: Record<string, number> = {};
  const difficulties: Record<string, number> = {};
  const correctIdxDistribution: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  questions.forEach(q => {
    categories[q.category] = (categories[q.category] || 0) + 1;
    difficulties[q.difficulty] = (difficulties[q.difficulty] || 0) + 1;
    const idx = convertLegacyToPilot(q).correct_idx;
    correctIdxDistribution[idx] = (correctIdxDistribution[idx] || 0) + 1;
  });

  return {
    total: questions.length,
    uniqueHashes: uniqueHashes.size,
    categories,
    difficulties,
    correctIdxDistribution,
    hashes,
  };
}