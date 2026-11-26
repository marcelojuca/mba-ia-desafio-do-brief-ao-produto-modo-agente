import { Router } from 'express';
import { html } from './html.js';
import { render } from './layout.js';

// Placeholder da vitrine pública. F02 substitui por src/events/showcase.js.
export const homeRouter = Router();

homeRouter.get('/', (req, res) => {
  render(res, {
    title: 'Vitrine',
    body: html`<p>Nenhum evento à venda no momento</p>`,
  });
});
