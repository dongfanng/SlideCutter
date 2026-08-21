/**
 * 连通域标记：对内容掩码做两遍扫描（等价类合并），输出每个连通域的包围盒。
 * 纯算法，不依赖 DOM / Node API。
 */

/**
 * @param {Uint8Array} mask   内容掩码（1 = 内容）
 * @param {number} width
 * @param {number} height
 * @param {object} [options]
 * @param {4|8} [options.connectivity]  邻域类型，默认 8
 * @param {number} [options.minSize]    最小尺寸过滤（宽或高低于此值视为噪点），默认 16
 * @param {boolean} [options.filterText]  是否识别文字并标记，默认 false
 * @param {number} [options.textFillRatio]  文字填充率阈值（面积/包围盒面积），默认 0.35
 * @param {number} [options.textAreaRatio]  文字面积上限（相对最大元素面积的比例），默认 0.15
 * @param {number} [options.textMaxHeight]  文字横条最大高度（px），默认 24
 * @returns {Array<{x:number,y:number,width:number,height:number,area:number,label:number,text:boolean}>}
 *          包围盒已按 (上→下, 左→右) 排序，且紧贴内容像素；text=true 表示判定为文字。
 */
export function findComponents(mask, width, height, options = {}) {
  const {
    connectivity = 8,
    minSize = 16,
    filterText = false,
    textFillRatio = 0.35,
    textAreaRatio = 0.15,
    textMaxHeight = 24,
  } = options;
  const total = width * height;
  const labels = new Int32Array(total); // 0 = 背景

  // 并查集，1 基索引
  const parent = [0];
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // 第一遍：分配临时标签并合并等价类
  let nextLabel = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const neighbors = [];
      const check = (nx, ny) => {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
        const nl = labels[ny * width + nx];
        if (nl) neighbors.push(nl);
      };
      if (connectivity === 8) {
        check(x - 1, y - 1);
        check(x, y - 1);
        check(x + 1, y - 1);
        check(x - 1, y);
      } else {
        check(x, y - 1);
        check(x - 1, y);
      }
      if (neighbors.length === 0) {
        nextLabel++;
        parent[nextLabel] = nextLabel;
        labels[i] = nextLabel;
      } else {
        const m = Math.min(...neighbors);
        labels[i] = m;
        for (const nl of neighbors) union(m, nl);
      }
    }
  }

  // 第二遍：路径压缩并统计各根节点的包围盒与面积
  const stats = new Map();
  for (let i = 0; i < total; i++) {
    if (!mask[i]) continue;
    const root = find(labels[i]);
    labels[i] = root;
    let s = stats.get(root);
    if (!s) {
      s = { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1, count: 0 };
      stats.set(root, s);
    }
    const x = i % width;
    const y = (i / width) | 0;
    if (x < s.minX) s.minX = x;
    if (x > s.maxX) s.maxX = x;
    if (y < s.minY) s.minY = y;
    if (y > s.maxY) s.maxY = y;
    s.count++;
  }

  const boxes = [];
  for (const [root, s] of stats) {
    const w = s.maxX - s.minX + 1;
    const h = s.maxY - s.minY + 1;
    // 宽或高达到最小尺寸即保留（细长线条如分隔线不被误过滤）
    if (w < minSize && h < minSize) continue;
    boxes.push({ x: s.minX, y: s.minY, width: w, height: h, area: s.count, label: root, text: false });
  }
  boxes.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  // 文字判定：满足任一条件即判为文字，两者都要求"高度不超过 textMaxHeight"——
  //   镂空/多孔图标（如门窗、网格、太阳）填充率也低但体积大，用高度上限排除；
  //   A) 笔画型细字：填充率低（包围盒内空白多）且面积明显小于最大元素；
  //   B) 文字标注横条：宽扁（宽高比大）、高度很小、面积不超过最大元素的 1/4。
  //     素材图里的粗体文字标注通常呈现为这种"矮扁横条"（填充率并不低，A 判不出）。
  if (filterText) {
    let maxArea = 0;
    for (const b of boxes) if (b.area > maxArea) maxArea = b.area;
    const maxAreaQ = maxArea * 0.25;
    for (const b of boxes) {
      const fillRatio = b.area / (b.width * b.height);
      const aspect = b.width / b.height;
      const strokeText = fillRatio < textFillRatio && b.height <= textMaxHeight && b.area < maxArea * textAreaRatio;
      const stripText = aspect >= 1.5 && b.height <= textMaxHeight && b.area < maxAreaQ;
      b.text = strokeText || stripText;
    }
  }
  return boxes;
}
