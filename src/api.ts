import type { Snapshot } from "../worker/copy";
import type { Adjustment, ListBody, Match, AdjustmentInput, IngredientNote, NewRecipe, PantryItem, ParsedRecipe, RecipeFull, RecipeSummary, StepValues } from "../shared/schema";

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

const GENERIC_ERROR = "Etwas ist schiefgelaufen. Bitte versuche es erneut.";

// User-facing text for a failed call; session expiry is shown by the global banner instead.
export function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof SessionExpiredError ? "" : GENERIC_ERROR;
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

// The server strips the note author from shared previews.
export type SharedPreview = Omit<Snapshot, "ingredient_notes"> & { ingredient_notes: Omit<IngredientNote, "author">[] };

export interface GroupSummary { id: string; name: string; member_count: number; recipe_count: number }
export interface GroupDetail { id: string; name: string; members: string[]; invites: string[]; recipes: RecipeSummary[] }
export interface Invite { group_id: string; group_name: string; invited_by: string }

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
  saveIngredientNote: (id: string, targetId: string, text: string) =>
    request<void>(`/api/recipes/${id}/ingredient-notes/${targetId}`, send("PUT", { text })),
  pantrySuggestions: () => request<{ name: string; unit: string }[]>("/api/pantry/suggestions"),
  listPantry: () => request<PantryItem[]>("/api/pantry"),
  addPantry: (name: string, amount: number | null, unit: string) =>
    request<PantryItem>("/api/pantry", send("POST", { name, amount, unit })),
  // Resolves to undefined (204) when the edit deleted the row.
  editPantry: (key: Pick<PantryItem, "canonical_name" | "unit">, set: Partial<PantryItem>) =>
    request<PantryItem | undefined>("/api/pantry", send("PATCH", { ...key, set })),
  deletePantry: (key: Pick<PantryItem, "canonical_name" | "unit">) => request<void>("/api/pantry", send("DELETE", key)),
  getList: () => request<ListBody>("/api/list"),
  planRecipe: (recipe_id: string, servings: number) => request<void>("/api/list/recipes", send("POST", { recipe_id, servings })),
  unplanRecipe: (recipeId: string) => request<void>(`/api/list/recipes/${recipeId}`, send("DELETE")),
  addListItem: (name: string, amount: number | null, unit: string) =>
    request<void>("/api/list/items", send("POST", { name, amount, unit })),
  deleteListItem: (id: string) => request<void>(`/api/list/items/${id}`, send("DELETE")),
  setTick: (key: string, ticked: boolean) => request<void>("/api/list/ticks", send("PUT", { key, ticked })),
  checkout: (lines: { key: string; canonical_name: string; unit: string; amount: number | null }[]) =>
    request<ListBody>("/api/list/checkout", send("POST", { lines })),
  getMatches: (id: string) => request<Match[]>(`/api/recipes/${id}/matches`),
  cooked: (id: string, items: { canonical_name: string; unit: string; amount: number }[]) =>
    request<void>(`/api/recipes/${id}/cooked`, send("POST", { items })),
  putAlias: (source_name: string, canonical_name: string, unit: string) =>
    request<void>("/api/aliases", send("PUT", { source_name, canonical_name, unit })),
  parse: (text: string) => request<ParsedRecipe>("/api/parse", send("POST", { text })),
  importLink: (url: string) =>
    request<{
      recipe: ParsedRecipe;
      source_url: string;
      source_platform: NewRecipe["source_platform"];
      image_url: string | null;
      caption: string | null;
    }>("/api/import-link", send("POST", { url })),
  shareRecipe: (id: string, mode: "with_comments" | "baked") =>
    request<{ url: string; expires_at: string }>(`/api/recipes/${id}/share`, send("POST", { mode })),
  getShared: (token: string) =>
    request<{ recipe: SharedPreview; expires_at: string; shared_by_initials: string }>(`/api/share/${encodeURIComponent(token)}`),
  importShared: (token: string) => request<{ id: string }>(`/api/share/${encodeURIComponent(token)}/import`, send("POST")),
  listGroups: () => request<GroupSummary[]>("/api/groups"),
  createGroup: (name: string) => request<{ id: string }>("/api/groups", send("POST", { name })),
  getGroup: (id: string) => request<GroupDetail>(`/api/groups/${id}`),
  inviteToGroup: (id: string, email: string) => request<void>(`/api/groups/${id}/invites`, send("POST", { email })),
  leaveGroup: (id: string) => request<void>(`/api/groups/${id}/members/me`, send("DELETE")),
  listInvites: () => request<Invite[]>("/api/invites"),
  acceptInvite: (groupId: string) => request<void>(`/api/invites/${groupId}/accept`, send("POST")),
  declineInvite: (groupId: string) => request<void>(`/api/invites/${groupId}`, send("DELETE")),
  shareToGroup: (id: string, group_id: string) => request<{ id: string }>(`/api/recipes/${id}/share-to-group`, send("POST", { group_id })),
  splitStep: (text: string) => request<{ steps: StepValues[] }>("/api/split-step", send("POST", { text })),
};
