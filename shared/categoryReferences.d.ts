export interface NamedCategory {
    id: string;
    name: string;
}
/** Read-only compatibility for document-ID and mobile category-name references. */
export declare function categoryReferenceMap(categories: readonly NamedCategory[]): Map<string, string>;
//# sourceMappingURL=categoryReferences.d.ts.map