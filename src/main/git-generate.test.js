const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fallbackFromStaged,
  parseGeneratedJson,
  sanitizeCommitMessage,
  sanitizeGeneratedLine,
  sanitizePrContent,
  setApiCredentials,
  setTextGenerator,
  generateCommitMessage,
  generatePrContent,
} = require('./git-generate.js');

test('sanitizeGeneratedLine keeps the first line, drops periods, caps at 72', () => {
  assert.equal(sanitizeGeneratedLine('Fix login...\nsecond line'), 'Fix login');
  assert.equal(sanitizeGeneratedLine('x'.repeat(80)).length, 72);
  assert.equal(sanitizeGeneratedLine(''), 'Update project files');
  assert.equal(sanitizeGeneratedLine(undefined), 'Update project files');
});

test('sanitizeCommitMessage strips trailing periods and caps the subject', () => {
  assert.deepEqual(
    sanitizeCommitMessage({ subject: 'Add files...', body: 'more' }),
    { subject: 'Add files', body: 'more' },
  );
  assert.equal(sanitizeCommitMessage({ subject: 'x'.repeat(80), body: '' }).subject.length, 72);
  assert.equal(sanitizeCommitMessage({ subject: '', body: '' }).subject, 'Update project files');
});

test('fallbackFromStaged uses the name-status verb', () => {
  assert.equal(fallbackFromStaged('A\tREADME.md').subject, 'Add README.md');
  assert.equal(fallbackFromStaged('M\ta.ts\nM\tb.ts').subject, 'Update a.ts and 1 other files');
  assert.equal(fallbackFromStaged('D\told.ts').subject, 'Remove old.ts');
});

test('parseGeneratedJson accepts a fenced object', () => {
  assert.deepEqual(parseGeneratedJson('```json\n{"subject":"Add files","body":""}\n```'), {
    subject: 'Add files',
    body: '',
  });
});

test('generateCommitMessage uses the injected generator then sanitizes', async () => {
  setTextGenerator(async () => ({ subject: 'Add files...', body: 'detail' }));
  try {
    const generated = await generateCommitMessage({ stagedSummary: 'A\tREADME.md', stagedPatch: '' });
    assert.deepEqual(generated, { subject: 'Add files', body: 'detail', source: 'model' });
  } finally {
    setTextGenerator(null);
  }
});

test('sanitizePrContent falls back to the supplied title', () => {
  assert.equal(sanitizePrContent({ title: '', body: '' }, 'feature/demo').title, 'feature/demo');
});

test('generateCommitMessage forwards recent subjects to the injected generator', async () => {
  let seen = null;
  setTextGenerator(async (input) => {
    seen = input;
    return { subject: 'Follow style', body: '' };
  });
  try {
    await generateCommitMessage({
      stagedSummary: 'M\ta.ts',
      stagedPatch: '',
      recentSubjects: 'fix: hook\nfeat: toast',
    });
    assert.equal(seen.recentSubjects, 'fix: hook\nfeat: toast');
  } finally {
    setTextGenerator(null);
  }
});

test('generateCommitMessage fail-closes when a key is set and the model returns nothing', async () => {
  setApiCredentials({ apiKey: 'test-key', baseUrl: 'http://127.0.0.1:9' });
  try {
    const generated = await generateCommitMessage({ stagedSummary: 'A\tREADME.md', stagedPatch: '' });
    assert.equal(generated.error, 'Commit message generation failed.');
  } finally {
    setApiCredentials(null);
  }
});

test('generateCommitMessage refuses a cleartext off-host baseUrl without fetching', async (t) => {
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched += 1; throw new Error('must not be called'); };
  t.after(() => { globalThis.fetch = realFetch; });
  setApiCredentials({ apiKey: 'test-key', baseUrl: 'http://203.0.113.9/v1' });
  try {
    const generated = await generateCommitMessage({ stagedSummary: 'A\tREADME.md', stagedPatch: '' });
    assert.equal(generated.error, 'Commit message generation failed.');
    assert.equal(fetched, 0);
  } finally {
    setApiCredentials(null);
  }
});

test('generateCommitMessage keeps the model branch when includeBranch is set', async () => {
  setTextGenerator(async (input) => {
    assert.equal(input.includeBranch, true);
    return { subject: 'Add files', body: '', branch: 'feature/add-files' };
  });
  try {
    const generated = await generateCommitMessage({
      stagedSummary: 'A\tREADME.md',
      stagedPatch: '',
      includeBranch: true,
    });
    assert.equal(generated.branch, 'feature/add-files');
    assert.equal(generated.subject, 'Add files');
  } finally {
    setTextGenerator(null);
  }
});

test('generatePrContent fail-closes when a key is set and the model returns nothing', async () => {
  setApiCredentials({ apiKey: 'test-key', baseUrl: 'http://127.0.0.1:9' });
  try {
    const generated = await generatePrContent({
      commitSummary: 'abc Add files',
      diffSummary: '',
      diffPatch: '',
      fallbackTitle: 'feature/demo',
    });
    assert.equal(generated.error, 'Pull request content generation failed.');
  } finally {
    setApiCredentials(null);
  }
});
