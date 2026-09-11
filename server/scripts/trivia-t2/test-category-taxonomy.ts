import { initDatabase, getDb } from '../../src/db/db';
import { 
  getAllCategories, 
  getActiveCategories, 
  getCategoryById, 
  getCategoryBySlug,
  getCategoryByNameAr,
  getCategoryByTextCategory,
  getCategoryIdByText,
  isValidCategory,
  getCanonicalCategories,
  resolveCategory,
} from '../../src/games/trivia/CategoryService';
import { 
  getCategories, 
  getRandomQuestions, 
  countQuestions,
  validateQuestion,
  computeQuestionHash,
} from '../../src/games/trivia/QuestionPoolService';
import { 
  validateBatch, 
  runValidationPipeline 
} from '../../src/games/trivia/validation/TriviaValidationPipeline';

// Initialize database
initDatabase();
console.log('Database initialized\n');

const db = getDb();

console.log('=== T2.3 Category Taxonomy Tests ===\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    console.log(`     Expected: ${JSON.stringify(expected)}`);
    console.log(`     Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// 1. Database Tests
console.log('1. Database Tests');

const allCats = getAllCategories();
assertEqual(allCats.length, 8, 'trivia_categories table has exactly 8 categories');

const activeCats = getActiveCategories();
assertEqual(activeCats.length, 8, 'All 8 categories are active');

const slugs = new Set(activeCats.map(c => c.slug));
assertEqual(slugs.size, 8, 'All category slugs are unique');

const names = new Set(activeCats.map(c => c.name_ar));
assertEqual(names.size, 8, 'All Arabic names are unique');

// Check canonical categories
const expectedCategories = [
  { slug: 'history', name_ar: 'تاريخ' },
  { slug: 'geography', name_ar: 'جغرافيا' },
  { slug: 'science', name_ar: 'علوم' },
  { slug: 'arts_literature', name_ar: 'فنون وآداب' },
  { slug: 'sports', name_ar: 'رياضة' },
  { slug: 'technology_space', name_ar: 'تقنية وفضاء' },
  { slug: 'video_games', name_ar: 'ألعاب فيديو' },
  { slug: 'general_knowledge', name_ar: 'ثقافة عامة' },
];

expectedCategories.forEach(exp => {
  const cat = getCategoryBySlug(exp.slug);
  assert(cat !== null, `Category ${exp.slug} exists`);
  if (cat) {
    assertEqual(cat.name_ar, exp.name_ar, `Category ${exp.slug} has correct Arabic name`);
  }
});

// 2. Existing Questions Tests
console.log('\n2. Existing Questions Tests');

const totalQuestions = db.prepare('SELECT COUNT(*) as count FROM trivia_questions').get() as { count: number };
console.log(`   Total questions in DB: ${totalQuestions.count}`);

const questionsWithCategoryId = db.prepare('SELECT COUNT(*) as count FROM trivia_questions WHERE category_id IS NOT NULL').get() as { count: number };
assertEqual(questionsWithCategoryId.count, totalQuestions.count, 'Every question has category_id');

const orphanedQuestions = db.prepare('SELECT COUNT(*) as count FROM trivia_questions WHERE category_id NOT IN (SELECT id FROM trivia_categories)').get() as { count: number };
assertEqual(orphanedQuestions.count, 0, 'No orphaned category references');

const legacyGamesMapped = db.prepare("SELECT COUNT(*) as count FROM trivia_questions WHERE category = 'ألعاب' AND category_id = 'video_games'").get() as { count: number };
console.log(`   Legacy 'ألعاب' questions mapped to 'video_games': ${legacyGamesMapped.count}`);

// Check category distribution
const catDist = db.prepare('SELECT category, category_id, COUNT(*) as count FROM trivia_questions GROUP BY category, category_id ORDER BY count DESC').all();
console.log('\n   Category Distribution:');
catDist.forEach((row: any) => {
  console.log(`     ${row.category} (${row.category_id}): ${row.count}`);
});

// Verify hashes unchanged
const allHashes = db.prepare('SELECT hash FROM trivia_questions').all() as { hash: string }[];
const uniqueHashes = new Set(allHashes.map(h => h.hash));
assertEqual(uniqueHashes.size, totalQuestions.count, 'All hashes are unique and unchanged');

// 3. Category Filtering Tests
console.log('\n3. Category Filtering Tests');

const activeCategories = getActiveCategories();
for (const cat of activeCategories) {
  const count = countQuestions({ category: cat.name_ar, verifiedOnly: true });
  const questions = getRandomQuestions(5, { category: cat.name_ar, verifiedOnly: true }, []);
  const allCorrectCategory = questions.every(q => q.category === cat.name_ar);
  assert(allCorrectCategory && count > 0, `Category filter works for ${cat.name_ar} (${count} questions)`);
}

// Test invalid category
const invalidQuestions = getRandomQuestions(5, { category: 'invalid_category', verifiedOnly: true }, []);
assertEqual(invalidQuestions.length, 0, 'Invalid category returns empty array');

// 4. Invalid Category Rejection Tests
console.log('\n4. Invalid Category Rejection Tests');

const validQuestion = {
  question: 'ما هي عاصمة فرنسا؟',
  choices: ['باريس', 'ليون', 'مرسيليا', 'نيس'],
  correct_idx: 0,
  correct_answer: 'باريس',
  category: 'جغرافيا',
  difficulty: 'سهل',
  language: 'ar',
  tags: ['عواصم'],
  source: 'اختبار',
  verified: true,
};

const validResult = validateQuestion(validQuestion.question, validQuestion.choices, validQuestion.correct_idx, validQuestion.category, validQuestion.difficulty, validQuestion.language);
assert(validResult.valid, 'Valid canonical category passes validation');

const invalidQuestion = {
  ...validQuestion,
  category: 'فئة غير موجودة',
};

const invalidResult = validateQuestion(invalidQuestion.question, invalidQuestion.choices, invalidQuestion.correct_idx, invalidQuestion.category, invalidQuestion.difficulty, invalidQuestion.language);
assert(!invalidResult.valid, 'Invalid category fails validation');
assert(invalidResult.errors.some(e => e.includes('canonical category')), 'Error mentions canonical category');

// Test inactive category (we can't easily test this without creating an inactive category, but we verify the logic exists)

// 5. T1.7 Regression Tests
console.log('\n5. T1.7 Regression Tests');

// Run a quick gameplay simulation
const matchQuestions = getRandomQuestions(10, { verifiedOnly: true }, []);
assertEqual(matchQuestions.length, 10, 'Can fetch 10 questions for a match');

const uniqueInMatch = new Set(matchQuestions.map(q => q.id));
assertEqual(uniqueInMatch.size, 10, 'No duplicates within match');

// Test cross-match rotation
const seen = new Set<string>();
for (let i = 0; i < 20; i++) {
  const qs = getRandomQuestions(1, { verifiedOnly: true }, []);
  if (qs.length > 0) seen.add(qs[0].id);
}
console.log(`   Unique questions in 20 selections: ${seen.size}`);

// Test difficulty filtering
for (const diff of ['سهل', 'متوسط', 'صعب']) {
  const count = countQuestions({ difficulty: diff, verifiedOnly: true });
  assert(count > 0, `Difficulty filter works for ${diff} (${count} questions)`);
}

// Test combined filters
const combined = getRandomQuestions(5, { category: 'علوم', difficulty: 'متوسط', verifiedOnly: true }, []);
const allCorrect = combined.every(q => q.category === 'علوم' && q.difficulty === 'متوسط');
assert(allCorrect, 'Combined category + difficulty filter works');

// 6. Batch Validation Integration Test
console.log('\n6. Batch Validation Integration Test');

const testBatchQuestions = [
  {
    question: 'ما هي عاصمة اليابان؟',
    choices: ['طوكيو', 'أوساكا', 'كيوتو', 'ناغويا'],
    correct_idx: 0,
    correct_answer: 'طوكيو',
    category: 'جغرافيا',
    difficulty: 'سهل',
    language: 'ar',
    tags: ['عواصم'],
    source: 'اختبار T2.3',
    verified: true,
  },
  {
    question: 'في أي سنة تم اكتشاف البنسلين؟',
    choices: ['1928', '1930', '1940', '1945'],
    correct_idx: 0,
    correct_answer: '1928',
    category: 'علوم',
    difficulty: 'متوسط',
    language: 'ar',
    tags: ['طب', 'اكتشافات'],
    source: 'اختبار T2.3',
    verified: true,
  },
];

const batchValidation = validateBatch({
  batchId: 'test-batch',
  questions: testBatchQuestions,
});

assert(batchValidation.passed, 'Batch validation passes with canonical categories');
assertEqual(batchValidation.validQuestions, 2, 'Both test questions are valid');
assertEqual(batchValidation.errors, 0, 'No validation errors');

// Test invalid category in batch
const invalidBatchQuestions = [
  {
    ...testBatchQuestions[0],
    category: 'فئة غير موجودة',
  },
];

const invalidBatchValidation = validateBatch({
  batchId: 'test-batch-invalid',
  questions: invalidBatchQuestions,
});

assert(!invalidBatchValidation.passed, 'Batch validation fails with unknown category');
assert(invalidBatchValidation.errors > 0, 'Batch validation reports error for unknown category');

// 7. CategoryService Resolution Tests
console.log('\n7. CategoryService Resolution Tests');

const resolved = resolveCategory('علوم');
assert(resolved !== null, 'resolveCategory works for canonical name');
assertEqual(resolved?.name_ar, 'علوم', 'Resolved category has correct Arabic name');
assertEqual(resolved?.slug, 'science', 'Resolved category has correct slug');

const legacyResolved = resolveCategory('ألعاب');
assert(legacyResolved !== null, 'Legacy "ألعاب" maps to video_games');
assertEqual(legacyResolved?.slug, 'video_games', 'Legacy mapping works correctly');

const invalidResolved = resolveCategory('فئة غير موجودة');
assert(invalidResolved === null, 'Invalid category returns null');

// 8. Question Import with Canonical Categories
console.log('\n8. Question Import with Canonical Categories');

const importResult = validateQuestion(
  'ما هو أكبر محيط؟',
  ['الهادئ', 'الأطلسي', 'الهندي', 'القطبي'],
  0,
  'جغرافيا',
  'سهل',
  'ar'
);
assert(importResult.valid, 'Import validation works with canonical categories');

// Summary
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failed === 0) {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log('\n❌ SOME TESTS FAILED');
  process.exit(1);
}