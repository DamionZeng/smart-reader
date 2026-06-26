import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '../../utils/cn';
import type { PaperSection } from '@/types';
import { useTranslation } from 'react-i18next';

interface ConceptNodeData {
  title: string;
  description: string;
  isActive?: boolean;
  section?: PaperSection;
  note?: string;
}

// Section → accent color mapping (labels are i18n'd via SECTION_I18N_KEYS)
const SECTION_CONFIG: Record<PaperSection, { accent: string; bg: string }> = {
  abstract:      { accent: 'border-l-[#6B7280]', bg: 'bg-[#6B7280]/10' },
  introduction:  { accent: 'border-l-[#3B82F6]', bg: 'bg-[#3B82F6]/10' },
  method:        { accent: 'border-l-[#8B5CF6]', bg: 'bg-[#8B5CF6]/10' },
  experiment:    { accent: 'border-l-[#F59E0B]', bg: 'bg-[#F59E0B]/10' },
  result:        { accent: 'border-l-[#10B981]', bg: 'bg-[#10B981]/10' },
  conclusion:    { accent: 'border-l-[#EF4444]', bg: 'bg-[#EF4444]/10' },
  'related-work':{ accent: 'border-l-[#EC4899]', bg: 'bg-[#EC4899]/10' },
  background:    { accent: 'border-l-[#6366F1]', bg: 'bg-[#6366F1]/10' },
};

const SECTION_I18N_KEYS: Record<PaperSection, string> = {
  abstract: 'board.sectionAbstract',
  introduction: 'board.sectionIntroduction',
  method: 'board.sectionMethod',
  experiment: 'board.sectionExperiment',
  result: 'board.sectionResult',
  conclusion: 'board.sectionConclusion',
  'related-work': 'board.sectionRelatedWork',
  background: 'board.sectionBackground',
};

function ConceptNodeComponent({ data, selected }: { data?: ConceptNodeData; selected?: boolean }) {
  const { t } = useTranslation();
  const section = data?.section;
  const sectionCfg = section ? SECTION_CONFIG[section] : null;

  return (
    <div
      className={cn(
        "relative min-w-[240px] max-w-[280px] p-6 bg-[#F9F8F6] transition-colors duration-200 rounded-none shadow-none border-l-[3px]",
        sectionCfg ? sectionCfg.accent : "border-l-transparent",
        selected || data?.isActive
          ? "border border-[#1C1C1C] z-10"
          : "border border-[#1C1C1C]/20 hover:border-[#1C1C1C]/60"
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#F9F8F6] !border-[#1C1C1C] w-2 h-2 rounded-none shadow-none" />

      <div className="flex items-center justify-between mb-3">
        {sectionCfg && section ? (
          <span className={cn("text-[9px] uppercase tracking-[0.15em] font-sans px-2 py-0.5 rounded-none", sectionCfg.bg, "text-[#1C1C1C]/70")}>
            {t(SECTION_I18N_KEYS[section])}
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-sans">{t('board.topicNode')}</span>
        )}
        {data?.note && (
          <span className="w-2 h-2 rounded-full bg-[#1C1C1C]/40 shrink-0" title={t('board.hasNote')} />
        )}
      </div>
      <h3 className={cn("text-lg font-serif tracking-tight leading-tight mb-2", selected || data?.isActive ? "text-[#1C1C1C] italic" : "text-[#1C1C1C]")}>
        {data?.title || ""}
      </h3>
      <p className="text-xs text-[#1C1C1C]/60 leading-relaxed font-sans line-clamp-4">
        {data?.description || ""}
      </p>

      <Handle type="source" position={Position.Bottom} className="!bg-[#F9F8F6] !border-[#1C1C1C] w-2 h-2 rounded-none shadow-none" />
    </div>
  );
}

export const ConceptNode = memo(ConceptNodeComponent);
