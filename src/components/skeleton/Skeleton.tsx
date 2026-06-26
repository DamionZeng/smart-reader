/**
 * Editorial 风格骨架屏基础组件
 * - 纯 Server Component（无 "use client"），SSR 安全
 * - 无 i18n 文本，避免 I18nHydrationGate 时序问题
 * - 严格遵循编辑设计：#F9F8F6 背景、#1C1C1C 低透明度块、无圆角、无阴影
 */

/** 基础骨架条 */
export function SkeletonBar({
  className = "",
  width,
  height,
}: {
  className?: string;
  width?: string;
  height?: string;
}) {
  return (
    <div
      className={`skeleton-pulse bg-[#1C1C1C]/10 ${className}`}
      style={{ width, height }}
    />
  );
}

/** 骨架块（较大区域） */
export function SkeletonBlock({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div className={`skeleton-pulse bg-[#1C1C1C]/8 ${className}`} />
  );
}

// ============================================================
// 页面级骨架屏
// ============================================================

/** Landing 首页骨架 */
export function LandingSkeleton() {
  return (
    <div className="min-h-screen bg-[#F9F8F6]">
      {/* Nav */}
      <div className="border-b border-[#1C1C1C]/10 px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <SkeletonBar width="120px" height="24px" />
          <SkeletonBar width="32px" height="32px" />
        </div>
      </div>
      {/* Hero */}
      <div className="min-h-[90vh] flex items-center px-6 border-b border-[#1C1C1C]/10">
        <div className="max-w-4xl mx-auto text-center w-full space-y-8">
          <SkeletonBar className="mx-auto" width="200px" height="10px" />
          <div className="space-y-4">
            <SkeletonBar className="mx-auto" width="480px" height="64px" />
            <SkeletonBar className="mx-auto" width="320px" height="64px" />
          </div>
          <SkeletonBar className="mx-auto" width="400px" height="16px" />
          <SkeletonBar className="mx-auto" width="180px" height="48px" />
        </div>
      </div>
    </div>
  );
}

/** Auth 页面骨架（login / register / forgot-password / verify-email） */
export function AuthSkeleton() {
  return (
    <div className="min-h-screen bg-[#F9F8F6] flex items-center justify-center px-6">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-4">
          <SkeletonBar className="mx-auto" width="160px" height="32px" />
          <SkeletonBar className="mx-auto" width="240px" height="14px" />
        </div>
        <div className="space-y-6">
          <div className="space-y-2">
            <SkeletonBar width="80px" height="12px" />
            <SkeletonBar width="100%" height="44px" />
          </div>
          <div className="space-y-2">
            <SkeletonBar width="80px" height="12px" />
            <SkeletonBar width="100%" height="44px" />
          </div>
          <SkeletonBar width="100%" height="48px" />
        </div>
        <SkeletonBar className="mx-auto" width="200px" height="14px" />
      </div>
    </div>
  );
}

/** Dashboard 骨架（项目网格 + 侧栏） */
export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-[#F9F8F6]">
      {/* Nav */}
      <div className="border-b border-[#1C1C1C]/10 px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <SkeletonBar width="120px" height="24px" />
          <SkeletonBar width="32px" height="32px" />
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <SkeletonBar width="280px" height="40px" />
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border border-[#1C1C1C]/10 p-6 space-y-4"
            >
              <SkeletonBar width="60%" height="20px" />
              <SkeletonBar width="40%" height="12px" />
              <SkeletonBar width="100%" height="40px" />
              <div className="flex gap-2">
                <SkeletonBar width="60px" height="28px" />
                <SkeletonBar width="60px" height="28px" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Canvas 页面骨架（board / codeboard） */
export function CanvasSkeleton() {
  return (
    <div className="w-screen h-screen bg-[#F9F8F6] flex">
      {/* Sidebar */}
      <div className="w-80 border-r border-[#1C1C1C]/10 p-6 space-y-4 hidden md:block">
        <SkeletonBar width="120px" height="20px" />
        <SkeletonBar width="100%" height="36px" />
        <div className="space-y-3 mt-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBar key={i} width="100%" height="32px" />
          ))}
        </div>
      </div>
      {/* Canvas area */}
      <div className="flex-1 relative">
        <SkeletonBlock className="absolute inset-0" />
        {/* Toolbar */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
          <SkeletonBar width="200px" height="32px" />
          <div className="flex gap-2">
            <SkeletonBar width="32px" height="32px" />
            <SkeletonBar width="32px" height="32px" />
            <SkeletonBar width="32px" height="32px" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Graph 页面骨架 */
export function GraphSkeleton() {
  return (
    <div className="w-screen h-screen bg-[#F9F8F6] flex flex-col">
      {/* Top bar */}
      <div className="border-b border-[#1C1C1C]/10 px-6 py-4 flex items-center justify-between">
        <SkeletonBar width="160px" height="24px" />
        <div className="flex gap-3">
          <SkeletonBar width="80px" height="32px" />
          <SkeletonBar width="80px" height="32px" />
          <SkeletonBar width="32px" height="32px" />
        </div>
      </div>
      <div className="flex-1 flex">
        {/* Graph canvas */}
        <div className="flex-1 relative">
          <SkeletonBlock className="absolute inset-0" />
        </div>
        {/* Right panel */}
        <div className="w-96 border-l border-[#1C1C1C]/10 p-6 space-y-4 hidden lg:block">
          <SkeletonBar width="120px" height="20px" />
          <SkeletonBar width="100%" height="60px" />
          <SkeletonBar width="100%" height="120px" />
          <SkeletonBar width="100%" height="40px" />
        </div>
      </div>
    </div>
  );
}

/** Import 页面骨架 */
export function ImportSkeleton() {
  return (
    <div className="min-h-screen bg-[#F9F8F6]">
      <div className="border-b border-[#1C1C1C]/10 px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <SkeletonBar width="120px" height="24px" />
          <SkeletonBar width="32px" height="32px" />
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-6 py-24 space-y-12">
        <div className="text-center space-y-4">
          <SkeletonBar className="mx-auto" width="240px" height="40px" />
          <SkeletonBar className="mx-auto" width="320px" height="14px" />
        </div>
        {/* Upload zone */}
        <div className="border border-[#1C1C1C]/10 p-16 space-y-6">
          <SkeletonBar className="mx-auto" width="64px" height="64px" />
          <SkeletonBar className="mx-auto" width="200px" height="16px" />
          <SkeletonBar className="mx-auto" width="160px" height="14px" />
        </div>
        <SkeletonBar className="mx-auto" width="180px" height="48px" />
      </div>
    </div>
  );
}

/** Settings 页面骨架 */
export function SettingsSkeleton() {
  return (
    <div className="min-h-screen bg-[#F9F8F6]">
      <div className="border-b border-[#1C1C1C]/10 px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <SkeletonBar width="120px" height="24px" />
          <SkeletonBar width="32px" height="32px" />
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-6 py-12 space-y-12">
        <SkeletonBar width="200px" height="40px" />
        <div className="space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="border border-[#1C1C1C]/10 p-6 space-y-4"
            >
              <SkeletonBar width="160px" height="20px" />
              <SkeletonBar width="100%" height="44px" />
              <SkeletonBar width="60%" height="12px" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Share 页面骨架 */
export function ShareSkeleton() {
  return (
    <div className="min-h-screen bg-[#F9F8F6] flex flex-col">
      <div className="border-b border-[#1C1C1C]/10 px-6 py-5">
        <div className="max-w-7xl mx-auto">
          <SkeletonBar width="120px" height="24px" />
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-3xl space-y-8">
          <SkeletonBar className="mx-auto" width="280px" height="40px" />
          <SkeletonBar className="mx-auto" width="400px" height="16px" />
          <SkeletonBlock className="w-full h-64" />
          <div className="flex justify-center gap-4">
            <SkeletonBar width="120px" height="48px" />
            <SkeletonBar width="120px" height="48px" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Graph Compare 页面骨架 */
export function GraphCompareSkeleton() {
  return (
    <div className="w-screen h-screen bg-[#F9F8F6] flex flex-col">
      <div className="border-b border-[#1C1C1C]/10 px-6 py-4 flex items-center justify-between">
        <SkeletonBar width="200px" height="24px" />
        <SkeletonBar width="100px" height="32px" />
      </div>
      <div className="flex-1 flex gap-px bg-[#1C1C1C]/10">
        <div className="flex-1 relative">
          <SkeletonBlock className="absolute inset-0" />
        </div>
        <div className="flex-1 relative">
          <SkeletonBlock className="absolute inset-0" />
        </div>
      </div>
    </div>
  );
}
