import { copyFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { defineConfig } from 'vitepress';

const REPO = 'https://github.com/chief-builder/local-vs-remote-mcp';
const BLOB = `${REPO}/blob/main/`;

export default defineConfig({
  title: 'Local vs Remote MCP',
  description: 'Does it matter whether an AI agent reaches its tools locally or over the internet? Measured.',
  base: '/local-vs-remote-mcp/',
  cleanUrls: true,
  // Planning notes and spike logs stay in the repo but are not site pages.
  srcExclude: ['spikes/**'],
  ignoreDeadLinks: [/presentation(\.html)?$/],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/local-vs-remote-mcp/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#3c8772' }],
  ],
  markdown: {
    config(md) {
      // ```mermaid fences become a client-rendered diagram component.
      const fence = md.renderer.rules.fence!;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx]!;
        if (token.info.trim() === 'mermaid') return `<Mermaid graph="${encodeURIComponent(token.content)}" />`;
        return fence(tokens, idx, options, env, self);
      };
      // Relative links that leave docs/ (results, AUDIT.md, code) point at GitHub, so the
      // Markdown sources keep working on github.com and on the site without edits.
      const linkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
      md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const token = tokens[idx]!;
        const href = token.attrGet('href');
        if (href && !/^([a-z]+:|#|\/)/i.test(href)) {
          const [path, hash] = href.split('#');
          const repoPath = posix.normalize(posix.join('docs', posix.dirname(env.relativePath ?? ''), path ?? ''));
          if (!repoPath.startsWith('docs/')) {
            token.attrSet('href', `${BLOB}${repoPath.replace(/\/$/, '')}${hash ? `#${hash}` : ''}`);
            token.attrSet('target', '_blank');
            token.attrSet('rel', 'noreferrer');
          }
        }
        return linkOpen(tokens, idx, options, env, self);
      };
    },
  },
  // The slide deck is standalone HTML; ship it next to the generated pages.
  async buildEnd(site) {
    await copyFile(join(site.srcDir, 'presentation.html'), join(site.outDir, 'presentation.html'));
  },
  themeConfig: {
    nav: [
      { text: 'How it works', link: '/how-it-works' },
      { text: 'Results', link: '/results' },
      { text: 'Lessons', link: '/lessons' },
      { text: 'Background', link: '/foundations/README' },
      { text: 'Slides', link: '/presentation.html', target: '_blank' },
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Summary', link: '/' },
          { text: 'How it works', link: '/how-it-works' },
          { text: 'Results', link: '/results' },
          { text: 'Lessons', link: '/lessons' },
        ],
      },
      {
        text: 'Background',
        items: [
          { text: 'Overview', link: '/foundations/README' },
          { text: 'MCP transports', link: '/foundations/mcp-transports' },
          { text: 'Tool discovery and deferral', link: '/foundations/tool-discovery-and-deferral' },
          { text: 'Experiment design', link: '/foundations/experiment-design' },
          { text: 'Threat models', link: '/foundations/threat-models' },
        ],
      },
      {
        text: 'Deep dives',
        items: [
          { text: 'Long-form writeup', link: '/writeup/long-form' },
          { text: 'Visual brief', link: '/writeup/visual-brief' },
          { text: 'Evidence matrix', link: '/writeup/evidence-matrix' },
          { text: 'Runbook', link: '/runbook' },
          { text: 'Repository audit', link: `${BLOB}AUDIT.md` },
        ],
      },
    ],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: REPO }],
    outline: 'deep',
    footer: { message: 'MIT licensed. Every number links to its published report.', copyright: 'Local vs Remote MCP' },
  },
});
