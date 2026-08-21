/**
 * 裁剪：从原图提取指定区域为独立 RGBA 位图；可选剥离均匀黑色边缘（黑边）。
 * 默认把背景像素（透明或接近背景色）置为完全透明，实现"去白底"；
 * 开启 preserveWhite 时保留原始像素（含白色）。
 * 纯算法，不依赖 DOM / Node API。
 */
import { buildMask, externalBackgroundMask } from './mask.js';

/**
 * 剥离黑色边框条：逐层检查四条边，若某条边近乎均匀黑色则剥掉一层，
 * 直到没有黑色边或达到最大剥离层数。避免误删图标自身的黑色像素
 * （图标边缘通常非均匀黑色）。
 *
 * @returns {{x,y,width,height}|null}
 */
export function peelBlackBorder(img, box, options = {}) {
  const { blackTol = 30, maxPeel = 24, ratio = 0.97 } = options;
  const { width: W, data } = img;
  let { x, y, width: w, height: h } = box;

  const isBlackLine = (lineIdx, isColumn) => {
    const len = isColumn ? h : w;
    if (len <= 0) return false;
    let black = 0;
    for (let k = 0; k < len; k++) {
      const px = isColumn ? (y + k) * W + (x + lineIdx) : (y + lineIdx) * W + (x + k);
      const o = px * 4;
      if (data[o + 3] >= 40 && Math.max(data[o], data[o + 1], data[o + 2]) <= blackTol) black++;
    }
    return black / len >= ratio;
  };

  let peeled = 0;
  while (peeled < maxPeel && w > 1 && h > 1) {
    if (isBlackLine(0, false)) {
      y++;
      h--;
      peeled++;
    } else if (isBlackLine(h - 1, false)) {
      h--;
      peeled++;
    } else if (isBlackLine(0, true)) {
      x++;
      w--;
      peeled++;
    } else if (isBlackLine(w - 1, true)) {
      w--;
      peeled++;
    } else {
      break;
    }
  }
  if (w <= 0 || h <= 0) return null;
  return { x, y, width: w, height: h };
}

/**
 * 提取区域为独立 RGBA 位图。背景像素（透明或接近背景色）输出为完全透明。
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {{x:number,y:number,width:number,height:number}} box
 * @param {object} [options]
 * @param {boolean} [options.peelBlack]  是否剥离黑色边缘
 * @param {number} [options.blackTol]
 * @param {number} [options.maxPeel]
 * @param {Uint8Array} [options.mask]    内容掩码（可复用 analyze 的结果）；缺省则按 bg/tolerance 重建
 * @param {boolean} [options.preserveWhite]  为 true 时保留所有原始像素（不去白底）
 * @param {Uint8Array} [options.external]    外部背景掩码（1 = 能从图像四边到达的背景像素）；
 *                                            缺省则按 mask 自动计算。仅去白底模式下生效。
 * @returns {{width:number,height:number,data:Uint8ClampedArray,box:object}}
 *          box 为最终实际裁剪区域（可能已剥边）。
 */
export function extractRegion(img, box, options = {}) {
  const { peelBlack = false, blackTol = 30, maxPeel = 24, preserveWhite = false } = options;
  const { width: W, height: H, data } = img;
  let b = box;
  if (peelBlack) {
    const p = peelBlackBorder(img, b, { blackTol, maxPeel });
    if (p) b = p;
  }
  // 内容掩码 mask=1 表示内容；外部背景掩码 external=1 表示能从图像四边到达的背景。
  // 像素处理规则：
  //   - 内容像素（mask=1）：保留
  //   - 外部开放背景（mask=0 且 external=1）：置为完全透明（去白底）
  //   - 孔洞背景（mask=0 且 external=0）：外部到不了，视为图标一部分，保留原始像素
  const mask = preserveWhite ? null : (options.mask || buildMask(img, options));
  const external = mask ? (options.external || externalBackgroundMask(mask, W, H)) : null;
  const out = new Uint8ClampedArray(b.width * b.height * 4);
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const si = ((b.y + y) * W + (b.x + x)) * 4;
      const di = (y * b.width + x) * 4;
      const si0 = (b.y + y) * W + (b.x + x);
      const isExternalBg = mask && external && !mask[si0] && external[si0];
      if (isExternalBg) {
        out[di] = 0;
        out[di + 1] = 0;
        out[di + 2] = 0;
        out[di + 3] = 0;
      } else {
        out[di] = data[si];
        out[di + 1] = data[si + 1];
        out[di + 2] = data[si + 2];
        out[di + 3] = data[si + 3];
      }
    }
  }
  return { width: b.width, height: b.height, data: out, box: b };
}
