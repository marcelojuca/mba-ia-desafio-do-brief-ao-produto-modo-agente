import { html } from '../web/html.js';
import { registerManagementSection } from '../events/management-sections.js';

// Seção "Check-in" da página de gestão (F05.P1). Fica disponível também em evento cancelado (R10: o código
// válido desse evento resulta em "Evento cancelado"). O resultado do último POST vem em req.checkinResult.
registerManagementSection({
  id: 'checkin',
  order: 20,
  render: ({ event, req }) => {
    const r = req.checkinResult;
    return html`
      <h2>Check-in</h2>
      <form class="stack" method="post" action="/organizer/events/${event.id}/checkin" data-form="checkin">
        <label for="checkin-code">Código do ingresso</label>
        <input id="checkin-code" name="code" required maxlength="64" autocomplete="off" autofocus>
        <button type="submit">Validar ingresso</button>
      </form>
      ${r ? html`<p class="${r.key === 'ok' ? 'notice' : 'error'}" data-checkin-result="${r.key}">${r.message}</p>` : ''}`;
  },
});
