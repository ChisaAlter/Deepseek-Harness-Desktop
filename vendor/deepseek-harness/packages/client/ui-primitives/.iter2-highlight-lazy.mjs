/**
 * Per-task cost of a lazily loaded read-card grammar: scanner construction
 * (Oniguruma -> JS translation) and the first tokenize each happen in their own
 * task, so measure them separately against the 50 ms long-task budget.
 */
import { performance } from 'node:perf_hooks'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import python from '@shikijs/langs/python'
import rust from '@shikijs/langs/rust'
import markdown from '@shikijs/langs/markdown'
import html from '@shikijs/langs/html'
import css from '@shikijs/langs/css'
import yaml from '@shikijs/langs/yaml'

const theme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const samples = {
  python: 'def add(a, b):\n    return a + b',
  rust: 'fn main() { let x: u32 = 1; }',
  markdown: '# Title\n\n- item',
  html: '<div class="a">text</div>',
  css: 'a { color: red; }',
  yaml: 'key: value',
}

const results = []
for (const [name, grammar, sample] of [
  ['python', python, samples.python],
  ['rust', rust, samples.rust],
  ['markdown', markdown, samples.markdown],
  ['html', html, samples.html],
  ['css', css, samples.css],
  ['yaml', yaml, samples.yaml],
]) {
  let patterns = 0
  let longest = 0
  const engine = createJavaScriptRegexEngine({
    forgiving: true,
    cache: new Map(),
    regexConstructor(pattern) {
      patterns += 1
      longest = Math.max(longest, pattern.length)
      return defaultJavaScriptRegexConstructor(pattern, {
        lazyCompileLength: Number.POSITIVE_INFINITY,
      })
    },
  })
  const instance = createHighlighterCoreSync({ themes: [theme], langs: [], engine })
  const loadStart = performance.now()
  instance.loadLanguageSync(grammar)
  const loadMs = performance.now() - loadStart
  const tokenStart = performance.now()
  instance.codeToTokens(sample, { lang: name, theme: 'css-variables', tokenizeTimeLimit: 0 })
  const tokenMs = performance.now() - tokenStart
  results.push({
    name,
    patterns,
    longestPattern: longest,
    loadMs: Number(loadMs.toFixed(2)),
    firstTokenizeMs: Number(tokenMs.toFixed(2)),
    maxTaskMs: Number(Math.max(loadMs, tokenMs).toFixed(2)),
  })
}

console.log(JSON.stringify(results.sort((left, right) => right.maxTaskMs - left.maxTaskMs), null, 2))
