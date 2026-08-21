// 冒烟测试：合成一张白底图，验证连通域切片、最小尺寸过滤与区域提取。
import assert from 'node:assert/strict';
import { analyze, extractRegion, peelBlackBorder } from '../src/core/index.js';

function makeImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 255;
    data[i * 4 + 1] = 255;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function fillRect(img, x, y, w, h, [r, g, b] = [0, 0, 0]) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const o = (yy * img.width + xx) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
}

const img = makeImage(300, 300);
fillRect(img, 20, 30, 80, 60);   // 元素 A
fillRect(img, 150, 120, 60, 80); // 元素 B
fillRect(img, 250, 250, 3, 3);   // 噪点（应被 minSize 过滤）

const { boxes } = analyze(img, { minSize: 16, tolerance: 30 });
assert.equal(boxes.length, 2, `期望 2 个元素，实际 ${boxes.length}`);

const [a, b] = boxes;
assert.deepEqual(
  [a.x, a.y, a.width, a.height],
  [20, 30, 80, 60],
  '元素 A 包围盒不正确'
);
assert.deepEqual(
  [b.x, b.y, b.width, b.height],
  [150, 120, 60, 80],
  '元素 B 包围盒不正确'
);

// 区域提取：内容像素保留、背景像素透明（去白底）
const region = extractRegion(img, a, { peelBlack: false });
assert.equal(region.width, 80);
assert.equal(region.height, 60);
let contentOpaque = 0;
let bgTransparent = 0;
for (let i = 0; i < region.width * region.height; i++) {
  const o = i * 4;
  if (region.data[o + 3] === 255) contentOpaque++;
  else if (region.data[o + 3] === 0) bgTransparent++;
}
assert.equal(contentOpaque, 80 * 60, '内容像素应保留不透明');
assert.equal(bgTransparent, 0, '紧贴内容的包围盒内不应有背景');

// 包含白色边距的提取：边距应变为透明
const wide = extractRegion(img, { x: 0, y: 0, width: 120, height: 120 }, { mask: analyze(img).mask });
let marginTransparent = 0;
for (let y = 0; y < 120; y++) {
  for (let x = 0; x < 120; x++) {
    const o = (y * 120 + x) * 4;
    if (wide.data[o + 3] === 0) marginTransparent++;
  }
}
assert.equal(marginTransparent, 120 * 120 - 80 * 60, '白色边距应被置为透明');

// 保留白色像素：开启 preserveWhite 后白色边距保持不透明
const kept = extractRegion(img, { x: 0, y: 0, width: 120, height: 120 }, { preserveWhite: true });
let whiteOpaque = 0;
for (let y = 0; y < 120; y++) {
  for (let x = 0; x < 120; x++) {
    const o = (y * 120 + x) * 4;
    if (kept.data[o + 3] === 255 && kept.data[o] === 255) whiteOpaque++;
  }
}
assert.equal(whiteOpaque, 120 * 120 - 80 * 60, '开启 preserveWhite 后白色像素应保留');

// 黑色边框剥离
const framed = makeImage(40, 40);
fillRect(framed, 0, 0, 40, 40);          // 整图黑框
fillRect(framed, 5, 5, 30, 30, [200, 40, 40]); // 内部彩色内容
const peeled = peelBlackBorder(framed, { x: 0, y: 0, width: 40, height: 40 }, { maxPeel: 40 });
assert.deepEqual(
  [peeled.x, peeled.y, peeled.width, peeled.height],
  [5, 5, 30, 30],
  '黑色边缘未正确剥离'
);

// 8 邻域：对角接触的两块应合并为一个元素
const diag = makeImage(20, 20);
fillRect(diag, 2, 2, 5, 5);
fillRect(diag, 7, 7, 5, 5); // 与上一块对角相接
const diagBoxes = analyze(diag, { minSize: 1 }).boxes;
assert.equal(diagBoxes.length, 1, '8 邻域应合并对角接触块');

// 孔洞保留：方形环内封闭白底应保留，外部开放白底应透明
const ring = makeImage(100, 100);
fillRect(ring, 30, 30, 40, 40);                    // 黑色环（内容）
fillRect(ring, 40, 40, 20, 20, [255, 255, 255]);   // 环内部白色孔洞（封闭，外部到不了）
const ringRegion = extractRegion(ring, { x: 0, y: 0, width: 100, height: 100 }, {});
let ringTransparent = 0;
let ringOpaque = 0;
let holeWhite = 0;
for (let y = 0; y < 100; y++) {
  for (let x = 0; x < 100; x++) {
    const o = (y * 100 + x) * 4;
    const a = ringRegion.data[o + 3];
    if (a === 0) ringTransparent++;
    else {
      ringOpaque++;
      if (ringRegion.data[o] === 255 && ringRegion.data[o + 1] === 255 && ringRegion.data[o + 2] === 255) {
        holeWhite++;
      }
    }
  }
}
assert.equal(ringTransparent, 100 * 100 - 40 * 40, '外部开放白底应被置为透明');
assert.equal(ringOpaque, 40 * 40, '黑色环与内部孔洞应保留不透明');
assert.equal(holeWhite, 20 * 20, '图标内部封闭孔洞的白底应保留');

// 文字过滤：实心图标保留；笔画型细字（低填充率）与矮扁文字横条（高填充率）判为文字；
// 方正小图标（矮但不成横条）不误判
const textImg = makeImage(200, 200);
fillRect(textImg, 20, 20, 80, 80);    // 实心图标（填充率 1.0）
fillRect(textImg, 130, 40, 4, 30);    // 文字 L 竖
fillRect(textImg, 130, 64, 30, 4);    // 文字 L 横（低填充率 → 笔画型文字）
fillRect(textImg, 20, 120, 50, 10);   // 矮扁文字横条（高填充率、宽高比 5 → 横条文字）
fillRect(textImg, 140, 120, 28, 28);  // 小方块图标（矮但方正 → 不误判）
const textBoxes = analyze(textImg, { minSize: 1, filterText: true, textFillRatio: 0.35, textMaxHeight: 30 }).boxes;
assert.equal(textBoxes.length, 4, '应检测到 4 个元素');
const byPos = Object.fromEntries(textBoxes.map((b) => [b.x + ',' + b.y, b]));
assert.equal(byPos['20,20'].text, false, '实心图标不应判为文字');
assert.equal(byPos['130,40'].text, true, '低填充率字形应判为文字');
assert.equal(byPos['20,120'].text, true, '矮扁文字横条应判为文字');
assert.equal(byPos['140,120'].text, false, '方正小图标不应判为文字');
const noFilter = analyze(textImg, { minSize: 1 }).boxes;
assert.ok(noFilter.every((b) => !b.text), '未开启过滤时不应有文字标记');

console.log('冒烟测试全部通过 ✓');
