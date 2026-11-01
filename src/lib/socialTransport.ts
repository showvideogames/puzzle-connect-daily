/**
 * The live connection to the shared Friends and Groups hub: one POST to the
 * social-gateway Edge Function per call. Rainbow's adapter stays free of the
 * network, and whoever builds a client hands this in as its transport.
 *
 * Nothing here retries, logs or throws: anything but a well-formed answer from
 * the gateway is `unavailable`, and the portable client decides what happens
 * next.
 */

import { OUTCOMES } from "@/social/contract";
import type { Result, SocialTransport } from "@/social/contract";
import { AUTH_STORAGE_KEY } from "./platformSignIn";

const UNAVAILABLE = { ok: false, outcome: "unavailable" } as const;

/** Only the gateway's two shapes, and only an outcome the contract knows. */
function isResult(body: unknown): body is Result<never> {
  if (typeof body !== "object" || body === null) return false;
  const { ok, data, outcome } = body as { ok?: unknown; data?: unknown; outcome?: unknown };
  if (ok === true) return data !== undefined;
  return ok === false && (OUTCOMES as readonly unknown[]).includes(outcome);
}

export function createGatewayTransport({ baseUrl, publishableKey }: {
  baseUrl: string;
  publishableKey: string;
}): SocialTransport {
  const url = `${baseUrl.replace(/\/+$/, "")}/functions/v1/social-gateway`;
  return {
    async call(op, args, credential) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json", apikey: publishableKey };
        if (credential) headers.Authorization = `Bearer ${credential}`;
        const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ op, args }) });
        if (!response.ok) return UNAVAILABLE;
        const body: unknown = await response.json();
        return isResult(body) ? body : UNAVAILABLE;
      } catch {
        return UNAVAILABLE;
      }
    },
  };
}

/** The access token of the session stored under AUTH_STORAGE_KEY, or null if it can't be read. */
export function readStoredAccessToken(): string | null {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored === null) return null;
    const token = JSON.parse(stored)?.access_token;
    return typeof token === "string" && token !== "" ? token : null;
  } catch {
    return null;
  }
}
