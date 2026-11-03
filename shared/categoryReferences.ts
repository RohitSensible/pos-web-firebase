export interface NamedCategory { id: string; name: string }

/** Read-only compatibility for document-ID and mobile category-name references. */
export function categoryReferenceMap(categories: readonly NamedCategory[]): Map<string, string> {
  const ids = new Set(categories.map(category => category.id));
  const names = new Map<string, string | null>();
  for (const category of categories) {
    const name = category.name.trim();
    if (!name) continue;
    for (const alias of new Set([category.name, name, name.toLowerCase(), name.toUpperCase()])) {
      const previous = names.get(alias);
      names.set(alias, previous === undefined || previous === category.id ? category.id : null);
    }
  }
  // A document ID always wins over another category's similarly named alias.
  const references = new Map(categories.map(category => [category.id, category.id]));
  for (const [name, id] of names) if (id !== null && !ids.has(name)) references.set(name, id);
  return references;
}
