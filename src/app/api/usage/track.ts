import { db } from "@/lib/db";
import { usageRecords } from "@/db/schema";

/**
 * Records a single AI usage event for the given user.
 *
 * Non-fatal: if the insert fails (e.g. transient DB error) the calling
 * request still succeeds — usage tracking must never break the user-facing
 * AI flow.
 */
export async function trackUsage(
  userId: string,
  endpoint: string,
  tokensUsed: number = 0
): Promise<void> {
  try {
    await db.insert(usageRecords).values({
      userId,
      endpoint,
      tokensUsed,
    });
  } catch (err) {
    // Non-fatal: don't fail the request if tracking fails
    console.error("Failed to track usage:", err);
  }
}
