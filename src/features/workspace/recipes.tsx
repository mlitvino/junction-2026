"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Recipe, CreateRecipeRequest, RecipeIngredient } from "@/shared/contracts/recipes";
import { CreateRecipeRequestSchema } from "@/shared/contracts/recipes";
import type { ProductSummary } from "@/shared/contracts/products";
import { recipeNeeds } from "@/client/workspace/service";
import { useWorkspace } from "@/client/use-workspace";
import { useAction } from "@/features/procurement/use-action";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  store,
  Page,
  Panel,
  EmptyState,
  ErrorMessage,
  EvidenceDisclosure,
  StatusBadge,
  inputClass,
  displayDate,
} from "./ui";
import { useLoad } from "./use-load";

export function Recipes() {
  const s = useWorkspace(),
    [query, setQuery] = useState("");
  const error = useLoad(() => store.loadRecipes(), "recipe-library");
  const results = s.recipes.filter((r) =>
    `${r.name} ${r.ingredients.map((i) => i.productName).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <Page
      title="Recipes"
      description="Trusted kitchen recipes, ready for your next service."
      wide
      action={
        <Link href="/recipes/new" className={buttonVariants()}>
          Create recipe
        </Link>
      }
    >
      <label className="block max-w-xl">
        <span className="sr-only">Search recipes</span>
        <input
          type="search"
          className={inputClass}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes or ingredients"
        />
      </label>
      <ErrorMessage error={error} />
      <div className="grid gap-5 md:grid-cols-2">
        {results.map((recipe) => (
          <Panel key={recipe.id}>
            <h2 className="section-title">{recipe.name}</h2>
            <p className="mt-3 text-caption text-muted-foreground">
              Base: {recipe.baseServings} portions
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              {recipe.ingredients
                .map((i) => i.productName)
                .slice(0, 5)
                .join(", ")}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={`/recipes/${recipe.id}`}
                className={buttonVariants({ variant: "outline" })}
              >
                Open recipe
              </Link>
              <Link
                href={`/recipes/${recipe.id}/plan`}
                className={buttonVariants({ variant: "ghost" })}
              >
                Plan a batch
              </Link>
            </div>
          </Panel>
        ))}
      </div>
      {!results.length && !error && (
        <EmptyState title="No recipes found">
          Try another ingredient or create a kitchen recipe.
        </EmptyState>
      )}
    </Page>
  );
}
export function RecipeIngredientRow({ ingredient }: { ingredient: RecipeIngredient }) {
  return (
    <div className="flex flex-wrap justify-between gap-3 border-b py-4">
      <div>
        <h3 className="text-sm font-medium">{ingredient.productName}</h3>
        {ingredient.notes && (
          <p className="mt-1 text-caption text-muted-foreground">{ingredient.notes}</p>
        )}
      </div>
      <span className="tabular-nums">
        {ingredient.quantity} {ingredient.unit}
      </span>
    </div>
  );
}
function RecipeEditor({ recipe }: { recipe?: Recipe }) {
  const s = useWorkspace(),
    action = useAction(),
    router = useRouter();
  const [draft, setDraft] = useState<CreateRecipeRequest>(() => {
    const stored = recipe ? s.local.drafts[`recipe:${recipe.id}`] : undefined;
    if (stored) {
      try {
        const parsed = CreateRecipeRequestSchema.safeParse(JSON.parse(stored));
        if (parsed.success) return parsed.data;
      } catch {
        /* Use the source recipe instead. */
      }
    }
    return recipe
      ? {
          name: recipe.name,
          description: recipe.description ?? "",
          baseServings: recipe.baseServings,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions ?? "",
          tags: recipe.tags,
        }
      : {
          name: "",
          baseServings: 100,
          ingredients: [{ productName: "", productType: "Ingredient", quantity: 1, unit: "KG" }],
          tags: [],
          instructions: "",
        };
  });
  const [notice, setNotice] = useState("");
  function updateIngredient(index: number, patch: Partial<RecipeIngredient>) {
    setDraft((d) => ({
      ...d,
      ingredients: d.ingredients.map((i, n) => (n === index ? { ...i, ...patch } : i)),
    }));
  }
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          const body = CreateRecipeRequestSchema.parse(draft);
          if (recipe) {
            store.draft(`recipe:${recipe.id}`, JSON.stringify(body));
            setNotice("Draft saved in this browser. The source recipe has not been changed.");
          } else {
            const created = await store.createRecipe(body);
            router.push(`/recipes/${created.id}`);
          }
        });
      }}
    >
      <ErrorMessage error={action.error} />
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-label">
            Recipe name
            <input
              required
              maxLength={160}
              className={`${inputClass} mt-2`}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </label>
          <label className="text-label">
            Base portions
            <input
              required
              type="number"
              min="1"
              className={`${inputClass} mt-2`}
              value={draft.baseServings}
              onChange={(e) => setDraft((d) => ({ ...d, baseServings: Number(e.target.value) }))}
            />
          </label>
        </div>
        <label className="mt-4 block text-label">
          Description
          <textarea
            maxLength={500}
            className={`${inputClass} mt-2 min-h-20`}
            value={draft.description ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </label>
      </Panel>
      <Panel>
        <h2 className="section-title">Ingredients</h2>
        <div className="mt-5 space-y-5">
          {draft.ingredients.map((ingredient, index) => (
            <div
              className="grid items-end gap-3 border-b pb-5 sm:grid-cols-[1fr_100px_100px_auto]"
              key={index}
            >
              <label className="text-label">
                Ingredient {index + 1}
                <input
                  required
                  className={`${inputClass} mt-2`}
                  value={ingredient.productName}
                  onChange={(e) =>
                    updateIngredient(index, {
                      productName: e.target.value,
                      productType: e.target.value || "Ingredient",
                    })
                  }
                />
              </label>
              <label className="text-label">
                Quantity
                <input
                  required
                  type="number"
                  min="0.001"
                  step="any"
                  className={`${inputClass} mt-2`}
                  value={ingredient.quantity}
                  onChange={(e) => updateIngredient(index, { quantity: Number(e.target.value) })}
                />
              </label>
              <label className="text-label">
                Unit
                <select
                  aria-label={`Ingredient ${index + 1} unit`}
                  className={`${inputClass} mt-2`}
                  value={ingredient.unit}
                  onChange={(e) => updateIngredient(index, { unit: e.target.value })}
                >
                  {["KG", "G", "L", "ML", "ST"].map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              </label>
              <Button
                variant="ghost"
                disabled={draft.ingredients.length === 1}
                aria-label={`Remove ingredient ${index + 1}`}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    ingredients: d.ingredients.filter((_, n) => n !== index),
                  }))
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          className="mt-4"
          disabled={draft.ingredients.length >= 50}
          onClick={() =>
            setDraft((d) => ({
              ...d,
              ingredients: [
                ...d.ingredients,
                { productName: "", productType: "Ingredient", quantity: 1, unit: "KG" },
              ],
            }))
          }
        >
          Add ingredient
        </Button>
      </Panel>
      <Panel>
        <label className="text-label">
          Preparation instructions
          <textarea
            className={`${inputClass} mt-2 min-h-32`}
            maxLength={4000}
            value={draft.instructions ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, instructions: e.target.value }))}
          />
        </label>
      </Panel>
      {recipe && (
        <p className="text-sm text-muted-foreground">
          Updating an existing source recipe is not connected. Save a local draft, or explicitly
          create a separate recipe version.
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-secondary p-4 text-sm">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={action.busy}>
          {recipe ? "Save draft locally" : "Create recipe"}
        </Button>
        {recipe && (
          <Button
            variant="outline"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const created = await store.createRecipe(
                  CreateRecipeRequestSchema.parse({
                    ...draft,
                    name: `${draft.name} — new version`,
                  }),
                );
                router.push(`/recipes/${created.id}`);
              })
            }
          >
            Create separate recipe version
          </Button>
        )}
        <Link
          href={recipe ? `/recipes/${recipe.id}` : "/recipes"}
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
export function RecipePage({ id, create = false }: { id?: string; create?: boolean }) {
  const s = useWorkspace(),
    [edit, setEdit] = useState(false);
  const error = useLoad(
    () => (id ? store.loadRecipe(id) : Promise.resolve()),
    `recipe:${id ?? "new"}`,
  );
  const recipe = s.recipes.find((r) => r.id === id);
  if (create)
    return (
      <Page
        title="Create recipe"
        description="Save a recipe with clear portions and ingredient units."
      >
        <RecipeEditor />
      </Page>
    );
  return (
    <Page
      title={recipe?.name ?? "Recipe"}
      description={
        recipe
          ? `Base yield: ${recipe.baseServings} portions · Updated ${displayDate(recipe.updatedAt)}`
          : undefined
      }
      action={
        recipe &&
        !edit && (
          <Link href={`/recipes/${id}/plan`} className={buttonVariants()}>
            Plan a batch
          </Link>
        )
      }
    >
      <ErrorMessage error={error} />
      {recipe &&
        (edit ? (
          <RecipeEditor key={recipe.id} recipe={recipe} />
        ) : (
          <>
            <p className="text-large-body text-muted-foreground">{recipe.description}</p>
            <Panel>
              <div className="flex flex-wrap justify-between gap-3">
                <h2 className="section-title">Ingredients for {recipe.baseServings} portions</h2>
                <Button variant="outline" onClick={() => setEdit(true)}>
                  Edit recipe
                </Button>
              </div>
              <div className="mt-4">
                {recipe.ingredients.map((ingredient, index) => (
                  <RecipeIngredientRow ingredient={ingredient} key={index} />
                ))}
              </div>
            </Panel>
            {recipe.instructions && (
              <section>
                <h2 className="section-title">Preparation</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                  {recipe.instructions}
                </p>
              </section>
            )}
            <EvidenceDisclosure title="Dietary notes, substitutes & version details">
              <p>
                Recipe tags: {recipe.tags.join(", ") || "Not supplied"}. Ingredient allergen safety
                must be checked independently; a recipe tag does not verify a supplier product.
              </p>
              <p>
                Recipe source:{" "}
                {recipe.source === "customer" ? "Organization kitchen recipe" : "Recipe library"} ·{" "}
                {recipe.id}
              </p>
              <p>
                Catalog mappings are reviewed during batch planning. Unknown substitutions are never
                accepted automatically.
              </p>
            </EvidenceDisclosure>
          </>
        ))}
    </Page>
  );
}

export function MealPlan({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const s = useWorkspace(),
    action = useAction(),
    router = useRouter();
  const [portions, setPortions] = useState(1000),
    [date, setDate] = useState("2026-11-20"),
    [requirement, setRequirement] = useState(searchParams.get("requirement") ?? "");
  const [question, setQuestion] = useState("");
  const [candidates, setCandidates] = useState<Record<number, ProductSummary[]>>({}),
    [mapping, setMapping] = useState<
      Record<number, { id: string; sales: number | null; unit: string; issue?: string }>
    >({}),
    [finding, setFinding] = useState<number | null>(null);
  const error = useLoad(
      () => Promise.all([store.loadRecipe(id), store.loadInventory()]),
      `batch:${id}`,
    ),
    recipe = s.recipes.find((r) => r.id === id);
  const rows = recipe && portions > 0 ? recipeNeeds(recipe, portions, s.inventory) : [];
  const purchasable = rows.filter(
    (row, index) =>
      row.shortage > 0 &&
      mapping[index]?.sales !== null &&
      mapping[index]?.sales !== undefined &&
      !mapping[index]?.issue,
  );
  const attention = rows.filter(
    (row, index) =>
      row.shortage > 0 &&
      (mapping[index]?.sales === null || !mapping[index] || !!mapping[index]?.issue),
  );
  const inStock = rows.filter((row) => row.shortage === 0);
  const group = (index: number) =>
    rows[index]!.shortage === 0 ? 2 : mapping[index]?.sales && !mapping[index]?.issue ? 0 : 1;
  const grouped = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => group(a.index) - group(b.index));
  const groupTitles = ["Need to purchase", "Needs attention", "In kitchen stock"];
  async function choose(index: number, product: ProductSummary) {
    const row = rows[index];
    if (!row) return;
    const sales = await store.toSales(product.id, row.shortage, row.ingredient.unit);
    const offers = await store.quote([product.id], date);
    const offer = offers.offers[0];
    const availability = offer?.availability;
    const issue =
      sales === null
        ? "Physical quantity conversion needs confirmation."
        : !offer?.price?.found ||
            !availability?.orderable ||
            availability.availableQuantity === null
          ? "Price or supplier availability is not confirmed."
          : availability.availableQuantity < sales ||
              (availability.availableDate?.slice(0, 10) ?? "9999") > date
            ? "Available quantity or delivery date does not cover this ingredient."
            : undefined;
    setMapping((current) => ({
      ...current,
      [index]: { id: product.id, sales, unit: product.salesUnit, issue },
    }));
  }
  return (
    <Page
      title="Plan a batch"
      description={recipe?.name}
      action={
        <Link href={`/recipes/${id}`} className={buttonVariants({ variant: "ghost" })}>
          Back to recipe
        </Link>
      }
    >
      <ErrorMessage error={error || action.error} />
      {recipe && (
        <>
          <Panel>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="text-label">
                Portions
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={portions}
                  className={`${inputClass} mt-2`}
                  onChange={(e) => {
                    setPortions(Number(e.target.value));
                    setMapping({});
                  }}
                />
              </label>
              <label className="text-label">
                Needed by
                <input
                  required
                  type="date"
                  className={`${inputClass} mt-2`}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setMapping({});
                  }}
                />
              </label>
              <label className="text-label">
                Mandatory dietary requirement
                <select
                  aria-label="Mandatory dietary requirement"
                  disabled={!!searchParams.get("requirement")}
                  value={requirement}
                  className={`${inputClass} mt-2`}
                  onChange={(e) => setRequirement(e.target.value)}
                >
                  <option value="">No additional requirement</option>
                  <option value="gluten-free">Gluten-free</option>
                  <option value="milk-protein-free">Milk-protein-free</option>
                </select>
              </label>
            </div>
            <p className="mt-5 text-sm">
              {purchasable.length} need to purchase · {attention.length} need attention ·{" "}
              {inStock.length} in kitchen stock
            </p>
            <p className="mt-2 text-caption text-muted-foreground">
              {portions / recipe.baseServings}× base yield · stock is a snapshot, not reserved
              inventory.
            </p>
          </Panel>
          {requirement && (
            <Panel>
              <StatusBadge status="BLOCKED" label="Safety requirement needs verification" />
              <p className="mt-3 text-sm">
                Verified {requirement} evidence is required for every purchased ingredient. This
                batch cannot proceed while that evidence is unavailable.
              </p>
            </Panel>
          )}
          <section className="space-y-4">
            <h2 className="section-title">
              Ingredients for {portions.toLocaleString("en-GB")} portions
            </h2>
            {grouped.map(({ row, index }, position) => (
              <Fragment key={`${row.ingredient.productName}:${index}`}>
                {(position === 0 || group(grouped[position - 1]!.index) !== group(index)) && (
                  <h3 className="pt-4 text-base font-semibold">{groupTitles[group(index)]}</h3>
                )}
                <Panel key={`${row.ingredient.productName}:${index}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{row.ingredient.productName}</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Need {Number(row.needed.toFixed(3))} {row.ingredient.unit} · Kitchen stock{" "}
                        {row.stock} {row.ingredient.unit}
                      </p>
                    </div>
                    <StatusBadge
                      status={
                        row.shortage === 0
                          ? "APPROVED"
                          : mapping[index]?.sales && !mapping[index]?.issue
                            ? "READY"
                            : "PENDING"
                      }
                      label={
                        row.shortage === 0
                          ? "In kitchen stock"
                          : mapping[index]?.sales && !mapping[index]?.issue
                            ? "Ready for purchase review"
                            : "Needs attention"
                      }
                    />
                  </div>
                  {row.shortage > 0 && (
                    <>
                      <p className="mt-3 text-sm">
                        Need to purchase: {Number(row.shortage.toFixed(3))} {row.ingredient.unit}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Button
                          variant="outline"
                          disabled={action.busy}
                          onClick={() =>
                            void action.run(async () => {
                              const result = await store.searchProducts(row.ingredient.productName);
                              setCandidates((c) => ({ ...c, [index]: result.items }));
                              setFinding(index);
                            })
                          }
                        >
                          Find ingredient products
                        </Button>
                        {mapping[index] && (
                          <Button
                            variant="ghost"
                            disabled={action.busy}
                            onClick={() =>
                              void action.run(async () => {
                                if (mapping[index]!.sales === null)
                                  throw new Error(
                                    "Confirm the sales-unit conversion before requesting substitutes.",
                                  );
                                const substitutes = await store.api.substitutions({
                                  productId: mapping[index]!.id,
                                  requestedQuantity: mapping[index]!.sales!,
                                  deliveryDate: date,
                                });
                                if (!substitutes.rankedSubstitutes.length)
                                  throw new Error(
                                    "No verified substitute was found. Keep this ingredient under review.",
                                  );
                                const products = await Promise.all(
                                  substitutes.rankedSubstitutes.map((r) =>
                                    store.loadProduct(r.candidate.id),
                                  ),
                                );
                                setCandidates((c) => ({ ...c, [index]: products }));
                                setFinding(index);
                              })
                            }
                          >
                            Review substitute options
                          </Button>
                        )}
                      </div>
                      {finding === index && (
                        <div className="mt-4 space-y-2">
                          {candidates[index]?.length ? (
                            candidates[index]!.map((p) => (
                              <button
                                key={p.id}
                                className="block min-h-11 w-full rounded-md border p-3 text-left text-sm hover:bg-accent"
                                onClick={() => void action.run(() => choose(index, p))}
                              >
                                {p.name} · {p.salesUnit}
                              </button>
                            ))
                          ) : (
                            <p className="text-sm text-warning">
                              No matching product found. Try the catalog manually; no safe
                              substitute has been selected.
                            </p>
                          )}
                        </div>
                      )}
                      {mapping[index] && (
                        <p className="mt-4 text-sm">
                          {mapping[index]!.issue
                            ? `${mapping[index]!.issue} Excluded from the purchase.`
                            : mapping[index]!.sales === null
                              ? `Conversion to ${mapping[index]!.unit} needs confirmation; excluded from purchase.`
                              : `${mapping[index]!.sales} ${mapping[index]!.unit} selected for the proposal.`}
                        </p>
                      )}
                      <EvidenceDisclosure title="Expand ingredient & pack math">
                        <p>
                          {row.ingredient.quantity} {row.ingredient.unit} ×{" "}
                          {portions / recipe.baseServings} = {row.needed} {row.ingredient.unit};
                          less {row.stock} {row.ingredient.unit} compatible stock.
                        </p>
                        <p>
                          Only catalog sales units or published base-unit weight conversions are
                          used. A product name is not evidence of physical package size. Unknown
                          conversions remain excluded.
                        </p>
                      </EvidenceDisclosure>
                    </>
                  )}
                </Panel>
              </Fragment>
            ))}
          </section>
          <div className="sticky bottom-20 z-10 rounded-lg border bg-background p-4 lg:bottom-4">
            <Button
              className="w-full sm:w-auto"
              disabled={
                action.busy ||
                !purchasable.length ||
                attention.length > 0 ||
                !!requirement ||
                portions <= 0 ||
                !date
              }
              onClick={() =>
                void action.run(async () => {
                  const lines = rows.flatMap((row, index) =>
                    row.shortage > 0 && mapping[index]?.sales && !mapping[index]?.issue
                      ? [{ productId: mapping[index]!.id, quantity: mapping[index]!.sales! }]
                      : [],
                  );
                  const result = await store.createPurchase(
                    { lines, date, note: `${recipe.name}, ${portions} portions` },
                    undefined,
                    "Recipes",
                  );
                  router.push(`/buyer/conversations/${result.threadId}`);
                })
              }
            >
              Review purchase proposal
            </Button>
            {attention.length > 0 && (
              <p className="mt-2 text-caption text-warning">
                Resolve all ingredients needing attention before preparing the full batch purchase.
              </p>
            )}
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void action.run(async () => {
                  const amount = question.match(
                    /(?:make|change|to)?\s*([\d,]+)\s*(?:portions|servings)/i,
                  );
                  if (amount) {
                    const count = Number(amount[1]!.replace(/,/g, ""));
                    if (count <= 0) throw new Error("Use a positive portion count.");
                    setPortions(count);
                    setMapping({});
                    setQuestion("");
                  } else {
                    const thread = await store.discussRecipe(id, portions, question);
                    router.push(`/buyer/conversations/${thread}`);
                  }
                });
              }}
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Adjust portions or ask assistant</span>
                <input
                  className={inputClass}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Adjust portions or ask assistant…"
                />
              </label>
              <Button type="submit" disabled={!question.trim() || action.busy}>
                Send
              </Button>
            </form>
          </div>
        </>
      )}
    </Page>
  );
}
