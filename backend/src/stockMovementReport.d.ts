export interface ProductRate {
    price: number;
    cost: number;
}
export declare function stockDirection(data: Record<string, unknown>): 'in' | 'out' | null;
export declare function stockMovementRecord(documentId: string, data: Record<string, unknown>, rates?: ReadonlyMap<string, ProductRate>): {
    transactionNo: string;
    items: {
        price: number;
        cost: number;
        total: number;
        productId: string;
        name: string;
        quantity: number;
        remark: string;
    }[];
    remark: string;
    quantity: number;
    total: number;
    finalTotal: number;
    direction: "in" | "out" | null;
    documentId: string;
    dayId: string;
    createdDate: number;
    type: string;
    supplier: string;
    source: string;
    state: string;
    roundOff: number;
};
export declare function unpricedProductIds(data: Record<string, unknown>): string[];
export declare function productRate(data: Record<string, unknown> | undefined): ProductRate;
//# sourceMappingURL=stockMovementReport.d.ts.map