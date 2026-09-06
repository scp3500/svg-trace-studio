/* ================= 工具逻辑 ================= */
const $ = id => document.getElementById(id);
const log = (msg, spin) => { $('log').innerHTML = spin ? '<span class="spin"></span>' + msg : msg; };
const wait = ms => new Promise(r => setTimeout(r, ms));

['cp','fs','ld','layers','stagger','csslayers'].forEach(id => {
  $(id).addEventListener('input', () => {
    if (id === 'cp') $('cpv').textContent = $(id).value;
    if (id === 'fs') $('fsv').textContent = $(id).value;
    if (id === 'ld') $('ldv').textContent = $(id).value;
    if (id === 'layers') $('layersv').textContent = $(id).value;
    if (id === 'stagger') $('staggerv').textContent = '.' + String($(id).value).padStart(2, '0');
    if (id === 'csslayers') $('csslayersv').textContent = $(id).value;
  });
});

let SRC = null;   // { canvas, w, h, rgba } —— 当前工作图
let SVG = null;   // 描摹结果
let animTimer = null;

/* ---------- 加载图片 ---------- */
$('drop').addEventListener('click', e => { if (e.target !== $('file')) $('file').click(); });
$('file').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
$('drop').addEventListener('dragover', e => { e.preventDefault(); $('drop').classList.add('over'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', e => {
  e.preventDefault(); $('drop').classList.remove('over');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

function previewBox() {
  // 两个预览框统一适配：宽不超侧栏可用宽度，高不超视口 62%，比例恒定
  const availW = Math.min(340, Math.max(200, window.innerWidth - (window.innerWidth <= 860 ? 40 : 620)));
  const availH = Math.max(220, Math.round(window.innerHeight * 0.62));
  const k = Math.min(availW / SRC.w, availH / SRC.h);
  return { w: Math.round(SRC.w * k), h: Math.round(SRC.h * k) };
}
function fitPreviews() {
  const box = previewBox();
  ['pvSrc', 'pvOut'].forEach(id => {
    const el = $(id);
    el.style.width = box.w + 'px';
    el.style.height = box.h + 'px';
  });
}
window.addEventListener('resize', () => { if (SRC && !$('pvwrap').hidden) fitPreviews(); });

async function loadFile(file) {
  try {
    log('读取图片…', true);
    const bmp = await createImageBitmap(file);
    await wait(30);
    const up = +$('upscale').value;
    let w = bmp.width * up, h = bmp.height * up;
    const MAX = 1600;
    if (Math.max(w, h) > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(bmp, 0, 0, w, h);
    const rgba = cx.getImageData(0, 0, w, h).data;
    SRC = { canvas: cv, w, h, rgba };
    // 原图预览（两框同尺寸）
    fitPreviews();
    const pv = $('cvSrc');
    const box = previewBox();
    pv.width = box.w; pv.height = Math.round(box.w * h / w);
    pv.style.width = box.w + 'px';
    pv.getContext('2d').drawImage(cv, 0, 0, pv.width, pv.height);
    $('pvwrap').hidden = false;
    $('pvOutTitle').textContent = '描摹结果（工作尺寸 ' + w + '×' + h + '）';
    log('已加载 ' + bmp.width + '×' + bmp.height + (up > 1 ? ' → 工作尺寸 ' + w + '×' + h : ''));
    $('retrace').disabled = false;
    await trace();
  } catch (err) { log('加载失败：' + err.message); }
}

/* ---------- 描摹 ---------- */
$('retrace').addEventListener('click', () => SRC && trace());

async function trace() {
  if (!SRC) return;
  log('VTracer 描摹中…', true);
  await wait(50);
  try {
    const t0 = performance.now();
    const svgText = convertPixels(SRC.rgba, SRC.w, SRC.h, {
      mode: $('mode').value,
      hierarchical: $('hier').value,
      colorPrecision: +$('cp').value,
      filterSpeckle: +$('fs').value,
      layerDifference: +$('ld').value,
      pathPrecision: 2,
    });
    const ms = Math.round(performance.now() - t0);
    SVG = svgText;
    const n = (svgText.match(/<path/g) || []).length;
    const kb = (new Blob([svgText]).size / 1024).toFixed(0);
    $('stats').hidden = false;
    $('stats').innerHTML =
      '<span class="chip">路径 <b>' + n + '</b></span>' +
      '<span class="chip">SVG <b>' + kb + '</b> KB</span>' +
      '<span class="chip">耗时 <b>' + ms + '</b> ms</span>' +
      '<span class="chip">工作尺寸 <b>' + SRC.w + '×' + SRC.h + '</b></span>';
    // 静态预览（alpha 版无 viewBox，需补上才能响应式缩放）
    const out = $('pvOut');
    out.style.aspectRatio = SRC.w + '/' + SRC.h;
    out.innerHTML = '<span class="tag" id="pvOutTag">SVG</span>' + svgText.replace('<svg ', '<svg viewBox="0 0 ' + SRC.w + ' ' + SRC.h + '" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;position:absolute;inset:0" ');
    ['dlsvg', 'dlpng', 'dlstatic', 'dlanim', 'dlcsszip', 'replay'].forEach(id => $(id).disabled = false);
    log('完成。调整参数后点「重新描摹」；右侧预览可直接播放动画。');
  } catch (err) { log('描摹失败：' + err.message); console.error(err); }
}

/* ---------- 动画构建（预览与导出共用） ---------- */
function buildAnim(svgText, o, W, H) {
  const paths = svgText.match(/<path\b.*?\/>/gs) || [];
  const w = paths.map(p => (p.match(/d="([^"]*)"/) || ['', ''])[1].length);
  const per = w.reduce((a, b) => a + b, 0) / o.layers;
  const layers = []; let cur = [], acc = 0;
  for (let i = 0; i < paths.length; i++) {
    cur.push(paths[i]); acc += w[i];
    if (acc >= per && layers.length < o.layers - 1) { layers.push(cur); cur = []; acc = 0; }
  }
  if (cur.length) layers.push(cur);

  const t = {};
  let skInner = '';
  if (o.sketch) {
    // 打稿：按墨量取最大的 32 条路径，一笔接一笔顺序勾（不再整批同时出）；
    // 顺序按空间最近邻——从一处起笔、就近连线，模拟真实勾线路径；
    // 每条线随机略偏（画不准的铅笔感）并回描一道淡复线，
    // 整组再叠 feTurbulence 位移滤镜让线条带轻微手抖毛边；勾完即草稿完成
    const main = paths.map((p, i) => i).sort((a, b) => w[b] - w[a]).slice(0, 32);
    const ctr = p => {
      const n = ((p.match(/d="([^"]*)"/) || ['', ''])[1].match(/-?\d*\.?\d+/g) || []).map(Number);
      let x = 0, y = 0, c = 0;
      for (let j = 0; j + 1 < n.length && c < 8; j += 2) { x += n[j]; y += n[j + 1]; c++; }
      return c ? [x / c, y / c] : [0, 0];
    };
    const pool = main.map(i => ({ i, c: ctr(paths[i]) }));
    const ordered = []; let here = [0, 0];
    while (pool.length) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < pool.length; j++) {
        const d = (pool[j].c[0] - here[0]) ** 2 + (pool[j].c[1] - here[1]) ** 2;
        if (d < bd) { bd = d; bi = j; }
      }
      here = pool[bi].c; ordered.push(pool.splice(bi, 1)[0].i);
    }
    // 偏移幅度按 viewBox 定：约等于显示宽 354px 时的 1.3px
    const amp = Math.max(W, H) / 260;
    const jit = () => ((Math.random() * 2 - 1) * amp).toFixed(2);
    const sketchify = p => {
      const put = ghost => '<g transform="translate(' + jit() + ' ' + jit() + '">'
        + p.replace('<path ', '<path pathLength="1"' + (ghost ? ' opacity=".38"' : '') + ' ', 1) + '</g>';
      return put(false) + '\n' + put(true);
    };
    // 位移滤镜参数随 viewBox 缩放，保证不同放大倍数下毛边观感一致
    const k = Math.max(1, Math.max(W, H) / 512);
    const bf = (0.18 / k).toFixed(4);
    const ds = (skbWidth(W, H) * 0.85).toFixed(2);
    skInner = '<defs><filter id="pw" x="-5%" y="-5%" width="110%" height="110%">'
      + '<feTurbulence type="fractalNoise" baseFrequency="' + bf + '" numOctaves="2" seed="7" result="n"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="n" scale="' + ds + '" xChannelSelector="R" yChannelSelector="G"/>'
      + '</filter></defs>\n'
      + ordered.map((i, k2) => '<g class="skb" style="--i:' + k2 + '">\n' + sketchify(paths[i]) + '\n</g>').join('\n');
    const drawEnd = .2 + (ordered.length - 1) * .11 + .34;  // 每笔间隔 .11s、单笔 .34s
    t.T0 = drawEnd + .15;       // 草稿完成 -> 色块原地接着铺
  } else {
    t.T0 = .3;
  }

  // 上色：每条路径逐笔落点（快速淡入 + 随机节奏微抖），
  // 层叠顺序严格保持 DOM 顺序（后层覆盖前层），只控制出现时刻
  const P = paths.length;
  const perPath = Math.min(.05, Math.max(.01, 20 / P)) * (o.stagger / .16); // 路径多时自动压缩，总时长 ~20s
  let body = ''; let gi = 0;
  layers.forEach(g => {
    body += '<g class="pg">\n';
    g.forEach(p => {
      const d = (t.T0 + gi * perPath + Math.random() * perPath * .6).toFixed(3);
      const f = (.16 + Math.random() * .1).toFixed(2);
      body += p.replace('<path ', '<path class="ps" style="--d:' + d + 's;--f:' + f + 's" ', 1) + '\n';
      gi++;
    });
    body += '</g>\n';
  });
  t.end    = t.T0 + (P - 1) * perPath + .45;
  t.out    = t.end - .9;
  t.settle = t.end;
  t.total  = t.end + 1.3;
  return { body, skInner, t, layers: layers.length, count: paths.length };
}

/* 草稿线宽随 viewBox 缩放：大 viewBox 下固定 2.6 单位会细成亚像素 */
function skbWidth(w, h) { return +(2.6 * Math.max(1, Math.max(w, h) / 512)).toFixed(2); }

function animContent(svgText, src, o, beam) {
  const a = buildAnim(svgText, o, src.w, src.h);
  if (beam) {
    return { inner: a.body, extra: '<div class="glow"></div>\n<div class="shine"></div>', t: a.t, layers: a.layers, count: a.count };
  }
  const inner = (o.sketch ? '<g class="skst" filter="url(#pw)">\n' + a.skInner + '\n</g>\n' : '')
    + '<g id="art">\n' + a.body + '\n</g>';
  return { inner, extra: '', t: a.t, layers: a.layers, count: a.count };
}

/* ---------- 预览动画 ---------- */
$('replay').addEventListener('click', playAnim);

function animOpts() {
  return { layers: +$('layers').value, stagger: +$('stagger').value / 100, sketch: $('sketch').checked };
}

function playAnim() {
  if (!SVG) return;
  const o = animOpts();
  const beam = $('anim').value === 'beam';
  const a = animContent(SVG, SRC, o, beam);
  const out = $('pvOut');
  out.style.aspectRatio = SRC.w + '/' + SRC.h;
  const svgOpen = '<svg version="1.1" viewBox="0 0 ' + SRC.w + ' ' + SRC.h + '" xmlns="http://www.w3.org/2000/svg" class="' + (beam ? 'beam-svg' : '') + '">';
  out.innerHTML = '<span class="tag">动画 · ' + a.layers + ' 层</span>'
    + a.extra + svgOpen + a.inner + '</svg>';
  if (!beam) {
    const st = out.querySelector('svg');
    st.style.setProperty('--out', a.t.out.toFixed(2) + 's');
    st.style.setProperty('--settle', a.t.settle.toFixed(2) + 's');
    st.style.setProperty('--skb-w', skbWidth(SRC.w, SRC.h) + 'px');
  }
  out.classList.remove('playing'); void out.offsetWidth; out.classList.add('playing');
  $('pvOutTag').textContent = '动画 · ' + a.layers + ' 层';
  log('动画预览中（' + a.count + ' 条路径 / ' + a.layers + ' 层）· 总时长约 ' + a.t.total.toFixed(1) + 's');
}

/* ---------- 导出 ---------- */
function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

$('dlsvg').addEventListener('click', () => download('trace.svg', ensureViewBox(SVG), 'image/svg+xml'));

function ensureViewBox(svgText, w, h) {
  return /viewBox=/.test(svgText) ? svgText
    : svgText.replace('<svg ', '<svg viewBox="0 0 ' + w + ' ' + h + '" ');
}

$('dlpng').addEventListener('click', () => {
  const scale = +$('pngscale').value;
  log('渲染 PNG…', true);
  const svgText = ensureViewBox(SVG, SRC.w, SRC.h);
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = SRC.w * scale; cv.height = SRC.h * scale;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    cv.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'trace-' + cv.width + 'x' + cv.height + '.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      log('PNG 已导出（' + cv.width + '×' + cv.height + '）');
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); log('PNG 渲染失败'); };
  img.src = url;
});

$('dlstatic').addEventListener('click', () => {
  download('trace-static.html', staticHTML(SVG, SRC), 'text/html');
});

$('dlanim').addEventListener('click', () => {
  download('trace-animated.html', animHTML(SVG, SRC, animOpts(), $('anim').value === 'beam'), 'text/html');
});

/* ---------- 纯 CSS 绘图包 ---------- */
/* Trace Studio | 纯 CSS 绘图包生成器
 * 把 VTracer 描摹结果转换为 pure-css-duo 结构：
 *   index.html（命名图层）+ style.css（--fill / clip-path: path()）+ README.md
 * 同时提供无外部依赖的 STORE zip 打包。
 * 浏览器与 Node 通用（Node 下走 module.exports）。
 */
'use strict';

/* ---------- SVG path -> 绝对坐标（烘焙 translate） ---------- */
function pathToAbsolute(d, tx, ty) {
  const R = v => { const r = Math.round(v * 100) / 100; return (r === 0 ? 0 : r); };
  const P = (x, y) => R(x) + ',' + R(y);
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let out = '', m, cx = 0, cy = 0, sx = 0, sy = 0;
  while ((m = re.exec(d))) {
    const cmd = m[1], up = cmd.toUpperCase(), rel = cmd !== up;
    const a = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    if (up === 'Z') { out += 'Z '; cx = sx; cy = sy; continue; }
    let i = 0;
    const sx0 = cx, sy0 = cy; // 相对命令的全部坐标对都相对命令起点
    const abs = (x, y) => { const X = (rel ? sx0 : 0) + x + tx, Y = (rel ? sy0 : 0) + y + ty; cx = X; cy = Y; return P(X, Y); };
    switch (up) {
      case 'M':
        let first = true;
        while (i < a.length) {
          out += (first ? 'M ' : 'L ') + abs(a[i], a[i + 1]) + ' ';
          if (first) { sx = cx; sy = cy; first = false; }
          i += 2;
        }
        break;
      case 'L':
        for (; i < a.length; i += 2) out += 'L ' + abs(a[i], a[i + 1]) + ' ';
        break;
      case 'H':
        for (; i < a.length; i++) out += 'L ' + P((rel ? sx0 : 0) + a[i] + tx, cy) + ' ';
        if (a.length) cx = (rel ? sx0 : 0) + a[a.length - 1] + tx;
        break;
      case 'V':
        for (; i < a.length; i++) out += 'L ' + P(cx, (rel ? sy0 : 0) + a[i] + ty) + ' ';
        if (a.length) cy = (rel ? sy0 : 0) + a[a.length - 1] + ty;
        break;
      case 'C':
        for (; i + 5 < a.length; i += 6) out += 'C ' + abs(a[i], a[i + 1]) + ' ' + abs(a[i + 2], a[i + 3]) + ' ' + abs(a[i + 4], a[i + 5]) + ' ';
        break;
      case 'S':
        for (; i + 3 < a.length; i += 4) out += 'S ' + abs(a[i], a[i + 1]) + ' ' + abs(a[i + 2], a[i + 3]) + ' ';
        break;
      case 'Q':
        for (; i + 3 < a.length; i += 4) out += 'Q ' + abs(a[i], a[i + 1]) + ' ' + abs(a[i + 2], a[i + 3]) + ' ';
        break;
      case 'T':
        for (; i + 1 < a.length; i += 2) out += 'T ' + abs(a[i], a[i + 1]) + ' ';
        break;
      case 'A':
        for (; i + 6 < a.length; i += 7) {
          const ex = (rel ? cx : 0) + a[i + 5] + tx, ey = (rel ? cy : 0) + a[i + 6] + ty;
          out += 'A ' + R(a[i]) + ' ' + R(a[i + 1]) + ' ' + R(a[i + 2]) + ' ' + a[i + 3] + ' ' + a[i + 4] + ' ' + P(ex, ey) + ' ';
          cx = ex; cy = ey;
        }
        break;
    }
  }
  return out.trim();
}

/* ---------- 生成 index.html / style.css / README ---------- */
function buildCssPack(svgText, src, n, meta) {
  const paths = svgText.match(/<path\b.*?\/>/gs) || [];
  const items = [];
  for (const p of paths) {
    const fill = (p.match(/fill="([^"]*)"/) || ['', '#000'])[1];
    const dm = p.match(/ d="([^"]*)"/);
    if (!dm) continue;
    const tr = p.match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/);
    items.push({
      fill,
      d: pathToAbsolute(dm[1], tr ? +tr[1] : 0, tr ? +tr[2] : 0),
    });
  }
  // 按墨量加权分成 n 组（保持叠放顺序），每组一节
  const ws = items.map(it => it.d.length);
  const per = ws.reduce((a, b) => a + b, 0) / n;
  const secs = []; let cur = [], acc = 0;
  for (let i = 0; i < items.length; i++) {
    cur.push(items[i]); acc += ws[i];
    if (acc >= per && secs.length < n - 1) { secs.push(cur); cur = []; acc = 0; }
  }
  if (cur.length) secs.push(cur);

  const W = src.w, H = src.h;
  let divs = '', cssLayers = '';
  let idx = 0;
  secs.forEach((sec, si) => {
    const no = String(si + 1).padStart(2, '0');
    divs += '      <!-- ' + no + ' / layer group ' + (si + 1) + ' -->\n';
    for (const it of sec) {
      idx++;
      divs += '      <div class="piece" id="p' + idx + '"></div>\n';
      cssLayers += '#p' + idx + ' { --fill: ' + it.fill + '; --path: path("' + it.d + '"); }\n';
    }
  });

  const css =
    '/* ' + (meta && meta.title || 'Trace') + ' | Pure HTML + CSS illustration\n' +
    '   Artboard: ' + W + ' x ' + H + '. No images, SVG, canvas, JavaScript or external\n' +
    '   resources are used. Each .piece is one vector-like CSS layer, generated\n' +
    '   from a VTracer trace (color/stacked/spline). Order matters: later layers\n' +
    '   cover earlier ones. Edit --fill to recolor, --path to reshape.\n*/\n' +
    ':root { color-scheme: light; }\n' +
    '* { box-sizing: border-box; }\n' +
    'html, body { margin: 0; min-height: 100%; background: #fff; }\n' +
    'body { min-height: 100svh; display: grid; place-items: center; }\n' +
    '.frame {\n  position: relative;\n  width: min(100vw, calc(100svh * ' + W + ' / ' + H + '), ' + W + 'px);\n  aspect-ratio: ' + W + ' / ' + H + ';\n  container-type: inline-size;\n  overflow: hidden;\n  isolation: isolate;\n  background: #fff;\n}\n' +
    '.artwork {\n  position: absolute;\n  left: 0;\n  top: 0;\n  width: ' + W + 'px;\n  height: ' + H + 'px;\n  transform-origin: 0 0;\n  transform: scale(tan(atan2(100cqw, ' + W + 'px)));\n}\n' +
    '.piece { position: absolute; inset: 0; pointer-events: none; }\n' +
    '.piece::before {\n  content: "";\n  position: absolute;\n  inset: 0;\n  background: var(--fill);\n  clip-path: var(--path);\n}\n\n' +
    '/* ---------- layers (' + idx + ') ---------- */\n' + cssLayers;

  const html =
    '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '  <meta name="color-scheme" content="light">\n  <title>' + (meta && meta.title || 'Trace') + ' - Pure CSS</title>\n' +
    '  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n' +
    '  <main class="frame" role="img" aria-label="纯 CSS 分层插画（由描摹生成，' + idx + ' 层）">\n' +
    '    <div class="artwork" aria-hidden="true">\n' + divs + '    </div>\n  </main>\n</body>\n</html>\n';

  const readme =
    '# 纯 HTML + CSS 插画（描摹生成）\n\n## 打开方式\n\n双击 `index.html`，保持 `style.css` 同目录。\n\n' +
    '## 说明\n\n- 由 Trace Studio 从图片描摹生成：' + idx + ' 个图层、' + secs.length + ' 个分组。\n' +
    '- 画板 ' + W + ' x ' + H + '，纯 CSS 等比缩放；无 JS / SVG / Canvas / 图片。\n' +
    '- 图层按叠放顺序排列，后面的图层覆盖前面的图层。\n' +
    '- 修改：`#pN { --fill; --path }` 改颜色或轮廓。\n' +
    '- 与手工重绘版本（hitagi-css 风格）的差异：本包为逐像素描摹，曲线密度高；\n  未生成 outlined 描边层。\n';

  return { html, css, readme, count: idx, sections: secs.length };
}

/* ---------- 无压缩（STORE）zip 打包 ---------- */
function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
}
const _crcT = crcTable();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = (_crcT[(c ^ u8[i]) & 0xFF] ^ (c >>> 8));
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files) { // files: [{ name, data:string|Uint8Array }]
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const DTIME = 0, DDATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const nameB = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, DTIME, true); lh.setUint16(12, DDATE, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nameB, data);
    central.push({ nameB, crc, size: data.length, offset });
    offset += 30 + nameB.length + data.length;
  }
  const cdStart = offset; let cdSize = 0;
  for (const c of central) {
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, DTIME, true); ch.setUint16(14, DDATE, true);
    ch.setUint32(16, c.crc, true);
    ch.setUint32(20, c.size, true); ch.setUint32(24, c.size, true);
    ch.setUint16(28, c.nameB.length, true); ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true); ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
    ch.setUint32(42, c.offset, true);
    chunks.push(new Uint8Array(ch.buffer), c.nameB);
    cdSize += 46 + c.nameB.length;
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true); eocd.setUint16(6, 0, true);
  eocd.setUint16(8, central.length, true); eocd.setUint16(10, central.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, cdStart, true);
  eocd.setUint16(20, 0, true);
  chunks.push(new Uint8Array(eocd.buffer));
  return new Blob(chunks, { type: 'application/zip' });
}

$('dlcsszip').addEventListener('click', () => {
  log('生成纯 CSS 绘图包…', true);
  try {
    const pack = buildCssPack(SVG, SRC, +$('csslayers').value, { title: 'Trace ' + SRC.w + 'x' + SRC.h });
    const zip = makeZip([
      { name: 'pure-css-trace/index.html', data: pack.html },
      { name: 'pure-css-trace/style.css', data: pack.css },
      { name: 'pure-css-trace/README.md', data: pack.readme },
    ]);
    zip.arrayBuffer().then(ab => {
      download('pure-css-trace.zip', new Uint8Array(ab), 'application/zip');
      log('纯 CSS 绘图包已导出（' + pack.count + ' 层 / ' + pack.sections + ' 组，' + Math.round(ab.byteLength / 1024) + ' KB）');
    });
  } catch (err) { log('生成失败：' + err.message); console.error(err); }
});

/* 自检：?selftest 时用合成图自动走完整流程（无头验证用） */
async function selftest() {
  const cv = document.createElement('canvas'); cv.width = 96; cv.height = 64;
  const cx = cv.getContext('2d');
  const g = cx.createLinearGradient(0, 0, 96, 64);
  g.addColorStop(0, '#22ccaa'); g.addColorStop(.5, '#f2f8e8'); g.addColorStop(1, '#185a78');
  cx.fillStyle = g; cx.fillRect(0, 0, 96, 64);
  cx.fillStyle = '#e8537a'; cx.beginPath(); cx.arc(30, 24, 13, 0, 7); cx.fill();
  cx.fillStyle = '#16324e'; cx.fillRect(58, 34, 26, 20);
  const up = +$('upscale').value;
  const w = cv.width * up, h = cv.height * up;
  const cv2 = document.createElement('canvas'); cv2.width = w; cv2.height = h;
  const cx2 = cv2.getContext('2d');
  cx2.imageSmoothingEnabled = true; cx2.imageSmoothingQuality = 'high';
  cx2.drawImage(cv, 0, 0, w, h);
  const rgba = cx2.getImageData(0, 0, w, h).data;
  SRC = { canvas: cv2, w, h, rgba };
  const pv = $('cvSrc');
  fitPreviews();
  const box = previewBox();
  pv.width = box.w; pv.height = Math.round(box.w * h / w);
  pv.style.width = box.w + 'px';
  pv.getContext('2d').drawImage(cv2, 0, 0, pv.width, pv.height);
  $('pvwrap').hidden = false;
  $('pvOutTitle').textContent = '描摹结果（工作尺寸 ' + w + '×' + h + '）';
  $('retrace').disabled = false;
  await trace();
  if (new URLSearchParams(location.search).get('selftest') === 'static') return;
  playAnim();
}
if (new URLSearchParams(location.search).has('selftest')) selftest();

function staticHTML(svg, src) {
  svg = ensureViewBox(svg, src.w, src.h);
  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Trace · static</title>\n'
    + '<style>\n*{box-sizing:border-box}html,body{margin:0;min-height:100%}\n'
    + 'body{min-height:100svh;display:grid;place-items:center;background:#fff}\n'
    + '.frame{position:relative;aspect-ratio:' + src.w + '/' + src.h + ';width:min(354px,92vw,calc(100svh*' + src.w + '/' + src.h + '));'
    + 'overflow:hidden;isolation:isolate;background:#fff}\n'
    + '.frame svg{position:absolute;inset:0;width:100%;height:100%;display:block}\n</style>\n</head>\n<body>\n'
    + '<main class="frame">' + svg + '</main>\n</body>\n</html>\n';
}

function animHTML(svgText, src, o, beam) {
  const a = animContent(svgText, src, o, beam);
  const t = a.t;
  const body = a.inner;
  const layerCSS = beam ? '' : (
    (o.sketch ? '.skb path{fill:none;stroke:#454a4d;stroke-width:' + skbWidth(src.w, src.h) + 'px;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1}\n.playing .skb path{animation:draw .34s ease-out both;animation-delay:calc(.2s + var(--i) * .11s)}\n.playing .skst{animation:skst-out .8s ease both ' + t.out.toFixed(2) + 's}\n@keyframes draw{to{stroke-dashoffset:0}}\n@keyframes skst-out{from{opacity:1}to{opacity:0}}\n' : '')
    + '/* 图层原地落笔：短淡入，无位移无缩放。不用 clip-path——它在 SVG 上'
    + '   逐帧重栅格化，大 viewBox 非整数缩放时每帧像素吸附漂移 -> 抖动。 */\n'
    + '/* 逐笔上色：每条路径单独落点，延迟 --d / 时长 --f 逐路径内联指定 */\n'
    + '.playing .ps{animation:pg-in var(--f,.22s) ease-out both;animation-delay:var(--d)}\n'
    + '@keyframes pg-in{from{opacity:0}to{opacity:1}}\n'
    + '.playing #art{animation:settle .9s ease-out forwards;animation-delay:' + t.settle.toFixed(2) + 's}\n'
    + '@keyframes settle{from{filter:saturate(.95) brightness(1.02)}to{filter:none}}\n'
  );
  const beamCSS = beam ? (
    '.frame svg{transform:scale(1.06);filter:brightness(.85) saturate(.95);'
    + '-webkit-mask-image:linear-gradient(105deg,#000 42%,rgba(0,0,0,.35) 50%,transparent 58%);'
    + 'mask-image:linear-gradient(105deg,#000 42%,rgba(0,0,0,.35) 50%,transparent 58%);'
    + '-webkit-mask-size:260% 100%;mask-size:260% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}\n'
    + '.playing svg{animation:reveal 2.6s cubic-bezier(.55,.06,.28,.99) forwards,bzoom 3.4s cubic-bezier(.2,.6,.2,1) forwards,bbright 3.4s ease forwards}\n'
    + '@keyframes reveal{from{-webkit-mask-position:100% 0;mask-position:100% 0}to{-webkit-mask-position:0% 0;mask-position:0% 0}}\n'
    + '@keyframes bzoom{to{transform:scale(1)}}\n@keyframes bbright{to{filter:brightness(1) saturate(1)}}\n'
    + '.glow{position:absolute;top:-10%;bottom:-10%;left:0;width:110px;opacity:0;pointer-events:none;'
    + 'background:linear-gradient(90deg,transparent 0%,rgba(63,246,211,.06) 25%,rgba(63,246,211,.55) 55%,rgba(255,255,255,.95) 60%,rgba(63,246,211,.55) 65%,transparent 100%);'
    + 'filter:blur(7px);mix-blend-mode:screen}\n'
    + '.playing .glow{animation:sweep 2.6s cubic-bezier(.55,.06,.28,.99) forwards}\n'
    + '@keyframes sweep{0%{transform:translateX(-160px);opacity:0}6%{opacity:1}92%{opacity:1}100%{transform:translateX(calc(100cqw + 60px));opacity:0}}\n'
    + '.shine{position:absolute;inset:0;background:linear-gradient(75deg,transparent 30%,rgba(255,255,255,.10) 42%,rgba(210,255,245,.35) 50%,rgba(255,255,255,.10) 58%,transparent 70%);mix-blend-mode:screen;opacity:0;pointer-events:none}\n'
    + '.playing .shine{animation:sh2 1.1s cubic-bezier(.4,.05,.3,1) 2.9s forwards}\n'
    + '@keyframes sh2{0%{opacity:0;transform:translateX(-130%)}25%{opacity:.75}100%{opacity:0;transform:translateX(130%)}}\n'
  ) : '';
  const beamBody = beam ? '<div class="glow"></div>\n<div class="shine"></div>\n' : '';
  const frameBg = beam ? '#061413' : '#fff';
  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>Trace · animated</title>\n<style>\n'
    + '*{box-sizing:border-box}html,body{margin:0;min-height:100%}\n'
    + 'body{min-height:100svh;display:grid;place-items:center;'
    + (beam ? 'background:radial-gradient(90% 90% at 75% 10%,#10312e 0%,#0a1f1e 45%,#050f10 100%)' : 'background:radial-gradient(120% 120% at 20% 0%,#f4fffc 0%,#e8f7f2 55%,#dfeee8 100%)')
    + ';font-family:"Segoe UI",system-ui,sans-serif}\n'
    + '.stage{display:grid;justify-items:center;gap:14px;padding:24px 0}\n'
    + '.frame{position:relative;aspect-ratio:' + src.w + '/' + src.h + ';width:min(354px,92vw,calc(100svh*' + src.w + '/' + src.h + '));'
    + 'border-radius:10px;overflow:hidden;isolation:isolate;background:' + frameBg + ';'
    + 'box-shadow:0 0 0 1px rgba(94,234,200,.18),0 14px 40px -12px rgba(0,0,0,.45)}\n'
    + '.frame svg{position:absolute;inset:0;width:100%;height:100%;display:block}\n'
    + layerCSS + beamCSS
    + '.bar{width:min(354px,92vw);height:4px;border-radius:99px;background:rgba(127,222,200,.25);overflow:hidden}\n'
    + '.bar i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#2fbf9a,#7dfade)}\n'
    + '.playing .bar i{animation:fill ' + (beam ? 3.6 : t.total.toFixed(2)) + 's linear forwards}\n'
    + '@keyframes fill{to{width:100%}}\n'
    + '.tools{display:flex;align-items:center;gap:12px}\n'
    + 'button{appearance:none;border:0;cursor:pointer;padding:8px 18px;border-radius:99px;'
    + 'background:#17a884;color:#fff;font-size:14px;font-weight:600}\n'
    + '</style>\n</head>\n<body>\n<main class="stage">\n'
    + '<div class="frame" id="frame">\n'
    + '<svg version="1.1" viewBox="0 0 ' + src.w + ' ' + src.h + '" xmlns="http://www.w3.org/2000/svg">\n'
    + body + '\n</svg>\n' + beamBody + '</div>\n'
    + '<div class="bar"><i></i></div>\n'
    + '<div class="tools"><button id="replay" type="button">重画一遍</button></div>\n'
    + '</main>\n<script>\n'
    + 'function play(){const f=document.getElementById("frame");f.classList.remove("playing");void f.offsetWidth;f.classList.add("playing")}\n'
    + 'document.getElementById("replay").addEventListener("click",play);play();\n'
    + '<\/script>\n</body>\n</html>\n';
}

/* ================= 胶水补充：转换入口与自检 ================= */
function convertPixels(rgba, w, h, opts) {
  // camelCase -> wasm options
  return VTracer.convertPixels(rgba, w, h, opts);
}
