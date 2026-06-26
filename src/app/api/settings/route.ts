import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { SUPPORTED_LANGUAGES, isSupportedLanguage } from "@/lib/i18n-config";

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Return `null` (not "en") when the user has no settings row, so the
    // client can tell "user has never set anything" apart from "user
    // explicitly picked English". The client uses that distinction to
    // auto-onboard new users with their browser language — without it,
    // every fresh account would silently fall back to English even
    // when their browser is in Chinese / Japanese / etc.
    let language: string | null = null;
    let aiOutputLanguage: string | null = null;
    let hasSettingsRow = false;
    try {
      const [row] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);
      if (row) {
        hasSettingsRow = true;
        language = row.language;
        aiOutputLanguage = row.aiOutputLanguage;
      }
    } catch {
      // Table may not exist yet (pending migration) — leave nulls.
    }

    return NextResponse.json({
      language,
      aiOutputLanguage,
      hasSettingsRow,
    });
  } catch (error: any) {
    console.error("Settings GET error:", error);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { language, aiOutputLanguage } = body as {
      language?: string;
      aiOutputLanguage?: string;
    };

    // Validate inputs
    const updates: Record<string, string> = {};
    if (language !== undefined) {
      if (!isSupportedLanguage(language)) {
        return NextResponse.json(
          { error: `Unsupported language: ${language}` },
          { status: 400 }
        );
      }
      updates.language = language;
    }
    if (aiOutputLanguage !== undefined) {
      if (!isSupportedLanguage(aiOutputLanguage)) {
        return NextResponse.json(
          { error: `Unsupported AI output language: ${aiOutputLanguage}` },
          { status: 400 }
        );
      }
      updates.aiOutputLanguage = aiOutputLanguage;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // Upsert: try update first, insert if no row exists
    const [existing] = await db
      .select({ id: userSettings.id })
      .from(userSettings)
      .where(eq(userSettings.userId, session.user.id))
      .limit(1);

    if (existing) {
      await db
        .update(userSettings)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(userSettings.id, existing.id));
    } else {
      await db.insert(userSettings).values({
        userId: session.user.id,
        language: updates.language || "en",
        aiOutputLanguage: updates.aiOutputLanguage || "en",
      });
    }

    return NextResponse.json({ success: true, ...updates });
  } catch (error: any) {
    console.error("Settings POST error:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
