import { z } from "zod";

const Platform = z.enum(["instagram", "youtube", "web"]);

export const IngredientValues = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().min(0).max(100_000).nullable(),
  unit: z.string().max(30),
});
export type IngredientValues = z.infer<typeof IngredientValues>;

export const StepValues = z.object({
  text: z.string().min(1).max(2000),
  duration_minutes: z.number().int().min(1).max(1440).nullable(),
});
export type StepValues = z.infer<typeof StepValues>;

// Plain object schema (no transforms/refinements) so z.toJSONSchema can export it for the AI call.
export const ParsedRecipe = z.object({
  title: z.string().min(1).max(200),
  servings: z.number().int().min(1).max(100),
  total_minutes: z.number().int().min(1).max(2880).nullable(),
  ingredients: z.array(IngredientValues).max(100),
  steps: z.array(StepValues).min(1).max(100),
});
export type ParsedRecipe = z.infer<typeof ParsedRecipe>;

const HttpsUrl = z
  .url()
  .max(2000)
  .refine((value) => URL.canParse(value) && new URL(value).protocol === "https:", "Nur https-Links");

export const NewRecipe = ParsedRecipe.extend({
  source_url: HttpsUrl.nullable(),
  source_platform: Platform.nullable(),
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
  // Strict, so a step's values are not stripped to {} by the ingredient variant.
  new_values: z
    .union([z.strictObject(IngredientValues.shape).partial(), z.strictObject(StepValues.shape).partial()])
    .nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Adjustment = z.infer<typeof Adjustment>;

const targetId = z.string().min(1);
const hasKeys = (values: object) => Object.keys(values).length > 0;

// One variant per (target_type, action), so each combination validates its own value shape.
const inputsFor = <T extends "ingredient" | "step", V extends z.ZodObject>(targetType: T, values: V) => [
  z.object({ target_type: z.literal(targetType), action: z.literal("add"), target_id: z.null(), new_values: values }),
  z.object({
    target_type: z.literal(targetType),
    action: z.literal("modify"),
    target_id: targetId,
    new_values: values.partial().refine(hasKeys, "Mindestens ein Feld"),
  }),
  z.object({ target_type: z.literal(targetType), action: z.literal("remove"), target_id: targetId }),
];

export const AdjustmentInput = z.union([
  ...inputsFor("ingredient", IngredientValues),
  ...inputsFor("step", StepValues),
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
  created_at: z.string(),
});
export type Recipe = z.infer<typeof Recipe>;

export const RecipeSummary = Recipe.extend({
  adjustment_count: z.number().int(),
  ingredient_names: z.array(z.string()),
});
export type RecipeSummary = z.infer<typeof RecipeSummary>;

export const RecipeFull = z.object({
  recipe: Recipe,
  ingredients: z.array(Ingredient),
  steps: z.array(Step),
  adjustments: z.array(Adjustment),
  note: z.string().max(5000),
});
export type RecipeFull = z.infer<typeof RecipeFull>;
