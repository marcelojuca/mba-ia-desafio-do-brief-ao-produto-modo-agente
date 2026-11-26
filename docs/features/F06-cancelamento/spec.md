# Spec F06 — Cancelamento de evento

PRD: `docs/PRD.md` § F06. Critérios: F06-AC01..AC04, CF-09, CF-10. Regras: R02, R05, R08, R11, R13.
Base: F02 (gestão, guard, status do evento, bloqueio de edição de cancelado) e F03 (tickets, worker com guarda `status='pending'`, `getAvailability` com cancelado = 0).
Wave 4 (paralela a F04 e F05): não depende delas.

## Migração `0006_event_cancellation.sql`
```sql
alter table events add column cancelled_at timestamptz;
```

## Serviço `src/cancellation/service.js`

`cancelEvent(eventId, organizerId)` numa transação:
1. `SELECT * FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE` — mesmo lock da compra (F03) e da edição (F02): nenhuma compra entra depois do cancelamento.
2. `status <> 'published'` → erro `not_cancellable` (rascunho ou já cancelado).
3. `UPDATE events SET status = 'cancelled', cancelled_at = now(), updated_at = now()`.
4. **Uma única** instrução para os ingressos:
   ```sql
   update tickets
      set status = case status when 'confirmed' then 'refunded' else 'cancelled' end,
          updated_at = now()
    where event_id = $1 and status in ('pending','confirmed')
   ```
   Em `READ COMMITTED`, se o worker do gateway estiver confirmando um pendente ao mesmo tempo, esta instrução espera o lock da linha, reavalia com o valor novo e o `CASE` escolhe o destino certo (confirmado → estornado). Duas instruções separadas teriam uma janela em que um pendente vira confirmado depois do passo "confirmados → estornados" e escapa.
5. `COMMIT`. As transições acontecem na mesma requisição (bem abaixo dos 10 s de R11).

Resposta tardia do gateway: o worker de F03 só atualiza `WHERE status = 'pending'`; depois do cancelamento nenhum ingresso do evento está pendente, então nada muda.

## Interface

- Seção `registerManagementSection({ id: 'cancel', order: 90 })`: em evento `published`, formulário `POST /organizer/events/:id/cancel` com botão "Cancelar evento" e aviso de que é irreversível (sem `confirm()` em JS). Em `draft` a seção não aparece. Em `cancelled` mostra "Evento cancelado em <data>".
- `POST /organizer/events/:id/cancel` (`requireRole('organizer')` + `loadOwnedEvent`): sucesso → 303 para a gestão com aviso "Evento cancelado"; `not_cancellable` → 409 com mensagem.
- A página de gestão de evento cancelado (F02) já não mostra formulário de edição nem "Publicar"; `POST` de edição/publicação → 409 (F02). F06 verifica isso de ponta a ponta.
- Vitrine (F02/F03) e listagem da API (F04) filtram `status='published'`, então o evento some sem código novo; compra → `event_not_available`.

## Testes
`test/cancellation.test.js`: só publicado cancela (rascunho e cancelado → 409); transições confirmado/pendente/recusado (recusado não muda); resposta tardia do worker não altera (cancelar com tentativa pendente e rodar `processDueAttempts` depois); corrida worker × cancelamento (aprovação e cancelamento simultâneos repetidos 20× → nunca sobra `confirmed`/`pending`); compra após cancelamento → `event_not_available`; vagas = 0; edição/publicação após cancelamento → 409; B não cancela evento de A (404, evento continua publicado).
