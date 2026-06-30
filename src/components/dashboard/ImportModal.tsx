"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IngestionUI } from "@/components/board/IngestionUI";
import { CodeIngestionUI } from "@/components/board/CodeIngestionUI";
import { useSession } from "@/lib/auth-client";
import type { ProjectType } from "@/types";

interface ImportModalProps {
  /** 项目类型:paper 或 code */
  type: ProjectType;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 解析成功提交后回调(关闭弹窗 + 刷新列表) */
  onSubmitted: () => void;
}

/**
 * Dashboard 导入弹窗。
 *
 * 用户选择论文/代码类型后弹出,直接调用 Python /parse 服务:
 *   - Python 创建 project(status='parsing')+ 启动后台 KG 管线
 *   - 返回 projectId 后关闭弹窗,dashboard 轮询显示进度
 *
 * 不再经过 Next.js 转发,前端直接请求 Python 服务。
 * userId 作为 form 字段传递(非鉴权 header)。
 */
export function ImportModal({ type, onClose, onSubmitted }: ImportModalProps) {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 走 Vercel rewrites 反向代理（vercel.json 里 /parser/(.*) → http://47.239.249.167:30008/$1）
  // 生产环境无需配置 NEXT_PUBLIC_PARSER_URL；本地开发若直接连 Python 服务可设置此变量
  const parserUrl = process.env.NEXT_PUBLIC_PARSER_URL || "/parser";

  const handleIngest = async (name: string, url: string, file: File | null) => {
    if (!session?.user?.id) {
      setError(t("common.unauthorized"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("userId", session.user.id);
      formData.append("type", type);
      if (url) {
        formData.append("url", url);
      }
      if (file) {
        formData.append("file", file);
      }

      const response = await fetch(`${parserUrl}/parse`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || data.error || `Parse failed (${response.status})`);
      }

      const result = await response.json();

      // 如果 Python 返回 existing(幂等命中已有项目),也视为成功
      if (result.existing) {
        setError(t("ingest.alreadyExists", { defaultValue: "This URL has already been imported." }));
        setLoading(false);
        return;
      }

      // 解析任务已提交,关闭弹窗,dashboard 轮询显示进度
      onSubmitted();
    } catch (err: any) {
      setError(err.message || t("ingest.error"));
      setLoading(false);
    }
  };

  const UI = type === "code" ? CodeIngestionUI : IngestionUI;

  return (
    <UI
      onIngest={handleIngest}
      onClose={onClose}
      errorMessage={error}
      loading={loading}
    />
  );
}
