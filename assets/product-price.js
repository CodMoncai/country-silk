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

  connectedCallback() {
    const closestSection = this.closest('.shopify-section, dialog');
    if (!closestSection) return;
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
    const priceCents = parseInt(this.dataset.variantPrice, 10);
    if (Number.isNaN(priceCents)) return;
    const quantity = this.#getQuantity();
    const totalCents = quantity * priceCents;
    totalEl.textContent = this.#formatMoney(totalCents);
  };

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

    // Sync variant price and currency for total calculation
    if (newProductPrice.dataset.variantPrice) {
      this.dataset.variantPrice = newProductPrice.dataset.variantPrice;
    }
    if (newProductPrice.dataset.currency) {
      this.dataset.currency = newProductPrice.dataset.currency;
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
