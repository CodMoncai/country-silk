import { Component } from '@theme/component';
import { ThemeEvents, VariantUpdateEvent } from '@theme/events';

/**
 * Returns variant SKUs sorted ascending (numeric-aware for strings like 02671728BSW).
 *
 * @param {unknown[]} rawSkus
 * @returns {string[]}
 */
export function sortVariantSkusAscending(rawSkus) {
  const skus = [...new Set(rawSkus.map((s) => String(s).trim()).filter(Boolean))];
  return skus.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );
}

/**
 * A custom element that displays a product SKU.
 * This component listens for variant update events and updates the SKU display accordingly.
 * It handles SKU updates from two different sources:
 * 1. Variant picker (in quick add modal or product page)
 * 2. Swatches variant picker (in product cards)
 *
 * On collection (non-product) templates, optional data attributes apply the lowest sorted SKU
 * per product on first paint; variant updates still replace the label with the active variant.
 *
 * @typedef {Object} Refs
 * @property {HTMLElement} skuContainer - The container element for the SKU
 * @property {HTMLElement} sku - The span element that displays the SKU text
 *
 * @extends {Component<Refs>}
 */
class ProductSkuComponent extends Component {
  requiredRefs = ['skuContainer', 'sku'];

  connectedCallback() {
    super.connectedCallback();
    this.#applyLowestVariantSkuOnCard();
    const target = this.closest('[id*="ProductInformation-"], [id*="QuickAdd-"], product-card');
    if (!target) return;
    target.addEventListener(ThemeEvents.variantUpdate, this.updateSku);
  }

  /** On cards, show the first SKU after numeric-aware sort when `data-apply-lowest-variant-sku` is set. */
  #applyLowestVariantSkuOnCard() {
    if (this.dataset.applyLowestVariantSku !== 'true') return;
    const raw = this.dataset.variantSkus;
    if (!raw) return;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return;

    const sorted = sortVariantSkusAscending(parsed);
    const first = sorted[0];
    if (!first || !this.refs.sku) return;

    this.refs.sku.textContent = first;
    this.style.display = 'block';
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    const target = this.closest('[id*="ProductInformation-"], [id*="QuickAdd-"], product-card');
    if (!target) return;
    target.removeEventListener(ThemeEvents.variantUpdate, this.updateSku);
  }

  /**
   * Updates the SKU.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  updateSku = (event) => {
    if (event.detail.data.newProduct) {
      this.dataset.productId = event.detail.data.newProduct.id;
    }

    if (event.target instanceof HTMLElement && event.target.dataset.productId !== this.dataset.productId) {
      return;
    }

    // Use the variant data from the event
    // The variant is in event.detail.resource
    if (event.detail.resource) {
      const variantSku = event.detail.resource.sku || '';

      if (variantSku) {
        // Show the component and update the SKU
        this.style.display = 'block';
        this.refs.sku.textContent = variantSku;
      } else {
        // Hide the entire component when SKU is empty
        this.style.display = 'none';
        this.refs.sku.textContent = '';
      }
    }
  };
}

if (!customElements.get('product-sku-component')) {
  customElements.define('product-sku-component', ProductSkuComponent);
}
