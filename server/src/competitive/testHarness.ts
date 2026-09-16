/**
 * Phase 4A — minimal zero-dependency test harness.
 *
 * The project has no test framework; existing suites (e.g.
 * `games/TriviaGame.test.ts`) are plain ts-node scripts. This keeps that same
 * convention while giving the competitive core deterministic, exit-code
 * checked assertions. Pure test helper: no external dependencies.
 */

let passed = 0;
let failed = 0;

export function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  \u2717 ${name}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Async variant for HTTP/integration tests. */
export async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  \u2717 ${name}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, label?: string): void {
  if (actual !== expected) {
    throw new Error(`${label ? `${label}: ` : ''}expected ${String(expected)}, received ${String(actual)}`);
  }
}

export function assertTrue(value: boolean, label?: string): void {
  if (!value) throw new Error(label ?? 'expected condition to be true');
}

export function assertNull(value: unknown, label?: string): void {
  if (value !== null) throw new Error(`${label ?? 'value'}: expected null, received ${String(value)}`);
}

export function assertClose(actual: number, expected: number, epsilon = 1e-9, label?: string): void {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${label ? `${label}: ` : ''}expected ~${expected}, received ${actual}`);
  }
}

export function assertInteger(value: number, label?: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label ?? 'value'}: expected an integer, received ${value}`);
  }
}

export function assertThrows(fn: () => void, label?: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`${label ?? 'assertThrows'}: expected the function to throw`);
}

export function summarize(suiteName: string): void {
  console.log(`\n${suiteName}: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
