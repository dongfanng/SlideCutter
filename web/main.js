import { analyze, extractRegion } from '../src/core/index.js';

const $ = (id) => document.getElementById(id);

const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const DEFAULT_PARAMS = {
  bg: '#ffffff',
  tolerance: 30,
  minSize: 16,
  connectivity: 8,
  peelBlack: false,
  preserveWhite: false,
  filterText: false,
  textFillRatio: 0.35,
  textMaxHeight: 24,
  blackTol: 30,
  maxPeel: 24,
};

const state = {
  image: null,        // HTMLImageElement
  imageData: null,    // { width, height, data }
  sourceName: '',
  boxes: [],          // { x, y, width, height, area, text }
  mask: null,         // 内容掩码，导出时复用
  external: null,     // 外部背景掩码（去白底时保留内部孔洞），导出时复用
  selected: new Set(),
  excluded: new Set(),
};

let params = { ...DEFAULT_PARAMS };
let debounceTimer = null;

const dropzone = $('dropzone');
const stage = $('stage');
const fileInput = $('fileInput');

/* ---------------- 参数绑定 ---------------- */

function readParams() {
  params.bg = $('bg').value;
  params.tolerance = +$('tolerance').value;
  params.minSize = +$('minSize').value;
  params.connectivity = +$('connectivity').value;
  params.peelBlack = $('peelBlack').checked;
  params.preserveWhite = $('preserveWhite').checked;
  params.filterText = $('filterText').checked;
  params.textFillRatio = +$('textFillRatio').value;
  params.textMaxHeight = +$('textMaxHeight').value;
  $('toleranceVal').textContent = $('tolerance').value;
  $('minSizeVal').textContent = $('minSize').value;
  $('textFillRatioVal').textContent = $('textFillRatio').value;
  $('textMaxHeightVal').textContent = $('textMaxHeight').value;
}

function bindParams() {
  const apply = () => {
    readParams();
    recompute();
  };
  const debounce = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(apply, 120);
  };
  $('bg').addEventListener('input', debounce);
  $('tolerance').addEventListener('input', debounce);
  $('minSize').addEventListener('input', debounce);
  $('connectivity').addEventListener('change', apply);
  $('peelBlack').addEventListener('change', apply);
  $('preserveWhite').addEventListener('change', apply);
  $('filterText').addEventListener('change', apply);
  $('textFillRatio').addEventListener('input', debounce);
  $('textMaxHeight').addEventListener('input', debounce);
}

function resetParams() {
  params = { ...DEFAULT_PARAMS };
  $('bg').value = params.bg;
  $('tolerance').value = params.tolerance;
  $('minSize').value = params.minSize;
  $('connectivity').value = String(params.connectivity);
  $('peelBlack').checked = params.peelBlack;
  $('preserveWhite').checked = params.preserveWhite;
  $('filterText').checked = params.filterText;
  $('textFillRatio').value = String(params.textFillRatio);
  $('textMaxHeight').value = String(params.textMaxHeight);
  readParams();
  recompute();
}

/* ---------------- 检测与渲染 ---------------- */

function recompute() {
  if (!state.imageData) return;
  const { boxes, mask, external } = analyze(state.imageData, params);
  state.boxes = boxes;
  state.mask = mask;
  state.external = external;
  state.selected.clear();
  state.excluded.clear();
  // 开启文字过滤时，判定为文字的元素自动排除导出（列表仍显示，灰色虚框）
  state.boxes.forEach((b, i) => {
    if (b.text) state.excluded.add(i);
  });
  render();
  renderList();
  updateButtons();
}

function render() {
  if (!state.image) return;
  canvas.width = state.imageData.width;
  canvas.height = state.imageData.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.image, 0, 0);

  ctx.font = 'bold 12px sans-serif';
  for (let i = 0; i < state.boxes.length; i++) {
    const b = state.boxes[i];
    const sel = state.selected.has(i);
    const ex = state.excluded.has(i);
    ctx.strokeStyle = ex ? '#9aa0a8' : sel ? '#ff6b35' : '#2f80ed';
    ctx.lineWidth = sel ? 3 : 2;
    ctx.setLineDash(ex ? [5, 4] : []);
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.width, b.height);
    ctx.setLineDash([]);
    if (!ex) {
      const label = String(i + 1);
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = sel ? '#ff6b35' : '#2f80ed';
      ctx.fillRect(b.x, b.y, tw + 8, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, b.x + 4, b.y + 12);
    }
  }
}

/* ---------------- 选择交互 ---------------- */

function hitTest(px, py) {
  for (let i = state.boxes.length - 1; i >= 0; i--) {
    const b = state.boxes[i];
    if (px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height) return i;
  }
  return -1;
}

function handleSelect(i, multi) {
  if (multi) {
    if (state.selected.has(i)) state.selected.delete(i);
    else state.selected.add(i);
  } else {
    state.selected = new Set([i]);
  }
  render();
  renderList();
  updateButtons();
}

canvas.addEventListener('click', (e) => {
  if (!state.imageData) return;
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas.height / rect.height);
  const hit = hitTest(px, py);
  const multi = e.ctrlKey || e.metaKey || e.shiftKey;
  if (hit === -1) {
    state.selected.clear();
    render();
    renderList();
    updateButtons();
    return;
  }
  handleSelect(hit, multi);
});

function mergeSelected() {
  const ids = [...state.selected];
  if (ids.length < 2) return;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  let text = false;
  for (const i of ids) {
    const b = state.boxes[i];
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
    if (b.text) text = true; // 任一来源为文字，则合并结果保留文字标记
  }
  const merged = { x: minX, y: minY, width: maxX - minX, height: maxY - minY, area: 0, text };
  const boxes = state.boxes.filter((_, i) => !state.selected.has(i));
  boxes.push(merged);
  boxes.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  state.boxes = boxes;
  state.selected.clear();
  state.excluded.clear();
  // 合并后按当前开关重新应用文字自动排除，避免过滤状态失效
  if (params.filterText) {
    state.boxes.forEach((b, i) => {
      if (b.text) state.excluded.add(i);
    });
  }
  render();
  renderList();
  updateButtons();
}

function toggleExclude() {
  for (const i of state.selected) {
    if (state.excluded.has(i)) state.excluded.delete(i);
    else state.excluded.add(i);
  }
  render();
  renderList();
  updateButtons();
}

/* ---------------- 列表 ---------------- */

function renderList() {
  const list = $('list');
  list.innerHTML = '';
  for (let i = 0; i < state.boxes.length; i++) {
    const b = state.boxes[i];
    const li = document.createElement('li');
    li.className = 'item'
      + (state.excluded.has(i) ? ' excluded' : '')
      + (state.selected.has(i) ? ' selected' : '');
    li.innerHTML = `<span class="idx">${i + 1}</span>`
      + `<span class="info">${b.width}×${b.height}</span>`
      + `<span class="pos">(${b.x},${b.y})</span>`;
    li.addEventListener('click', (e) => {
      const multi = e.ctrlKey || e.metaKey || e.shiftKey;
      handleSelect(i, multi);
    });
    list.appendChild(li);
  }
  $('count').textContent = state.boxes.length;
}

function updateButtons() {
  $('btnExport').disabled = !state.imageData || state.boxes.length === 0;
  $('btnPpt').disabled = !state.imageData || state.boxes.length === 0;
  $('btnMerge').disabled = state.selected.size < 2;
  $('btnExclude').disabled = state.selected.size === 0;
}

/* ---------------- 加载图片 ---------------- */

function loadFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.image = img;
    state.sourceName = file.name;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    state.imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    dropzone.hidden = true;
    stage.hidden = false;
    recompute();
    $('status').textContent = `已加载 ${file.name} · ${img.naturalWidth}×${img.naturalHeight}`;
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    $('status').textContent = `无法加载 ${file.name}`;
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  loadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  loadFile(fileInput.files[0]);
  fileInput.value = '';
});

/* ---------------- 导出 ---------------- */

function baseName(name) {
  return name.replace(/\.[^.]+$/, '');
}

function regionToDataUrl(region) {
  const c = document.createElement('canvas');
  c.width = region.width;
  c.height = region.height;
  const cx = c.getContext('2d');
  cx.putImageData(new ImageData(region.data, region.width, region.height), 0, 0);
  return c.toDataURL('image/png');
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 收集中间产物：layout + 各元素 PNG（base64 dataURL），供 ZIP / PPT 复用
async function collectExport() {
  const layout = {
    source: state.sourceName,
    width: state.imageData.width,
    height: state.imageData.height,
    elements: [],
  };
  const images = {};
  const items = state.boxes
    .map((b, i) => ({ b, i }))
    .filter(({ i }) => !state.excluded.has(i))
    .sort((a, b) => (a.b.y - b.b.y) || (a.b.x - b.b.x));
  for (let k = 0; k < items.length; k++) {
    const { b, i } = items[k];
    const name = `element-${String(k + 1).padStart(2, '0')}.png`;
    const region = extractRegion(state.imageData, b, { ...params, mask: state.mask, external: state.external });
    layout.elements.push({
      file: name,
      index: i,
      x: region.box.x,
      y: region.box.y,
      width: region.box.width,
      height: region.box.height,
    });
    images[name] = regionToDataUrl(region);
  }
  return { layout, images };
}

async function exportZip() {
  const { layout, images } = await collectExport();
  const zip = new JSZip();
  for (const [name, dataUrl] of Object.entries(images)) {
    zip.file(name, dataUrl.split(',')[1], { base64: true });
  }
  zip.file('layout.json', JSON.stringify(layout, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${baseName(state.sourceName)}-sliced.zip`);
  $('status').textContent = `已导出 ${layout.elements.length} 个元素 → ${baseName(state.sourceName)}-sliced.zip`;
}

async function downloadPpt() {
  $('status').textContent = '正在生成 PPT…';
  try {
    const { layout, images } = await collectExport();
    // 像素 → 英寸（96 DPI），与导出 ZIP 的 layout.json 单位一致
    const px = 96;
    const pptx = new PptxGenJS();
    pptx.defineLayout({
      name: 'SC_LAYOUT',
      width: layout.width / px,
      height: layout.height / px,
    });
    pptx.layout = 'SC_LAYOUT';
    const slide = pptx.addSlide();
    for (const el of layout.elements) {
      slide.addImage({
        data: images[el.file],
        x: el.x / px,
        y: el.y / px,
        w: el.width / px,
        h: el.height / px,
      });
    }
    await pptx.writeFile({ fileName: `${baseName(layout.source)}-slide.pptx` });
    $('status').textContent = `已生成 PPT → ${baseName(layout.source)}-slide.pptx（浏览器本地生成）`;
  } catch (err) {
    $('status').textContent = `生成 PPT 失败：${err.message}`;
  }
}

/* ---------------- 初始化 ---------------- */

$('btnReset').addEventListener('click', resetParams);
$('btnExport').addEventListener('click', exportZip);
$('btnPpt').addEventListener('click', downloadPpt);
$('btnMerge').addEventListener('click', mergeSelected);
$('btnExclude').addEventListener('click', toggleExclude);
bindParams();
