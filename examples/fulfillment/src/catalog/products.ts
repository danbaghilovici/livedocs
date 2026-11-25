/**
 * @livedocs:file Lists the products and unit weights used by the sample checkout.
 *
 * Add products here to make them available to the [checkout workflow](../integrations/checkout.ts#checkout).
 * Stock levels are supplied separately to the warehouse ledger.
 *
 * @livedocs:tag catalog
 * @livedocs:zone Catalog
 */
import type { Sku } from '../contracts.js';

/** Catalog data needed to turn a cart item into an order line. */
export interface Product {
  readonly sku: Sku;
  readonly name: string;
  readonly unitWeightGrams: number;
}

const products = new Map<Sku, Product>([
  ['MUG-01', Object.freeze({ sku: 'MUG-01', name: 'Stoneware mug', unitWeightGrams: 450 })],
  ['TEA-02', Object.freeze({ sku: 'TEA-02', name: 'Breakfast tea', unitWeightGrams: 350 })],
  ['TIN-03', Object.freeze({ sku: 'TIN-03', name: 'Tea tin', unitWeightGrams: 225 })],
]);

/**
 * Looks up a product by its exact SKU.
 * @param sku Identifier from a cart line.
 * @returns The catalog product when the SKU is known.
 * @livedocs:docId fulfillment.product
 */
export function findProduct(sku: Sku): Product | undefined {
  return products.get(sku);
}
