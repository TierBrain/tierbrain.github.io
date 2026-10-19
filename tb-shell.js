/* TierBrain shared footer for game and quiz pages.
   Add near the end of <body>:  <script src="tb-shell.js" data-tone="dark" defer></script>
   Options (all optional):
     data-tone="dark|light"   match the page background (default dark)
     data-mode="footer|none"  "none" turns it off for a page that cannot take one
     data-target="#selector"  append inside that element instead of <body>
     data-notice="quiz"       add the "unofficial fan quiz" line (use on quizzes about brands, clubs, shows)
     data-hide-when=".over"   hide the footer while a full-screen overlay with that selector is showing
   One file controls the look on every page, so design changes are a single edit. */
(function(){
  var me = document.currentScript;
  function opt(n, d){ return (me && me.getAttribute('data-' + n)) || d; }
  var mode = opt('mode', 'footer'), tone = opt('tone', 'dark'), target = opt('target', ''), notice = opt('notice', ''), hideWhen = opt('hide-when', '');
  if(mode === 'none') return;
  function run(){
    if(document.getElementById('tb-shell')) return;
    var css = '.tb-foot{box-sizing:border-box;flex:none;align-self:center;width:100%;max-width:640px;margin:28px auto 0;padding:14px 16px calc(22px + env(safe-area-inset-bottom,0px));text-align:center;font:700 13px/1.5 Nunito,system-ui,-apple-system,sans-serif;border-top:1px solid var(--tbline);color:var(--tbmut);}'
      + '.tb-dark{--tbmut:#c2a99a;--tbink:#fbf1e2;--tbgold:#e6b655;--tbline:rgba(255,255,255,.14);}'
      + '.tb-light{--tbmut:#6b5649;--tbink:#2a1a14;--tbgold:#85590a;--tbline:rgba(60,36,28,.22);}'
      + '.tb-foot a{text-decoration:none;}'
      + '.tb-home{display:inline-flex;align-items:center;gap:8px;min-height:44px;color:var(--tbgold);font-weight:800;font-size:14px;}'
      + '.tb-home svg{width:24px;height:24px;flex:none;}'
      + '.tb-w{display:inline-flex;font-size:16px;}.tb-w span{color:var(--tbink);font-weight:500;}.tb-w b{color:var(--tbgold);font-weight:800;}.tb-sub{color:var(--tbmut);font-weight:700;font-size:13px;padding-left:10px;border-left:1px solid var(--tbline);}'
      + '.tb-links{display:flex;flex-wrap:wrap;justify-content:center;gap:0 4px;}'
      + '.tb-links a{display:inline-flex;align-items:center;min-height:40px;padding:0 8px;color:var(--tbink);font-weight:800;}'
      + '.tb-links a:hover,.tb-home:hover .tb-sub{color:var(--tbgold);text-decoration:underline;text-underline-offset:3px;}'
      + '.tb-foot a:focus-visible{outline:3px solid var(--tbgold);outline-offset:2px;border-radius:6px;}'
      + '.tb-fine{margin:6px auto 0;max-width:56ch;font-size:12px;font-weight:600;color:var(--tbmut);}';
    if(hideWhen) css += hideWhen.split(',').map(function(x){ return x.trim() + ':not([hidden]) ~ .tb-foot'; }).join(',') + '{visibility:hidden;}';
    var st = document.createElement('style'); st.id = 'tb-shell-css'; st.textContent = css; document.head.appendChild(st);
    var mark = '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><clipPath id="tbsc"><path d="M22.3 9C15 6 6 10 6 20C3 24 4 32 9 34C10 40 18 42 22.3 38Z"/><path d="M25.7 9C33 6 42 10 42 20C45 24 44 32 39 34C38 40 30 42 25.7 38Z"/></clipPath></defs>'
      + '<g clip-path="url(#tbsc)"><rect y="5" width="48" height="11.07" fill="#f2d27a"/><rect y="19.47" width="48" height="9.07" fill="#d9694f"/><rect y="31.93" width="48" height="10.07" fill="#86bf9d"/></g></svg>';
    var f = document.createElement('footer'); f.id = 'tb-shell'; f.className = 'tb-foot tb-' + (tone === 'light' ? 'light' : 'dark');
    f.innerHTML = '<a class="tb-home" href="./" aria-label="All TierBrain games">' + mark + '<span class="tb-w"><span>Tier</span><b>Brain</b></span><span class="tb-sub">All games</span></a>'
      + '<nav class="tb-links" aria-label="About and legal"><a href="about.html">About</a><a href="contact.html">Contact</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="contact.html#report">Report a question</a></nav>'
      + (notice === 'quiz' ? '<p class="tb-fine">TierBrain is an independent site. It is not affiliated with, endorsed by or sponsored by any club, league, broadcaster, programme or brand named in a quiz.</p>' : '');
    var host = (target && document.querySelector(target)) || document.body; host.appendChild(f);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
