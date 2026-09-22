/** Default documentation theme with Markdown actions and a client-only Mermaid viewer. */
import DefaultTheme from 'vitepress/theme'
import { useData, useRoute, type Theme } from 'vitepress'
import { defineComponent, h, onBeforeUnmount, onMounted, watch } from 'vue'
import type { MermaidViewer } from './mermaid-viewer.ts'
import { PageMarkdownActions } from './page-markdown-actions.ts'
import './mermaid-viewer.css'
import './code-group.css'
import './page-markdown-actions.css'

export default {
  extends: DefaultTheme,
  Layout: defineComponent({
    name: 'DocsLayout',
    setup() {
      const { lang, isDark, frontmatter, site, page } = useData()
      const route = useRoute()
      let viewer: MermaidViewer | undefined
      let disposed = false
      onMounted(async () => {
        const { installMermaidViewer } = await import('./mermaid-viewer.ts')
        if (!disposed) viewer = installMermaidViewer(document, () => lang.value)
      })
      watch([() => route.path, lang, isDark], () => viewer?.refresh(), { flush: 'post' })
      onBeforeUnmount(() => {
        disposed = true
        viewer?.dispose()
      })
      return () => h(DefaultTheme.Layout, null, {
        'doc-before': () => {
          const path: unknown = frontmatter.value.rawMarkdownPath
          return !page.value.isNotFound && typeof path === 'string'
            ? h(PageMarkdownActions, { key: `${route.path}:${lang.value}:${path}`, path: `${site.value.base}${path}`, lang: lang.value })
            : null
        },
      })
    },
  }),
} satisfies Theme
