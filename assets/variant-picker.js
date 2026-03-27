import { Component } from '@theme/component';
import { VariantSelectedEvent, VariantUpdateEvent } from '@theme/events';
import { morph, MORPH_OPTIONS } from '@theme/morph';
import { yieldToMainThread, getViewParameterValue, ResizeNotifier } from '@theme/utilities';

/**
 * @typedef {object} VariantPickerRefs
 * @property {HTMLFieldSetElement[]} fieldsets – The fieldset elements.
 */

/**
 * A custom element that manages a variant picker.
 *
 * @template {import('@theme/component').Refs} [TRefs=VariantPickerRefs]
 * @extends Component<TRefs>
 */
export default class VariantPicker extends Component {
  /** @type {string | undefined} */
  #pendingRequestUrl;

  /** @type {AbortController | undefined} */
  #abortController;

  /** @type {number[][]} */
  #checkedIndices = [];

  /** @type {HTMLInputElement[][]} */
  #radios = [];

  #resizeObserver = new ResizeNotifier(() => this.updateVariantPickerCss());

  connectedCallback() {
    super.connectedCallback();
    const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);

    fieldsets.forEach((fieldset) => {
      const radios = Array.from(fieldset?.querySelectorAll('input') ?? []);
      this.#radios.push(radios);

      const initialCheckedIndex = radios.findIndex((radio) => radio.dataset.currentChecked === 'true');
      if (initialCheckedIndex !== -1) {
        this.#checkedIndices.push([initialCheckedIndex]);
      }
    });

    this.addEventListener('change', this.variantChanged.bind(this));
    this.#resizeObserver.observe(this);

    // Collection cards: pathname handle (e.g. /collections/enchanted-christmas → "Enchanted Christmas") takes
    // precedence over priority Theme list when it matches a Theme option value on each card.
    const pathApplied = this.#autoSelectThemeFromCollectionPathname();
    if (!pathApplied) {
      // Optionally auto-select the first priority Theme value on initial page load.
      this.#autoSelectPriorityThemeOnLoad();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#resizeObserver.disconnect();
  }

  /**
   * Priority Theme config is output on both `<variant-picker>` and inner `<form>`.
   * Some storefronts lose host `data-*` on the custom element; the form stays in sync with Liquid.
   */
  #readPriorityConfig() {
    const form = this.querySelector('form.variant-picker__form');
    const fd = form?.dataset ?? {};
    const hd = this.dataset ?? {};
    return {
      priorityThemeLine: String(fd.priorityThemeLine || hd.priorityThemeLine || '').trim(),
      themeOptionLabels: String(fd.themeOptionLabels || hd.themeOptionLabels || 'Theme,Themes').trim(),
    };
  }

  /** @param {string | null | undefined} s */
  #normalizeThemeText(s) {
    return (s || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  }

  /** Labels for the Theme option (section setting), normalized for comparison. */
  #getThemeOptionLabelCandidatesNormalized() {
    const raw = this.#readPriorityConfig().themeOptionLabels;
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => this.#normalizeThemeText(t));
  }

  /**
   * Segment after `/collections/` in the URL, as display text: hyphens → spaces, title-cased words.
   * Empty when not on a collection URL or handle is meaningless (e.g. `all`).
   */
  #collectionPathThemeDisplayLabel() {
    try {
      const parts = window.location.pathname.split('/').filter(Boolean);
      const idx = parts.indexOf('collections');
      if (idx < 0 || idx >= parts.length - 1) return '';
      const slug = parts[idx + 1];
      if (!slug || slug === 'all') return '';
      const spaced = slug.replace(/-/g, ' ').trim();
      if (!spaced) return '';
      return spaced
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    } catch {
      return '';
    }
  }

  /**
   * Normalized Theme value candidates derived from collection handle.
   * Supports per-collection fallbacks (e.g. `traditional-christmas` → also allow `Traditional`).
   * @returns {string[]}
   */
  #collectionPathThemeWantedCandidatesNormalized() {
    try {
      const parts = window.location.pathname.split('/').filter(Boolean);
      const idx = parts.indexOf('collections');
      if (idx < 0 || idx >= parts.length - 1) return [];
      const slug = parts[idx + 1];
      if (!slug || slug === 'all') return [];

      const display = this.#collectionPathThemeDisplayLabel();
      const candidates = [];
      if (display) candidates.push(this.#normalizeThemeText(display));

      if (slug === 'traditional-christmas') {
        candidates.push(this.#normalizeThemeText('Traditional'));
      }

      if (slug === 'emerald-christmas') {
        candidates.push(this.#normalizeThemeText('Gold White'));
      }

      // De-dupe while preserving order.
      return Array.from(new Set(candidates)).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** @returns {HTMLFieldSetElement | undefined} */
  #findThemeFieldsetElement() {
    const themeLabelCandidates = this.#getThemeOptionLabelCandidatesNormalized();
    const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);
    return fieldsets.find((fs) => {
      const legend = fs.querySelector('legend');
      if (!legend) return false;
      const legendText = (legend.childNodes?.[0]?.textContent || legend.textContent || '').trim();
      return themeLabelCandidates.includes(this.#normalizeThemeText(legendText));
    });
  }

  /** @returns {HTMLSelectElement | null} */
  #findThemeSelectElement() {
    const themeLabelCandidates = this.#getThemeOptionLabelCandidatesNormalized();
    const wrappers = this.querySelectorAll('.variant-option--dropdowns');
    for (const wrap of wrappers) {
      const lab = wrap.querySelector(':scope > label');
      if (!lab) continue;
      const labelText = (lab.textContent || '').trim();
      if (themeLabelCandidates.includes(this.#normalizeThemeText(labelText))) {
        const sel = wrap.querySelector('select.variant-option__select');
        if (sel instanceof HTMLSelectElement) return sel;
      }
    }
    return null;
  }

  /**
   * Select Theme radio or dropdown option matching `wantedNormalized`, using existing change/update paths.
   * @param {string} wantedNormalized
   * @returns {boolean} True if the value is already selected or selection was applied.
   */
  #selectThemeIfMatching(wantedNormalized) {
    const themeFieldset = this.#findThemeFieldsetElement();
    if (themeFieldset) {
      const inputs = Array.from(themeFieldset.querySelectorAll('input[type="radio"]'));
      const target = inputs.find((input) => {
        const label = this.#normalizeThemeText(input.getAttribute('aria-label') || input.value);
        const disabled = input.getAttribute('aria-disabled') === 'true' || input.disabled;
        return !disabled && label === wantedNormalized;
      });
      if (!target) return false;
      if (target.checked) return true;
      target.click();
      return true;
    }

    const selectEl = this.#findThemeSelectElement();
    if (selectEl) {
      const opt = Array.from(selectEl.options).find(
        (o) => !o.disabled && this.#normalizeThemeText(o.value) === wantedNormalized,
      );
      if (!opt) return false;
      if (this.#normalizeThemeText(selectEl.value) === wantedNormalized) return true;
      selectEl.value = opt.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    return false;
  }

  /**
   * Auto-select Theme from collection URL handle on product cards (e.g. enchanted-christmas → Enchanted Christmas).
   * @returns {boolean} True when pathname produced a label and Theme control exists for that value.
   */
  #autoSelectThemeFromCollectionPathname() {
    if (!this.closest('product-card')) return false;
    if (this.closest('quick-add-dialog')) return false;
    if (this.dataset.templateProductMatch === 'true') return false;
    if (this.dataset.autoCollectionPathThemeApplied === 'true') return false;

    const wantedCandidates = this.#collectionPathThemeWantedCandidatesNormalized();
    if (!wantedCandidates.length) return false;

    const ok = wantedCandidates.some((wanted) => this.#selectThemeIfMatching(wanted));
    if (ok) this.dataset.autoCollectionPathThemeApplied = 'true';
    return ok;
  }

  /**
   * Auto-select the first priority Theme on load for collection product cards.
   * Runs once per element; safe if no priority/theme option exists.
   */
  #autoSelectPriorityThemeOnLoad() {
    // Only apply to product cards (collection grid). Avoid product pages, quick add, and dialogs.
    if (!this.closest('product-card')) return;
    if (this.closest('quick-add-dialog')) return;
    if (this.dataset.templateProductMatch === 'true') return;
    if (this.dataset.autoPriorityThemeApplied === 'true') return;

    const cfg = this.#readPriorityConfig();
    const priorityLine = cfg.priorityThemeLine;

    if (!priorityLine) return;

    const priorityFirst = priorityLine
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)[0];

    if (!priorityFirst) return;

    const wanted = this.#normalizeThemeText(priorityFirst);
    if (!this.#selectThemeIfMatching(wanted)) return;

    this.dataset.autoPriorityThemeApplied = 'true';
  }

  /**
   * Handles the variant change event.
   * @param {Event} event - The variant change event.
   */
  variantChanged(event) {
    if (!(event.target instanceof HTMLElement)) return;

    const selectedOption =
      event.target instanceof HTMLSelectElement ? event.target.options[event.target.selectedIndex] : event.target;

    if (!selectedOption) return;

    this.updateSelectedOption(event.target);
    this.dispatchEvent(new VariantSelectedEvent({ id: selectedOption.dataset.optionValueId ?? '' }));

    const isOnProductPage =
      this.dataset.templateProductMatch === 'true' &&
      !event.target.closest('product-card') &&
      !event.target.closest('quick-add-dialog');

    // Morph the entire main content for combined listings child products, because changing the product
    // might also change other sections depending on recommendations, metafields, etc.
    const currentUrl = this.dataset.productUrl?.split('?')[0];
    const newUrl = selectedOption.dataset.connectedProductUrl;
    const loadsNewProduct = isOnProductPage && !!newUrl && newUrl !== currentUrl;
    const isOnFeaturedProductSection = Boolean(this.closest('featured-product-information'));

    const morphElementSelector = loadsNewProduct
      ? 'main'
      : isOnFeaturedProductSection
      ? 'featured-product-information'
      : undefined;

    this.fetchUpdatedSection(this.buildRequestUrl(selectedOption), morphElementSelector);

    const url = new URL(window.location.href);

    const variantId = selectedOption.dataset.variantId || null;

    if (isOnProductPage) {
      if (variantId) {
        url.searchParams.set('variant', variantId);
      } else {
        url.searchParams.delete('variant');
      }
    }

    // Change the path if the option is connected to another product via combined listing.
    if (loadsNewProduct) {
      url.pathname = newUrl;
    }

    if (url.href !== window.location.href) {
      yieldToMainThread().then(() => {
        history.replaceState({}, '', url.toString());
      });
    }
  }

  /**
   * @typedef {object} FieldsetMeasurements
   * @property {HTMLFieldSetElement} fieldset
   * @property {number | undefined} currentIndex
   * @property {number | undefined} previousIndex
   * @property {number | undefined} currentWidth
   * @property {number | undefined} previousWidth
   */

  /**
   * Gets measurements for a single fieldset (read phase).
   * @param {number} fieldsetIndex
   * @returns {FieldsetMeasurements | null}
   */
  #getFieldsetMeasurements(fieldsetIndex) {
    const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);
    const fieldset = fieldsets[fieldsetIndex];
    const checkedIndices = this.#checkedIndices[fieldsetIndex];
    const radios = this.#radios[fieldsetIndex];

    if (!radios || !checkedIndices || !fieldset) return null;

    const [currentIndex, previousIndex] = checkedIndices;

    return {
      fieldset,
      currentIndex,
      previousIndex,
      currentWidth: currentIndex !== undefined ? radios[currentIndex]?.parentElement?.offsetWidth : undefined,
      previousWidth: previousIndex !== undefined ? radios[previousIndex]?.parentElement?.offsetWidth : undefined,
    };
  }

  /**
   * Applies measurements to a fieldset (write phase).
   * @param {FieldsetMeasurements} measurements
   */
  #applyFieldsetMeasurements({ fieldset, currentWidth, previousWidth, currentIndex, previousIndex }) {
    if (currentWidth) {
      fieldset.style.setProperty('--pill-width-current', `${currentWidth}px`);
    } else if (currentIndex !== undefined) {
      fieldset.style.removeProperty('--pill-width-current');
    }

    if (previousWidth) {
      fieldset.style.setProperty('--pill-width-previous', `${previousWidth}px`);
    } else if (previousIndex !== undefined) {
      fieldset.style.removeProperty('--pill-width-previous');
    }
  }

  /**
   * Updates the fieldset CSS.
   * @param {number} fieldsetIndex - The fieldset index.
   */
  updateFieldsetCss(fieldsetIndex) {
    if (Number.isNaN(fieldsetIndex)) return;

    const measurements = this.#getFieldsetMeasurements(fieldsetIndex);
    if (measurements) {
      this.#applyFieldsetMeasurements(measurements);
    }
  }

  /**
   * Updates the selected option.
   * @param {string | Element} target - The target element.
   */
  updateSelectedOption(target) {
    if (typeof target === 'string') {
      const targetElement = this.querySelector(`[data-option-value-id="${target}"]`);

      if (!targetElement) throw new Error('Target element not found');

      target = targetElement;
    }

    if (target instanceof HTMLInputElement) {
      const fieldsetIndex = Number.parseInt(target.dataset.fieldsetIndex || '');
      const inputIndex = Number.parseInt(target.dataset.inputIndex || '');

      if (!Number.isNaN(fieldsetIndex) && !Number.isNaN(inputIndex)) {
        const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);
        const fieldset = fieldsets[fieldsetIndex];
        const checkedIndices = this.#checkedIndices[fieldsetIndex];
        const radios = this.#radios[fieldsetIndex];

        if (radios && checkedIndices && fieldset) {
          // Clear previous checked states
          const [currentIndex, previousIndex] = checkedIndices;

          if (currentIndex !== undefined && radios[currentIndex]) {
            radios[currentIndex].dataset.previousChecked = 'false';
          }
          if (previousIndex !== undefined && radios[previousIndex]) {
            radios[previousIndex].dataset.previousChecked = 'false';
          }

          // Update checked indices array - keep only the last 2 selections
          checkedIndices.unshift(inputIndex);
          checkedIndices.length = Math.min(checkedIndices.length, 2);

          // Update the new states
          const newCurrentIndex = checkedIndices[0]; // This is always inputIndex
          const newPreviousIndex = checkedIndices[1]; // This might be undefined

          // newCurrentIndex is guaranteed to exist since we just added it
          if (newCurrentIndex !== undefined && radios[newCurrentIndex]) {
            radios[newCurrentIndex].dataset.currentChecked = 'true';
          }

          if (newPreviousIndex !== undefined && radios[newPreviousIndex]) {
            radios[newPreviousIndex].dataset.previousChecked = 'true';
            radios[newPreviousIndex].dataset.currentChecked = 'false';
          }

          this.updateFieldsetCss(fieldsetIndex);
        }
      }
      target.checked = true;
    }

    if (target instanceof HTMLSelectElement) {
      const newValue = target.value;
      const newSelectedOption = Array.from(target.options).find((option) => option.value === newValue);

      if (!newSelectedOption) throw new Error('Option not found');

      for (const option of target.options) {
        option.removeAttribute('selected');
      }

      newSelectedOption.setAttribute('selected', 'selected');
    }
  }

  /**
   * Builds the request URL.
   * @param {HTMLElement} selectedOption - The selected option.
   * @param {string | null} [source] - The source.
   * @param {string[]} [sourceSelectedOptionsValues] - The source selected options values.
   * @returns {string} The request URL.
   */
  buildRequestUrl(selectedOption, source = null, sourceSelectedOptionsValues = []) {
    // this productUrl and pendingRequestUrl will be useful for the support of combined listing. It is used when a user changes variant quickly and those products are using separate URLs (combined listing).
    // We create a new URL and abort the previous fetch request if it's still pending.
    let productUrl = selectedOption.dataset.connectedProductUrl || this.#pendingRequestUrl || this.dataset.productUrl;
    this.#pendingRequestUrl = productUrl;
    const params = [];
    const viewParamValue = getViewParameterValue();

    // preserve view parameter, if it exists, for alternative product view testing
    if (viewParamValue) params.push(`view=${viewParamValue}`);

    if (this.selectedOptionsValues.length && !source) {
      params.push(`option_values=${this.selectedOptionsValues.join(',')}`);
    } else if (source === 'product-card') {
      if (this.selectedOptionsValues.length) {
        params.push(`option_values=${sourceSelectedOptionsValues.join(',')}`);
      } else {
        params.push(`option_values=${selectedOption.dataset.optionValueId}`);
      }
    }

    // If variant-picker is a child of some specific sections, we need to append section_id=xxxx to the URL
    const SECTION_ID_MAP = {
      'quick-add-component': 'section-rendering-product-card',
      'swatches-variant-picker-component': 'section-rendering-product-card',
      'product-card': 'section-rendering-product-card',
      'featured-product-information': this.closest('featured-product-information')?.id,
    };

    const closestSectionId = /** @type {keyof typeof SECTION_ID_MAP} | undefined */ (
      Object.keys(SECTION_ID_MAP).find((sectionId) => this.closest(sectionId))
    );

    if (closestSectionId) {
      if (productUrl?.includes('?')) {
        productUrl = productUrl.split('?')[0];
      }
      return `${productUrl}?section_id=${SECTION_ID_MAP[closestSectionId]}&${params.join('&')}`;
    }

    return `${productUrl}?${params.join('&')}`;
  }

  /**
   * Fetches the updated section.
   * @param {string} requestUrl - The request URL.
   * @param {string} [morphElementSelector] - The selector of the element to be morphed. By default, only the variant picker is morphed.
   */
  fetchUpdatedSection(requestUrl, morphElementSelector) {
    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    fetch(requestUrl, { signal: this.#abortController.signal })
      .then((response) => response.text())
      .then((responseText) => {
        this.#pendingRequestUrl = undefined;
        const html = new DOMParser().parseFromString(responseText, 'text/html');
        // Defer is only useful for the initial rendering of the page. Remove it here.
        html.querySelector('overflow-list[defer]')?.removeAttribute('defer');

        const textContent = html.querySelector(`variant-picker script[type="application/json"]`)?.textContent;
        if (!textContent) return;

        if (morphElementSelector === 'main') {
          this.updateMain(html);
        } else if (morphElementSelector) {
          this.updateElement(html, morphElementSelector);
        } else {
          const newProduct = this.updateVariantPicker(html);

          // We grab the variant object from the response and dispatch an event with it.
          if (this.selectedOptionId) {
            this.dispatchEvent(
              new VariantUpdateEvent(JSON.parse(textContent), this.selectedOptionId, {
                html,
                productId: this.dataset.productId ?? '',
                newProduct,
              })
            );
          }
        }
      })
      .catch((error) => {
        if (error.name === 'AbortError') {
          console.warn('Fetch aborted by user');
        } else {
          console.error(error);
        }
      });
  }

  /**
   * @typedef {Object} NewProduct
   * @property {string} id
   * @property {string} url
   */

  /**
   * Re-renders the variant picker.
   * @param {Document | Element} newHtml - The new HTML.
   * @returns {NewProduct | undefined} Information about the new product if it has changed, otherwise undefined.
   */
  updateVariantPicker(newHtml) {
    /** @type {NewProduct | undefined} */
    let newProduct;

    const newVariantPickerSource = newHtml.querySelector(this.tagName.toLowerCase());

    if (!newVariantPickerSource) {
      throw new Error('No new variant picker source found');
    }

    // For combined listings, the product might have changed, so update the related data attribute.
    if (newVariantPickerSource instanceof HTMLElement) {
      const newProductId = newVariantPickerSource.dataset.productId;
      const newProductUrl = newVariantPickerSource.dataset.productUrl;

      if (newProductId && newProductUrl && this.dataset.productId !== newProductId) {
        newProduct = { id: newProductId, url: newProductUrl };
      }

      this.dataset.productId = newProductId;
      this.dataset.productUrl = newProductUrl;
    }

    // Section responses used to ship a script-only picker; morphing that would remove the real form. Prefer full markup
    // from section-rendering-product-card; if the response has no form, only sync JSON and keep the existing DOM.
    const hasForm = newVariantPickerSource.querySelector('form.variant-picker__form');
    if (!hasForm) {
      const newScript = newVariantPickerSource.querySelector('script[type="application/json"]');
      const oldScript = this.querySelector('script[type="application/json"]');
      if (newScript && oldScript) {
        oldScript.textContent = newScript.textContent;
      }
      this.updateVariantPickerCss();
      return newProduct;
    }

    morph(this, newVariantPickerSource, {
      ...MORPH_OPTIONS,
      getNodeKey: (node) => {
        if (!(node instanceof HTMLElement)) return undefined;
        const key = node.dataset.key;
        return key;
      },
    });
    this.updateVariantPickerCss();

    return newProduct;
  }

  updateVariantPickerCss() {
    const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);

    // Batch all reads first across all fieldsets to avoid layout thrashing
    const measurements = fieldsets.map((_, index) => this.#getFieldsetMeasurements(index)).filter((m) => m !== null);

    // Batch all writes after all reads
    for (const measurement of measurements) {
      this.#applyFieldsetMeasurements(measurement);
    }
  }

  /**
   * Re-renders the desired element.
   * @param {Document} newHtml - The new HTML.
   * @param {string} elementSelector - The selector of the element to re-render.
   */
  updateElement(newHtml, elementSelector) {
    const element = this.closest(elementSelector);
    const newElement = newHtml.querySelector(elementSelector);

    if (!element || !newElement) {
      throw new Error(`No new element source found for ${elementSelector}`);
    }

    morph(element, newElement);
  }

  /**
   * Re-renders the entire main content.
   * @param {Document} newHtml - The new HTML.
   */
  updateMain(newHtml) {
    const main = document.querySelector('main');
    const newMain = newHtml.querySelector('main');

    if (!main || !newMain) {
      throw new Error('No new main source found');
    }

    morph(main, newMain);
  }

  /**
   * Gets the selected option.
   * @returns {HTMLInputElement | HTMLOptionElement | undefined} The selected option.
   */
  get selectedOption() {
    const selectedOption = this.querySelector('select option[selected], fieldset input:checked');

    if (!(selectedOption instanceof HTMLInputElement || selectedOption instanceof HTMLOptionElement)) {
      return undefined;
    }

    return selectedOption;
  }

  /**
   * Gets the selected option ID.
   * @returns {string | undefined} The selected option ID.
   */
  get selectedOptionId() {
    const { selectedOption } = this;
    if (!selectedOption) return undefined;
    const { optionValueId } = selectedOption.dataset;

    if (!optionValueId) {
      throw new Error('No option value ID found');
    }

    return optionValueId;
  }

  /**
   * Gets the selected options values.
   * @returns {string[]} The selected options values.
   */
  get selectedOptionsValues() {
    /** @type HTMLElement[] */
    const selectedOptions = Array.from(this.querySelectorAll('select option[selected], fieldset input:checked'));

    return selectedOptions.map((option) => {
      const { optionValueId } = option.dataset;

      if (!optionValueId) throw new Error('No option value ID found');

      return optionValueId;
    });
  }
}

if (!customElements.get('variant-picker')) {
  customElements.define('variant-picker', VariantPicker);
}
