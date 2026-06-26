"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Send, MessageCircle, Trash2, Loader2, Paperclip, Image as ImageIcon } from "lucide-react";
import Markdown from "markdown-to-jsx";
import { isAcceptedImage, fileToImageDataUrl } from "@/utils/image";
import type { ChatImageAttachment } from "@/types";

interface QAMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Tier 2: image attachments on the user message (display + re-send) */
  images?: ChatImageAttachment[];
}

interface QAPanelProps {
  projectId: string;
  onClose: () => void;
}

export function QAPanel({ projectId, onClose }: QAPanelProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredNotice, setRestoredNotice] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Tier 2: pending image attachments for the next question
  const [pendingImages, setPendingImages] = useState<ChatImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasRestoredRef = useRef(false);
  const saveAbortRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load saved conversation from DB on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/qa/conversations?projectId=${encodeURIComponent(projectId)}`,
          { credentials: "include" }
        );
        if (cancelled) return;
        if (res.status === 404) {
          // No saved conversation yet — nothing to restore.
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        const saved = data?.conversation?.messages;
        if (Array.isArray(saved) && saved.length > 0) {
          const restored: QAMessage[] = saved.map((m: any) => ({
            id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
            role: m.role === "assistant" ? "assistant" : "user",
            content: typeof m.content === "string" ? m.content : "",
          }));
          setMessages(restored);
          if (data?.conversation?.id) {
            setConversationId(data.conversation.id);
          }
          setRestoredNotice(true);
          setTimeout(() => setRestoredNotice(false), 3000);
        }
      } catch {
        // Ignore network errors — start with an empty conversation.
      } finally {
        if (!cancelled) {
          hasRestoredRef.current = true;
          setIsRestoring(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Save conversation to DB (debounced 1s)
  useEffect(() => {
    // Don't save before the initial restore completes, and skip empty
    // conversations so we don't create rows for nothing.
    if (!hasRestoredRef.current || messages.length === 0) return;
    const timer = setTimeout(() => {
      // Abort any in-flight save (e.g. rapid successive edits).
      if (saveAbortRef.current) saveAbortRef.current.abort();
      const controller = new AbortController();
      saveAbortRef.current = controller;

      fetch("/api/qa/conversations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: new Date().toISOString(),
          })),
        }),
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.conversation?.id) {
            setConversationId(data.conversation.id);
          }
        })
        .catch(() => {
          // Ignore save errors — non-critical.
        });
    }, 1000);
    return () => clearTimeout(timer);
  }, [messages, projectId]);

  const handleAsk = async () => {
    const question = input.trim();
    if ((!question && pendingImages.length === 0) || isLoading) return;

    const userMsg: QAMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      ...(pendingImages.length > 0 ? { images: pendingImages } : {}),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setPendingImages([]);
    setIsLoading(true);
    setError(null);

    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          question,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
          // Tier 2: forward image attachments as data-URLs
          images: pendingImages.map((img) => ({
            dataUrl: img.dataUrl,
            ...(img.name ? { name: img.name } : {}),
          })),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to get answer");
      }

      // Create a placeholder assistant message that we'll update as chunks arrive
      const assistantIndex = newMessages.length;
      setMessages([...newMessages, { id: crypto.randomUUID(), role: "assistant", content: "" }]);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                break;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  // Append content to the last assistant message
                  setMessages((prev) => {
                    const updated = [...prev];
                    if (updated[assistantIndex]) {
                      updated[assistantIndex] = {
                        ...updated[assistantIndex],
                        content: updated[assistantIndex].content + parsed.content,
                      };
                    }
                    return updated;
                  });
                }
                if (parsed.error) {
                  setError(parsed.error);
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err.message || t("board.qaError"));
      // On error, restore the input so user can retry
      setInput(question);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  const handleClear = () => {
    setMessages([]);
    const idToDelete = conversationId;
    setConversationId(null);
    if (idToDelete) {
      fetch(`/api/qa/conversations/${encodeURIComponent(idToDelete)}`, {
        method: "DELETE",
        credentials: "include",
      }).catch(() => {
        // Ignore delete errors — non-critical.
      });
    }
  };

  return (
    <div className="w-[420px] h-full bg-[#F9F8F6] border-r border-[#1C1C1C]/10 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1C1C1C]/10">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-4 h-4 text-[#1C1C1C]/60" />
          <div>
            <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 mb-0.5">
              {t("board.qaTitle")}
            </p>
            <h3 className="font-serif text-lg tracking-tight text-[#1C1C1C]">
              {t("board.qaSubtitle")}
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors duration-200 focus:outline-none p-1"
              aria-label={t("board.clearConversation")}
              title={t("board.clearConversation")}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors duration-200 focus:outline-none"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {restoredNotice && (
        <div className="px-6 py-2 bg-[#1C1C1C]/5 border-b border-[#1C1C1C]/10">
          <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
            {t("board.conversationRestored")}
          </p>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} aria-live="polite" aria-busy={isLoading} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {isRestoring ? (
          <div className="text-center py-12">
            <Loader2 className="w-5 h-5 text-[#1C1C1C]/30 mx-auto mb-4 animate-spin" />
            <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
              {t("common.loading")}
            </p>
          </div>
        ) : messages.length === 0 && !isLoading ? (
          <div className="text-center py-12">
            <MessageCircle className="w-8 h-8 text-[#1C1C1C]/20 mx-auto mb-4" />
            <p className="font-sans text-sm text-[#1C1C1C]/40 leading-relaxed">
              {t("board.qaEmpty")}
            </p>
          </div>
        ) : null}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed font-sans ${
                msg.role === "user"
                  ? "bg-[#1C1C1C] text-[#F9F8F6]"
                  : "bg-[#1C1C1C]/5 text-[#1C1C1C]/80 border border-[#1C1C1C]/10"
              }`}
            >
              {msg.role === "assistant" ? (
                <Markdown
                  options={{
                    disableParsingRawHTML: true,
                    forceBlock: true,
                  }}
                  className="prose-sm [&_p]:mb-2 [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[#1C1C1C]/20 [&_blockquote]:pl-3 [&_blockquote]:text-[#1C1C1C]/60 [&_code]:font-mono [&_code]:text-xs [&_pre]:bg-[#1C1C1C]/5 [&_pre]:p-2 [&_pre]:text-xs"
                >
                  {msg.content}
                </Markdown>
              ) : (
                <>
                  {msg.images && msg.images.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {msg.images.map((img, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={img.dataUrl}
                          alt={img.name || `attachment-${i + 1}`}
                          className="w-20 h-20 object-cover border border-[#F9F8F6]/30"
                        />
                      ))}
                    </div>
                  )}
                  {msg.content}
                </>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-[#1C1C1C]/5 border border-[#1C1C1C]/10 px-4 py-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-[#1C1C1C]/30 rounded-full animate-pulse" />
                <span className="w-1.5 h-1.5 bg-[#1C1C1C]/30 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
                <span className="w-1.5 h-1.5 bg-[#1C1C1C]/30 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
              </div>
            </div>
          </div>
        )}
        {error && (
          <p className="font-sans text-xs text-[#1C1C1C]/60 italic">{error}</p>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[#1C1C1C]/10 px-6 py-4">
        {attachmentError && (
          <p className="mb-2 font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60">
            {attachmentError}
          </p>
        )}
        {pendingImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingImages.map((img, i) => (
              <div
                key={i}
                className="relative w-16 h-16 border border-[#1C1C1C]/20"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.dataUrl}
                  alt={img.name || `pending-${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPendingImages((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                  className="absolute -top-1.5 -right-1.5 bg-[#1C1C1C] text-[#F9F8F6] w-4 h-4 inline-flex items-center justify-center focus:outline-none"
                  aria-label={t("common.close")}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-stretch gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={async (e) => {
              setAttachmentError(null);
              const files = Array.from(e.target.files || []);
              if (files.length === 0) return;
              if (pendingImages.length + files.length > 4) {
                setAttachmentError(t("qa.attachmentLimit"));
              }
              const toAdd: ChatImageAttachment[] = [];
              for (const f of files) {
                if (pendingImages.length + toAdd.length >= 4) break;
                if (!isAcceptedImage(f)) {
                  setAttachmentError(t("qa.attachmentTypeError"));
                  continue;
                }
                try {
                  const dataUrl = await fileToImageDataUrl(f);
                  toAdd.push({ dataUrl, name: f.name, approxBytes: f.size });
                } catch (err: any) {
                  setAttachmentError(err?.message || t("qa.attachmentReadError"));
                }
              }
              if (toAdd.length > 0) {
                setPendingImages((prev) => [...prev, ...toAdd].slice(0, 4));
              }
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || pendingImages.length >= 4}
            className="shrink-0 inline-flex items-center justify-center bg-transparent border border-[#1C1C1C]/20 text-[#1C1C1C] px-3 transition-colors duration-200 hover:border-[#1C1C1C] disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none min-h-[40px]"
            aria-label={t("qa.attachImage")}
            title={t("qa.attachImage")}
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              pendingImages.length > 0
                ? t("qa.placeholderWithAttachment")
                : t("board.qaPlaceholder")
            }
            rows={1}
            className="flex-1 font-sans text-sm text-[#1C1C1C] bg-transparent border border-[#1C1C1C]/20 focus:border-[#1C1C1C] focus:outline-none px-3 py-2 resize-none min-h-[40px] max-h-[120px]"
            disabled={isLoading}
          />
          <button
            type="button"
            onClick={handleAsk}
            disabled={(!input.trim() && pendingImages.length === 0) || isLoading}
            className="shrink-0 inline-flex items-center justify-center bg-[#1C1C1C] text-[#F9F8F6] border border-[#1C1C1C] px-4 transition-colors duration-200 hover:bg-[#1C1C1C]/80 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none min-h-[40px]"
            aria-label={t("board.qaSend")}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
