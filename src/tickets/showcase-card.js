import { html } from '../web/html.js';

// Bloco de compra de um evento na vitrine (F03.P5), inserido no cartão do evento de F02.
//   "Vagas disponíveis: N"; sem vaga → "Ingressos esgotados" no lugar do formulário;
//   participante → formulário de cartão; visitante → convite para entrar; organizador → nada.
export function renderPurchaseBlock(event, availability, user) {
  const available = availability ? availability.available : 0;
  let action;
  if (available <= 0) {
    action = html`<p class="sold-out" data-sold-out><strong>Ingressos esgotados</strong></p>`;
  } else if (!user) {
    action = html`<p data-login-to-buy><a href="/login">Entre como participante para comprar</a></p>`;
  } else if (user.role === 'participant') {
    action = html`<form method="post" action="/events/${event.id}/purchase" data-form="purchase">
      <label for="card-${event.id}">Número do cartão (16 dígitos)</label>
      <input id="card-${event.id}" name="cardNumber" inputmode="numeric" autocomplete="cc-number" required>
      <button type="submit">Comprar</button>
    </form>`;
  } else {
    action = '';
  }
  return html`<p data-available-seats="${available}">Vagas disponíveis: ${available}</p>
    ${action}`;
}
