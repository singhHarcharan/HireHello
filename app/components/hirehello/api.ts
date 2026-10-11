export type Template = { id: string; name: string; subject: string; bodyText: string; updatedAt?: string };
export type Resume = { id: string; label: string; filename?: string; size?: number; createdAt?: string };
export type Contact = { id: string; recruiterName: string; emailNormalized?: string; email?: string; companyName: string; status?: string };
export type Campaign = { id: string; name: string; status: string; senderAddress?: string; totals?: Record<string, number>; createdAt?: string };
export type Delivery = { id: string; to: string; recruiterName?: string; companyName?: string; status: string; errorCode?: string; errorMessage?: string };
export type Preview = { to: string; recruiterName?: string; companyName?: string; subject: string; bodyText?: string; body?: string };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.message === "string" ? data.message : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

export function json(method: string, body: unknown, extraHeaders?: Record<string, string>): RequestInit {
  return { method, headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(body) };
}

export function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}
