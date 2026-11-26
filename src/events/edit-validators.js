// Ganchos de validação da edição de evento (F02.P5).
//
//   registerEditValidator(async ({ client, event, next }) => null | 'mensagem de erro')
//
// - client: conexão da transação da edição (a linha do evento já está travada com FOR UPDATE);
// - event: linha atual do evento (antes da edição);
// - next: valores novos já validados por R01 { name, startsAt, venue, capacity, priceCents }.
// Retornar uma string rejeita a edição (422) com essa mensagem. Ex.: F03 registra a regra de lotação (R03).

const validators = [];

export function registerEditValidator(fn) {
  if (typeof fn !== 'function') throw new TypeError('registerEditValidator: fn precisa ser uma função');
  if (!validators.includes(fn)) validators.push(fn);
  return () => {
    const i = validators.indexOf(fn);
    if (i >= 0) validators.splice(i, 1);
  };
}

// Roda todos os validadores em ordem de registro; retorna a lista de mensagens de erro (vazia = ok).
export async function runEditValidators({ client, event, next }) {
  const messages = [];
  for (const fn of validators) {
    const result = await fn({ client, event, next });
    if (result) messages.push(String(result));
  }
  return messages;
}
