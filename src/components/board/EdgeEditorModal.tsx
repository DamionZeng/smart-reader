"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { EDGE_TYPES, type DocumentEdge, type EdgeType } from "@/types";
import { cn } from "@/utils/cn";

type Props = {
  edge: DocumentEdge;
  open: boolean;
  onClose: () => void;
  onSave: (next: DocumentEdge) => void;
};

export function EdgeEditorModal({ edge, open, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [edgeType, setEdgeType] = useState<EdgeType>(edge.edgeType ?? "relates");
  const [label, setLabel] = useState<string>(edge.label ?? "");
  const [note, setNote] = useState<string>(edge.note ?? "");

  useEffect(() => {
    if (open) {
      setEdgeType(edge.edgeType ?? "relates");
      setLabel(edge.label ?? "");
      setNote(edge.note ?? "");
    }
  }, [open, edge]);

  if (!open) return null;

  const handleSave = () => {
    onSave({
      ...edge,
      edgeType,
      label: label.trim() || undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1C1C]/30 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-lg border border-border bg-[#F9F8F6] p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-[#1C1C1C]/60 hover:text-[#1C1C1C]"
          aria-label={t("common.close")}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
          {t("edgeType.legend")}
        </div>
        <h2 className="font-serif text-2xl tracking-tight">
          {t("edgeType.editEdge")}
        </h2>

        {/* Type selector */}
        <div className="mt-6">
          <label className="mb-2 block text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
            {t("edgeType.relates")}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {EDGE_TYPES.map((et) => (
              <button
                key={et.value}
                onClick={() => setEdgeType(et.value)}
                className={cn(
                  "flex items-center gap-2 border px-3 py-2 text-left text-sm transition-colors",
                  edgeType === et.value
                    ? "border-[#1C1C1C] bg-[#1C1C1C] text-[#F9F8F6]"
                    : "border-border hover:border-[#1C1C1C]"
                )}
              >
                <EdgeTypeMini type={et.value} active={edgeType === et.value} />
                <span>{t(`edgeType.${et.value}`)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Label */}
        <div className="mt-4">
          <label
            htmlFor="edge-label"
            className="mb-2 block text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40"
          >
            Label
          </label>
          <input
            id="edge-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            placeholder="e.g. enables"
            className="w-full border border-border bg-transparent px-3 py-2 text-sm focus:border-[#1C1C1C] focus:outline-none placeholder:text-[#1C1C1C]/30"
          />
        </div>

        {/* Note */}
        <div className="mt-4">
          <label
            htmlFor="edge-note"
            className="mb-2 block text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40"
          >
            {t("edgeType.note")}
          </label>
          <textarea
            id="edge-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="..."
            className="w-full resize-none border border-border bg-transparent px-3 py-2 text-sm focus:border-[#1C1C1C] focus:outline-none placeholder:text-[#1C1C1C]/30"
          />
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-6">
          <button
            onClick={onClose}
            className="px-6 py-3 text-sm tracking-wide transition-colors hover:underline"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            className="bg-[#1C1C1C] px-6 py-3 text-sm tracking-wide text-[#F9F8F6] transition-colors hover:bg-[#1C1C1C]/90"
          >
            {t("edgeType.saveEdge")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EdgeTypeMini({
  type,
  active,
}: {
  type: EdgeType;
  active: boolean;
}) {
  const color = active ? "#F9F8F6" : "#1C1C1C";
  if (type === "relates") {
    return <span className="block h-px w-6" style={{ background: color }} />;
  }
  if (type === "depends") {
    return (
      <span
        className="block h-px w-6"
        style={{
          background: `repeating-linear-gradient(to right, ${color} 0 4px, transparent 4px 7px)`,
        }}
      />
    );
  }
  if (type === "extends") {
    return (
      <span
        className="block w-6"
        style={{ background: color, height: "2px" }}
      />
    );
  }
  return (
    <span
      className="block h-px w-6"
      style={{
        background: `repeating-linear-gradient(to right, ${color} 0 1px, transparent 1px 5px)`,
      }}
    />
  );
}
