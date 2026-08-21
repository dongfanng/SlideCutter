/**
 * 内容掩码：判定每个像素是否为"内容"（非背景）。
 * 背景判定：透明（alpha 低于阈值）或颜色接近指定背景色（按最大通道差容差）。
 * 纯算法，不依赖 DOM / Node API，浏览器与 Workers 通用。
 * 输入约定：{ width, height, data: Uint8ClampedArray }（RGBA，0-255）。
 */

export function parseColor(input) {
  if (Array.isArray(input)) {
    return [input[0] | 0, input[1] | 0, input[2] | 0];
  }
  const s = String(input).replace('#', '').trim();
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return [
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16),
    ];
  }
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = [...s].map((c) => parseInt(c + c, 16));
    return [r, g, b];
  }
  return [255, 255, 255];
}

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {object} [options]
 * @param {string|number[]} [options.bg]      背景色，默认白色
 * @param {number} [options.tolerance]        背景容差（最大通道差），默认 30
 * @param {number} [options.alphaThreshold]   低于此 alpha 视为透明背景，默认 10
 * @returns {Uint8Array} 每像素 0/1 掩码，1 = 内容
 */
export function buildMask(img, options = {}) {
  const { width, height, data } = img;
  const bg = parseColor(options.bg != null ? options.bg : [255, 255, 255]);
  const tolerance = options.tolerance != null ? options.tolerance : 30;
  const alphaThreshold = options.alphaThreshold != null ? options.alphaThreshold : 10;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (data[o + 3] < alphaThreshold) continue; // 透明
    const dr = Math.abs(data[o] - bg[0]);
    const dg = Math.abs(data[o + 1] - bg[1]);
    const db = Math.abs(data[o + 2] - bg[2]);
    mask[i] = Math.max(dr, dg, db) > tolerance ? 1 : 0;
  }
  return mask;
}

/**
 * 外部背景掩码：从图像四边对背景像素做 4 邻域洪水填充，
 * 标记"能从外部边界到达"的背景像素（即外部开放区域）。
 * 被内容完全围住、外部到达不了的背景像素（图标内部孔洞）不会被标记，
 * 从而在去白底时得以保留。
 *
 * @param {Uint8Array} mask   内容掩码（1 = 内容）
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} 1 = 外部背景（应置为透明）
 */
export function externalBackgroundMask(mask, width, height) {
  const external = new Uint8Array(width * height);
  const stack = new Int32Array(width * height); // 每个像素至多入栈一次
  let sp = 0;
  const pushXY = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = y * width + x;
    if (mask[i] || external[i]) return;
    external[i] = 1;
    stack[sp++] = i;
  };
  // 从四条边界播种
  for (let x = 0; x < width; x++) {
    pushXY(x, 0);
    pushXY(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    pushXY(0, y);
    pushXY(width - 1, y);
  }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % width;
    const y = (i / width) | 0;
    pushXY(x - 1, y);
    pushXY(x + 1, y);
    pushXY(x, y - 1);
    pushXY(x, y + 1);
  }
  return external;
}
