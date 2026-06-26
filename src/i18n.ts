import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zh from "./locales/zh.json";

// 关键修复：服务端与客户端必须使用相同的初始语言，否则 SSR 文本
// 会和 hydrate 后由 navigator/localStorage 决定的语言产生不匹配。
// 这里把语言检测延后到客户端挂载完成之后（见 I18nHydrationGate）。
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en", "zh"],
  interpolation: {
    escapeValue: false,
  },
  // 不在初始化时启用 i18next-browser-languagedetector，
  // 避免在 SSR 阶段无法访问 window/navigator 时行为分叉。
  react: {
    useSuspense: false,
  },
});

// 客户端 i18n 是模块级单例。如果用户之前在别的页面切到了"zh"，
// 那么 hydrate 时 i18n.language 已经是 "zh"，与 SSR 渲染时的 "en"
// 不一致 → React 报 hydration mismatch。
//
// 解决：客户端首次加载模块时立即把语言重置为 "en"，让首次 React
// 渲染与 SSR 输出一致；之后再由 I18nHydrationGate 的 useEffect
// 安全地切回用户偏好（这一步只触发普通 React 更新）。
if (typeof window !== "undefined" && i18n.language !== "en") {
  i18n.changeLanguage("en");
}

export default i18n;
