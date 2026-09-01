# Trivia Pilot Questions

This directory is where the **real 100-question pilot dataset** must be placed.

## Expected File Location

```
server/scripts/trivia-pilot/questions/questions-source.json
```

## Required Schema

The dataset must be a JSON array of question objects with the following structure:

```json
{
  "question": "سؤال باللغة العربية؟",
  "choices": [
    "الخيار الأول",
    "الخيار الثاني",
    "الخيار الثالث",
    "الخيار الرابع"
  ],
  "correct_idx": 0,
  "category": "جغرافيا",
  "difficulty": "سهل",
  "language": "ar",
  "tags": ["example"],
  "source": "source reference",
  "verified": true
}
```

### Required Fields

| Field | Type | Constraints |
|-------|------|-------------|
| `question` | string | Non-empty, 10-200 characters, valid Arabic text |
| `choices` | string[] | Exactly 4 elements, each non-empty, 1-80 characters, all distinct |
| `correct_idx` | integer | 0, 1, 2, or 3 |
| `category` | string | Must be exactly one of: `تاريخ`, `جغرافيا`, `علوم`, `ثقافة عامة`, `ألعاب فيديو` |
| `difficulty` | string | Must be exactly one of: `سهل`, `متوسط`, `صعب` |
| `language` | string | Must be exactly `ar` |

### Optional Fields

| Field | Type | Default |
|-------|------|---------|
| `tags` | string[] | `[]` |
| `source` | string | `null` |
| `verified` | boolean | `false` |

## Pilot Distribution Requirements

The 100 questions must satisfy **exactly** these distributions:

### Category Distribution (20 each)
- `تاريخ` = 20
- `جغرافيا` = 20
- `علوم` = 20
- `ثقافة عامة` = 20
- `ألعاب فيديو` = 20

### Difficulty Distribution
- `سهل` = 35
- `متوسط` = 45
- `صعب` = 20

### Correct Answer Position Distribution (20-30 each)
- `correct_idx = 0` → 20-30
- `correct_idx = 1` → 20-30
- `correct_idx = 2` → 20-30
- `correct_idx = 3` → 20-30

## Important Notes

1. **Do NOT create fake questions** in this file. The real dataset will be supplied separately.
2. The legacy `ألعاب` category is **different** from the pilot `ألعاب فيديو` category.
3. The legacy 41 questions in `server/src/data/trivia-questions.json` are **not** part of the pilot.
4. The pipeline will report `DATASET NOT PROVIDED` until a valid 100-question dataset is placed here.
5. Test fixtures in `tests/fixtures/sample-questions.json` are **never** counted toward the pilot.

## Running the Pipeline

```bash
# From server directory
cd server

# Generate/normalize pilot data
npx ts-node scripts/trivia-pilot/generate-pilot.ts

# Validate pilot data
npx ts-node scripts/trivia-pilot/validate-pilot.ts

# Check semantic duplicates
npx ts-node scripts/trivia-pilot/check-semantic-duplicates.ts

# Generate report
npx ts-node scripts/trivia-pilot/report-pilot.ts

# Export (only if all gates pass)
npx ts-node scripts/trivia-pilot/export-pilot.ts
```

## Hash Compatibility Check

```bash
npx ts-node -e "
import { computeQuestionHash, verifyHashCompatibility } from './scripts/trivia-pilot/lib/trivia-hash';
import { computeQuestionHash as prodHash } from './src/games/trivia/QuestionPoolService';
const result = verifyHashCompatibility(prodHash);
console.log('Hash Compatibility:', result.passed ? 'PASSED' : 'FAILED');
result.details.forEach(d => console.log(d.test, d.match ? '✓' : '✗'));
if (!result.passed) process.exit(1);
"
```