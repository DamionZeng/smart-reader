/**
 * 知识图谱背景的装饰性节点与连线数据。
 * 使用确定性 LCG 随机数，确保 SSR 与 CSR 输出一致，避免 hydration mismatch。
 * 这些节点纯粹是视觉肌理，不承载真实语义。
 */

export interface BackdropNode {
  id: number;
  x: number;
  y: number;
  r: number; // 半径 1.5 - 3.5
  opacity: number; // 0.10 - 0.26
  // 漂浮动画参数（由 GSAP 读取）
  driftX: number; // ±px
  driftY: number;
  duration: number; // s
}

export interface BackdropEdge {
  from: number;
  to: number;
  opacity: number; // 0.05 - 0.12
}

export interface BackdropGraph {
  nodes: BackdropNode[];
  edges: BackdropEdge[];
  width: number;
  height: number;
}

// 固定 seed 的线性同余生成器
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const WIDTH = 1440;
const HEIGHT = 1024;

// 三个簇中心，营造「概念聚类」的视觉感
const CLUSTERS = [
  { cx: 360, cy: 320, count: 11, spread: 220 },
  { cx: 980, cy: 260, count: 10, spread: 200 },
  { cx: 720, cy: 760, count: 11, spread: 240 },
];

export function generateBackdropGraph(seed = 20260627): BackdropGraph {
  const rand = lcg(seed);
  const nodes: BackdropNode[] = [];
  let id = 0;

  for (const c of CLUSTERS) {
    for (let i = 0; i < c.count; i++) {
      // 极坐标分布，让簇内节点更自然
      const angle = rand() * Math.PI * 2;
      const dist = Math.pow(rand(), 0.6) * c.spread;
      const x = c.cx + Math.cos(angle) * dist;
      const y = c.cy + Math.sin(angle) * dist;
      nodes.push({
        id: id++,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        r: 2 + rand() * 2.5,
        opacity: 0.22 + rand() * 0.24,
        driftX: (rand() - 0.5) * 14,
        driftY: (rand() - 0.5) * 14,
        duration: 6 + rand() * 6,
      });
    }
  }

  // 连线：簇内最近邻 + 少量簇间桥接
  const edges: BackdropEdge[] = [];
  const clusterStart = [0];
  for (const c of CLUSTERS) clusterStart.push(clusterStart[clusterStart.length - 1] + c.count);

  // 簇内：每个节点连距离最近的 2 个同簇节点
  for (let ci = 0; ci < CLUSTERS.length; ci++) {
    const start = clusterStart[ci];
    const end = clusterStart[ci + 1];
    for (let i = start; i < end; i++) {
      const dists: { j: number; d: number }[] = [];
      for (let j = start; j < end; j++) {
        if (i === j) continue;
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        dists.push({ j, d: dx * dx + dy * dy });
      }
      dists.sort((a, b) => a.d - b.d);
      for (let k = 0; k < Math.min(2, dists.length); k++) {
        const j = dists[k].j;
        if (i < j) {
          edges.push({ from: i, to: j, opacity: 0.12 + rand() * 0.14 });
        }
      }
    }
  }

  // 簇间桥接：每个簇选 1 个节点连到下一个簇
  for (let ci = 0; ci < CLUSTERS.length; ci++) {
    const ni = ci;
    const nj = (ci + 1) % CLUSTERS.length;
    const a = clusterStart[ni] + Math.floor(rand() * CLUSTERS[ni].count);
    const b = clusterStart[nj] + Math.floor(rand() * CLUSTERS[nj].count);
    edges.push({ from: a, to: b, opacity: 0.10 + rand() * 0.08 });
  }

  return { nodes, edges, width: WIDTH, height: HEIGHT };
}
