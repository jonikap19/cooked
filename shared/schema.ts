import { z } from "zod";
import type { ShoppingLine } from "./shopping";

const Platform = z.enum(["instagram", "youtube", "web"]);

export const IngredientValues = z.object({
  name: z.string().trim().min(1).max(200),
  amount: z.number().min(0).max(100_000).nullable(),
  unit: z.string().max(30),
  spice: z.boolean(),
});
export type IngredientValues = z.infer<typeof IngredientValues>;

export const StepValues = z.object({
  text: z.string().trim().min(1).max(2000),
  duration_minutes: z.number().int().min(1).max(1440).nullable(),
});
export type StepValues = z.infer<typeof StepValues>;

// Plain object schema (no transforms/refinements) so z.toJSONSchema can export it for the AI call.
export const ParsedRecipe = z.object({
  title: z.string().trim().min(1).max(200),
  servings: z.number().int().min(1).max(100),
  total_minutes: z.number().int().min(1).max(2880).nullable(),
  ingredients: z.array(IngredientValues).max(100),
  steps: z.array(StepValues).min(1).max(100),
});
export type ParsedRecipe = z.infer<typeof ParsedRecipe>;

export const HttpsUrl = z
  .url()
  .max(2048)
  .refine((value) => URL.canParse(value) && new URL(value).protocol === "https:", "Nur https-Links");

// Request-side ingredient: clients and share links from before Gewürze send no spice, which means false.
// ParsedRecipe keeps the plain required field, so the AI JSON schema asks for it.
export const IngredientInput = IngredientValues.extend({ spice: z.boolean().default(false) });

export const NewRecipe = ParsedRecipe.extend({
  ingredients: z.array(IngredientInput).max(100),
  source_url: HttpsUrl.nullable(),
  source_platform: Platform.nullable(),
  // Only a handle from POST /api/import-link; the server moves it to the recipe on save.
  image_url: z
    .string()
    .regex(/^\/api\/images\/tmp\/[0-9a-f-]{36}$/)
    .nullish(),
});
export type NewRecipe = z.infer<typeof NewRecipe>;

const Row = z.object({ id: z.string(), position: z.number().int() });

export const Ingredient = IngredientValues.extend(Row.shape);
export type Ingredient = z.infer<typeof Ingredient>;

export const Step = StepValues.extend(Row.shape);
export type Step = z.infer<typeof Step>;

export const Adjustment = z.object({
  id: z.string(),
  target_type: z.enum(["ingredient", "step"]),
  target_id: z.string().nullable(),
  action: z.enum(["modify", "add", "remove"]),
  insert_after: z.string().nullable(),
  // Strict, so a step's values are not stripped to {} by the ingredient variant.
  new_values: z
    .union([z.strictObject(IngredientValues.shape).partial(), z.strictObject(StepValues.shape).partial()])
    .nullable(),
  // Who last wrote it; null for adjustments from before groups.
  author: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Adjustment = z.infer<typeof Adjustment>;

const targetId = z.string().min(1);
const hasKeys = (values: object) => Object.keys(values).length > 0;

// One variant per (target_type, action), so each combination validates its own value shape.
// `added` validates an add (may default fields), `values` is the plain shape whose partial a modify uses:
// a default inside .partial() would fill spice = false into a modify that never mentioned it.
const inputsFor = <T extends "ingredient" | "step", V extends z.ZodObject, A extends z.ZodObject>(targetType: T, values: V, added: A) => [
  z.object({
    target_type: z.literal(targetType),
    action: z.literal("add"),
    target_id: z.null(),
    insert_after: targetId.nullish(),
    new_values: added,
  }),
  z.object({
    target_type: z.literal(targetType),
    action: z.literal("modify"),
    target_id: targetId,
    insert_after: z.undefined().optional(), // only adds are positioned; z.undefined rejects instead of silently stripping
    new_values: values.partial().refine(hasKeys, "Mindestens ein Feld"),
  }),
  z.object({ target_type: z.literal(targetType), action: z.literal("remove"), target_id: targetId, insert_after: z.undefined().optional() }),
];

export const AdjustmentInput = z.union([
  ...inputsFor("ingredient", IngredientValues, IngredientInput),
  ...inputsFor("step", StepValues, StepValues),
]);
export type AdjustmentInput = z.infer<typeof AdjustmentInput>;

export const Recipe = z.object({
  id: z.string(),
  title: z.string(),
  source_url: z.string().nullable(),
  source_platform: Platform.nullable(),
  image_url: z.string().nullable(),
  servings: z.number().int(),
  total_minutes: z.number().int().nullable(),
  tags: z.array(z.string().max(30)).max(10),
  group_id: z.string().nullable(),
  created_at: z.string(),
});
export type Recipe = z.infer<typeof Recipe>;

export const RecipeSummary = Recipe.extend({
  adjustment_count: z.number().int(),
  ingredient_names: z.array(z.string()),
});
export type RecipeSummary = z.infer<typeof RecipeSummary>;

export const IngredientNote = z.object({
  target_id: z.string(),
  body: z.string(),
  author: z.string(),
  updated_at: z.string(),
});
export type IngredientNote = z.infer<typeof IngredientNote>;

export const RecipeFull = z.object({
  recipe: Recipe,
  ingredients: z.array(Ingredient),
  steps: z.array(Step),
  adjustments: z.array(Adjustment),
  note: z.string().max(5000),
  ingredient_notes: z.array(IngredientNote),
  // The caller's allergies on a personal recipe, every current member's on a group recipe. Never in share links.
  allergies: z.array(z.object({ user_id: z.string(), allergens: z.array(z.string()) })),
});
export type RecipeFull = z.infer<typeof RecipeFull>;

export const NoteBody = z.object({ text: z.string().max(5000) });

export const NoteText = z.object({ text: z.string().trim().max(500) });

// An ingredient's standard name and unit; target_id is an original ingredient id or an 'add' adjustment id.
export type Match = { target_id: string; canonical_name: string; unit: string };

export type PantryItem = { canonical_name: string; unit: string; amount: number | null; always_at_home: boolean; spice: boolean };

const PantryName = z.string().trim().min(1).max(100);
const PantryUnit = z.string().trim().max(30);
const PantryAmount = z.number().min(0).max(100000).nullable();

// Adding needs a positive amount; PATCH may set 0, which deletes the item.
export const PantryAdd = z.object({ name: PantryName, amount: PantryAmount.pipe(z.number().positive().nullable()), unit: PantryUnit, spice: z.boolean().default(false) });
export const PantryKey = z.object({ canonical_name: PantryName, unit: PantryUnit });
export const PantryEdit = PantryKey.extend({
  set: z.object({
    canonical_name: PantryName.optional(),
    unit: PantryUnit.optional(),
    amount: PantryAmount.optional(),
    always_at_home: z.boolean().optional(),
    spice: z.boolean().optional(),
  }),
});

export const ListRecipeAdd = z.object({ recipe_id: z.string().min(1).max(100), servings: z.number().int().min(1).max(100) });
export const ListTick = z.object({ key: z.string().min(1).max(200), ticked: z.boolean() });
// Amounts are what the user confirmed: never negative, because pantryStatements does not guard against it.
export const ListCheckout = z.object({
  lines: z.array(PantryKey.extend({ key: z.string().min(1).max(200), amount: PantryAmount })).min(1).max(200),
});
// What the user confirmed in the "Fertig gekocht" sheet; a null or 0 amount subtracts nothing.
export const ListCooked = z.object({ items: z.array(PantryKey.extend({ amount: PantryAmount })).max(100) });

export const GroupName = z.object({ name: z.string().trim().min(1).max(60) });
export const GroupInvite = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) });
// Trimmed and capped per item; duplicates are dropped on save.
export const AllergyList = z.object({ allergens: z.array(z.string().trim().min(1).max(40)).max(30) });
export const ShareToGroup = z.object({ group_id: z.string().min(1).max(100) });

export type ListBody = {
  lines: ShoppingLine[];
  ticked: string[];
  planned: { recipe_id: string; title: string; servings: number }[];
};
