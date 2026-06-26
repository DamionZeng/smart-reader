import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '../../utils/cn';

interface CodeNodeData {
  title: string;
  description: string;
  isActive?: boolean;
  filePath?: string;
  language?: string;
  codeSnippet?: string;
}

const NODE_TYPE_LABELS: Record<string, string> = {
  module: 'MODULE',
  function: 'FUNCTION',
  class: 'CLASS',
  concept: 'CONCEPT',
};

function CodeNodeComponent({ data, type, selected }: { data?: CodeNodeData; type?: string; selected?: boolean }) {
  const typeLabel = NODE_TYPE_LABELS[type || ''] || 'NODE';

  return (
    <div
      className={cn(
        "relative min-w-[260px] max-w-[320px] bg-[#F9F8F6] transition-colors duration-200 rounded-none shadow-none",
        selected || data?.isActive
          ? "border border-[#1C1C1C] z-10"
          : "border border-[#1C1C1C]/20 hover:border-[#1C1C1C]/60"
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#F9F8F6] !border-[#1C1C1C] w-2 h-2 rounded-none shadow-none" />

      {/* Header bar — monospace type label + language tag */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1C1C1C]/10">
        <span className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-mono">
          {typeLabel}
        </span>
        {data?.language && (
          <span className="text-[10px] uppercase tracking-[0.15em] text-[#1C1C1C]/30 font-mono">
            {data.language}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        <h3 className={cn(
          "text-base font-mono tracking-tight leading-tight mb-2 break-all",
          selected || data?.isActive ? "text-[#1C1C1C] italic" : "text-[#1C1C1C]"
        )}>
          {data?.title || ""}
        </h3>

        {data?.filePath && (
          <p className="text-[10px] text-[#1C1C1C]/40 font-mono mb-2 truncate">
            {data.filePath}
          </p>
        )}

        <p className="text-xs text-[#1C1C1C]/60 leading-relaxed font-sans line-clamp-4">
          {data?.description || ""}
        </p>

        {data?.codeSnippet && (
          <pre className="mt-3 p-3 bg-[#1C1C1C]/5 border border-[#1C1C1C]/10 text-[10px] font-mono text-[#1C1C1C]/70 leading-relaxed overflow-hidden max-h-24">
            <code>{data.codeSnippet}</code>
          </pre>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-[#F9F8F6] !border-[#1C1C1C] w-2 h-2 rounded-none shadow-none" />
    </div>
  );
}

export const CodeNode = memo(CodeNodeComponent);
