import { getDb } from '../../db/db';
import crypto from 'crypto';

export interface TriviaCategory {
  id: string;
  slug: string;
  name_ar: string;
  description: string | null;
  sort_order: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface CreateCategoryInput {
  slug: string;
  name_ar: string;
  description?: string;
  sort_order?: number;
  is_active?: number;
}

export interface UpdateCategoryInput {
  name_ar?: string;
  description?: string;
  sort_order?: number;
  is_active?: number;
}

const VALID_SLUG_PATTERN = /^[a-z_][a-z0-9_]*$/;

function rowToCategory(row: any): TriviaCategory {
  return {
    id: row.id,
    slug: row.slug,
    name_ar: row.name_ar,
    description: row.description,
    sort_order: row.sort_order,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateSlug(slug: string): void {
  if (!slug || !slug.trim()) {
    throw new Error('Category slug is required');
  }
  if (!VALID_SLUG_PATTERN.test(slug)) {
    throw new Error('Category slug must contain only lowercase letters, numbers, and underscores, starting with a letter or underscore');
  }
}

function validateNameAr(nameAr: string): void {
  if (!nameAr || !nameAr.trim()) {
    throw new Error('Arabic name is required');
  }
  if (nameAr.length > 50) {
    throw new Error('Arabic name must be 50 characters or less');
  }
}

export function getAllCategories(): TriviaCategory[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM trivia_categories ORDER BY sort_order ASC, name_ar ASC').all();
  return rows.map(rowToCategory);
}

export function getActiveCategories(): TriviaCategory[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM trivia_categories WHERE is_active = 1 ORDER BY sort_order ASC, name_ar ASC').all();
  return rows.map(rowToCategory);
}

export function getCategoryById(id: string): TriviaCategory | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trivia_categories WHERE id = ?').get(id);
  return row ? rowToCategory(row) : null;
}

export function getCategoryBySlug(slug: string): TriviaCategory | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trivia_categories WHERE slug = ?').get(slug);
  return row ? rowToCategory(row) : null;
}

export function getCategoryByNameAr(nameAr: string): TriviaCategory | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trivia_categories WHERE name_ar = ?').get(nameAr);
  return row ? rowToCategory(row) : null;
}

export function getCategoryByTextCategory(textCategory: string): TriviaCategory | null {
  // Map legacy text category to canonical category
  const textToSlug: Record<string, string> = {
    'تاريخ': 'history',
    'جغرافيا': 'geography',
    'علوم': 'science',
    'فنون وآداب': 'arts_literature',
    'رياضة': 'sports',
    'تقنية وفضاء': 'technology_space',
    'ألعاب فيديو': 'video_games',
    'ثقافة عامة': 'general_knowledge',
    'ألعاب': 'video_games', // Legacy mapping
  };
  const slug = textToSlug[textCategory];
  if (slug) {
    return getCategoryBySlug(slug);
  }
  return null;
}

export function createCategory(input: CreateCategoryInput): TriviaCategory {
  const db = getDb();
  validateSlug(input.slug);
  validateNameAr(input.name_ar);

  // Check for duplicate slug
  const existingSlug = db.prepare('SELECT id FROM trivia_categories WHERE slug = ?').get(input.slug);
  if (existingSlug) {
    throw new Error(`Category slug '${input.slug}' already exists`);
  }

  // Check for duplicate name_ar
  const existingName = db.prepare('SELECT id FROM trivia_categories WHERE name_ar = ?').get(input.name_ar);
  if (existingName) {
    throw new Error(`Category Arabic name '${input.name_ar}' already exists`);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const sortOrder = input.sort_order ?? 0;
  const isActive = input.is_active ?? 1;

  db.prepare(`
    INSERT INTO trivia_categories (id, slug, name_ar, description, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.slug, input.name_ar, input.description ?? null, sortOrder, isActive, now, now);

  const category = getCategoryById(id);
  if (!category) {
    throw new Error('Failed to retrieve created category');
  }
  return category;
}

export function updateCategory(id: string, input: UpdateCategoryInput): TriviaCategory {
  const db = getDb();

  const existing = getCategoryById(id);
  if (!existing) {
    throw new Error('Category not found');
  }

  // Validate unique constraints if changing
  if (input.name_ar !== undefined && input.name_ar !== existing.name_ar) {
    validateNameAr(input.name_ar);
    const dup = db.prepare('SELECT id FROM trivia_categories WHERE name_ar = ? AND id != ?').get(input.name_ar, id);
    if (dup) {
      throw new Error(`Category Arabic name '${input.name_ar}' already exists`);
    }
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (input.name_ar !== undefined) {
    updates.push('name_ar = ?');
    params.push(input.name_ar);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    params.push(input.description);
  }
  if (input.sort_order !== undefined) {
    updates.push('sort_order = ?');
    params.push(input.sort_order);
  }
  if (input.is_active !== undefined) {
    updates.push('is_active = ?');
    params.push(input.is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);

  db.prepare(`UPDATE trivia_categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const category = getCategoryById(id);
  if (!category) {
    throw new Error('Failed to retrieve updated category');
  }
  return category;
}

export function deactivateCategory(id: string): TriviaCategory {
  const db = getDb();

  const existing = getCategoryById(id);
  if (!existing) {
    throw new Error('Category not found');
  }

  // Check if category has questions
  const questionCount = db.prepare('SELECT COUNT(*) as count FROM trivia_questions WHERE category_id = ?').get(id) as { count: number };
  if (questionCount.count > 0) {
    // Soft deactivate only - don't allow hard delete if questions exist
    return updateCategory(id, { is_active: 0 });
  }

  // If no questions, we could hard delete, but soft deactivate is safer
  return updateCategory(id, { is_active: 0 });
}

export function getCategoryIdByText(textCategory: string): string | null {
  const category = getCategoryByTextCategory(textCategory);
  return category?.id ?? null;
}

export function isValidCategory(textCategory: string): boolean {
  return getCategoryByTextCategory(textCategory) !== null;
}

export function getCanonicalCategories(): string[] {
  return [
    'تاريخ',
    'جغرافيا',
    'علوم',
    'فنون وآداب',
    'رياضة',
    'تقنية وفضاء',
    'ألعاب فيديو',
    'ثقافة عامة',
  ];
}

export function resolveCategory(textCategory: string): { id: string; slug: string; name_ar: string } | null {
  const category = getCategoryByTextCategory(textCategory);
  if (!category) return null;
  return { id: category.id, slug: category.slug, name_ar: category.name_ar };
}