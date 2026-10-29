import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const config = await readFile(new URL('../next.config.ts', import.meta.url), 'utf8');

test('pilot UI does not pretend authentication or authorization is complete', () => {
  assert.match(page, /does not simulate sign-in or authorization/i);
  assert.match(page, /Platform entitlement checks/i);
});

test('Next.js uses standalone output for independent container deployment', () => {
  assert.match(config, /output:\s*'standalone'/);
});
