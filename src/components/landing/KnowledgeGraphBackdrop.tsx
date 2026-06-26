"use client";

import { useMemo, useRef } from "react";
import { useGSAP } from "@gsap/react";
import { ensureGsapRegistered, gsap } from "@/lib/gsap/register";
import {
  generateBackdropGraph,
  type BackdropGraph,
} from "@/lib/knowledge-graph/backdrop-data";

const INK = "#1C1C1C";

// 鼠标影响半径（SVG 坐标空间）
const INFLUENCE_RADIUS = 180;
const INFLUENCE_RADIUS_SQ = INFLUENCE_RADIUS * INFLUENCE_RADIUS;

/**
 * Hero 背景的知识图谱装饰。
 * - 节点：逐个 fade+scale 浮现，之后持续缓慢漂浮
 * - 连线：随节点浮现后淡入
 * - 鼠标交互：鼠标移动时附近节点被"吸引"放大 + 提亮，
 *   相关连线高亮加粗，远处的元素轻微淡出
 * - 滚动：整体随滚动视差下移
 *
 * SVG 本身 pointer-events:none，通过监听父 section 的 mousemove 实现。
 */
export function KnowledgeGraphBackdrop() {
  const svgRef = useRef<SVGSVGElement>(null);
  const graph: BackdropGraph = useMemo(() => generateBackdropGraph(), []);

  useGSAP(
    () => {
      ensureGsapRegistered();
      const svg = svgRef.current;
      if (!svg) return;

      const nodeEls = svg.querySelectorAll<SVGCircleElement>(".kg-node");
      const edgeEls = svg.querySelectorAll<SVGLineElement>(".kg-edge");
      const section = svg.closest("section");
      if (!section) return;

      // 缓存每个节点的基准 opacity 和 quickTo setter
      const nodeData = Array.from(nodeEls).map((el) => {
        const baseOpacity = parseFloat(
          el.getAttribute("data-opacity") || "0.3",
        );
        const cx = parseFloat(el.getAttribute("cx") || "0");
        const cy = parseFloat(el.getAttribute("cy") || "0");
        return {
          el,
          cx,
          cy,
          baseOpacity,
          setOpacity: gsap.quickTo(el, "opacity", { duration: 0.4, ease: "power2.out" }),
          setScale: gsap.quickTo(el, "scale", { duration: 0.4, ease: "power2.out" }),
        };
      });

      // 缓存每条边的基准 opacity 和 quickTo setter
      const edgeData = Array.from(edgeEls).map((el) => {
        const baseOpacity = parseFloat(
          el.getAttribute("data-opacity") || "0.15",
        );
        return {
          el,
          baseOpacity,
          setOpacity: gsap.quickTo(el, "opacity", { duration: 0.4, ease: "power2.out" }),
          setWidth: gsap.quickTo(el, "strokeWidth", { duration: 0.4, ease: "power2.out" }),
        };
      });

      // ===== 入场动画 =====
      gsap.set(nodeEls, { opacity: 0, scale: 0, transformOrigin: "center" });
      gsap.set(edgeEls, { opacity: 0 });

      const tl = gsap.timeline({ delay: 0.15 });

      tl.to(nodeEls, {
        opacity: (i, el) => parseFloat(el.getAttribute("data-opacity") || "0.3"),
        scale: 1,
        duration: 1.1,
        stagger: { each: 0.035, from: "random" },
        ease: "power3.out",
      });

      tl.to(
        edgeEls,
        {
          opacity: (i, el) => parseFloat(el.getAttribute("data-opacity") || "0.15"),
          duration: 0.8,
          stagger: 0.02,
          ease: "power2.out",
        },
        "-=0.7",
      );

      // 节点持续漂浮
      nodeEls.forEach((el) => {
        const dx = parseFloat(el.getAttribute("data-dx") || "0");
        const dy = parseFloat(el.getAttribute("data-dy") || "0");
        const dur = parseFloat(el.getAttribute("data-dur") || "8");
        gsap.to(el, {
          x: dx,
          y: dy,
          duration: dur,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      });

      // 整体随滚动视差
      gsap.to(svg, {
        y: 120,
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: "bottom top",
          scrub: 1,
        },
      });

      // ===== 鼠标交互 =====
      let mouseX = -9999;
      let mouseY = -9999;
      let rafId: number | null = null;
      let hasMouse = false;

      const screenToSvg = (clientX: number, clientY: number) => {
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const ctm = svg.getScreenCTM();
        if (!ctm) return { x: -9999, y: -9999 };
        const svgPt = pt.matrixTransform(ctm.inverse());
        return { x: svgPt.x, y: svgPt.y };
      };

      const updateNodeInfluence = () => {
        rafId = null;

        // 预计算每个节点的当前实际位置（基准 + GSAP 漂浮位移）
        const nodePositions = nodeData.map((nd) => {
          const offX = (gsap.getProperty(nd.el, "x") as number) || 0;
          const offY = (gsap.getProperty(nd.el, "y") as number) || 0;
          return { x: nd.cx + offX, y: nd.cy + offY };
        });

        for (let i = 0; i < nodeData.length; i++) {
          const nd = nodeData[i];
          const pos = nodePositions[i];
          const dx = pos.x - mouseX;
          const dy = pos.y - mouseY;
          const distSq = dx * dx + dy * dy;

          if (distSq < INFLUENCE_RADIUS_SQ) {
            const dist = Math.sqrt(distSq);
            const influence = 1 - dist / INFLUENCE_RADIUS; // 0..1
            // 鼠标附近：放大 + 提亮
            nd.setScale(1 + influence * 2.5);
            nd.setOpacity(Math.min(0.85, nd.baseOpacity + influence * 0.5));
          } else if (hasMouse) {
            // 远处：轻微淡出
            nd.setScale(1);
            nd.setOpacity(nd.baseOpacity * 0.6);
          }
        }

        // 连线：两端任一节点在影响范围内则高亮
        for (let i = 0; i < edgeData.length; i++) {
          const ed = edgeData[i];
          const edge = graph.edges[i];
          const posA = nodePositions[edge.from];
          const posB = nodePositions[edge.to];

          const distA = (posA.x - mouseX) ** 2 + (posA.y - mouseY) ** 2;
          const distB = (posB.x - mouseX) ** 2 + (posB.y - mouseY) ** 2;
          const minDistSq = Math.min(distA, distB);

          if (minDistSq < INFLUENCE_RADIUS_SQ) {
            const minDist = Math.sqrt(minDistSq);
            const influence = 1 - minDist / INFLUENCE_RADIUS;
            ed.setOpacity(Math.min(0.7, ed.baseOpacity + influence * 0.45));
            ed.setWidth(0.5 + influence * 1.2);
          } else if (hasMouse) {
            ed.setOpacity(ed.baseOpacity * 0.5);
            ed.setWidth(0.5);
          }
        }
      };

      const onMouseMove = (e: MouseEvent) => {
        const pt = screenToSvg(e.clientX, e.clientY);
        mouseX = pt.x;
        mouseY = pt.y;
        hasMouse = true;
        if (rafId === null) {
          rafId = requestAnimationFrame(updateNodeInfluence);
        }
      };

      const onMouseLeave = () => {
        hasMouse = false;
        mouseX = -9999;
        mouseY = -9999;
        if (rafId === null) {
          rafId = requestAnimationFrame(updateNodeInfluence);
        }
      };

      section.addEventListener("mousemove", onMouseMove);
      section.addEventListener("mouseleave", onMouseLeave);

      return () => {
        section.removeEventListener("mousemove", onMouseMove);
        section.removeEventListener("mouseleave", onMouseLeave);
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    },
    { scope: svgRef },
  );

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      viewBox={`0 0 ${graph.width} ${graph.height}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      style={{ pointerEvents: "none" }}
    >
      {/* 连线层 */}
      <g>
        {graph.edges.map((e, i) => {
          const a = graph.nodes[e.from];
          const b = graph.nodes[e.to];
          return (
            <line
              key={`e-${i}`}
              className="kg-edge"
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={INK}
              strokeWidth={0.5}
              data-opacity={e.opacity}
            />
          );
        })}
      </g>
      {/* 节点层 */}
      <g>
        {graph.nodes.map((n) => (
          <circle
            key={`n-${n.id}`}
            className="kg-node"
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={INK}
            data-opacity={n.opacity}
            data-dx={n.driftX}
            data-dy={n.driftY}
            data-dur={n.duration}
          />
        ))}
      </g>
    </svg>
  );
}
