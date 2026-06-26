/**
 * Email sending helpers.
 *
 * When RESEND_API_KEY is set we send through the Resend SDK. Otherwise we
 * fall back to console-logging the message, which is only useful in
 * local development where there is no real inbox to deliver to.
 *
 * Both verification codes and password resets flow through here. We keep
 * the content short and editorial — the app is an essay-like UI, so the
 * email should match that tone.
 */
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || "onboarding@resend.dev";

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(RESEND_API_KEY);
  return _resend;
}

/**
 * Send the 6-digit verification code to the user's inbox. We log it to
 * the server console regardless (so devs can copy it from the terminal
 * during local development) but only hit Resend when the API key is set.
 */
export async function sendVerificationCodeEmail({
  email,
  code,
}: {
  email: string;
  code: string;
}): Promise<void> {
  // Always log so devs can pick the code out of the terminal in dev
  console.log(`[Email] Verification code for ${email}: ${code}`);

  const resend = getResend();
  if (!resend) return;

  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: email,
      subject: `${code} — your SmartReader verification code`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1C1C1C;">
          <div style="font-family: Georgia, serif; font-size: 24px; font-weight: 600; margin-bottom: 24px;">
            SmartReader.
          </div>
          <p style="font-size: 14px; line-height: 1.6; color: #1C1C1C; margin: 0 0 24px 0;">
            Use the code below to finish creating your account.
          </p>
          <div style="background: #F9F8F6; border: 1px solid #1C1C1C20; padding: 24px; text-align: center; margin-bottom: 24px;">
            <div style="font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 36px; letter-spacing: 8px; font-weight: 600; color: #1C1C1C;">
              ${code}
            </div>
          </div>
          <p style="font-size: 12px; line-height: 1.6; color: #1C1C1C80; margin: 0;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
      text: `Your SmartReader verification code is: ${code}\n\nIf you didn't request this, you can ignore this email.`,
    });
  } catch (e) {
    // Don't fail the request when Resend hiccups — the code is still in the
    // server log and the user can request a new one.
    console.error(`[Email] Resend send failed for ${email}:`, e);
  }
}

export async function sendPasswordResetEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}): Promise<void> {
  console.log(`[Email] Password reset for ${email}: ${url}`);

  const resend = getResend();
  if (!resend) return;

  try {
    await resend.emails.send({
      from: RESEND_FROM,
      to: email,
      subject: "Reset your SmartReader password",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1C1C1C;">
          <div style="font-family: Georgia, serif; font-size: 24px; font-weight: 600; margin-bottom: 24px;">
            SmartReader.
          </div>
          <p style="font-size: 14px; line-height: 1.6; color: #1C1C1C; margin: 0 0 24px 0;">
            We received a request to reset your password. Click the link below to set a new one.
          </p>
          <a href="${url}" style="display: inline-block; background: #1C1C1C; color: #F9F8F6; padding: 14px 28px; text-decoration: none; font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 24px;">
            Reset Password
          </a>
          <p style="font-size: 12px; line-height: 1.6; color: #1C1C1C80; margin: 0;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
      text: `Reset your SmartReader password by visiting: ${url}\n\nIf you didn't request this, you can ignore this email.`,
    });
  } catch (e) {
    console.error(`[Email] Resend send failed for ${email}:`, e);
  }
}
