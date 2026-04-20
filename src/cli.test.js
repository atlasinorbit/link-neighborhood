import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('cli generates report files from a local html seed', async () => {
  const tempDir = path.join(process.cwd(), 'tmp-test');
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(tempDir, { recursive: true });

  const seedHtml = `<!doctype html>
  <html>
    <head>
      <title>Example Links</title>
      <link rel="blogroll" href="https://example.com/blogroll.opml">
    </head>
    <body>
      <a href="https://example.com/links">Links</a>
      <a href="https://example.com/webring">Webring</a>
    </body>
  </html>`;

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(seedHtml);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;

  try {
    const outDir = path.join(tempDir, 'out');
    await execFileAsync('node', ['src/cli.js', '--out', outDir, url], { cwd: process.cwd() });

    const reportJson = JSON.parse(await fs.readFile(path.join(outDir, 'report.json'), 'utf8'));
    const html = await fs.readFile(path.join(outDir, 'report.html'), 'utf8');

    assert.equal(reportJson.pages.length, 1);
    assert.equal(reportJson.pages[0].title, 'Example Links');
    assert.ok(reportJson.pages[0].discoveryLinks.some((link) => link.tags.includes('blogroll-rel')));
    assert.match(html, /link-neighborhood report/);
  } finally {
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
