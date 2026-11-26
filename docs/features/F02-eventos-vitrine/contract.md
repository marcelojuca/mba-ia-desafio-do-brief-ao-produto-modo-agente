# Contrato F02 — Eventos do organizador e vitrine

## Pré-requisitos

- Ambiente de pé com `./scripts/up.sh` (seed de F01 carregada); `$WEB = http://localhost:${PORT:-3000}`.
- Sessões obtidas via `POST /login` (cookie `catraca_session`) para `org.a@catraca.dev`, `org.b@catraca.dev`, `participante@catraca.dev` (senha `catraca123`).
- Datas futuras: usar o mês seguinte ao da execução; data passada: ontem.

## Quality gates

- `./scripts/gates.sh` — exit 0, inclui testes de eventos.

## Mapeamento critério → itens

| Critério PRD | Itens |
|---|---|
| F02-AC01 | EVT-CREATE-01, EVT-CREATE-02, EVT-CREATE-03, EVT-EDIT-02 |
| F02-AC02 | EVT-DRAFT-01, EVT-PUBLISH-01 |
| F02-AC03 | EVT-MGMT-01 |
| F02-AC04 | ACL-LIST-01, ACL-DIRECT-01, ACL-ROLE-01 |
| F02-AC05 | EVT-EDIT-01 |
| CF-01 (F01→F02) | CF01-SEED-ORGS-01, ACL-ROLE-01 |

## Itens

### CF01-SEED-ORGS-01 — organizadores da seed chegam à própria área
- quando: login de A e de B (seed F01) e `GET /organizer` com cada cookie
- então: 200 com a lista de eventos ("Meus eventos") e o nome do organizador no cabeçalho.

### EVT-CREATE-01 — criação válida nasce rascunho
- quando: como A, `POST /organizer/events` com `name=E1`, `startsAt=<mês seguinte>T21:00`, `venue=Bar do Zé`, `capacity=2`, `price=100,00`
- então: 302 para `/organizer/events/evt_...`; a página de gestão mostra "E1", "Rascunho", "R$ 100,00", lotação 2.

### EVT-CREATE-02 — data no passado rejeitada na criação
- quando: como A, criar com `startsAt` = ontem
- então: 422 com "A data de início precisa estar no futuro"; nenhum evento novo na lista de A.

### EVT-CREATE-03 — validação de lotação e preço
- quando: criar com `capacity=0`, depois `capacity=1.5`, depois `price=0`, depois `name` vazio
- então: cada um 422 com mensagem do campo; nenhum evento criado.

### EVT-DRAFT-01 — rascunho fora da vitrine
- quando: deslogado, `GET /` após EVT-CREATE-01
- então: o HTML não contém "E1".

### EVT-PUBLISH-01 — publicado aparece na vitrine
- quando: como A, `POST /organizer/events/:id/publish`; deslogado `GET /`
- então: a página de gestão mostra "Publicado"; a vitrine contém "E1", a data e "R$ 100,00"; publicar de novo → 409.

### EVT-MGMT-01 — página de gestão com URL própria
- quando: `GET /organizer/events/:id` como A
- então: 200 com formulário de edição e botão de publicar (rascunho) na URL do evento; outro evento de A tem outra URL e outros dados.

### EVT-EDIT-01 — editar preço e aumentar lotação
- quando: como A, `POST /organizer/events/:id` com `price=150,00` e `capacity=3` (demais campos iguais, data futura)
- então: 303/302 de volta para a gestão; página mostra "R$ 150,00" e lotação 3.

### EVT-EDIT-02 — data no passado rejeitada na edição
- quando: editar com `startsAt` = ontem
- então: 422 com "A data de início precisa estar no futuro"; dados do evento inalterados.

### ACL-LIST-01 — lista só com os próprios eventos
- quando: como B, `GET /organizer`
- então: não contém "E1" nem o id de E1.

### ACL-DIRECT-01 — URL direta de evento de outro organizador
- quando: como B, `GET`, `POST` (edição) e `POST .../publish` em `/organizer/events/<id de E1>`
- então: 404 "Evento não encontrado"; a resposta não contém nome, local, preço nem lotação de E1; E1 continua inalterado.

### ACL-ROLE-01 — participante e visitante fora da área
- quando: como participante da seed `GET /organizer` e `GET /organizer/events/<id de E1>`; deslogado o mesmo
- então: participante → 403 "Acesso negado" sem dados de E1; visitante → 302 para `/login`.
