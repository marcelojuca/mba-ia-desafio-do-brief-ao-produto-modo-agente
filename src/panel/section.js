import { html, formatBRL } from '../web/html.js';
import { registerManagementSection } from '../events/management-sections.js';
import { getPanelMetrics } from './service.js';

// Seção "Painel" da página de gestão (F05.P2): um <dd data-metric="..."> por número.
registerManagementSection({
  id: 'panel',
  order: 10,
  render: async ({ event }) => {
    const m = await getPanelMetrics(event.id);
    return html`
      <h2>Painel</h2>
      <dl data-panel>
        <dt>Confirmados</dt><dd data-metric="confirmed">${m.confirmed}</dd>
        <dt>Pendentes</dt><dd data-metric="pending">${m.pending}</dd>
        <dt>Check-ins</dt><dd data-metric="checkins">${m.checkins}</dd>
        <dt>Vagas disponíveis</dt><dd data-metric="available">${m.available}</dd>
        <dt>Receita</dt><dd data-metric="revenue">${formatBRL(m.revenueCents)}</dd>
        <dt>Estornados</dt><dd data-metric="refunded">${m.refunded}</dd>
      </dl>`;
  },
});
