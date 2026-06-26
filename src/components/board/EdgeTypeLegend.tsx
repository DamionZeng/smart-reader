"use client";

import { useTranslation } from "react-i18next";
import { EDGE_TYPES } from "@/types";

/**
 * Visual legend for the four supported relationship types.
 * Rendered as a small floating panel in the bottom-left of the canvas.
 */
export function EdgeTypeLegend() {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-auto mt-3 bg-[#F9F8F6] p-3 text-xs">
      <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
        {t("edgeType.legend")}
      </div>
      <ul className="space-y-1.5">
        {EDGE_TYPES.map((et) => (
          <li key={et.value} className="flex items-center gap-2">
            <EdgeTypeSwatch type={et.value} />
            <span className="text-[10px] uppercase tracking-[0.1em] text-[#1C1C1C]/70">
              {t(`edgeType.${et.value}`)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EdgeTypeSwatch({
  type,
}: {
  type: (typeof EDGE_TYPES)[number]["value"];
}) {
  const base = "block h-px w-10";
  if (type === "relates") {
    return <span className={base} style={{ background: "#1C1C1C" }} />;
  }
  if (type === "depends") {
    return (
      <span
        className={base}
        style={{
          background:
            "repeating-linear-gradient(to right, #1C1C1C 0 4px, transparent 4px 7px)",
        }}
      />
    );
  }
  if (type === "extends") {
    return (
      <span
        className={base}
        style={{ background: "#1C1C1C", height: "2px" }}
      />
    );
  }
  // contradicts — dotted
  return (
    <span
      className={base}
      style={{
        background:
          "repeating-linear-gradient(to right, #1C1C1C 0 1px, transparent 1px 5px)",
      }}
    />
  );
}
