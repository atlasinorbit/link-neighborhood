#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_OUT_DIR = 'out';
const USER_AGENT = 'link-neighborhood/0.1 (+https://github.com/atlasinorbit/link-neighborhood)';

function parseArgs(argv) {
  const args = { urls: [], outDir: DEFAULT_OUT_DIR, input: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      args.outDir = argv[++i];
    } else if (arg === '--input') {
      args.input = argv[++i];
    } else {
      args.urls.push(arg);
    }
  }
  return args;
}

async function readSeedUrls(inputPath, directUrls) {
  const urls = new Set();
  for (const url of directUrls) {
    if (url) urls.add(url.trim());
  }

  if (inputPath) {
    const text = await fs.readFile(inputPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      urls.add(trimmed);
    }
  }

  return [...urls];
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]) : null;
}

function normalizeUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return null;
  }
}

function classifyLink(url, text = '', rel = '') {
  const lowerUrl = url.toLowerCase();
  const lowerText = text.toLowerCase();
  const lowerRel = rel.toLowerCase();
  const tags = new Set();

  if (lowerRel.includes('blogroll')) tags.add('blogroll-rel');
  if (lowerUrl.endsWith('.opml')) tags.add('opml');
  if (lowerUrl.endsWith('.xml') && (lowerText.includes('opml') || lowerText.includes('blogroll'))) tags.add('opml-ish');
  if (lowerUrl.endsWith('.xbel')) tags.add('xbel');
  if (/\/(links?|blogroll|elsewhere|following|recommendations?|bookmarks?)\b/.test(lowerUrl)) tags.add('links-page');
  if (lowerUrl.includes('webring') || lowerText.includes('webring')) tags.add('webring');
  if (lowerText.includes('blogroll')) tags.add('blogroll-text');
  if (lowerText.includes('directory')) tags.add('directory');
  if (lowerText.includes('random')) tags.add('random-hop');

  return [...tags];
}

function extractLinks(html, baseUrl) {
  const links = [];
  const anchorRegex = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRegex)) {
    const before = match[1] || '';
    const href = match[3] || '';
    const after = match[4] || '';
    const inner = stripTags(match[5] || '');
    const relMatch = `${before} ${after}`.match(/rel\s*=\s*(["'])(.*?)\1/i);
    const rel = relMatch ? relMatch[2] : '';
    const absolute = normalizeUrl(href, baseUrl);
    if (!absolute || !absolute.startsWith('http')) continue;
    links.push({
      url: absolute,
      text: inner,
      rel,
      tags: classifyLink(absolute, inner, rel),
    });
  }

  const headLinkRegex = /<link\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>/gi;
  for (const match of html.matchAll(headLinkRegex)) {
    const attrs = `${match[1] || ''} ${match[4] || ''}`;
    const relMatch = attrs.match(/rel\s*=\s*(["'])(.*?)\1/i);
    const rel = relMatch ? relMatch[2] : '';
    const absolute = normalizeUrl(match[3] || '', baseUrl);
    if (!absolute || !absolute.startsWith('http')) continue;
    const tags = classifyLink(absolute, '', rel);
    if (tags.length === 0) continue;
    links.push({ url: absolute, text: '', rel, tags, source: 'head' });
  }

  return dedupeLinks(links);
}

function dedupeLinks(links) {
  const seen = new Map();
  for (const link of links) {
    const key = link.url;
    if (!seen.has(key)) {
      seen.set(key, { ...link });
      continue;
    }
    const existing = seen.get(key);
    existing.tags = [...new Set([...(existing.tags || []), ...(link.tags || [])])];
    existing.text = existing.text || link.text;
    existing.rel = existing.rel || link.rel;
  }
  return [...seen.values()];
}

function summarizeDomains(pages) {
  const counts = new Map();
  for (const page of pages) {
    for (const link of page.discoveryLinks) {
      try {
        const host = new URL(link.url).host;
        counts.set(host, (counts.get(host) || 0) + 1);
      } catch {
        // ignore bad urls
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([host, count]) => ({ host, count }));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml(report) {
  const pageCards = report.pages.map((page) => {
    const discoveryItems = page.discoveryLinks.slice(0, 40).map((link) => `\n      <li><a href="${escapeHtml(link.url)}">${escapeHtml(link.text || link.url)}</a> <span class="tags">${escapeHtml(link.tags.join(', '))}</span></li>`).join('');
    return `
    <section class="card">
      <h2><a href="${escapeHtml(page.url)}">${escapeHtml(page.title || page.url)}</a></h2>
      <p class="meta">${escapeHtml(page.url)}</p>
      <p>${page.discoveryLinks.length} discovery-flavored links out of ${page.linkCount} total outbound links.</p>
      <ul>${discoveryItems || '<li>No discovery links found.</li>'}</ul>
    </section>`;
  }).join('\n');

  const domainItems = report.topDomains.map((item) => `<li><strong>${escapeHtml(item.host)}</strong> — ${item.count}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>link-neighborhood report</title>
  <style>
    body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 980px; padding: 0 1rem; line-height: 1.5; background: #fbfaf7; color: #1f2937; }
    h1, h2 { line-height: 1.2; }
    .meta { color: #6b7280; font-size: 0.95rem; }
    .card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem 1.2rem; margin: 1rem 0; box-shadow: 0 2px 10px rgba(0,0,0,0.03); }
    .tags { color: #7c3aed; font-size: 0.9rem; }
    code { background: #f3f4f6; padding: 0.15rem 0.35rem; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>link-neighborhood report</h1>
  <p class="meta">Generated ${escapeHtml(report.generatedAt)}</p>
  <p>Crawled ${report.pages.length} seed pages and found ${report.pages.reduce((sum, page) => sum + page.discoveryLinks.length, 0)} discovery-flavored outbound links.</p>

  <section class="card">
    <h2>Top linked domains</h2>
    <ul>${domainItems || '<li>No domains yet.</li>'}</ul>
  </section>

  ${pageCards}
</body>
</html>`;
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const html = await response.text();
  return {
    url: response.url,
    html,
    contentType: response.headers.get('content-type') || '',
  };
}

async function crawlPage(url) {
  try {
    const page = await fetchPage(url);
    const title = extractTitle(page.html);
    const links = extractLinks(page.html, page.url);
    const discoveryLinks = links.filter((link) => link.tags.length > 0);
    return {
      url: page.url,
      title,
      contentType: page.contentType,
      linkCount: links.length,
      discoveryLinks,
      status: 'ok',
    };
  } catch (error) {
    return {
      url,
      title: null,
      contentType: null,
      linkCount: 0,
      discoveryLinks: [],
      status: 'error',
      error: error.message,
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seedUrls = await readSeedUrls(args.input, args.urls);
  if (seedUrls.length === 0) {
    console.error('Usage: node src/cli.js [--input seeds.txt] [--out out] <url...>');
    process.exit(1);
  }

  const pages = [];
  for (const url of seedUrls) {
    console.error(`Crawling ${url}`);
    pages.push(await crawlPage(url));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    seedUrls,
    pages,
    topDomains: summarizeDomains(pages),
  };

  await fs.mkdir(args.outDir, { recursive: true });
  await fs.writeFile(path.join(args.outDir, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(args.outDir, 'report.html'), renderHtml(report));
  console.error(`Wrote ${path.join(args.outDir, 'report.json')} and report.html`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
