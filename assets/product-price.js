import { ThemeEvents, VariantUpdateEvent } from '@theme/events';

/**
 * A custom element that displays a product price.
 * This component listens for variant update events and updates the price display accordingly.
 * It handles price updates from two different sources:
 * 1. Variant picker (in quick add modal or product page)
 * 2. Swatches variant picker (in product cards)
 * When a total column is present, it also listens for quantity changes and updates the total.
 */
class ProductPrice extends HTMLElement {
  #abortController = new AbortController();

  /** @type {Record<string, number> | null} */
  #variantUnitCentsMap = null;

  /**
   * @param {ParentNode | null} root
   * @returns {Record<string, number> | null}
   */
  #parseVariantUnitCentsMap(root) {
    if (!root) return null;
    const el = root.querySelector('script[data-variant-unit-cents-map]');
    if (!el?.textContent) return null;
    try {
      const parsed = JSON.parse(el.textContent.trim());
      if (parsed && typeof parsed === 'object') {
        return /** @type {Record<string, number>} */ (parsed);
      }
    } catch {
      // no-op
    }
    return null;
  }

  /** @returns {number} */
  #displayUnitCents() {
    const map = this.#variantUnitCentsMap;
    const id = this.dataset.activeVariantId ?? this.dataset.initialVariantId;
    if (map && id != null && Object.prototype.hasOwnProperty.call(map, id)) {
      const cents = map[id];
      if (typeof cents === 'number' && !Number.isNaN(cents)) {
        return cents;
      }
    }
    return parseInt(this.dataset.variantPrice, 10);
  }

  #ensurePriceContainer() {
    let priceContainer = this.querySelector('[ref="priceContainer"]');
    if (!priceContainer) {
      priceContainer = document.createElement('div');
      priceContainer.setAttribute('ref', 'priceContainer');
      const scriptMap = this.querySelector('script[data-variant-unit-cents-map]');
      if (scriptMap?.parentNode) {
        scriptMap.insertAdjacentElement('afterend', priceContainer);
      } else {
        this.appendChild(priceContainer);
      }
    }

    let priceElement = priceContainer.querySelector('.price');
    if (!priceElement) {
      priceElement = document.createElement('span');
      priceElement.className = 'price';
      priceContainer.appendChild(priceElement);
    }

    const priceCents = this.#displayUnitCents();
    if (!Number.isNaN(priceCents)) {
      priceElement.textContent = this.#formatMoney(priceCents);
    }
  }

  /**
   * Builds the full Price / Total two-column row client-side.
   * Used when the server-rendered HTML omitted it (e.g. CDN cached page rendered
   * before ?show_pricing was added to the URL).
   */
  #ensureShowPricingRow() {
    if (this.querySelector('.product-price__row')) return;

    const priceCents = this.#displayUnitCents();
    if (Number.isNaN(priceCents)) return;

    const priceText = this.#formatMoney(priceCents);
    const labelStyle = 'display:block;font-size:var(--font-size--xs,0.75rem);color:rgb(var(--color-foreground-rgb,0 0 0)/var(--opacity-subdued-text,0.7));';
    const colBase = 'display:flex;flex-direction:column;gap:var(--gap-2xs,0.25rem);min-width:0;';

    const row = document.createElement('div');
    row.className = 'product-price__row';
    row.style.cssText = 'display:flex;flex-direction:row;justify-content:space-between;align-items:flex-start;gap:var(--gap-md,0.75rem);width:100%;';

    // Price column — reuse the existing priceContainer if present
    const priceCol = document.createElement('div');
    priceCol.className = 'product-price__column product-price__column--price';
    priceCol.style.cssText = colBase + 'flex:1 1 auto;';
    const priceLabel = document.createElement('span');
    priceLabel.className = 'product-price__label';
    priceLabel.style.cssText = labelStyle;
    priceLabel.textContent = 'Price';
    const priceCell = document.createElement('div');
    priceCell.className = 'product-price__price-cell';
    priceCell.style.minHeight = '1.5em';
    const existingContainer = this.querySelector('[ref="priceContainer"]');
    if (existingContainer) {
      priceCell.appendChild(existingContainer);
    } else {
      const pc = document.createElement('div');
      pc.setAttribute('ref', 'priceContainer');
      const ps = document.createElement('span');
      ps.className = 'price';
      ps.textContent = priceText;
      pc.appendChild(ps);
      priceCell.appendChild(pc);
    }
    priceCol.appendChild(priceLabel);
    priceCol.appendChild(priceCell);

    // Total column
    const totalCol = document.createElement('div');
    totalCol.className = 'product-price__column product-price__column--total';
    totalCol.style.cssText = colBase + 'flex:0 0 auto;text-align:end;';
    const totalLabel = document.createElement('span');
    totalLabel.className = 'product-price__label';
    totalLabel.style.cssText = labelStyle;
    totalLabel.textContent = 'Total';
    const totalCell = document.createElement('div');
    totalCell.className = 'product-price__total-cell';
    totalCell.style.minHeight = '1.5em';
    const totalSpan = document.createElement('span');
    totalSpan.className = 'price';
    totalSpan.setAttribute('ref', 'totalPrice');
    totalSpan.textContent = priceText;
    totalCell.appendChild(totalSpan);
    totalCol.appendChild(totalLabel);
    totalCol.appendChild(totalCell);

    row.appendChild(priceCol);
    row.appendChild(totalCol);
    this.appendChild(row);
  }

  connectedCallback() {
    const closestSection = this.closest('.shopify-section, dialog');
    if (!closestSection) return;

    this.#variantUnitCentsMap = this.#parseVariantUnitCentsMap(this);
    if (this.dataset.initialVariantId) {
      this.dataset.activeVariantId = this.dataset.initialVariantId;
    }
    const initialCents = this.#displayUnitCents();
    if (!Number.isNaN(initialCents)) {
      this.dataset.variantPrice = String(initialCents);
    }
    this.#ensurePriceContainer();

    if (new URLSearchParams(window.location.search).has('show_pricing')) {
      this.#ensureShowPricingRow();
    }

    const { signal } = this.#abortController;
    closestSection.addEventListener(ThemeEvents.variantUpdate, this.updatePrice);
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#updateTotal, { signal });
    this.#updateTotal();
  }

  disconnectedCallback() {
    const closestSection = this.closest('.shopify-section, dialog');
    if (!closestSection) return;
    closestSection.removeEventListener(ThemeEvents.variantUpdate, this.updatePrice);
    this.#abortController.abort();
  }

  /**
   * Gets current quantity from the product form for this product.
   * @returns {number}
   */
  #getQuantity() {
    const form = document.querySelector(
      `product-form-component[data-product-id="${this.dataset.productId}"]`
    );
    const quantityInput = form?.querySelector('input[name="quantity"]');
    if (!quantityInput) return 1;
    return parseInt(quantityInput.value, 10) || 1;
  }

  /**
   * Formats cents as currency string.
   * @param {number} cents
   * @returns {string}
   */
  #formatMoney(cents) {
    const currency = this.dataset.currency || '';
    const value = cents / 100;
    if (currency) {
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency,
        }).format(value);
      } catch (_) {
        // no-op
      }
    }
    return value.toFixed(2);
  }

  /**
   * Updates the total price display (quantity × unit price).
   */
  #updateTotal = () => {
    const totalEl = this.querySelector('[ref="totalPrice"]');
    if (!totalEl) return;
    const priceCents = this.#displayUnitCents();
    if (Number.isNaN(priceCents)) return;
    const quantity = this.#getQuantity();
    const totalCents = quantity * priceCents;
    totalEl.textContent = this.#formatMoney(totalCents);
  };

  /**
   * Called by product-card after it morphs the price container on collection pages.
   * The variantUpdate event is stopPropagated by product-card so this element's
   * section-level listener never fires — this gives it a way to still refresh the total.
   * @param {string | number} variantId
   */
  updateVariantId(variantId) {
    if (variantId != null) {
      this.dataset.activeVariantId = String(variantId);
    }
    this.#updateTotal();
  }

  /**
   * Updates the price and volume pricing note.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  updatePrice = (event) => {
    if (event.detail.data.newProduct) {
      this.dataset.productId = event.detail.data.newProduct.id;
    } else if (event.target instanceof HTMLElement && event.target.dataset.productId !== this.dataset.productId) {
      return;
    }

    // Find the new product-price element in the updated HTML
    const newProductPrice = event.detail.data.html.querySelector(`product-price[data-block-id="${this.dataset.blockId}"]`);
    if (!newProductPrice) return;

    const newMap = this.#parseVariantUnitCentsMap(newProductPrice);
    if (newMap) {
      this.#variantUnitCentsMap = newMap;
    }

    if (event.detail.resource?.id != null) {
      this.dataset.activeVariantId = String(event.detail.resource.id);
    }

    if (newProductPrice.dataset.initialVariantId) {
      this.dataset.initialVariantId = newProductPrice.dataset.initialVariantId;
    }

    // Sync variant price and currency for total calculation
    if (newProductPrice.dataset.variantPrice) {
      this.dataset.variantPrice = newProductPrice.dataset.variantPrice;
    }
    if (newProductPrice.dataset.currency) {
      this.dataset.currency = newProductPrice.dataset.currency;
    }

    const resolvedCents = this.#displayUnitCents();
    if (!Number.isNaN(resolvedCents)) {
      this.dataset.variantPrice = String(resolvedCents);
    }

    // Update price container
    const newPrice = newProductPrice.querySelector('[ref="priceContainer"]');
    const currentPrice = this.querySelector('[ref="priceContainer"]');
    if (newPrice && currentPrice) currentPrice.replaceWith(newPrice);

    // Update volume pricing note
    const currentNote = this.querySelector('.volume-pricing-note');
    const newNote = newProductPrice.querySelector('.volume-pricing-note');

    if (!newNote) {
      currentNote?.remove();
    } else if (!currentNote) {
      this.querySelector('[ref="priceContainer"]')?.insertAdjacentElement('afterend', /** @type {Element} */ (newNote.cloneNode(true)));
    } else {
      currentNote.replaceWith(newNote);
    }

    // Update total column if present
    const newTotal = newProductPrice.querySelector('[ref="totalPrice"]');
    const currentTotal = this.querySelector('[ref="totalPrice"]');
    if (newTotal && currentTotal) {
      currentTotal.textContent = newTotal.textContent;
    }
    this.#updateTotal();
  };
}

if (!customElements.get('product-price')) {
  customElements.define('product-price', ProductPrice);
}
