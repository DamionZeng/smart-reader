import { FileSearch } from "lucide-react";

interface GraphEmptyProps {
  message?: string;
}

/**
 * Centered empty-state placeholder for the concept graph canvas.
 * Uses the editorial monochrome palette — no rounded corners, no shadows.
 */
export function GraphEmpty({ message }: GraphEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-[#F9F8F6] text-[#1C1C1C] px-6">
      <FileSearch
        className="w-10 h-10 text-[#1C1C1C]/20 mb-6"
        strokeWidth={1}
        aria-hidden
      />
      <p className="font-serif italic text-lg text-[#1C1C1C]/60 text-center max-w-md leading-relaxed">
        {message ?? "Upload a paper or code file to generate a concept graph"}
      </p>
      <div className="w-12 h-px bg-[#1C1C1C]/20 mt-8" />
    </div>
  );
}
