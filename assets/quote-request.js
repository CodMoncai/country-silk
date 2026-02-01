import { Component } from '@theme/component';

/**
 * @typedef {Object} QuoteRequestRefs
 * @property {HTMLFormElement} form
 * @property {HTMLInputElement} emailInput
 * @property {HTMLInputElement} [nameInput]
 * @property {HTMLTextAreaElement} [messageInput]
 * @property {HTMLTextAreaElement} details
 * @property {HTMLElement} errorMessage
 * @property {HTMLElement} statusMessage
 * @property {HTMLButtonElement} submitButton
 */

/**
 * @extends {Component<QuoteRequestRefs>}
 */
class QuoteRequestComponent extends Component {
  requiredRefs = ['form', 'emailInput', 'details', 'errorMessage', 'statusMessage', 'submitButton'];

  connectedCallback() {
    super.connectedCallback();
    this.#syncState();
  }

  handleSubmit = (event) => {
    event.preventDefault();

    if (!this.#canSubmit()) return;

    const mailtoUrl = this.#buildMailtoUrl();
    if (!mailtoUrl) return;

    this.#announceStatus();
    window.location.href = mailtoUrl;
  };

  #syncState() {
    if (this.#getAdminEmail()) return;
    this.refs.submitButton.disabled = true;
  }

  #getAdminEmail() {
    return (this.dataset.adminEmail || '').trim();
  }

  #canSubmit() {
    this.#clearStatus();

    if (!this.#getAdminEmail()) {
      this.#showError(this.dataset.emailAdminError || 'Quote recipient email is not configured.');
      return false;
    }

    const email = this.refs.emailInput.value.trim();

    if (!email) {
      this.#showError(this.dataset.emailRequiredError || 'Enter an email address.');
      this.refs.emailInput.focus();
      return false;
    }

    if (this.refs.emailInput.validity.typeMismatch) {
      this.#showError(this.dataset.emailInvalidError || 'Enter a valid email address.');
      this.refs.emailInput.focus();
      return false;
    }

    return true;
  }

  #buildMailtoUrl() {
    const adminEmail = this.#getAdminEmail();
    if (!adminEmail) return '';

    const subject = (this.dataset.emailSubject || '').trim();
    const intro = (this.dataset.emailIntro || '').trim();
    const nameLabel = (this.dataset.emailNameLabel || 'Name').trim();
    const emailLabel = (this.dataset.emailEmailLabel || 'Email').trim();
    const messageLabel = (this.dataset.emailMessageLabel || 'Message').trim();

    const email = this.refs.emailInput.value.trim();
    const name = this.refs.nameInput?.value.trim() || '';
    const message = this.refs.messageInput?.value.trim() || '';
    const details = this.refs.details.value.trim();

    const lines = [];

    if (intro) {
      lines.push(intro, '');
    }

    if (name) {
      lines.push(`${nameLabel}: ${name}`);
    }

    if (email) {
      lines.push(`${emailLabel}: ${email}`);
    }

    if (message) {
      lines.push(`${messageLabel}: ${message}`);
    }

    if (details) {
      lines.push('', details);
    }

    const params = new URLSearchParams();
    if (subject) params.set('subject', subject);
    if (lines.length) params.set('body', lines.join('\n'));
    if (email) params.set('cc', email);

    return `mailto:${adminEmail}?${params.toString()}`;
  }

  #showError(message) {
    if (!message) return;
    this.refs.errorMessage.textContent = message;
    this.refs.errorMessage.hidden = false;
  }

  #announceStatus() {
    const message = (this.dataset.emailOpened || '').trim();
    if (!message) return;

    this.refs.statusMessage.textContent = message;
    this.refs.statusMessage.hidden = false;
  }

  #clearStatus() {
    this.refs.errorMessage.hidden = true;
    this.refs.errorMessage.textContent = '';
    this.refs.statusMessage.hidden = true;
    this.refs.statusMessage.textContent = '';
  }
}

customElements.define('quote-request-component', QuoteRequestComponent);
