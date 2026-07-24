import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Response } from 'express';
import { readFile } from 'fs/promises';
import { ConfigService } from '@nestjs/config';

import { Public } from './common/decorators/public.decorator';
import { INDEX_HTML, LANDING_HTML, HELP_MD, GATE_SCRIPT_CANDIDATES } from './common/paths';
import { SUTRAS } from './common/sutras.data';
import { COVERAGE } from './compliance/coverage.data';
import { BUILD_TAG } from './common/build';

/** Cache-bust /static assets per deploy: the browser only re-fetches when the
 *  query string changes. Without this, a redeploy leaves the old dashboard.js in
 *  the browser/proxy cache (new HTML, stale JS → buttons that do nothing). */
const ASSET_VERSION = encodeURIComponent(BUILD_TAG);

/** Process start, for the /health uptime signal. */
const STARTED_AT = Date.now();

@ApiTags('Root')
@Controller()
export class AppController {
  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Serves the public marketing landing page (product, pricing, responsible-AI story). */
  @Public()
  @Get('/')
  @ApiExcludeEndpoint()
  async landing(@Res() res: Response): Promise<void> {
    res.sendFile(LANDING_HTML);
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
    const cards = COVERAGE.map((f) => `
      <section class="fw">
        <div class="fw-head">
          <h2>${esc(f.name)} <span class="jur">${esc(f.jurisdiction)}</span></h2>
          <span class="depth ${f.depth}">${f.depth === 'deep' ? 'DEEP COVERAGE' : 'PARTIAL COVERAGE'}</span>
        </div>
        <p class="count"><b>${f.evaluated.length}</b> controls evaluated · regime size: <b>${f.universe.total}</b> ${esc(f.universe.unit)}</p>
        <p class="stmt">${esc(f.statement)}</p>
        <details>
          <summary>Show the ${f.evaluated.length} evaluated controls</summary>
          <ul>${f.evaluated.map((c) => `<li><code>${esc(c.code)}</code> ${esc(c.name)}</li>`).join('')}</ul>
        </details>
        ${f.operational?.length ? `<details><summary>Platform machinery implementing this regime</summary><ul>${f.operational.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></details>` : ''}
      </section>`).join('\n');

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
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
  .foot{color:var(--graphite);font-family:var(--mono);font-size:11.5px;margin-top:26px;border-top:1px solid var(--hairline);padding-top:14px}
</style></head><body><div class="wrap">
  <p><a href="/">&larr; SentRAI</a></p>
  <span class="eyebrow">SR-DL · Coverage disclosure</span>
  <h1>Framework coverage disclosure</h1>
  <p class="sub">Exactly which controls SentRAI evaluates per framework, measured against the full size of each regime — published so our claims can never drift from our code. This page and the product are generated from the same manifest.</p>
  <div class="why"><b>Why we publish this.</b> A governance product that overstates its own coverage invites exactly the audit it sells protection from. Where coverage is partial we say so, say what a verdict means, and say what is on the roadmap.</div>
  ${cards}
  <p class="foot">Machine-readable version: <a href="/api/v1/compliance/coverage">/api/v1/compliance/coverage</a> · Source of truth: <code>src/compliance/coverage.data.ts</code>, updated in the same commit as any validator change. Build ${ASSET_VERSION}.</p>
</div></body></html>`;
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
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
  ): Promise<{ status: string; service: string; db: string; uptime_s: number; build: string }> {
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
      db,
      uptime_s: Math.floor((Date.now() - STARTED_AT) / 1000),
      build: BUILD_TAG,
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
