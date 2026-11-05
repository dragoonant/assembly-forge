/**
 * Headless test runner.
 *
 *   node tests/run.js
 *
 * The suite is plain ES modules with no dependencies, so Node runs the same
 * files the browser does -- `tests.html` is the same suite with a nicer
 * report. Exits non-zero on any failure, so CI or a pre-commit hook can use it.
 */

import * as T from './harness.js';
import './suite.js';
import './combat-suite.js';
import './effects-suite.js';
import './content-suite.js';
import './deploy-suite.js';
import './movement-extras-suite.js';
import './mechanics-suite.js';
import './pack-suite.js';
import './ai-suite.js';
import './wave-suite.js';

const summary = T.run(function (r) {
  const mark = r.ok ? '  ok  ' : ' FAIL ';
  process.stdout.write(mark + r.suite + ' / ' + r.name + '\n');
  if (!r.ok) process.stdout.write('       ' + String(r.error).split('\n').join('\n       ') + '\n');
});

process.stdout.write('\n' + summary.passed + ' passed, ' + summary.failed + ' failed\n');
process.exit(summary.failed ? 1 : 0);
