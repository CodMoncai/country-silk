import { Component } from '@theme/component';
import { onAnimationEnd } from '@theme/utilities';
import { ThemeEvents, CartUpdateEvent } from '@theme/events';

/**
 * A custom element that displays a cart icon.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} cartBubble - The cart bubble element.
 * @property {HTMLElement} cartBubbleText - The cart bubble text element.
 * @property {HTMLElement} cartBubbleCount - The cart bubble count element.
 * @property {HTMLElement} [cartTotal] - The cart total element.
 *
 * @extends {Component<Refs>}
 */
class CartIcon extends Component {
  requiredRefs = ['cartBubble', 'cartBubbleText', 'cartBubbleCount'];

  /** @type {number} */
  get currentCartCount() {
    return parseInt(this.refs.cartBubbleCount.textContent ?? '0', 10);
  }

  set currentCartCount(value) {
    this.refs.cartBubbleCount.textContent = value < 100 ? String(value) : '';
  }

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
    window.addEventListener('pageshow', this.onPageShow);
    this.ensureCartBubbleIsCorrect();
    this.#updateCartTotalFromDataset();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    document.removeEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
    window.removeEventListener('pageshow', this.onPageShow);
  }

  /**
   * Handles the page show event when the page is restored from cache.
   * @param {PageTransitionEvent} event - The page show event.
   */
  onPageShow = (event) => {
    if (event.persisted) {
      this.ensureCartBubbleIsCorrect();
    }
  };

  /**
   * Handles the cart update event.
   * @param {CartUpdateEvent} event - The cart update event.
   */
  onCartUpdate = async (event) => {
    const itemCount = event.detail.data?.itemCount ?? 0;
    const comingFromProductForm = event.detail.data?.source === 'product-form-component';

    this.renderCartBubble(itemCount, comingFromProductForm);
    await this.#updateCartTotal(event.detail.resource);
  };

  /**
   * Renders the cart bubble.
   * @param {number} itemCount - The number of items in the cart.
   * @param {boolean} comingFromProductForm - Whether the cart update is coming from the product form.
   */
  renderCartBubble = async (itemCount, comingFromProductForm, animate = true) => {
    // If the cart update is coming from the product form, we add to the current cart count, otherwise we set the new cart count

    this.refs.cartBubbleCount.classList.toggle('hidden', itemCount === 0);
    this.refs.cartBubble.classList.toggle('visually-hidden', itemCount === 0);

    this.currentCartCount = comingFromProductForm ? this.currentCartCount + itemCount : itemCount;

    this.classList.toggle('header-actions__cart-icon--has-cart', itemCount > 0);

    sessionStorage.setItem(
      'cart-count',
      JSON.stringify({
        value: String(this.currentCartCount),
        timestamp: Date.now(),
      })
    );

    if (!animate || itemCount === 0) return;

    // Ensure element is visible before starting animation
    // Use requestAnimationFrame to ensure the browser sees the state change
    await new Promise((resolve) => requestAnimationFrame(resolve));

    this.refs.cartBubble.classList.add('cart-bubble--animating');
    await onAnimationEnd(this.refs.cartBubbleText);

    this.refs.cartBubble.classList.remove('cart-bubble--animating');
  };

  /**
   * Checks if the cart count is correct.
   */
  ensureCartBubbleIsCorrect = () => {
    // Ensure refs are available
    if (!this.refs.cartBubbleCount) return;

    const sessionStorageCount = sessionStorage.getItem('cart-count');

    // If no session storage data, nothing to check
    if (sessionStorageCount === null) return;

    const visibleCount = this.refs.cartBubbleCount.textContent;

    try {
      const { value, timestamp } = JSON.parse(sessionStorageCount);

      // Check if the stored count matches what's visible
      if (value === visibleCount) return;

      // Only update if timestamp is recent (within 10 seconds)
      if (Date.now() - timestamp < 10000) {
        const count = parseInt(value, 10);

        if (count >= 0) {
          this.renderCartBubble(count, false, false);
        }
      }
    } catch (_) {
      // no-op
    }
  };

  #updateCartTotalFromDataset() {
    if (!this.refs.cartTotal) return;
    const storedTotal = this.refs.cartTotal.dataset.cartTotal;
    if (!storedTotal) return;

    const total = Number(storedTotal);
    if (Number.isNaN(total)) return;

    this.#setCartTotal(total);
  }

  /**
   * @param {Object} resource
   */
  #updateCartTotal = async (resource) => {
    if (!this.refs.cartTotal) return;

    if (resource && typeof resource.total_price === 'number') {
      this.#setCartTotal(resource.total_price);
      return;
    }

    try {
      const response = await fetch('/cart.js', {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) return;

      const cart = await response.json();
      if (typeof cart.total_price !== 'number') return;

      this.#setCartTotal(cart.total_price);
    } catch (_) {
      // no-op
    }
  };

  /**
   * @param {number} total
   */
  #setCartTotal(total) {
    if (!this.refs.cartTotal) return;

    this.refs.cartTotal.dataset.cartTotal = String(total);
    this.refs.cartTotal.textContent = this.#formatCurrency(total);
    this.refs.cartTotal.hidden = total === 0;
  }

  /**
   * @param {number} cents
   * @returns {string}
   */
  #formatCurrency(cents) {
    const currency = this.dataset.currency || this.refs.cartTotal?.dataset.currency || '';
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
}

if (!customElements.get('cart-icon')) {
  customElements.define('cart-icon', CartIcon);
}
