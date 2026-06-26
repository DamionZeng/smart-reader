import { memo } from 'react';
import { Handle, Position, useViewport } from '@xyflow/react';
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
  clusterId?: string;
  clusterColor?: string;
  clusterLabel?: string;
  importance?: number;
  frequency?: number;
  degree?: number;
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
  const { zoom } = useViewport();
  const importance = data?.importance ?? 0;
  const degree = data?.degree ?? 0;
  const clusterColor = data?.clusterColor || '#1C1C1C';

  // P1-3: size by both importance AND degree. A high-degree hub should
  // be visually larger even if the LLM marked it as low importance,
  // because it's structurally central to the graph. We blend the two:
  //   - importance normalized to [0, 1]
  //   - degree normalized via log(1 + degree) / log(1 + maxDegree=20)
  //     (log so a node with 20 edges isn't 20x bigger than one with 1)
  //   - final size score = max(importance, degreeWeight) so a high
  //     score on EITHER axis pushes the node up a tier
  const degreeWeight = Math.min(1, Math.log(1 + degree) / Math.log(1 + 20));
  const sizeScore = Math.max(importance, degreeWeight);

  // Size tiers by combined score
  const sizeClass =
    sizeScore >= 0.7 ? 'w-[72px] h-[72px]' :
    sizeScore >= 0.4 ? 'w-[56px] h-[56px]' :
    'w-[40px] h-[40px]';

  const labelSizeClass =
    sizeScore >= 0.7 ? 'text-xs' :
    sizeScore >= 0.4 ? 'text-[11px]' :
    'text-[10px]';

  // Zoom-aware label visibility. When zoomed out, hide labels for
  // low-importance nodes so the canvas doesn't become a sea of text.
  // Thresholds: zoom<0.5 → only high; <0.8 → medium+; >=0.8 → all.
  // We use opacity transition instead of display:none so the layout
  // doesn't jump as the user scrolls.
  const labelOpacity =
    zoom >= 0.8 ? 'opacity-100' :
    zoom >= 0.5 ? (sizeScore >= 0.4 ? 'opacity-100' : 'opacity-0') :
    (sizeScore >= 0.7 ? 'opacity-100' : 'opacity-0');

  // P2-2: staggered entrance animation delay. The parent injects this
  // based on importance rank so high-importance nodes appear first.
  const entranceDelay = data?.entranceDelay ?? 0;

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center transition-all duration-200 animate-in fade-in zoom-in-50 duration-300",
        data?.isActive && "z-10 scale-110",
        data?.isHoverNeighbor && "z-10 scale-105",
        data?.isFaded && "opacity-20"
      )}
      style={{ width: 90, animationDelay: `${entranceDelay}ms` }}
    >
      <Handle type="target" position={Position.Top} className="!w-1 !h-1 !min-w-0 !min-h-0 !bg-transparent !border-none !opacity-0" />

      {/* Node circle */}
      <div
        className={cn(
          "rounded-full flex items-center justify-center transition-all duration-200 border-2",
          sizeClass,
          selected || data?.isActive
            ? "shadow-md"
            : data?.isHoverNeighbor
            ? "shadow-md ring-2 ring-offset-1"
            : "hover:shadow-sm"
        )}
        style={{
          backgroundColor: `${clusterColor}20`,
          borderColor: clusterColor,
          borderWidth: selected || data?.isActive ? 3 : data?.isHoverNeighbor ? 3 : 2,
        }}
      >
        {/* Type badge for high-importance nodes (uses sizeScore so hubs get it too) */}
        {sizeScore >= 0.7 && data?.conceptType && TYPE_LABELS[data.conceptType] && (
          <span
            className="text-[8px] font-mono uppercase tracking-wider opacity-60"
            style={{ color: clusterColor }}
          >
            {TYPE_LABELS[data.conceptType]}
          </span>
        )}
      </div>

      {/* Label below node */}
      <div
        className={cn(
          "mt-1 text-center font-sans leading-tight max-w-[90px] truncate transition-opacity duration-200",
          labelSizeClass,
          labelOpacity,
          selected || data?.isActive ? "text-[#1C1C1C] font-medium" : "text-[#1C1C1C]/70"
        )}
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

      <Handle type="source" position={Position.Bottom} className="!w-1 !h-1 !min-w-0 !min-h-0 !bg-transparent !border-none !opacity-0" />
    </div>
  );
}

export const ConceptGraphNode = memo(ConceptGraphNodeComponent);
