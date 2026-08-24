/**
 * 核心算法层统一出口。全部为纯函数，仅操作 RGBA 像素数组，
 * 浏览器端与 Cloudflare Workers 均可直接复用。
 */
import { buildMask, externalBackgroundMask } from './mask.js';
import { findComponents } from './components.js';
import { extractRegion, peelBlackBorder } from './trim.js';

export { extractRegion, peelBlackBorder };

/**
 * 一键分析：内容掩码 + 外部背景掩码 + 连通域包围盒。
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {object} [options]  同 buildMask / findComponents 的参数
 * @returns {{mask:Uint8Array, external:Uint8Array, boxes:Array<object>}}
 */
export function analyze(img, options = {}) {
  const mask = buildMask(img, options);
  const external = externalBackgroundMask(mask, img.width, img.height);
  const boxes = findComponents(mask, img.width, img.height, options);
  return { mask, external, boxes };
}
