import type { Firestore } from 'firebase-admin/firestore';
export declare function stockBalanceAfter(stock: number, quantity: number, direction: 'in' | 'out'): number;
export declare function saveStockAdjustment(db: Firestore, outletId: string, profileId: string | null, assigned: (profile: Record<string, unknown>) => string[], raw: unknown): Promise<{
    documentId: string;
    alreadySaved: boolean;
}>;
//# sourceMappingURL=stockAdjustment.d.ts.map