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
<style>
  :root{--bg:#0b0f14;--card:#121722;--line:#232b3a;--fg:#e8ebf3;--muted:#8b94aa;--accent:#4c7eff;--ok:#25c98d;--warn:#f2a93b}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:860px;margin:0 auto;padding:48px 24px 80px}
  h1{font-size:26px;margin:0 0 6px} .sub{color:var(--muted);max-width:70ch}
  .fw{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:18px 0}
  .fw-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .fw h2{font-size:17px;margin:0} .jur{color:var(--muted);font-size:12px;font-weight:400}
  .depth{margin-left:auto;font-size:10px;letter-spacing:.08em;padding:3px 10px;border-radius:12px;font-weight:700}
  .depth.deep{background:rgba(37,201,141,.14);color:var(--ok)} .depth.partial{background:rgba(242,169,59,.14);color:var(--warn)}
  .count{color:var(--muted);font-size:13px;margin:8px 0 6px} .count b{color:var(--fg)}
  .stmt{font-size:13.5px;margin:0 0 8px}
  details{border-top:1px solid var(--line);padding:8px 0 2px;font-size:13px}
  summary{cursor:pointer;color:var(--accent)}
  ul{margin:8px 0 4px;padding-left:20px} li{margin:3px 0;color:var(--muted)}
  code{background:#0e1420;border:1px solid var(--line);border-radius:4px;padding:1px 6px;font-size:11.5px;color:var(--accent)}
  .why{background:rgba(76,126,255,.08);border:1px solid rgba(76,126,255,.35);border-radius:10px;padding:14px 18px;margin:20px 0;font-size:13.5px}
  a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
  .foot{color:var(--muted);font-size:12px;margin-top:26px;border-top:1px solid var(--line);padding-top:14px}
</style></head><body><div class="wrap">
  <p><a href="/">&larr; SentRAI</a></p>
  <h1>Framework Coverage Disclosure</h1>
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
