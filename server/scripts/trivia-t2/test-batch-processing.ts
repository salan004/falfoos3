import { 
  createBatch, 
  getBatch, 
  transitionBatchStatus,
  getBatchQuestions 
} from '../src/games/trivia/BatchService';
import { 
  validateBatch, 
  reconcileBatch, 
  importBatch, 
  approveBatch,
  processBatch,
  loadBatchFromFile,
  saveBatchToFile,
  printBatchReport 
} from '../src/games/trivia/BatchProcessor';
import { initDatabase } from '../src/db/db';

// Initialize database
initDatabase();
console.log('Database initialized\n');

// Test file path
const testFilePath = 'scripts/trivia-t2/batches/batch-001-test.json';

console.log('=== T2.2 Batch Processing Test ===\n');

// Step 1: Load questions from file
console.log('1. Loading questions from file...');
const questions = loadBatchFromFile('', testFilePath);
console.log(`   Loaded ${questions.length} questions\n`);

// Step 2: Create batch
console.log('2. Creating batch...');
const batch = createBatch({ name: 'Test Batch 001', batch_number: 1 });
console.log(`   Created batch: ${batch.name} (ID: ${batch.id}, Number: ${batch.batch_number})\n`);

// Step 3: Save batch to file
console.log('3. Saving batch to file...');
const savedPath = saveBatchToFile(batch.id, questions);
console.log(`   Saved to: ${savedPath}\n`);

// Step 4: Validate batch
console.log('4. Validating batch...');
const validationReport = validateBatch(batch.id);
printBatchReport(validationReport);
console.log(`\n   Validation ${validationReport.passed ? 'PASSED' : 'FAILED'}\n`);

// Step 5: If validation passed, reconcile
if (validationReport.passed) {
  console.log('5. Reconciling batch...');
  const reconciliationReport = reconcileBatch(batch.id);
  console.log(`   Reconciliation ${reconciliationReport.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`   Total in batch: ${reconciliationReport.totalInBatch}`);
  console.log(`   Found in DB: ${reconciliationReport.foundInDb}`);
  console.log(`   Missing: ${reconciliationReport.missingFromDb}`);
  console.log(`   Hash mismatches: ${reconciliationReport.hashMismatches}`);
  console.log(`   Extra in DB: ${reconciliationReport.extraInDb}`);
  reconciliationReport.details.forEach(d => console.log(`   - ${d}`));
  console.log('');

  // Step 6: Approve batch
  if (reconciliationReport.passed) {
    console.log('6. Approving batch...');
    const approvedBatch = approveBatch(batch.id);
    console.log(`   Batch status: ${approvedBatch.status}\n`);

    // Step 7: Import batch
    console.log('7. Importing batch...');
    const importResult = importBatch(batch.id);
    console.log(`   Imported: ${importResult.imported}`);
    console.log(`   Skipped (duplicates): ${importResult.skipped}`);
    console.log(`   Rejected: ${importResult.rejected}\n`);

    // Step 8: Verify imported questions
    console.log('8. Verifying imported questions...');
    const importedQuestions = getBatchQuestions(batch.id);
    console.log(`   Questions in DB with batch_id: ${importedQuestions.length}`);
    importedQuestions.forEach((q, i) => {
      console.log(`   ${i+1}. ${q.question.substring(0, 50)}... (hash: ${q.hash.substring(0, 16)}...)`);
    });
  }
}

console.log('\n=== Test Complete ===');