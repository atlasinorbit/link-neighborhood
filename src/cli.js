#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_OUT_DIR = 'out';
const USER_AGENT = 'link-neighborhood/0.1 (+https://github.com/atlasinorbit/link-neighborhood)';

function parseArgs(argv) {
  const args = { urls: [], outDir: DEFAULT_OUT_DIR, input: null, depth: 0, wander: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      args.outDir = argv[++i];
    } else if (arg === '--input') {
      args.input = argv[++i];
    } else if (arg === '--depth') {
      args.depth = Number.parseInt(argv[++i], 10) || 0;
    } else if (arg === '--wander') {
      args.wander = Number.parseInt(argv[++i], 10) || 0;
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
    const resolved = new URL(url, baseUrl);
    resolved.hash = '';
    return resolved.toString();
  } catch {
    return null;
  }
}

function classifyLink(url, text = '', rel = '') {
  const lowerText = text.toLowerCase();
  const lowerRel = rel.toLowerCase();
  const tags = new Set();

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }

  const lowerHost = parsed.host.toLowerCase();
  const lowerPath = parsed.pathname.toLowerCase();

  if (lowerRel.includes('blogroll')) tags.add('blogroll-rel');
  if (lowerPath.endsWith('.opml')) tags.add('opml');
  if (lowerPath.endsWith('.xml') && (lowerText.includes('opml') || lowerText.includes('blogroll'))) tags.add('opml-ish');
  if (lowerPath.endsWith('.xbel')) tags.add('xbel');
  if (/\/(links?|blogroll|elsewhere|following|recommendations?|bookmarks?)\b/.test(lowerPath)) tags.add('links-page');
  if (lowerHost.includes('webring') || lowerPath.includes('webring') || lowerText.includes('webring')) tags.add('webring');
  if (lowerText.includes('blogroll')) tags.add('blogroll-text');
  if (lowerText.includes('directory')) tags.add('directory');
  if (lowerText.includes('random')) tags.add('random-hop');

  return [...tags];
}

function extractHtmlLinks(html, baseUrl) {
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

  return links;
}

function extractXmlLinks(xml, baseUrl) {
  const links = [];

  const opmlOutlineRegex = /<outline\b[^>]*\b(?:xmlUrl|htmlUrl|url)\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  for (const match of xml.matchAll(opmlOutlineRegex)) {
    const tag = match[0] || '';
    const textMatch = tag.match(/\b(?:text|title)\s*=\s*(["'])(.*?)\1/i);
    const htmlUrlMatch = tag.match(/\bhtmlUrl\s*=\s*(["'])(.*?)\1/i);
    const xmlUrlMatch = tag.match(/\bxmlUrl\s*=\s*(["'])(.*?)\1/i);
    const urlMatch = tag.match(/\burl\s*=\s*(["'])(.*?)\1/i);

    const candidates = [
      { value: htmlUrlMatch?.[2], rel: 'opml-htmlUrl', source: 'opml' },
      { value: xmlUrlMatch?.[2], rel: 'opml-xmlUrl', source: 'opml' },
      { value: urlMatch?.[2], rel: 'opml-url', source: 'opml' },
    ];

    for (const candidate of candidates) {
      if (!candidate.value) continue;
      const absolute = normalizeUrl(candidate.value, baseUrl);
      if (!absolute || !absolute.startsWith('http')) continue;
      const text = textMatch ? stripTags(textMatch[2]) : '';
      const tags = [...new Set([...classifyLink(absolute, text, candidate.rel), 'opml-entry'])];
      links.push({ url: absolute, text, rel: candidate.rel, tags, source: candidate.source });
    }
  }

  const xbelBookmarkRegex = /<bookmark\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/bookmark>/gi;
  for (const match of xml.matchAll(xbelBookmarkRegex)) {
    const absolute = normalizeUrl(match[2] || '', baseUrl);
    if (!absolute || !absolute.startsWith('http')) continue;
    const titleMatch = (match[3] || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const text = titleMatch ? stripTags(titleMatch[1]) : '';
    const tags = [...new Set([...classifyLink(absolute, text, 'xbel-bookmark'), 'xbel-entry'])];
    links.push({ url: absolute, text, rel: 'xbel-bookmark', tags, source: 'xbel' });
  }

  return links;
}

function extractLinks(content, baseUrl, contentType = '') {
  const lowerType = contentType.toLowerCase();
  const looksXml = lowerType.includes('xml') || lowerType.includes('opml') || lowerType.includes('xbel') || /^\s*<\?xml\b/i.test(content);
  const links = looksXml ? extractXmlLinks(content, baseUrl) : extractHtmlLinks(content, baseUrl);
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

function summarizeTags(pages) {
  const counts = new Map();
  for (const page of pages) {
    for (const link of page.discoveryLinks) {
      for (const tag of link.tags || []) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));
}

function collectDiscoveryUrls(pages) {
  const urls = new Set();
  for (const page of pages) {
    for (const link of page.discoveryLinks) {
      if (link.url) urls.add(link.url);
    }
  }
  return [...urls].sort();
}

function pickWanderUrls(discoveryUrls, count, seedUrls = []) {
  const pool = discoveryUrls.filter((url) => !seedUrls.includes(url));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.max(0, count));
}

function buildGraph(pages) {
  const nodeMap = new Map();
  const edgeMap = new Map();

  const ensureNode = (url, extras = {}) => {
    if (!url) return;
    let existing = nodeMap.get(url);
    if (!existing) {
      let host = null;
      try {
        host = new URL(url).host;
      } catch {
        host = null;
      }
      existing = { url, host, title: null, type: 'discovery', tags: [] };
      nodeMap.set(url, existing);
    }

    if (extras.title && !existing.title) existing.title = extras.title;
    if (extras.type) existing.type = extras.type;
    if (extras.tags?.length) {
      existing.tags = [...new Set([...(existing.tags || []), ...extras.tags])].sort();
    }
  };

  for (const page of pages) {
    ensureNode(page.url, {
      title: page.title || page.url,
      type: page.depth === 0 ? 'seed' : 'crawled',
      tags: [],
    });

    for (const link of page.discoveryLinks) {
      ensureNode(link.url, {
        title: link.text || null,
        type: 'discovery',
        tags: link.tags || [],
      });

      const key = `${page.url} -> ${link.url}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          from: page.url,
          to: link.url,
          tags: [...new Set(link.tags || [])].sort(),
          text: link.text || '',
          rel: link.rel || '',
          source: link.source || 'html',
        });
        continue;
      }

      const existing = edgeMap.get(key);
      existing.tags = [...new Set([...(existing.tags || []), ...(link.tags || [])])].sort();
      existing.text = existing.text || link.text || '';
      existing.rel = existing.rel || link.rel || '';
      existing.source = existing.source || link.source || 'html';
    }
  }

  return {
    nodes: [...nodeMap.values()].sort((a, b) => a.url.localeCompare(b.url)),
    edges: [...edgeMap.values()].sort((a, b) => {
      if (a.from === b.from) return a.to.localeCompare(b.to);
      return a.from.localeCompare(b.from);
    }),
  };
}

function renderDot(graph) {
  const lines = ['digraph link_neighborhood {', '  rankdir=LR;', '  node [shape=box, style="rounded"];'];

  for (const node of graph.nodes) {
    const label = (node.title || node.url).replace(/"/g, '\\"');
    const url = node.url.replace(/"/g, '\\"');
    const color = node.type === 'seed' ? '#2563eb' : node.type === 'crawled' ? '#7c3aed' : '#6b7280';
    lines.push(`  "${url}" [label="${label}", color="${color}"];`);
  }

  for (const edge of graph.edges) {
    const from = edge.from.replace(/"/g, '\\"');
    const to = edge.to.replace(/"/g, '\\"');
    const label = edge.tags?.length ? ` [label="${edge.tags.join(', ').replace(/"/g, '\\"')}"]` : '';
    lines.push(`  "${from}" -> "${to}"${label};`);
  }

  lines.push('}');
  return `${lines.join('\n')}\n`;
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
      <p>${page.discoveryLinks.length} discovery-flavored links out of ${page.linkCount} total outbound links.${page.depth > 0 ? ` Reached at crawl depth ${page.depth}.` : ''}</p>
      <ul>${discoveryItems || '<li>No discovery links found.</li>'}</ul>
    </section>`;
  }).join('\n');

  const domainItems = report.topDomains.map((item) => `<li><strong>${escapeHtml(item.host)}</strong> — ${item.count}</li>`).join('');
  const tagItems = report.tagSummary.map((item) => `<li><strong>${escapeHtml(item.tag)}</strong> — ${item.count}</li>`).join('');
  const wanderItems = report.wanderUrls.map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`).join('');

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
  <p>Crawled ${report.pages.length} page${report.pages.length === 1 ? '' : 's'} from ${report.seedUrls.length} seed${report.seedUrls.length === 1 ? '' : 's'} and found ${report.pages.reduce((sum, page) => sum + page.discoveryLinks.length, 0)} discovery-flavored outbound links.</p>
  <p>Max crawl depth: <code>${report.maxDepth}</code></p>

  <section class="card">
    <h2>Top linked domains</h2>
    <ul>${domainItems || '<li>No domains yet.</li>'}</ul>
  </section>

  <section class="card">
    <h2>Discovery tags</h2>
    <ul>${tagItems || '<li>No discovery tags yet.</li>'}</ul>
  </section>

  <section class="card">
    <h2>Reusable trail</h2>
    <p>Saved <code>discovery-links.txt</code> with ${report.discoveryUrls.length} unique discovery-flavored URLs for reuse as future seeds.</p>
  </section>

  <section class="card">
    <h2>Graph export</h2>
    <p>Saved <code>graph.json</code> with ${report.graph.nodes.length} nodes and ${report.graph.edges.length} directed discovery edges, plus a Graphviz-friendly <code>graph.dot</code> sketch for quick mapping.</p>
  </section>

  <section class="card">
    <h2>Wander picks</h2>
    <p>Saved <code>wander.txt</code> with ${report.wanderUrls.length} random discovery URLs as easy places to start drifting from this crawl.</p>
    <ul>${wanderItems || '<li>No wander picks this time.</li>'}</ul>
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

async function crawlPage(url, depth = 0) {
  try {
    const page = await fetchPage(url);
    const title = extractTitle(page.html);
    const links = extractLinks(page.html, page.url, page.contentType);
    const discoveryLinks = links.filter((link) => link.tags.length > 0 && link.url !== page.url);
    return {
      url: page.url,
      title,
      contentType: page.contentType,
      linkCount: links.length,
      discoveryLinks,
      status: 'ok',
      depth,
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
      depth,
    };
  }
}

async function crawlNeighborhood(seedUrls, maxDepth) {
  const pages = [];
  const visited = new Set();
  const queue = seedUrls.map((url) => ({ url, depth: 0 }));

  while (queue.length > 0) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    console.error(`Crawling ${url}${depth > 0 ? ` (depth ${depth})` : ''}`);
    const page = await crawlPage(url, depth);
    pages.push(page);

    if (page.status !== 'ok' || depth >= maxDepth) continue;

    for (const link of page.discoveryLinks) {
      if (visited.has(link.url)) continue;
      queue.push({ url: link.url, depth: depth + 1 });
    }
  }

  return pages;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seedUrls = await readSeedUrls(args.input, args.urls);
  if (seedUrls.length === 0) {
    console.error('Usage: node src/cli.js [--input seeds.txt] [--out out] [--depth 0] <url...>');
    process.exit(1);
  }

  const pages = await crawlNeighborhood(seedUrls, Math.max(0, args.depth));

  const discoveryUrls = collectDiscoveryUrls(pages);
  const graph = buildGraph(pages);
  const wanderUrls = pickWanderUrls(discoveryUrls, args.wander, seedUrls);
  const report = {
    generatedAt: new Date().toISOString(),
    seedUrls,
    maxDepth: Math.max(0, args.depth),
    pages,
    topDomains: summarizeDomains(pages),
    tagSummary: summarizeTags(pages),
    discoveryUrls,
    wanderUrls,
    graph,
  };

  await fs.mkdir(args.outDir, { recursive: true });
  await fs.writeFile(path.join(args.outDir, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(args.outDir, 'report.html'), renderHtml(report));
  await fs.writeFile(path.join(args.outDir, 'discovery-links.txt'), `${discoveryUrls.join('\n')}\n`);
  await fs.writeFile(path.join(args.outDir, 'wander.txt'), `${wanderUrls.join('\n')}\n`);
  await fs.writeFile(path.join(args.outDir, 'graph.json'), JSON.stringify(graph, null, 2));
  await fs.writeFile(path.join(args.outDir, 'graph.dot'), renderDot(graph));
  console.error(`Wrote ${path.join(args.outDir, 'report.json')}, report.html, discovery-links.txt, wander.txt, graph.json, and graph.dot`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
