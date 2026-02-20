import { Component } from '@theme/component';
import { QuantitySelectorUpdateEvent } from '@theme/events';
import { parseIntOrDefault } from '@theme/utilities';

/**
 * A custom element that allows the user to select a quantity.
 *
 * This component follows a pure event-driven architecture where quantity changes
 * are broadcast via QuantitySelectorUpdateEvent. Parent components that contain
 * quantity selectors listen for these events and handle them according to their
 * specific needs, with event filtering ensuring each parent only processes events
 * from its own quantity selectors to prevent conflicts between different cart
 * update strategies.
 *
 * @typedef {Object} Refs
 * @property {HTMLInputElement} quantityInput
 * @property {HTMLButtonElement} minusButton
 * @property {HTMLButtonElement} plusButton
 *
 * @extends {Component<Refs>}
 */
export class QuantitySelectorComponent extends Component {
  requiredRefs = ['quantityInput', 'minusButton', 'plusButton'];
  serverDisabledMinus = false;
  serverDisabledPlus = false;
  initialized = false;

  get casePackMode() {
    const pack = this.dataset.casePack;
    return pack != null && pack !== '' && parseInt(pack, 10) > 0;
  }

  get casePack() {
    return this.casePackMode ? parseInt(this.dataset.casePack, 10) : 0;
  }

  get maxCaseQuantity() {
    const max = this.dataset.maxCaseQuantity;
    return max != null && max !== '' ? parseInt(max, 10) : null;
  }

  connectedCallback() {
    super.connectedCallback();

    // Capture server-disabled state on first load
    const { minusButton, plusButton } = this.refs;

    if (minusButton.disabled) {
      this.serverDisabledMinus = true;
    }
    if (plusButton.disabled) {
      this.serverDisabledPlus = true;
    }

    this.initialized = true;
    this.updateButtonStates();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  /**
   * Updates cart quantity and refreshes component state
   * @param {number} cartQty - The quantity currently in cart for this variant
   */
  setCartQuantity(cartQty) {
    this.refs.quantityInput.setAttribute('data-cart-quantity', cartQty.toString());
    this.updateCartQuantity();
  }

  /**
   * Checks if the current quantity can be added to cart without exceeding max
   * @returns {{canAdd: boolean, maxQuantity: number|null, cartQuantity: number, quantityToAdd: number}} Validation result
   */
  canAddToCart() {
    const { max, cartQuantity, value } = this.getCurrentValues();
    const quantityToAdd = value;
    const wouldExceedMax = max !== null && cartQuantity + quantityToAdd > max;

    return {
      canAdd: !wouldExceedMax,
      maxQuantity: max,
      cartQuantity,
      quantityToAdd,
    };
  }

  /**
   * Gets the current quantity value
   * @returns {string} The current value
   */
  getValue() {
    return this.refs.quantityInput.value;
  }

  /**
   * Sets the current quantity value
   * @param {string} value - The value to set
   */
  setValue(value) {
    const total = typeof value === 'string' ? parseInt(value, 10) : value;
    this.refs.quantityInput.value = String(isNaN(total) ? 0 : total);
    if (this.casePackMode && this.refs.caseQuantityInput) {
      const pack = this.casePack;
      const caseQty = pack > 0 ? Math.max(1, Math.floor(total / pack)) : 1;
      this.refs.caseQuantityInput.value = String(caseQty);
    }
    this.updateButtonStates();
  }

  /**
   * Updates min/max/step constraints and snaps value to valid increment
   * @param {string} min - Minimum value
   * @param {string|null} max - Maximum value (null if no max)
   * @param {string} step - Step increment
   */
  updateConstraints(min, max, step) {
    const { quantityInput } = this.refs;
    const currentValue = parseInt(quantityInput.value) || 0;

    quantityInput.min = min;
    if (max) {
      quantityInput.max = max;
    } else {
      quantityInput.removeAttribute('max');
    }
    quantityInput.step = step;

    const newMin = parseIntOrDefault(min, 1);
    const newStep = parseIntOrDefault(step, 1);
    const effectiveMax = this.getEffectiveMax();

    let newValue = currentValue;
    if (!this.casePackMode && (currentValue - newMin) % newStep !== 0) {
      newValue = newMin + Math.floor((currentValue - newMin) / newStep) * newStep;
    }

    newValue = Math.max(newMin, Math.min(effectiveMax ?? Infinity, newValue));

    if (newValue !== currentValue) {
      quantityInput.value = newValue.toString();
    }

    if (this.casePackMode && this.refs.caseQuantityInput) {
      const pack = this.casePack;
      const caseQty = pack > 0 ? Math.max(1, Math.floor(newValue / pack)) : 1;
      const maxCase = this.maxCaseQuantity;
      this.refs.caseQuantityInput.value = String(maxCase != null ? Math.min(maxCase, caseQty) : caseQty);
      if (maxCase != null) {
        this.refs.caseQuantityInput.setAttribute('max', String(maxCase));
      }
    }

    this.updateButtonStates();
  }

  /**
   * Gets current values from DOM (fresh read every time)
   * @returns {{min: number, max: number|null, step: number, value: number, cartQuantity: number}}
   */
  getCurrentValues() {
    const { quantityInput } = this.refs;

    return {
      min: parseIntOrDefault(quantityInput.min, 1),
      max: parseIntOrDefault(quantityInput.max, null),
      step: parseIntOrDefault(quantityInput.step, 1),
      value: parseIntOrDefault(quantityInput.value, 0),
      cartQuantity: parseIntOrDefault(quantityInput.getAttribute('data-cart-quantity'), 0),
    };
  }

  /**
   * Gets the effective maximum value for this quantity selector
   * Product page: max - cartQuantity (how many can be added)
   * Override in subclass for different behavior
   * @returns {number | null} The effective max, or null if no max
   */
  getEffectiveMax() {
    if (this.casePackMode) {
      const maxCase = this.maxCaseQuantity;
      if (maxCase == null) return null;
      const pack = this.casePack;
      const { cartQuantity, min } = this.getCurrentValues();
      const maxTotal = maxCase * pack;
      return Math.max(maxTotal - cartQuantity, min);
    }
    const { max, cartQuantity, min } = this.getCurrentValues();
    if (max === null) return null;
    return Math.max(max - cartQuantity, min);
  }

  /**
   * Updates button states based on current value and limits
   */
  updateButtonStates() {
    const { minusButton, plusButton } = this.refs;
    if (this.casePackMode && this.refs.caseMinusButton != null && this.refs.casePlusButton != null) {
      const caseValue = parseInt(this.refs.caseQuantityInput?.value ?? '1', 10) || 1;
      const maxCase = this.maxCaseQuantity;
      this.refs.caseMinusButton.disabled = caseValue <= 1;
      this.refs.casePlusButton.disabled = maxCase != null && caseValue >= maxCase;
    }
    const { min, value } = this.getCurrentValues();
    const effectiveMax = this.getEffectiveMax();
    if (!this.serverDisabledMinus) {
      minusButton.disabled = value <= min;
    }
    if (!this.serverDisabledPlus) {
      plusButton.disabled = effectiveMax !== null && value >= effectiveMax;
    }
  }

  /**
   * Updates quantity by a given step
   * @param {number} stepMultiplier - Positive for increase, negative for decrease
   */
  updateQuantity(stepMultiplier) {
    const { quantityInput } = this.refs;
    const { min, step, value } = this.getCurrentValues();
    const effectiveMax = this.getEffectiveMax();

    const newValue = Math.min(effectiveMax ?? Infinity, Math.max(min, value + step * stepMultiplier));

    quantityInput.value = newValue.toString();
    this.onQuantityChange();
    this.updateButtonStates();
  }

  /**
   * Handles the quantity increase event.
   * @param {Event} event - The event.
   */
  increaseQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;
    event.preventDefault();
    this.updateQuantity(1);
  }

  /**
   * Handles the quantity decrease event.
   * @param {Event} event - The event.
   */
  decreaseQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;
    event.preventDefault();
    this.updateQuantity(-1);
  }

  /**
   * Case pack mode: sync total from case quantity and dispatch update
   */
  #syncTotalFromCase() {
    if (!this.casePackMode || !this.refs.caseQuantityInput) return;
    const pack = this.casePack;
    const caseQty = parseInt(this.refs.caseQuantityInput.value, 10) || 1;
    const maxCase = this.maxCaseQuantity;
    const clampedCase = Math.max(1, maxCase != null ? Math.min(maxCase, caseQty) : caseQty);
    if (clampedCase !== caseQty) {
      this.refs.caseQuantityInput.value = String(clampedCase);
    }
    const total = clampedCase * pack;
    this.refs.quantityInput.value = String(total);
    this.onQuantityChange();
    this.updateButtonStates();
  }

  increaseCaseQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;
    event.preventDefault();
    if (!this.casePackMode || !this.refs.caseQuantityInput) return;
    const maxCase = this.maxCaseQuantity;
    const current = parseInt(this.refs.caseQuantityInput.value, 10) || 1;
    const next = maxCase != null ? Math.min(maxCase, current + 1) : current + 1;
    this.refs.caseQuantityInput.value = String(next);
    this.#syncTotalFromCase();
  }

  decreaseCaseQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;
    event.preventDefault();
    if (!this.casePackMode || !this.refs.caseQuantityInput) return;
    const current = parseInt(this.refs.caseQuantityInput.value, 10) || 1;
    const next = Math.max(1, current - 1);
    this.refs.caseQuantityInput.value = String(next);
    this.#syncTotalFromCase();
  }

  setCaseQuantity(event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    this.#syncTotalFromCase();
  }

  /**
   * When our input gets focused, we want to fully select the value.
   * @param {FocusEvent} event
   */
  selectInputValue(event) {
    const { quantityInput } = this.refs;
    if (!(event.target instanceof HTMLInputElement) || document.activeElement !== quantityInput) return;

    quantityInput.select();
  }

  /**
   * Handles the quantity set event (on blur).
   * Validates and snaps to valid values.
   * @param {Event} event - The event.
   */
  setQuantity(event) {
    if (!(event.target instanceof HTMLInputElement)) return;

    event.preventDefault();
    const { quantityInput } = this.refs;
    const { min, step } = this.getCurrentValues();
    const effectiveMax = this.getEffectiveMax();

    // Snap to bounds
    const quantity = Math.min(effectiveMax ?? Infinity, Math.max(min, parseInt(event.target.value) || 0));

    // Validate step increment
    if ((quantity - min) % step !== 0) {
      // Set the invalid value and trigger native HTML validation
      quantityInput.value = quantity.toString();
      quantityInput.reportValidity();
      return;
    }

    quantityInput.value = quantity.toString();
    this.onQuantityChange();
    this.updateButtonStates();
  }

  /**
   * Handles the quantity change event.
   */
  onQuantityChange() {
    const { quantityInput } = this.refs;
    const newValue = parseInt(quantityInput.value);

    this.dispatchEvent(new QuantitySelectorUpdateEvent(newValue, Number(quantityInput.dataset.cartLine) || undefined));
  }

  /**
   * Updates the cart quantity from data attribute and refreshes button states
   * Called when cart is updated from external sources
   */
  updateCartQuantity() {
    const { quantityInput } = this.refs;
    const { min, value } = this.getCurrentValues();
    const effectiveMax = this.getEffectiveMax();

    // Clamp value to new effective max if necessary
    const clampedValue = Math.min(effectiveMax ?? Infinity, Math.max(min, value));

    if (clampedValue !== value) {
      quantityInput.value = clampedValue.toString();
    }

    this.updateButtonStates();
  }

  /**
   * Gets the quantity input.
   * @returns {HTMLInputElement} The quantity input.
   */
  get quantityInput() {
    if (!this.refs.quantityInput) {
      throw new Error('Missing <input ref="quantityInput" /> inside <quantity-selector-component />');
    }

    return this.refs.quantityInput;
  }
}

if (!customElements.get('quantity-selector-component')) {
  customElements.define('quantity-selector-component', QuantitySelectorComponent);
}
