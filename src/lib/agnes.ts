import OpenAI from "openai";

if (!process.env.AGNES_API_KEY) {
  throw new Error("AGNES_API_KEY is not defined");
}

export const agnes = new OpenAI({
  baseURL: "https://apihub.agnes-ai.com/v1",
  apiKey: process.env.AGNES_API_KEY,
  timeout: 90_000, // 90 seconds — concept extraction & enrichment need more time
  maxRetries: 2,
});

// Use the full-capability model for graph extraction & enrichment.
// The "flash" variant is faster but produces noticeably lower-quality
// concept extraction, which directly hurts the knowledge graph.
export const AGNES_MODEL = "agnes-2.0-flash";
// Reserved for light-weight tasks (cluster naming) where speed matters.
export const AGNES_MODEL_FAST = "agnes-2.0-flash";
