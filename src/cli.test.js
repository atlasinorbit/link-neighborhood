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
    const discoveryLinks = await fs.readFile(path.join(outDir, 'discovery-links.txt'), 'utf8');
    const wander = await fs.readFile(path.join(outDir, 'wander.txt'), 'utf8');
    const graphJson = JSON.parse(await fs.readFile(path.join(outDir, 'graph.json'), 'utf8'));
    const graphDot = await fs.readFile(path.join(outDir, 'graph.dot'), 'utf8');

    assert.equal(reportJson.pages.length, 1);
    assert.equal(reportJson.pages[0].title, 'Example Links');
    assert.ok(reportJson.pages[0].discoveryLinks.some((link) => link.tags.includes('blogroll-rel')));
    assert.equal(reportJson.maxDepth, 0);
    assert.ok(reportJson.tagSummary.some((item) => item.tag === 'blogroll-rel'));
    assert.ok(reportJson.discoveryUrls.includes('https://example.com/blogroll.opml'));
    assert.ok(reportJson.graph.nodes.some((node) => node.url === url && node.type === 'seed'));
    assert.ok(graphJson.edges.some((edge) => edge.from === url && edge.to === 'https://example.com/blogroll.opml'));
    assert.ok(!graphJson.edges.some((edge) => edge.from === edge.to));
    assert.match(discoveryLinks, /https:\/\/example\.com\/blogroll\.opml/);
    assert.match(graphDot, /digraph link_neighborhood/);
    assert.match(wander, /https:\/\/example\.com\/(blogroll\.opml|links|webring)/);
    assert.match(html, /link-neighborhood report/);
    assert.match(html, /Reusable trail/);
    assert.match(html, /Graph export/);
    assert.match(html, /Wander picks/);
  } finally {
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('cli follows discovery links when depth is enabled', async () => {
  const tempDir = path.join(process.cwd(), 'tmp-test-depth');
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(tempDir, { recursive: true });

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url === '/links') {
      res.end(`<!doctype html><html><head><title>Second Room</title></head><body><a href="/blogroll.opml">Blogroll OPML</a></body></html>`);
      return;
    }
    if (req.url === '/blogroll.opml') {
      res.end(`<?xml version="1.0"?><opml><head><title>OPML</title></head><body></body></opml>`);
      return;
    }
    res.end(`<!doctype html><html><head><title>Start Here</title></head><body><a href="/links">Links</a></body></html>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;

  try {
    const outDir = path.join(tempDir, 'out');
    await execFileAsync('node', ['src/cli.js', '--depth', '1', '--out', outDir, url], { cwd: process.cwd() });

    const reportJson = JSON.parse(await fs.readFile(path.join(outDir, 'report.json'), 'utf8'));
    const crawledUrls = reportJson.pages.map((page) => page.url);

    assert.equal(reportJson.maxDepth, 1);
    assert.equal(reportJson.pages.length, 2);
    assert.ok(crawledUrls.includes(url));
    assert.ok(crawledUrls.includes(`${url}links`));
    assert.ok(reportJson.pages.some((page) => page.depth === 1 && page.title === 'Second Room'));
    assert.ok(reportJson.discoveryUrls.includes(`${url}blogroll.opml`));
  } finally {
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('cli strips fragments and avoids query-string false positives when exporting discovery urls', async () => {
  const tempDir = path.join(process.cwd(), 'tmp-test-normalize');
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(tempDir, { recursive: true });

  const seedHtml = `<!doctype html><html><head><title>Normalize</title></head><body>
    <a href="/links#section">Links With Fragment</a>
    <a href="https://example.com/share?target=/links">Share thing</a>
  </body></html>`;

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
    assert.ok(reportJson.discoveryUrls.includes(`${url}links`));
    assert.ok(!reportJson.discoveryUrls.includes(`${url}links#section`));
    assert.ok(!reportJson.discoveryUrls.includes('https://example.com/share?target=/links'));
  } finally {
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('cli wander sampler excludes original seed urls', async () => {
  const tempDir = path.join(process.cwd(), 'tmp-test-wander');
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(tempDir, { recursive: true });

  const seedHtml = `<!doctype html><html><head><title>Wander</title></head><body>
    <a href="https://example.com/links">Links</a>
    <a href="https://example.com/webring">Webring</a>
    <a href="https://example.com/blogroll">Blogroll</a>
  </body></html>`;

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(seedHtml);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;

  try {
    const outDir = path.join(tempDir, 'out');
    await execFileAsync('node', ['src/cli.js', '--wander', '2', '--out', outDir, url], { cwd: process.cwd() });

    const reportJson = JSON.parse(await fs.readFile(path.join(outDir, 'report.json'), 'utf8'));
    assert.equal(reportJson.wanderUrls.length, 2);
    assert.ok(reportJson.wanderUrls.every((item) => item !== url));
    assert.ok(reportJson.wanderUrls.every((item) => reportJson.discoveryUrls.includes(item)));
  } finally {
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('cli extracts linked sites from opml and xbel discovery files', async () => {
  const tempDir = path.join(process.cwd(), 'tmp-test-xml');
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(tempDir, { recursive: true });

  const server = http.createServer((req, res) => {
    if (req.url === '/blogroll.opml') {
      res.writeHead(200, { 'content-type': 'text/x-opml; charset=utf-8' });
      res.end(`<?xml version="1.0"?>
        <opml version="2.0">
          <body>
            <outline text="Planet Example" htmlUrl="https://planet.example/" xmlUrl="https://planet.example/feed.xml" />
            <outline text="Links Room" url="https://planet.example/links" />
          </body>
        </opml>`);
      return;
    }
    if (req.url === '/bookmarks.xbel') {
      res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
      res.end(`<?xml version="1.0"?>
        <xbel>
          <bookmark href="https://forest.example/webring">
            <title>Forest Ring</title>
          </bookmark>
        </xbel>`);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>XML Door</title></head><body>
      <a href="/blogroll.opml">Blogroll file</a>
      <a href="/bookmarks.xbel">Bookmarks</a>
    </body></html>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;

  try {
    const outDir = path.join(tempDir, 'out');
    await execFileAsync('node', ['src/cli.js', '--depth', '1', '--out', outDir, url], { cwd: process.cwd() });

    const reportJson = JSON.parse(await fs.readFile(path.join(outDir, 'report.json'), 'utf8'));
    const opmlPage = reportJson.pages.find((page) => page.url === `${url}blogroll.opml`);
    const xbelPage = reportJson.pages.find((page) => page.url === `${url}bookmarks.xbel`);

    assert.ok(opmlPage);
    assert.ok(xbelPage);
    assert.ok(opmlPage.discoveryLinks.some((link) => link.url === 'https://planet.example/' && link.tags.includes('opml-entry')));
    assert.ok(opmlPage.discoveryLinks.some((link) => link.url === 'https://planet.example/feed.xml' && link.tags.includes('opml-entry')));
    assert.ok(xbelPage.discoveryLinks.some((link) => link.url === 'https://forest.example/webring' && link.tags.includes('xbel-entry')));
    assert.ok(reportJson.discoveryUrls.includes('https://planet.example/links'));
    assert.ok(reportJson.discoveryUrls.includes('https://forest.example/webring'));
  } finally {
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
