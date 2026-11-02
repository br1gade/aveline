import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { pathToFileURL } from 'node:url';
const escapeMessage = (value) => value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
export function formatFailures(results, root) {
  return results.testResults.filter((suite) => suite.status === 'failed').slice(0, 20).map((suite) => {
    const file = escapeMessage(relative(root, suite.name)).replaceAll(',', '%2C').replaceAll(':', '%3A');
    const message = stripVTControlCharacters(suite.message || 'Test suite failed before assertions completed').slice(0, 6000);
    return `::error file=${file}::${escapeMessage(message)}`;
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const results = JSON.parse(await readFile(process.argv[2], 'utf8'));
    for (const line of formatFailures(results, resolve('..'))) console.log(line);
  } catch { console.error('::warning::Structured test results unavailable; inspect the test step logs.'); }
}
