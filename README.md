# SmartFlow AI

Plataforma empresarial Full-Stack baseada em microsserviços, integrando CRM, ERP, Financeiro, autenticação, controle de usuários e Inteligência Artificial.

## 🌐 Demo Online

Acesse o SmartFlow AI em produção:

https://smartflow-ai-frontend.onrender.com

> ⏳ **O primeiro acesso pode demorar 1 minuto ou mais.** O projeto usa o plano gratuito do Render, que "adormece" os serviços após 15 minutos sem uso, e cada microsserviço acorda separadamente. Depois disso, tudo responde normalmente.

## Funcionalidades

- Dashboard empresarial
- Login com JWT
- Controle de acesso por perfil
- CRM de oportunidades
- ERP de pedidos
- Financeiro e contas a receber
- Integração CRM → ERP → Financeiro
- Assistente empresarial com IA
- Administração de usuários
- Ativação e desativação de contas
- API Gateway
- Inicialização automatizada

## Perfis

| Perfil | CRM | ERP | Financeiro | IA | Usuários |
|---|---|---|---|---|---|
| ADMIN | Sim | Sim | Sim | Sim | Sim |
| VENDEDOR | Sim | Não | Não | Sim | Não |
| ATENDENTE | Sim | Sim | Não | Não | Não |

## Arquitetura

Frontend React  
↓  
API Gateway :3000  
├── Auth Service :3001  
├── CRM Service :3002  
├── ERP Service :3003  
├── Finance Service :3004  
└── AI Service :3005  

Frontend: :5173

## Tecnologias

**Frontend:** React, TypeScript, Vite, React Router, CSS

**Backend:** Node.js, TypeScript, Express, Prisma ORM, PostgreSQL, JWT e bcrypt

**IA:** qualquer API compatível com a OpenAI (Groq, Gemini, OpenRouter ou OpenAI), integrada aos dados de CRM, ERP e Financeiro

### Configurando o assistente de IA

O provedor é definido por variáveis de ambiente do `ai-service`. Exemplo com o
plano gratuito do [Groq](https://console.groq.com):

    AI_API_KEY=sua_chave_groq
    AI_BASE_URL=https://api.groq.com/openai/v1
    AI_MODEL=openai/gpt-oss-120b

Para usar a OpenAI, deixe `AI_BASE_URL` vazio e informe um modelo da OpenAI em `AI_MODEL`.

**Infraestrutura:** Docker, Git, GitHub e GitHub Actions (typecheck de todos os serviços, lint e build do frontend)

## Segurança

- Autenticação JWT
- Autorização por perfil
- Senhas armazenadas com hash
- Microsserviços acessíveis somente pelo Gateway (chave interna `INTERNAL_API_KEY`)
- Usuários desativados perdem o acesso imediatamente
- Assistente de IA consulta apenas os módulos permitidos ao perfil do usuário
- Arquivos `.env` fora do Git

### Chave interna entre os serviços

Cada microsserviço recusa requisições que não tragam o cabeçalho `x-internal-key`
com o valor de `INTERNAL_API_KEY`. Só o Gateway e os próprios serviços conhecem
essa chave, então as URLs públicas dos serviços não podem ser usadas para
contornar o login. A rota `GET /` continua aberta, pois é usada para acordar os
serviços no Render.

Defina a **mesma** `INTERNAL_API_KEY` no `.env` do Gateway e de todos os serviços
(e nas variáveis de ambiente de cada serviço no Render). Para gerar uma chave:

    openssl rand -hex 32

## Consistência e concorrência

- **Transições de status atômicas**: confirmar/cancelar pedido e pagar/cancelar
  conta usam `UPDATE ... WHERE status = <esperado>` e conferem quantas linhas
  mudaram. Com duas requisições ao mesmo tempo, só uma vence; o estoque de um
  pedido cancelado é devolvido uma única vez.
- **Outbox transacional** (ERP → Financeiro e CRM → ERP): o evento é gravado na
  tabela `EventoOutbox` na mesma transação que muda o status. Um relay entrega o
  evento com novas tentativas (`src/lib/outbox.ts`); os endpoints de integração
  são idempotentes, então uma entrega repetida não duplica conta nem pedido.
- **Idempotency-Key**: o frontend gera uma chave por ação e só repete
  automaticamente leituras ou requisições com chave. `POST /erp/pedidos` e os
  cadastros do CRM guardam a resposta por chave (`src/lib/idempotencia.ts`):
  a mesma chave devolve a resposta original e, com outro corpo, responde 422.
- **Concorrência otimista**: oportunidades têm `versao`; editar a partir de uma
  versão antiga responde 409 em vez de sobrescrever. Oportunidade `GANHA` é final.
- **Estoque**: só muda por incremento/decremento atômico (`ajusteEstoque` no
  `PUT /produtos/:id`), nunca por um valor absoluto lido antes.
- **Dinheiro em decimal**: totais calculados com `Prisma.Decimal` e `SUM` no banco.

### Testes

Testes de integração (Vitest + Supertest) contra um PostgreSQL real, cobrindo as
corridas com `Promise.all`. Em cada serviço (`crm`, `erp`, `finance`):

    $env:DATABASE_URL="postgresql://usuario:senha@localhost:5432/banco_de_teste"
    npx prisma migrate deploy
    npm test

Os testes apagam os dados do banco informado: use um banco só para testes.

## Executando

Suba os bancos de dados (Auth, CRM, ERP e Financeiro):

    docker compose -f infra/docker-compose.yml up -d

Crie os arquivos `.env` a partir dos `.env.example` de cada pasta e aplique as migrações
em cada serviço com `npm run migrate`. Depois:

    .\SmartFlow.bat

Ou:

    powershell -ExecutionPolicy Bypass -File .\start-smartflow.ps1

Acesse:

    http://localhost:5173

## Estrutura

    smartflow-ai/
    ├── frontend/
    ├── gateway/
    ├── infra/
    ├── services/
    │   ├── ai-service/
    │   ├── auth-service/
    │   ├── crm-service/
    │   ├── erp-service/
    │   └── finance-service/
    ├── SmartFlow.bat
    └── start-smartflow.ps1

## Status

MVP funcional.

## Autor

**Deividi Luccas**  
Desenvolvedor Full-Stack  
GitHub: DeividiLuccasdev

## Demonstração

### Dashboard

![Dashboard do SmartFlow AI](docs/images/dashboard.png)

### CRM

![CRM do SmartFlow AI](docs/images/crm.png)

### ERP

![ERP do SmartFlow AI](docs/images/erp.png)

### Financeiro

![Financeiro do SmartFlow AI](docs/images/financeiro.png)

### Assistente IA

![Assistente IA do SmartFlow AI](docs/images/ia.png)

### Administração de usuários

![Gerenciamento de usuários do SmartFlow AI](docs/images/usuarios.png)


### Login

![Login do SmartFlow AI](docs/images/login.png)

