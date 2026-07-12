import { mkdtempSync, writeFileSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import AdmZip from 'adm-zip';

/**
 * Downloads remote repositories as ZIP archives and extracts them to a temp
 * directory. Port of discovery/connectors/repo_connector.py (httpx+zipfile →
 * fetch+adm-zip).
 */
export class RemoteRepoConnector {
  private static async downloadAndExtract(url: string, headers: Record<string, string>): Promise<string> {
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to download repository: ${res.status} - ${text}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());

    const tempDir = mkdtempSync(join(tmpdir(), 'sentrai_scan_'));
    const zipPath = join(tempDir, 'repo.zip');
    writeFileSync(zipPath, buf);

    const extractPath = join(tempDir, 'extracted');
    new AdmZip(zipPath).extractAllTo(extractPath, true);

    const subdirs = readdirSync(extractPath).map((n) => join(extractPath, n)).filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
    return subdirs.length ? subdirs[0] : extractPath;
  }

  static async downloadGithubRepo(owner: string, repo: string, branch = 'main', token?: string | null): Promise<string> {
    const headers: Record<string, string> = { 'User-Agent': 'SentrAI' };
    if (token) headers.Authorization = `token ${token}`;
    const url = `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`;
    return this.downloadAndExtract(url, headers);
  }

  /**
   * Fetches a GitHub repository as a raw zipball buffer (for extraction into a
   * project workspace). The host is fixed to api.github.com — owner/repo/branch
   * are the only caller-controlled parts, so this is not an SSRF vector.
   */
  static async fetchGithubZipball(owner: string, repo: string, branch = 'main', token?: string | null): Promise<Buffer> {
    const headers: Record<string, string> = { 'User-Agent': 'SentrAI' };
    if (token) headers.Authorization = `token ${token}`;
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(branch)}`;
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`GitHub returned ${res.status} for ${owner}/${repo}@${branch}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  static async downloadGitlabRepo(
    projectId: string,
    branch = 'main',
    token?: string | null,
    host = 'gitlab.com',
  ): Promise<string> {
    const headers: Record<string, string> = {};
    if (token) headers['PRIVATE-TOKEN'] = token;
    const url = `https://${host}/api/v4/projects/${projectId}/repository/archive.zip?sha=${branch}`;
    return this.downloadAndExtract(url, headers);
  }
}
