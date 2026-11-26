// Seções extras da página de gestão do evento (F02.P3).
//
//   registerManagementSection({ id: 'panel', order: 10, render: async ({ event, req, flash }) => html`...` })
//
// - id: identificador único (registrar de novo o mesmo id substitui a seção);
// - order: posição (menor primeiro); as seções aparecem depois dos dados/edição do evento;
// - render: retorna SafeHtml (html``), string já escapada ou null/'' para não mostrar nada.
//   Recebe o evento (linha de events), a requisição e a mensagem de aviso exibida na página (ou null).
// Ordens usadas: painel (F05) 10, check-in (F05) 20, cancelamento (F06) 90.

const sections = new Map();

export function registerManagementSection({ id, order = 50, render }) {
  if (!id || typeof render !== 'function') {
    throw new TypeError('registerManagementSection: id e render são obrigatórios');
  }
  sections.set(id, { id, order: Number(order) || 0, render });
}

export function listManagementSections() {
  return [...sections.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
