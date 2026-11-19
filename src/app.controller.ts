import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Request, Response } from 'express';
import { readFile, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { ConfigService } from '@nestjs/config';

import { Public } from './common/decorators/public.decorator';
import { INDEX_HTML, LANDING_HTML, HELP_MD, DEMO_MP4, GATE_SCRIPT_CANDIDATES } from './common/paths';
import { SUTRAS } from './common/sutras.data';
import { CoverageControl, coverageMode, DEEP_THRESHOLD, getCoverage } from './compliance/coverage.data';
import { APP_VERSION, BUILD_TAG } from './common/build';
import { GA_SNIPPET } from './common/analytics';

/** Cache-bust /static assets per deploy: the browser only re-fetches when the
 *  query string changes. Without this, a redeploy leaves the old dashboard.js in
 *  the browser/proxy cache (new HTML, stale JS → buttons that do nothing). */
const ASSET_VERSION = encodeURIComponent(BUILD_TAG);

/** Process start, for the /health uptime signal (and the sitemap lastmod). */
const STARTED_AT = Date.now();

/** Public, crawlable pages the sitemap advertises. App/API surfaces (/console,
 *  /dashboard, /api/*, auth) are deliberately excluded — they sit behind auth
 *  and carry no indexable content. Add a row here when a new public page ships. */
const PUBLIC_ROUTES: ReadonlyArray<{ path: string; changefreq: string; priority: string }> = [
  { path: '/', changefreq: 'monthly', priority: '1.0' },
  { path: '/coverage', changefreq: 'monthly', priority: '0.8' },
];

@ApiTags('Root')
@Controller()
export class AppController {
  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Serves the public marketing landing page (product, pricing, responsible-AI story).
   *  NOTE: must be `@Get()`, not `@Get('/')` — under Nest 11 / Express 5 the
   *  explicit '/' path no longer matches the root and 404s. */
  @Public()
  @Get()
  @ApiExcludeEndpoint()
  async landing(@Res() res: Response): Promise<void> {
    // Read-and-send rather than res.sendFile: under Express 5 the bundled
    // `send` throws NotFound on an absolute path, and the /console route
    // already proves readFile+send is reliable here.
    const html = await readFile(LANDING_HTML, 'utf-8');
    res.type('html').send(html);
  }

  /** Public 2-minute product walkthrough — a branded player page (the URL to
   *  share, e.g. for the ET AI Awards submission). The video streams from
   *  /demo.mp4 on the same origin. */
  @Public()
  @Get('/demo')
  @ApiExcludeEndpoint()
  demoPage(@Res() res: Response): void {
    const html = `<!doctype html><html lang="en"><head>${GA_SNIPPET}<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SentRAI — 2-minute product walkthrough</title>
<meta name="description" content="SentRAI Compliance Console — engineering-driven AI governance: discover AI in the code, gate the pipeline, watch the runtime, prove the evidence.">
<meta property="og:title" content="SentRAI — 2-minute product walkthrough">
<meta property="og:description" content="Engineering-driven AI governance for financial services — RBI FREE-AI, NIST AI RMF, EU AI Act, ISO 42001.">
<meta property="og:type" content="video.other">
<style>
  :root{--bg:#0d1a2b;--ink:#f4f7fb;--mut:#8398b4;--sig:#9db8dd;--hair:#233852}
  *{box-sizing:border-box} html,body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
  .wrap{max-width:1040px;margin:0 auto;padding:40px 22px 72px}
  .eyebrow{font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.28em;text-transform:uppercase;color:var(--sig)}
  h1{font-size:30px;letter-spacing:-.01em;margin:10px 0 4px}
  .sub{color:var(--mut);margin:0 0 22px;max-width:70ch}
  video{width:100%;border:1px solid var(--hair);border-radius:8px;background:#000;display:block}
  .row{display:flex;flex-wrap:wrap;gap:10px 22px;margin-top:16px;font:13px/1.5 ui-monospace,Menlo,monospace;color:var(--mut)}
  .row b{color:var(--ink);font-weight:600}
  a{color:var(--sig)}
  .foot{margin-top:26px;color:var(--mut);font:12px/1.6 ui-monospace,Menlo,monospace}
</style></head><body><div class="wrap">
  <div class="eyebrow">Product walkthrough · 1 min 49 s</div>
  <h1>SentRAI Compliance Console</h1>
  <p class="sub">Engineering-driven AI governance: discover the AI hiding in your code, gate the pipeline before it ships, watch the runtime, and generate tamper-evident evidence — mapped to RBI FREE-AI, NIST AI RMF, the EU AI Act and ISO/IEC 42001.</p>
  <video controls playsinline preload="metadata" poster="/static/logo.png">
    <source src="/demo.mp4" type="video/mp4">
    Your browser can’t play embedded video — <a href="/demo.mp4">download the walkthrough</a>.
  </video>
  <div class="row">
    <span>Direct link <b><a href="/demo.mp4">sentraiconsole.com/demo.mp4</a></b></span>
    <span>Live console <b><a href="/">sentraiconsole.com</a></b></span>
    <span>Health <b><a href="/health">/health</a></b></span>
  </div>
  <p class="foot">Auto-generated by SentRAI Console · RBI FREE-AI · NIST AI RMF · EU AI Act · ISO 42001</p>
</div></body></html>`;
    res.set('Cache-Control', 'public, max-age=300');
    res.type('html').send(html);
  }

  /** The walkthrough MP4 with HTTP Range support (seekable). Streamed manually
   *  because Express 5's bundled `send` rejects absolute paths (see landing). */
  @Public()
  @Get('/demo.mp4')
  @ApiExcludeEndpoint()
  async demoVideo(@Req() req: Request, @Res() res: Response): Promise<void> {
    let size: number;
    try {
      size = (await stat(DEMO_MP4)).size;
    } catch {
      res.status(404).send('Not Found');
      return;
    }
    res.set({
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    });
    const range = req.headers.range;
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
        res.status(416).set('Content-Range', `bytes */${size}`).end();
        return;
      }
      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      });
      createReadStream(DEMO_MP4, { start, end }).pipe(res);
    } else {
      res.status(200).set('Content-Length', String(size));
      createReadStream(DEMO_MP4).pipe(res);
    }
  }

  /** Serves the CLASSIC console UI — a single-page dashboard with no build step.
   *  The React console (served at /dashboard) is now the default experience;
   *  this classic UI is kept available at /console rather than retired.
   *  The HTML is served no-cache and its asset URLs are stamped with the build
   *  version, so a redeploy always loads the matching dashboard.js/.css instead
   *  of a stale cached copy. */
  @Public()
  @Get('/console')
  @ApiExcludeEndpoint()
  async dashboard(@Res() res: Response): Promise<void> {
    const html = (await readFile(INDEX_HTML, 'utf-8')).replace(/__ASSET_VER__/g, ASSET_VERSION);
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  }

  /**
   * Public coverage-disclosure page: renders src/compliance/coverage.data.ts —
   * the exact controls each validator evaluates vs the size of the regime.
   * Server-rendered from the same manifest the API serves, so the public claim
   * and the product behavior cannot drift apart.
   */
  @Public()
  @Get('/coverage')
  @ApiExcludeEndpoint()
  coveragePage(@Res() res: Response): void {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const item = (c: CoverageControl) => {
      const tags = [
        c.scope === 'organisation' ? '<span class="tag">organisation-level</span>' : '',
        c.advisory ? '<span class="tag">advisory, never blocks</span>' : '',
        c.appliesTo?.length ? `<span class="tag">${esc(c.appliesTo.join(' / '))} only</span>` : '',
      ].join('');
      return `<li><code>${esc(c.code)}</code> ${esc(c.name)}${c.clause ? ` <span class="ref">${esc(c.clause)}</span>` : ''}${tags}${c.note ? `<br><span class="note">${esc(c.note)}</span>` : ''}</li>`;
    };
    const mode = coverageMode();
    const cards = getCoverage().map((f) => `
      <section class="fw">
        <div class="fw-head">
          <h2>${esc(f.name)} <span class="jur">${esc(f.jurisdiction)}</span></h2>
          <span class="depth ${f.depth}" title="${f.implementation ? `DEEP when at least ${Math.round(DEEP_THRESHOLD * 100)}% of applicable requirements are implemented with this deployment's flags` : ''}">${f.depth === 'deep' ? 'DEEP COVERAGE' : 'PARTIAL COVERAGE'}</span>
        </div>
        <p class="count"><b>${f.evaluated.length}</b> checks evaluated${f.universe.covered !== undefined ? ` · reach <b>${f.universe.covered}</b> of <b>${f.universe.total}</b>` : ` · regime size: <b>${f.universe.total}</b>`} ${esc(f.universe.unit)}</p>
        ${f.implementation ? `<p class="count">Implemented in the product: <b>${f.implementation.implemented}</b> of <b>${f.implementation.applicable}</b> ${esc(f.implementation.unit)}${f.implementation.partial ? ` · <b>${f.implementation.partial}</b> partial` : ''}${f.implementation.gap ? ` · <b>${f.implementation.gap}</b> not yet` : ''}${f.implementation.notApplicable ? ` · ${f.implementation.notApplicable} not applicable to a product` : ''}${f.implementation.heldBackByFlags ? ` · ${f.implementation.heldBackByFlags} more need governance flags that are off here` : ''}<br><span class="note">Reviewed assessment against the code (${esc(f.implementation.assessedOn)}, commit ${esc(f.implementation.commit)}), counting only features switched on in this deployment. It includes workflows and records, not just the automated checks below.</span></p>` : ''}
        ${f.availability ? `<p class="avail">${esc(f.availability)}</p>` : ''}
        <p class="stmt">${esc(f.statement)}</p>
        <details>
          <summary>Show the ${f.evaluated.length} evaluated checks</summary>
          <ul>${f.evaluated.map(item).join('')}</ul>
        </details>
        ${f.notAssessed?.length ? `<details><summary>${f.notAssessed.length} listed but NOT ASSESSED here</summary><ul>${f.notAssessed.map(item).join('')}</ul></details>` : ''}
        ${f.operational?.length ? `<details><summary>Platform machinery implementing this regime</summary><ul>${f.operational.map((o) => `<li>${esc(typeof o === 'string' ? o : o.text)}</li>`).join('')}</ul></details>` : ''}
        ${f.basis ? `<p class="basis">${esc(f.basis)}</p>` : ''}
      </section>`).join('\n');

    const html = `<!doctype html><html lang="en"><head>${GA_SNIPPET}<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SentRAI — Framework Coverage Disclosure</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&family=Source+Serif+4:opsz,wght@8..60,400..600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  /* SR-DL-001 · paper world, one Signal Blue, three type families. */
  :root{--paper:#F5F6F3;--raise:#fff;--ink:#10202F;--graphite:#55677A;--hairline:#D6DCDE;--signal:#2240C9;--signal-tint:#E4E9FB;--verify:#1E8A5A;--caution:#B97416;
    --sans:Archivo,'Helvetica Neue',Arial,sans-serif;--serif:'Source Serif 4',Georgia,serif;--mono:'IBM Plex Mono',ui-monospace,Menlo,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--serif);font-size:16px;line-height:1.62}
  .wrap{max-width:880px;margin:0 auto;padding:44px 24px 80px}
  a{color:var(--signal);text-decoration:none} a:hover{text-decoration:underline}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--graphite);display:block;margin:14px 0 6px}
  h1{font-family:var(--sans);font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.1;margin:0 0 8px}
  .sub{color:var(--graphite);max-width:66ch}
  .fw{background:var(--raise);border:1px solid var(--hairline);border-radius:3px;padding:18px 22px;margin:16px 0}
  .fw-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--hairline);padding-bottom:10px;margin-bottom:10px}
  .fw h2{font-family:var(--sans);font-size:18px;font-weight:600;margin:0;letter-spacing:-.01em} .jur{font-family:var(--mono);color:var(--graphite);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
  .depth{margin-left:auto;font-family:var(--mono);font-size:10px;letter-spacing:.1em;padding:3px 10px;border-radius:10px;font-weight:600}
  .depth.deep{background:rgba(30,138,90,.1);color:var(--verify)} .depth.partial{background:rgba(185,116,22,.12);color:var(--caution)}
  .count{font-family:var(--mono);color:var(--graphite);font-size:12.5px;margin:0 0 8px} .count b{color:var(--ink)}
  .stmt{font-size:15px;margin:0 0 10px;max-width:74ch}
  details{border-top:1px solid var(--hairline);padding:8px 0 2px;font-size:14px}
  summary{cursor:pointer;font-family:var(--sans);color:var(--signal);font-size:13px}
  ul{margin:8px 0 4px;padding-left:20px} li{margin:4px 0;color:var(--graphite)}
  code{font-family:var(--mono);background:var(--signal-tint);border-radius:2px;padding:1px 6px;font-size:12px;color:var(--signal)}
  .why{background:var(--signal-tint);border:1px solid var(--signal);border-left-width:3px;border-radius:3px;padding:14px 18px;margin:20px 0;font-size:14.5px;max-width:74ch}
  .tag{font-family:var(--mono);font-size:10px;letter-spacing:.04em;border:1px solid var(--hairline);border-radius:8px;padding:0 7px;margin-left:6px;color:var(--graphite);white-space:nowrap}
  .ref{font-family:var(--mono);font-size:11px;color:var(--graphite)} .note{font-size:13px;font-style:italic}
  .avail{font-family:var(--sans);font-size:13px;color:var(--caution);margin:0 0 8px} .basis{font-family:var(--mono);font-size:11px;color:var(--graphite);margin:8px 0 0}
  .mode{font-family:var(--sans);font-size:13.5px;border:1px solid var(--hairline);border-radius:3px;padding:10px 14px;background:var(--raise);max-width:74ch}
  .foot{color:var(--graphite);font-family:var(--mono);font-size:11.5px;margin-top:26px;border-top:1px solid var(--hairline);padding-top:14px}
</style></head><body><div class="wrap">
  <p><a href="/">&larr; SentRAI</a></p>
  <span class="eyebrow">SR-DL · Coverage disclosure</span>
  <h1>Framework coverage disclosure</h1>
  <p class="sub">Exactly which controls SentRAI evaluates per framework, measured against the full size of each regime — published so our claims can never drift from our code. This page and the product are generated from the same manifest.</p>
  <div class="why"><b>Why we publish this.</b> A governance product that overstates its own coverage invites exactly the audit it sells protection from. Where coverage is partial we say so, say what a verdict means, and say what is on the roadmap.</div>
  <p class="mode">${esc(mode.description)}</p>
  ${cards}
  <p class="foot">Machine-readable version: <a href="/api/v1/compliance/coverage">/api/v1/compliance/coverage</a> · Source of truth: <code>src/compliance/coverage.data.ts</code>, updated in the same commit as any validator change; with the pack engine on, the lists are generated from the framework packs in force. Build ${ASSET_VERSION}.</p>
</div></body></html>`;
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  }

  /** Canonical origin (no trailing slash) for absolute URLs. Prefers the
   *  configured PUBLIC_URL; falls back to the proxy-aware request host so a
   *  staging mirror advertises itself, not production. */
  private siteBase(req: Request): string {
    const configured = this.config.get<string>('publicUrl');
    if (configured) return configured;
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol;
    const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.get('host') || 'localhost';
    return `${proto}://${host}`;
  }

  /**
   * Dynamic sitemap for search engines. Generated at request time from
   * PUBLIC_ROUTES against the canonical origin, so the URL set stays in sync
   * with the code and never points at a stale host. lastmod tracks the current
   * deploy (process start) — these pages only change on redeploy.
   */
  @Public()
  @Get('/sitemap.xml')
  @ApiExcludeEndpoint()
  sitemap(@Req() req: Request, @Res() res: Response): void {
    const base = this.siteBase(req);
    const lastmod = new Date(STARTED_AT).toISOString().slice(0, 10);
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const urls = PUBLIC_ROUTES.map(
      (r) => `  <url>
    <loc>${esc(base + r.path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`,
    ).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(xml);
  }

  /** robots.txt — keeps crawlers out of the app/API surfaces and points them at
   *  the sitemap, using the same canonical origin. */
  @Public()
  @Get('/robots.txt')
  @ApiExcludeEndpoint()
  robots(@Req() req: Request, @Res() res: Response): void {
    const body = `User-agent: *
Disallow: /api/
Disallow: /console
Disallow: /dashboard
Disallow: /auth

Sitemap: ${this.siteBase(req)}/sitemap.xml
`;
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(body);
  }

  /**
   * Liveness + readiness for an uptime monitor. Fast, unauthenticated, and it
   * pings the database with `SELECT 1` so an "app up but DB down" outage
   * returns 503 (and pages you) instead of a misleading 200. The body also
   * carries the build tag and uptime for a human glancing at it.
   */
  @Public()
  @Get('/health')
  async health(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string; service: string; version: string; build: string; db: string; uptime_s: number }> {
    let db = 'ok';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      db = 'unreachable';
      res.status(503);
    }
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      service: this.config.get<string>('appName')!,
      version: APP_VERSION,
      build: BUILD_TAG,
      db,
      uptime_s: Math.floor((Date.now() - STARTED_AT) / 1000),
    };
  }

  /** Serves the HELP.md content as JSON (mirrors GET /api/v1/docs). */
  @Public()
  @Get('/api/v1/docs')
  async getDocs(): Promise<{ content: string; error?: string }> {
    try {
      const content = await readFile(HELP_MD, 'utf-8');
      return { content };
    } catch (e) {
      return { error: `Failed to read HELP.md: ${String(e)}`, content: '' };
    }
  }

  @Public()
  @Get('/api/v1/sutras')
  listSutras(): typeof SUTRAS {
    return SUTRAS;
  }

  /**
   * Serves the standalone CI gate runner so any pipeline can `curl … | node` it
   * without a cross-repo Action or a vendored copy — works for private repos and
   * for GitLab/Jenkins/etc. Public + no-cache so pipelines always get the latest.
   */
  @Public()
  @Get('/api/v1/ci/gate.mjs')
  @ApiExcludeEndpoint()
  async gateScript(@Res() res: Response): Promise<void> {
    for (const path of GATE_SCRIPT_CANDIDATES) {
      try {
        const src = await readFile(path, 'utf-8');
        res.set('Cache-Control', 'no-cache');
        res.type('application/javascript').send(src);
        return;
      } catch { /* try the next candidate */ }
    }
    res.status(404).type('text/plain').send('// SentRAI gate runner unavailable on this deployment.');
  }
}
