import { agnes, AGNES_MODEL_FAST } from "@/lib/agnes";

/**
 * Generate a concise, human-readable project title from the document
 * content using a fast LLM call. Used at ingest time so the project
 * shell has a meaningful name immediately (instead of the raw filename
 * or "Untitled").
 *
 * Behaviour:
 *  - Input is plain text (HTML stripped beforehand by the caller).
 *  - We send only the first ~3000 chars to keep latency + token cost
 *    low — the title almost always comes from the abstract / intro.
 *  - The LLM is instructed to return a single line, max 12 words,
 *    no quotes, no trailing punctuation.
 *  - On any failure (network, empty response, parse error), the
 *    caller's fallback title is returned — title generation must
 *    never block ingestion.
 *
 * @param text   Plain text content of the document.
 * @param fallback  Title to use if LLM generation fails.
 */
export async function generateProjectTitle(
  text: string,
  fallback: string
): Promise<string> {
  const trimmed = (text || "").trim();
  if (trimmed.length < 40) {
    // Too short to meaningfully summarize — use the fallback.
    return fallback;
  }

  // First ~3000 chars is enough for the title/abstract/intro.
  const snippet = trimmed.slice(0, 3000);

  try {
    const completion = await agnes.chat.completions.create({
      model: AGNES_MODEL_FAST,
      temperature: 0.3,
      max_tokens: 60,
      messages: [
        {
          role: "system",
          content:
            "You generate a concise, descriptive title for a document based on its content. " +
            "Rules:\n" +
            "- Return ONLY the title text, nothing else.\n" +
            "- Max 12 words.\n" +
            "- No quotes, no trailing punctuation.\n" +
            "- Prefer the document's own title/heading if one is present in the first lines.\n" +
            "- Otherwise, summarize the core topic/method/contribution.\n" +
            "- Write in the same language as the document (Chinese doc → Chinese title, English doc → English title).",
        },
        {
          role: "user",
          content: snippet,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "";
    // Strip surrounding quotes if the model added them, and any
    // trailing period/newline.
    const cleaned = raw
      .replace(/^["'""\s]+|["'""\s]+$/g, "")
      .replace(/[.\s]+$/, "")
      .split("\n")[0]
      .trim();

    if (cleaned.length >= 2 && cleaned.length <= 120) {
      return cleaned;
    }
    return fallback;
  } catch (err) {
    console.error("[title-gen] LLM title generation failed:", err);
    return fallback;
  }
}
