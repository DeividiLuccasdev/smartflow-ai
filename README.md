<div align="center">

# SmartFlow AI

**Plataforma empresarial em microsserviços: CRM, ERP, Financeiro e um assistente de IA sobre os mesmos dados.**

[![CI](https://github.com/DeividiLuccasdev/smartflow-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/DeividiLuccasdev/smartflow-ai/actions/workflows/ci.yml)
![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)](LICENSE)

[**Demo ao vivo**](https://smartflow-ai-frontend.onrender.com) · [Consistência e concorrência](docs/consistencia.md) · [Portfólio](https://portfolio-deividi.vercel.app/)

**Acesso de demonstração** · e-mail `demo@example.com` · senha `Demo@2026`

<img src="docs/images/dashboard.png" alt="Dashboard do SmartFlow AI" width="900">

</div>

> Projeto de portfólio. A demo roda no plano gratuito do Render, que adormece os serviços após 15 minutos sem uso, e cada microsserviço acorda separadamente: **o primeiro acesso pode levar 1 minuto ou mais**. Depois disso, tudo responde normalmente.

## Sobre

O SmartFlow AI reúne os módulos que uma empresa pequena usa no dia a dia (vendas, pedidos e contas a receber) em serviços independentes, cada um com seu próprio banco, atrás de um API Gateway. Uma oportunidade ganha no CRM vira pedido no ERP, e o pedido confirmado vira conta a receber no Financeiro.

O foco está no que costuma quebrar quando sistemas conversam entre si: **cliques repetidos, requisições simultâneas e um serviço fora do ar no meio do fluxo**. A integração usa outbox transacional, endpoints idempotentes e transições de status atômicas, cobertas por testes contra um PostgreSQL real.

## Funcionalidades

| | |
| --- | --- |
| **CRM** | Clientes, leads, conversão de lead em oportunidade e funil de vendas. |
| **ERP** | Produtos com controle de estoque e pedidos com confirmação e cancelamento. |
| **Financeiro** | Contas a receber geradas a partir dos pedidos, pagamento, cancelamento e resumo. |
| **Integração CRM → ERP → Financeiro** | Oportunidade ganha gera pedido; pedido confirmado gera conta; cancelamento é propagado. |
| **Assistente com IA** | Responde perguntas sobre os dados de CRM, ERP e Financeiro, limitado aos módulos que o perfil pode ver. |
| **Usuários e perfis** | Login com JWT, controle de acesso por perfil, cadastro, ativação e desativação de contas. |
| **API Gateway** | Ponto único de entrada: autentica, autoriza por perfil e repassa aos serviços. |
| **Inicialização automatizada** | Script que sobe Docker, bancos, serviços e frontend no Windows. |

### Perfis

| Perfil | CRM | ERP | Financeiro | IA | Usuários |
| --- | --- | --- | --- | --- | --- |
| ADMIN | Sim | Sim | Sim | Sim | Sim |
| VENDEDOR | Sim | Não | Não | Sim | Não |
| ATENDENTE | Sim | Sim | Não | Não | Não |

<table>
  <tr>
    <td width="50%"><img src="docs/images/crm.png" alt="CRM do SmartFlow AI"></td>
    <td width="50%"><img src="docs/images/erp.png" alt="ERP do SmartFlow AI"></td>
  </tr>
  <tr>
    <td align="center"><sub>CRM</sub></td>
    <td align="center"><sub>ERP</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/financeiro.png" alt="Financeiro do SmartFlow AI"></td>
    <td width="50%"><img src="docs/images/ia.png" alt="Assistente IA do SmartFlow AI"></td>
  </tr>
  <tr>
    <td align="center"><sub>Financeiro</sub></td>
    <td align="center"><sub>Assistente IA</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/usuarios.png" alt="Gerenciamento de usuários do SmartFlow AI"></td>
    <td width="50%"><img src="docs/images/login.png" alt="Login do SmartFlow AI"></td>
  </tr>
  <tr>
    <td align="center"><sub>Administração de usuários</sub></td>
    <td align="center"><sub>Login</sub></td>
  </tr>
</table>

## Arquitetura

```mermaid
flowchart LR
    UI["Frontend React<br/>:5173"] -->|HTTPS + JWT| GW["API Gateway :3000<br/>autenticação · perfis"]
    GW -->|x-internal-key| AUTH["Auth :3001"]
    GW --> CRM["CRM :3002"]
    GW --> ERP["ERP :3003"]
    GW --> FIN["Financeiro :3004"]
    GW --> AI["IA :3005"]
    AUTH --- DBA[("auth-db")]
    CRM --- DBC[("crm-db")]
    ERP --- DBE[("erp-db")]
    FIN --- DBF[("finance-db")]
    CRM -->|outbox| ERP
    ERP -->|outbox| FIN
    AI -->|leitura| CRM & ERP & FIN
    AI --> LLM["Provedor compatível<br/>com a OpenAI"]
```

O Gateway valida o token consultando o Auth Service a cada requisição, confere o perfil e repassa a chamada com os cabeçalhos internos (`x-internal-key`, `x-usuario-id`, `x-usuario-perfil`). Cabeçalhos internos enviados pelo cliente são descartados.

## Decisões técnicas

- **Um banco por serviço.** Cada módulo evolui seu esquema e suas migrações (Prisma) sem acoplar os outros; a integração acontece só por HTTP.
- **Outbox transacional em vez de chamada HTTP direta.** O evento é gravado na mesma transação que muda o status; um relay entrega com novas tentativas e só marca como enviado após 2xx. Se o ERP ou o Financeiro estiver dormindo, nada se perde. Como a entrega é "pelo menos uma vez", os endpoints de integração são idempotentes por restrição única (`Pedido.oportunidadeId`, `ContaReceber.pedidoId`).
- **Transições de status atômicas.** Confirmar/cancelar pedido e pagar/cancelar conta usam `UPDATE ... WHERE status = <esperado>` e conferem quantas linhas mudaram: com duas requisições ao mesmo tempo, só uma vence, e o estoque de um pedido cancelado é devolvido uma única vez.
- **Idempotency-Key nas criações.** O frontend gera uma chave por ação e só repete automaticamente leituras ou requisições com chave. `POST /erp/pedidos` e os cadastros do CRM guardam a resposta por chave: a mesma chave devolve a resposta original e, com outro corpo, responde 422.
- **Concorrência otimista.** Oportunidades têm `versao`; editar a partir de uma versão antiga responde 409 em vez de sobrescrever. Oportunidade `GANHA` é final.
- **Estoque por ajuste, não por valor absoluto.** O estoque só muda por incremento/decremento atômico (`ajusteEstoque` no `PUT /produtos/:id`), nunca por um valor lido antes.
- **Dinheiro em decimal.** Totais com `Prisma.Decimal` e `SUM` no banco.
- **Serviços fechados atrás do Gateway.** Cada microsserviço recusa requisições sem o cabeçalho `x-internal-key` com o valor de `INTERNAL_API_KEY`, então as URLs públicas dos serviços não servem para contornar o login. Só `GET /` fica aberta, usada para acordar os serviços no Render.
- **Usuário desativado perde o acesso na hora.** O Auth Service consulta o banco a cada requisição autenticada, então desativação e mudança de perfil valem sem esperar o token expirar.
- **IA com o mesmo escopo do perfil.** O AI Service só busca os dados dos módulos que o perfil pode acessar e limita a quantidade de registros enviados ao modelo.
- **Acordar o Render em paralelo.** Ao abrir a tela de login, o Gateway começa a acordar todos os serviços ao mesmo tempo e responde 503 com `Retry-After` enquanto um serviço ainda está subindo.

Detalhes e cenários cobertos: [docs/consistencia.md](docs/consistencia.md).

## Stack

| Camada | Tecnologias |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router, CSS, oxlint |
| Backend | Node.js, TypeScript, Express 5, Prisma ORM 7, PostgreSQL 16 |
| Autenticação | JWT (`jsonwebtoken`), senhas com hash bcrypt (`bcryptjs`) |
| Gateway | Express + `http-proxy-middleware` |
| IA | SDK `openai`, com qualquer API compatível (Groq, Gemini, OpenRouter ou OpenAI) |
| Testes | Vitest + Supertest contra PostgreSQL real |
| Infra | Docker Compose (bancos), GitHub Actions, Render |

## Como rodar

Pré-requisitos: Node.js 22, Docker Desktop e Windows (os scripts de inicialização são PowerShell/BAT).

1. Suba os bancos (Auth, CRM, ERP e Financeiro, nas portas 5433 a 5436):

    ```bash
    docker compose -f infra/docker-compose.yml up -d
    ```

2. Em cada pasta (`frontend`, `gateway` e `services/*`), crie o `.env` a partir do `.env.example` e instale as dependências com `npm install`. Nos serviços com banco (`auth`, `crm`, `erp`, `finance`), aplique as migrações com `npm run migrate`.

3. Defina a **mesma** `INTERNAL_API_KEY` no `.env` do Gateway e de todos os serviços (e nas variáveis de ambiente de cada serviço no Render). Para gerar uma chave:

    ```bash
    openssl rand -hex 32
    ```

4. Inicie tudo:

    ```powershell
    .\SmartFlow.bat
    # ou
    powershell -ExecutionPolicy Bypass -File .\start-smartflow.ps1
    ```

    Também é possível rodar `npm run dev` em cada pasta.

5. Acesse http://localhost:5173.

### Variáveis de ambiente

| Pasta | Variáveis |
| --- | --- |
| `frontend` | `VITE_API_URL` |
| `gateway` | `PORT`, `AUTH_SERVICE_URL`, `CRM_SERVICE_URL`, `ERP_SERVICE_URL`, `FINANCE_SERVICE_URL`, `AI_SERVICE_URL`, `INTERNAL_API_KEY` |
| `services/auth-service` | `PORT`, `DATABASE_URL`, `JWT_SECRET`, `INTERNAL_API_KEY`, `CRIAR_USUARIO_DEMO` (opcional) |
| `services/crm-service` | `PORT`, `DATABASE_URL`, `ERP_SERVICE_URL`, `INTERNAL_API_KEY` |
| `services/erp-service` | `PORT`, `DATABASE_URL`, `FINANCE_SERVICE_URL`, `INTERNAL_API_KEY` |
| `services/finance-service` | `PORT`, `DATABASE_URL`, `INTERNAL_API_KEY` |
| `services/ai-service` | `PORT`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `CRM_SERVICE_URL`, `ERP_SERVICE_URL`, `FINANCE_SERVICE_URL`, `INTERNAL_API_KEY` |

### Configurando o assistente de IA

O provedor é definido por variáveis de ambiente do `ai-service`. Exemplo com o plano gratuito do [Groq](https://console.groq.com):

```env
AI_API_KEY=sua_chave_groq
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=openai/gpt-oss-120b
```

Para usar a OpenAI, deixe `AI_BASE_URL` vazio e informe um modelo da OpenAI em `AI_MODEL`.

## Testes

São 37 testes de integração (Vitest + Supertest) contra um PostgreSQL real, cobrindo as corridas com `Promise.all`: 13 no CRM, 18 no ERP e 6 no Financeiro. Em cada serviço (`crm`, `erp`, `finance`):

```powershell
$env:DATABASE_URL="postgresql://usuario:senha@localhost:5432/banco_de_teste"
npx prisma migrate deploy
npm test
```

Os testes apagam os dados do banco informado: use um banco só para testes.

O CI (GitHub Actions) roda o typecheck de todos os serviços e do Gateway, os testes de integração do CRM, ERP e Financeiro contra um PostgreSQL 16 de serviço, os testes unitários do Auth (proteção e seed da conta demo), e o lint e o build do frontend.

## Estrutura

```text
smartflow-ai/
├── frontend/              # React + Vite (páginas em src/pages, cliente HTTP em src/services)
├── gateway/               # API Gateway: autenticação, perfis e proxy
├── infra/                 # docker-compose com os quatro PostgreSQL
├── services/
│   ├── ai-service/        # assistente de IA
│   ├── auth-service/      # usuários, login e JWT
│   ├── crm-service/       # clientes, leads, oportunidades e funil
│   ├── erp-service/       # produtos, estoque e pedidos
│   └── finance-service/   # contas a receber e resumo
├── docs/                  # documentação e capturas de tela
├── SmartFlow.bat
└── start-smartflow.ps1
```

Nos serviços com banco, `prisma/` guarda o esquema e as migrações e `src/` as rotas e os middlewares. CRM e ERP têm `src/lib/` com outbox e idempotência; Auth, CRM, ERP e Financeiro têm `test/`.

## Limitações conhecidas

- A conta de demonstração (perfil ADMIN, para mostrar todos os módulos) é criada ou restaurada pelo Auth Service a cada deploy no Render, após as migrações. Ela não pode ser desativada nem alterada. Localmente ela não é criada: para o primeiro ADMIN, inicie o Auth com `CRIAR_USUARIO_DEMO=true` ou insira o usuário direto no banco, já que `POST /usuarios` exige um ADMIN autenticado.
- Os dados da demo são compartilhados: qualquer visitante pode criar, editar ou cancelar registros, então o que você vê pode ter sido alterado por outra pessoa.
- Os scripts `SmartFlow.bat` e `start-smartflow.ps1` usam o caminho fixo `C:\smartflow-ai` e só iniciam os contêineres de Auth, CRM e ERP; o banco do Financeiro precisa estar no ar pelo `docker compose`.
- Só os bancos rodam em Docker; os serviços Node rodam direto na máquina.
- Gateway, IA e frontend ainda não têm testes automatizados; o Auth tem só testes unitários.
- Não há rate limit no Gateway, e o token JWT fica no `localStorage` do navegador.

## Roadmap

- [x] Seed com usuário administrador inicial (conta de demonstração)
- [ ] Scripts de inicialização independentes do caminho de instalação
- [ ] Dockerfile por serviço e `docker compose` com a aplicação completa
- [ ] Testes para Gateway e IA (e de integração no Auth)
- [ ] Rate limit no Gateway

## Autor

**Deividi Luccas** · Desenvolvedor Full-Stack · [Portfólio](https://portfolio-deividi.vercel.app/) · [GitHub](https://github.com/DeividiLuccasdev)

## Licença

[MIT](LICENSE)
