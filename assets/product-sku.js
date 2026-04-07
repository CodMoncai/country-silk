import { Component } from '@theme/component';
import { ThemeEvents, VariantUpdateEvent } from '@theme/events';

/** Collection path segments where each SKU line shows that card’s `data-product-id`. */
const PRODUCT_ID_AS_SKU_COLLECTION_HANDLES = ['shatter-proof-balls'];

/**
 * @param {string} [pathname]
 */
function pathnameMatchesProductIdSkuCollection(pathname = window.location.pathname) {
  try {
    for (const handle of PRODUCT_ID_AS_SKU_COLLECTION_HANDLES) {
      if (pathname.includes(`/collections/${handle}`)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Run after DOM changes so every upgraded instance picks up its own `data-product-id`.
 */
function syncAllProductSkuComponentsForCollectionProductIds() {
  if (!pathnameMatchesProductIdSkuCollection()) return;

  for (const el of document.querySelectorAll('product-sku-component')) {
    if (el instanceof ProductSkuComponent) {
      el.syncProductIdDisplayForCollectionContext();
    }
  }
}

/**
 * A custom element that displays a product SKU.
 * This component listens for variant update events and updates the SKU display accordingly.
 * It handles SKU updates from two different sources:
 * 1. Variant picker (in quick add modal or product page)
 * 2. Swatches variant picker (in product cards)
 *
 * @typedef {Object} Refs
 * @property {HTMLElement} skuContainer - The container element for the SKU
 * @property {HTMLElement} sku - The span element that displays the SKU text
 *
 * @extends {Component<Refs>}
 */
class ProductSkuComponent extends Component {
  requiredRefs = ['skuContainer', 'sku'];

  #applyProductIdAsSkuDisplay() {
    const id = this.dataset.productId;
    if (id) {
      this.style.display = 'block';
      this.refs.sku.textContent = id;
    } else {
      this.style.display = 'none';
      this.refs.sku.textContent = '';
    }
  }

  /**
   * For configured collection URLs: show this instance’s `data-product-id` in `span.sku`
   * (each card has its own component + id).
   */
  syncProductIdDisplayForCollectionContext() {
    if (!pathnameMatchesProductIdSkuCollection()) return;
    this.#applyProductIdAsSkuDisplay();
  }

  connectedCallback() {
    super.connectedCallback();

    const target = this.closest('[id*="ProductInformation-"], [id*="QuickAdd-"], product-card');
    if (target) {
      target.addEventListener(ThemeEvents.variantUpdate, this.updateSku);
    }

    this.syncProductIdDisplayForCollectionContext();
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

    if (pathnameMatchesProductIdSkuCollection()) {
      this.#applyProductIdAsSkuDisplay();
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

if (pathnameMatchesProductIdSkuCollection()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncAllProductSkuComponentsForCollectionProductIds, {
      once: true,
    });
  } else {
    syncAllProductSkuComponentsForCollectionProductIds();
  }

  queueMicrotask(syncAllProductSkuComponentsForCollectionProductIds);
}
