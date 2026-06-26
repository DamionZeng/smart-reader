import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '../../utils/cn';
import { useTranslation } from 'react-i18next';

/**
 * Compact node renderer for concept-co-occurrence knowledge graphs.
 *
 * Unlike ConceptNode (240px wide card), this is a small pill/circle node
 * designed for 100+ node force-directed layouts:
 *   - Size scales with `importance` (3 tiers: 40/56/72px)
 *   - Border + faint fill use `clusterColor`
 *   - Label shown below the node, hidden when zoomed out (via CSS)
 *   - Type badge shown only for high-importance nodes
 *
 * Zoom-aware label fading (Obsidian-inspired):
 *   - zoom >= 0.8:  all labels visible
 *   - 0.5 <= zoom < 0.8: only medium+ importance labels
 *   - zoom < 0.5:  only high-importance labels (>= 0.7)
 * This keeps the canvas readable when zoomed out (you see the shape of
 * the graph) while preserving detail when zoomed in.
 */
interface ConceptGraphNodeData {
  title: string;
  description?: string;
  isActive?: boolean;
  isHoverNeighbor?: boolean;
  isFaded?: boolean;
  /**
   * True on the node currently under the cursor. Used to show that
   * node's label (and its neighbors' labels) on hover — labels are
   * hidden by default to keep the canvas clean.
   */
  isHovered?: boolean;
  clusterId?: string;
  /**
   * Kept on the data for downstream consumers (e.g. a future "find
   * nodes in same cluster" interaction), but no longer used for the
   * node fill. All nodes use a single color now (see nodeColor).
   */
  clusterColor?: string;
  clusterLabel?: string;
  importance?: number;
  frequency?: number;
  degree?: number;
  /**
   * True on the single node with the highest degree (most connections).
   * The renderer applies a distinct accent color so the central hub
   * of the graph is immediately visible — the "main concept" of the
   * article. Injected by `markMainNode` before layout.
   */
  isMain?: boolean;
  conceptType?: string;
  aliases?: string[];
  anchors?: string[];
  note?: string;
  /**
   * P2-2: stagger delay (ms) for the entrance animation. The parent
   * computes this once at load time based on importance ranking so
   * high-importance nodes appear first, creating a "graph builds up"
   * timeline animation. Capped at ~2s total so it doesn't drag.
   */
  entranceDelay?: number;
  /**
   * P2-3 (global graph): the source documents this concept was
   * extracted from. When present and length > 1, a small count badge
   * is shown on the node so the user can see it's a cross-article
   * concept. The parent's onNodeClick reads sourceDocuments[0].id to
   * navigate to the original article.
   */
  sourceDocuments?: Array<{ id: string; title: string }>;
}

const TYPE_LABELS: Record<string, string> = {
  method: 'METHOD',
  model: 'MODEL',
  metric: 'METRIC',
  dataset: 'DATA',
  term: 'TERM',
  tool: 'TOOL',
  task: 'TASK',
  function: 'FUNC',
  class: 'CLASS',
  module: 'MODULE',
  interface: 'IFACE',
  variable: 'VAR',
};

function ConceptGraphNodeComponent({ data, selected }: { data?: ConceptGraphNodeData; selected?: boolean }) {
  const { t } = useTranslation();
  const importance = data?.importance ?? 0;
  const degree = data?.degree ?? 0;
  const frequency = data?.frequency ?? 0;
  // Obsidian-style: every concept node is the same solid color.
  // The ONE exception is `isMain` — the single highest-degree hub
  // gets a distinct accent (editorial red) so the article's central
  // concept is immediately visible at a glance.
  const isMain = !!data?.isMain;
  const nodeColor = isMain ? '#991B1B' : '#1C1C1C';

  // P1-3: size by importance AND degree (structural centrality). For
  // a concept graph we ALSO want to scale by `frequency` (how many
  // times the concept was mentioned in the source text), since a
  // concept that appears 30 times is a more prominent topic than one
  // that appears once even if the LLM scored them similarly.
  //   - importance normalized to [0, 1]
  //   - degree normalized via log(1+degree)/log(1+20)  (log so 20
  //     edges isn't 20× bigger than 1)
  //   - frequency normalized via log(1+frequency)/log(1+30)  (log
  //     so a 50-mention concept isn't 50× bigger than a 1-mention)
  //   - final size score = max(importance, degreeWeight, freqWeight)
  //     so a high score on ANY axis pushes the node up a tier.
  const degreeWeight = Math.min(1, Math.log(1 + degree) / Math.log(1 + 20));
  const freqWeight = Math.min(1, Math.log(1 + frequency) / Math.log(1 + 30));
  const sizeScore = Math.max(importance, degreeWeight, freqWeight);

  // Smaller sizes than before — Obsidian-style compact nodes. Old
  // sizes (72/56/40px) were too large relative to the cluster
  // circles; the new range (28/22/16px) reads as "dots" until you
  // hover, while high-importance hubs still pop.
  const nodeRadius =
    sizeScore >= 0.7 ? 14 :
    sizeScore >= 0.4 ? 11 :
    8;
  const sizeClass =
    sizeScore >= 0.7 ? 'w-7 h-7' :
    sizeScore >= 0.4 ? 'w-[22px] h-[22px]' :
    'w-4 h-4';

  const labelSizeClass =
    sizeScore >= 0.7 ? 'text-xs' :
    sizeScore >= 0.4 ? 'text-[11px]' :
    'text-[10px]';

  // Labels are hidden by default and only surface on hover. When the
  // user hovers a node, the parent injects `isHovered` on that node
  // and `isHoverNeighbor` on its direct neighbors — we show labels
  // for both so the user can read the hovered concept plus its
  // immediate context. Everything else stays label-free to keep the
  // canvas readable at a glance.
  const showLabel = !!(data?.isHovered || data?.isHoverNeighbor);

  // P2-2: staggered entrance animation delay. The parent injects this
  // based on importance rank so high-importance nodes appear first.
  const entranceDelay = data?.entranceDelay ?? 0;

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center transition-all duration-200 animate-in fade-in zoom-in-50 duration-300",
        data?.isActive && "z-10 scale-110",
        data?.isHoverNeighbor && "z-10 scale-105",
        data?.isFaded && "opacity-15"
      )}
      style={{ width: 90, animationDelay: `${entranceDelay}ms` }}
    >
      {/* Obsidian-style solid node. Edges are rendered below the HTML
          node layer so the opaque fill hides any line segments that
          pass through the circle. No border by default — solid dots
          read as proper "data points" instead of UI chips.

          On hover we DO NOT modify the node itself (no ring, no scale
          change beyond the existing scale-105 for hover-neighbor).
          Instead, the parent fades non-incident nodes (isFaded) and
          dims non-incident edges, so the hovered subgraph stands out
          by contrast — exactly how Obsidian does it. */}
      <div
        className={cn(
          "relative rounded-full transition-all duration-200",
          sizeClass,
        )}
        style={{
          backgroundColor: nodeColor,
        }}
        data-node-radius={nodeRadius}
      >
        {/* Single hidden handle per type. The custom `shortest` edge
            does NOT use the handle position for routing — it
            computes the start/end points on the circle perimeter
            directly from the source/target node centers and the
            node radius stored in data-node-radius. This way, when
            one node has many edges, each line leaves the circle at
            the closest point to its specific target, so they fan
            out cleanly instead of stacking on a single handle. */}
        <Handle
          id="target"
          type="target"
          position={Position.Top}
          className="!w-1 !h-1 !min-w-0 !min-h-0 !bg-transparent !border-none !opacity-0"
        />
        <Handle
          id="source"
          type="source"
          position={Position.Top}
          className="!w-1 !h-1 !min-w-0 !min-h-0 !bg-transparent !border-none !opacity-0"
        />
      </div>

      {/* Label — absolutely positioned below the circle so it doesn't
          affect the node's layout box (and therefore doesn't pull the
          Bottom handle down). Hidden by default; revealed on hover. */}
      <div
        className={cn(
          "absolute top-full mt-1 text-center font-sans leading-tight max-w-[120px] truncate transition-opacity duration-150 pointer-events-none whitespace-nowrap z-20",
          labelSizeClass,
          showLabel ? "opacity-100" : "opacity-0",
          selected || data?.isActive ? "text-[#1C1C1C] font-medium" : "text-[#1C1C1C]/70"
        )}
        style={{ left: "50%", transform: "translateX(-50%)" }}
        title={data?.title}
      >
        {data?.title}
      </div>

      {/* Note indicator */}
      {data?.note && (
        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#1C1C1C]/40" title={t('board.hasNote')} />
      )}

      {/* P2-3: cross-article indicator — shows the number of source
          documents when this concept appears in more than one article.
          Rendered as a small pill on the top-left so it doesn't clash
          with the note dot. Only shown when there are 2+ sources. */}
      {data?.sourceDocuments && data.sourceDocuments.length > 1 && (
        <span
          className="absolute -top-2 -left-1 px-1 h-3.5 rounded-full bg-[#1C1C1C] text-[#F9F8F6] font-mono text-[8px] leading-3 flex items-center justify-center"
          title={t('board.crossArticleHint', { count: data.sourceDocuments.length })}
        >
          {data.sourceDocuments.length}
        </span>
      )}
    </div>
  );
}

export const ConceptGraphNode = memo(ConceptGraphNodeComponent);
