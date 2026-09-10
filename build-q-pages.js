#!/usr/bin/env node
/* ============================================================
   TierBrain — question page generator
   ------------------------------------------------------------
   Reads questions.js and writes one static, crawlable HTML page
   per question into /q/, plus sitemap-questions.xml.

   WHY: every question currently lives inside JavaScript, so Google
   cannot see any of them. People search in exact question phrasing
   ("what is the capital of turkmenistan"), so each question needs
   its own indexable page to capture that traffic.

   RUN:  node build-q-pages.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const SITE   = 'https://tierbrain.co';
const OUTDIR = path.join(__dirname, 'q');
const TIER_NAMES = { '1':'Easy', '2':'Medium', '3':'Hard', '4':'Legends' };

// ---- load the shared bank -------------------------------------------------
global.window = {};
require('./questions.js');
const BANK = global.window.TB_BANK.gk;

// ---- which questions deserve a page? --------------------------------------
// Thin, low-demand questions ("what is the opposite of tall?") would be
// exactly the auto-generated filler Google penalises. We publish only
// questions that look like something a person would actually type.
function worthPublishing(q) {
  const t = q.q.trim();
  if (t.length < 22) return false;                       // too short to be a real search
  if (/opposite of|which is bigger|how many letters/i.test(t)) return false;
  if (/^(is|are|do|does|can)\b/i.test(t)) return false;   // yes/no style, low intent
  const words = t.split(/\s+/).length;
  if (words < 5) return false;
  return true;
}

// ---- helpers --------------------------------------------------------------
function slugify(s) {
  return s.toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function shuffle(a, seed) {
  const r = [...a];
  let s = seed;
  for (let i = r.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// ---- page template --------------------------------------------------------
function page(item, related) {
  const { q, correct, wrong, tier, slug } = item;
  const options = shuffle([correct, ...wrong], q.length);
  const title = `${q} — Answer`;
  const desc  = `The answer is ${correct}. Test yourself with more ${TIER_NAMES[tier].toLowerCase()} general knowledge questions on TierBrain.`;
  const url   = `${SITE}/q/${slug}.html`;

  // Structured data helps Google show the answer directly in results.
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "QAPage",
    "mainEntity": {
      "@type": "Question",
      "name": q,
      "answerCount": 1,
      "acceptedAnswer": { "@type": "Answer", "text": correct }
    }
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} | TierBrain</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#161232">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  a{text-decoration:none;color:inherit;}
  :root{--bg0:#0c0a1e;--bg1:#161232;--bg2:#0d1430;--ink:#f4f1ff;--mut:#a9a4cf;--line:rgba(255,255,255,.10);--gold:#f2c95c;--good:#57d38a;}
  body{font-family:'Nunito',system-ui,sans-serif;color:var(--ink);min-height:100vh;
    background:radial-gradient(90% 60% at 15% -10%,rgba(201,138,224,.16),transparent 55%),
      radial-gradient(70% 50% at 100% 0%,rgba(61,143,232,.14),transparent 55%),
      linear-gradient(165deg,var(--bg0),var(--bg1) 55%,var(--bg2));
    background-attachment:fixed;padding:0 20px 60px;}
  .wrap{max-width:720px;margin:0 auto;}
  header{padding:26px 0 6px;}
  .word{font-family:'Baloo 2';font-weight:700;font-size:19px;}
  .word b{color:var(--gold);font-weight:800;}
  nav{color:var(--mut);font-size:13px;font-weight:700;margin-top:14px;}
  nav a:hover{color:var(--ink);}
  h1{font-family:'Baloo 2';font-weight:700;font-size:clamp(24px,4.6vw,34px);line-height:1.2;margin:22px 0 6px;}
  .tier{display:inline-block;font-weight:800;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;
    color:var(--gold);border:1px solid rgba(242,201,92,.35);border-radius:999px;padding:4px 11px;}
  .answer{background:rgba(87,211,138,.10);border:1px solid rgba(87,211,138,.32);border-radius:16px;
    padding:20px;margin:22px 0;}
  .answer .lbl{font-weight:800;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--good);}
  .answer .val{font-family:'Baloo 2';font-weight:700;font-size:clamp(22px,4vw,30px);margin-top:5px;}
  h2{font-family:'Baloo 2';font-weight:700;font-size:18px;margin:30px 0 12px;}
  .opts{display:grid;gap:9px;}
  .opt{background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:11px;padding:12px 14px;font-weight:700;font-size:14.5px;}
  .opt.right{border-color:rgba(87,211,138,.45);background:rgba(87,211,138,.09);}
  .opt .mark{color:var(--good);font-weight:800;margin-right:7px;}
  .cta{display:block;background:linear-gradient(135deg,#f2c95c,#e0912f);color:#241a12;border-radius:14px;
    padding:17px;text-align:center;font-family:'Baloo 2';font-weight:800;font-size:17px;margin:28px 0 8px;}
  .cta span{display:block;font-family:'Nunito';font-weight:700;font-size:12.5px;opacity:.75;margin-top:2px;}
  .rel{display:grid;gap:8px;}
  .rel a{background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:11px;
    padding:12px 14px;font-weight:700;font-size:14px;color:var(--mut);}
  .rel a:hover{color:var(--ink);border-color:rgba(242,201,92,.4);}
  footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--line);color:var(--mut);font-size:12.5px;font-weight:700;text-align:center;}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="word" href="/">Tier<b>Brain</b></a>
    <nav><a href="/">Home</a> &rsaquo; <a href="/general-knowledge-quiz.html">General Knowledge</a> &rsaquo; Question</nav>
  </header>
  <main>
    <span class="tier">${TIER_NAMES[tier]} &middot; General Knowledge</span>
    <h1>${esc(q)}</h1>

    <div class="answer">
      <div class="lbl">Answer</div>
      <div class="val">${esc(correct)}</div>
    </div>

    <h2>How it appears in the quiz</h2>
    <div class="opts">
${options.map(o => `      <div class="opt${o === correct ? ' right' : ''}">${o === correct ? '<span class="mark">&#10003;</span>' : ''}${esc(o)}</div>`).join('\n')}
    </div>

    <a class="cta" href="/general-knowledge-quiz.html">Play the full quiz
      <span>1,000 questions &middot; four tiers &middot; free, no sign-up</span></a>

    <h2>More questions like this</h2>
    <div class="rel">
${related.map(r => `      <a href="/q/${r.slug}.html">${esc(r.q)}</a>`).join('\n')}
    </div>
  </main>
  <footer>
    <a href="/">TierBrain</a> &middot; free quizzes, puzzles and party games
  </footer>
</div>
</body>
</html>`;
}

// ---- build ----------------------------------------------------------------
const all = [];
const seen = new Set();
for (const tier of ['1','2','3','4']) {
  for (const item of (BANK[tier] || [])) {
    if (!worthPublishing(item)) continue;
    const slug = slugify(item.q);
    if (!slug || seen.has(slug)) continue;     // skip collisions
    seen.add(slug);
    all.push({ ...item, tier, slug });
  }
}

if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

all.forEach((item, i) => {
  // related = neighbours in the same tier, so links stay topically sensible
  const sameTier = all.filter(x => x.tier === item.tier && x.slug !== item.slug);
  const related = [];
  for (let k = 1; related.length < 5 && k < sameTier.length; k++) {
    related.push(sameTier[(i + k * 7) % sameTier.length]);
  }
  fs.writeFileSync(path.join(OUTDIR, item.slug + '.html'), page(item, related));
});

// sitemap
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.map(i => `  <url><loc>${SITE}/q/${i.slug}.html</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`).join('\n')}
</urlset>`;
fs.writeFileSync(path.join(__dirname, 'sitemap-questions.xml'), sitemap);

const total = Object.values(BANK).reduce((n, a) => n + a.length, 0);
console.log(`Questions in bank:      ${total}`);
console.log(`Passed quality filter:  ${all.length}`);
console.log(`Skipped (too thin):     ${total - all.length}`);
console.log(`Pages written to:       ${OUTDIR}`);
console.log(`Sitemap:                sitemap-questions.xml`);
