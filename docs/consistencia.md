# Consistência e concorrência

Este documento detalha como o SmartFlow AI evita estados inconsistentes quando há
requisições simultâneas, repetições pela rede ou um serviço fora do ar. O resumo
está na seção **Decisões técnicas** do [README](../README.md).

## Transições de status atômicas

Confirmar/cancelar pedido (ERP) e pagar/cancelar conta (Financeiro) usam
`UPDATE ... WHERE status = <esperado>` e conferem quantas linhas mudaram. Com duas
requisições ao mesmo tempo, só uma vence; o estoque de um pedido cancelado é
devolvido uma única vez.

## Outbox transacional (CRM → ERP e ERP → Financeiro)

Mudar o status no banco e avisar outro serviço por HTTP são duas operações
separadas. Se o serviço cair entre elas, ou o destino estiver fora do ar, os dois
lados ficam inconsistentes.

Por isso o evento é gravado na tabela `EventoOutbox` na **mesma transação** que muda
o status. Depois do commit, um relay (`src/lib/outbox.ts`, iniciado no `server.ts`
do CRM e do ERP) entrega o evento por HTTP:

- o evento é "alugado" por um prazo (`bloqueadoAte`) antes do envio, para que duas
  instâncias, ou o relay e uma entrega sob demanda, não o enviem ao mesmo tempo;
- só é marcado como enviado quando o destino responde 2xx;
- em caso de falha, tenta de novo com espera exponencial (limitada a 5 minutos) até
  um número máximo de tentativas;
- eventos do mesmo agregado (ex.: `pedido:12`) são entregues em ordem.

A entrega é "pelo menos uma vez", então os endpoints de integração são idempotentes:
`ContaReceber.pedidoId` e `Pedido.oportunidadeId` são únicos, e uma entrega repetida
não duplica conta nem pedido.

## Idempotency-Key

O frontend gera uma chave por ação (ex.: um clique em "Criar pedido") e só repete
automaticamente leituras ou requisições com chave. `POST /erp/pedidos` e os
cadastros do CRM guardam a resposta por chave (`src/lib/idempotencia.ts`):

| Situação | Resposta |
| --- | --- |
| mesma chave + mesmo corpo | resposta original guardada (cabeçalho `Idempotent-Replayed`) |
| mesma chave + corpo diferente | 422 |
| mesma chave ainda em execução | 409 (o cliente tenta de novo depois) |
| chave fora do formato (até 255 caracteres ASCII visíveis) | 400 |

A chave vale por usuário (cabeçalho `x-usuario-id`, definido pelo Gateway). Se a
requisição original travar, outra tentativa pode assumir a chave depois de um prazo.

## Concorrência otimista

Oportunidades têm o campo `versao`; editar a partir de uma versão antiga responde
409 em vez de sobrescrever. Oportunidade `GANHA` é final: não volta de status nem
muda de valor.

## Estoque

O estoque só muda por incremento/decremento atômico (`ajusteEstoque` no
`PUT /produtos/:id`), nunca por um valor absoluto lido antes. Ajustes que deixariam
o estoque negativo são recusados.

## Dinheiro em decimal

Totais são calculados com `Prisma.Decimal` e `SUM` no banco, sem aritmética de ponto
flutuante.

## Cenários cobertos por testes

Os testes de integração (Vitest + Supertest, PostgreSQL real) disparam as corridas
com `Promise.all`. Entre os cenários:

- **CRM** (`services/crm-service/test/crm.test.ts`): conversões simultâneas de um
  lead criam uma única oportunidade; a mesma Idempotency-Key não duplica cliente,
  lead ou oportunidade; e-mail duplicado em cadastros simultâneos gera um 201 e o
  resto 409; edições com versão antiga ou simultâneas não se sobrescrevem; marcar a
  oportunidade como ganha gera um único pedido no ERP, inclusive com o ERP fora do
  ar (o pedido sai depois pelo relay).
- **ERP** (`services/erp-service/test/pedidos.test.ts`): cancelamentos simultâneos
  devolvem o estoque uma única vez; confirmar e cancelar ao mesmo tempo terminam em
  estado consistente; confirmar duas vezes cria uma única conta a receber; com o
  Financeiro fora do ar a conta é criada depois pelo relay; SKU duplicado e ajustes
  de estoque simultâneos; entregas repetidas da mesma oportunidade criam um único
  pedido.
- **Financeiro** (`services/finance-service/test/financeiro.test.ts`): pagar e
  cancelar ao mesmo tempo, exatamente uma operação vence; pagar duas vezes é
  idempotente; entregas repetidas do mesmo pedido criam uma única conta; o resumo
  soma valores em decimal.
