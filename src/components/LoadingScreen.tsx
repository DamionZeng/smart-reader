export function LoadingScreen({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-[#F9F8F6] text-[#1C1C1C]">
      <div className="flex items-center gap-4">
        <div className="w-2 h-2 bg-[#1C1C1C] animate-ping rounded-none" />
        <p className="text-xs uppercase tracking-[0.2em] font-semibold text-[#1C1C1C]/60 font-sans">{message}</p>
      </div>
    </div>
  );
}
