/**
 * Google Analytics 4 tag, injected immediately after <head> on every
 * HTML page the platform serves (landing, consoles, coverage, public
 * cards). The CSP in main.ts allowlists the googletagmanager /
 * google-analytics domains this loads from and reports to — without
 * those directives the tag is silently blocked.
 */
export const GA_SNIPPET = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-PGMRWMZL9W"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-PGMRWMZL9W');
</script>`;
