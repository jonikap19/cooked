import type { Adjustment, AdjustmentInput, NewRecipe, ParsedRecipe, RecipeFull, RecipeSummary, StepValues } from "../shared/schema";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: { caption?: string | null },
  ) {
    super(message);
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Sitzung abgelaufen");
  }
}

let expired = false;
const listeners = new Set<() => void>();
export const sessionStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  isExpired: () => expired,
};

function expire(): never {
  expired = true;
  listeners.forEach((listener) => listener());
  throw new SessionExpiredError();
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers;
  // A rejected fetch is how an expired Access session looks (redirect to cloudflareaccess.com fails CORS).
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" }).catch(expire);
  if (response.status === 401) expire();
  if (response.status === 204) return undefined as T;
  if (!response.headers.get("content-type")?.includes("application/json")) expire();
  const body = (await response.json()) as { error?: string; caption?: string | null };
  if (!response.ok) throw new ApiError(response.status, body.error ?? "Etwas ist schiefgelaufen", body);
  return body as T;
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  me: () => request<{ userId: string }>("/api/me"),
  listRecipes: () => request<RecipeSummary[]>("/api/recipes"),
  createRecipe: (recipe: NewRecipe) => request<{ id: string }>("/api/recipes", send("POST", recipe)),
  getRecipe: (id: string) => request<RecipeFull>(`/api/recipes/${id}`),
  updateTags: (id: string, tags: string[]) => request<void>(`/api/recipes/${id}`, send("PATCH", { tags })),
  deleteRecipe: (id: string) => request<void>(`/api/recipes/${id}`, send("DELETE")),
  addAdjustment: (id: string, input: AdjustmentInput) =>
    request<Adjustment | undefined>(`/api/recipes/${id}/adjustments`, send("POST", input)),
  updateAdjustment: (id: string, adjustmentId: string, new_values: Adjustment["new_values"]) =>
    request<Adjustment>(`/api/recipes/${id}/adjustments/${adjustmentId}`, send("PATCH", { new_values })),
  deleteAdjustment: (id: string, adjustmentId: string) =>
    request<void>(`/api/recipes/${id}/adjustments/${adjustmentId}`, send("DELETE")),
  saveNote: (id: string, text: string) => request<void>(`/api/recipes/${id}/note`, send("PUT", { text })),
  parse: (text: string) => request<ParsedRecipe>("/api/parse", send("POST", { text })),
  importLink: (url: string) =>
    request<{
      recipe: ParsedRecipe;
      source_url: string;
      source_platform: NewRecipe["source_platform"];
      image_url: string | null;
      caption: string | null;
    }>("/api/import-link", send("POST", { url })),
  splitStep: (text: string) => request<{ steps: StepValues[] }>("/api/split-step", send("POST", { text })),
};
