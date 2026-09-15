import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";

const app = express();

const CRM_SERVICE_URL =
    process.env.CRM_SERVICE_URL || "http://localhost:3002";

const ERP_SERVICE_URL =
    process.env.ERP_SERVICE_URL || "http://localhost:3003";

const FINANCE_SERVICE_URL =
    process.env.FINANCE_SERVICE_URL || "http://localhost:3004";


async function fetchComRetry(
    url: string,
    init: RequestInit = {},
    maxTentativas = 6
): Promise<Response> {

    let ultimoErro: unknown;

    for (
        let tentativa = 1;
        tentativa <= maxTentativas;
        tentativa++
    ) {
        try {
            const resposta = await fetch(url, {
                ...init,
                signal: AbortSignal.timeout(10000)
            });

            if (resposta.status < 500) {
                return resposta;
            }

            if (tentativa === maxTentativas) {
                return resposta;
            }

            console.log(
                `Tentativa ${tentativa}/${maxTentativas} para ${url} retornou ${resposta.status}`
            );

        } catch (erro) {
            ultimoErro = erro;

            console.log(
                `Tentativa ${tentativa}/${maxTentativas} falhou para ${url}`
            );

            if (tentativa === maxTentativas) {
                throw erro;
            }
        }

        await new Promise(resolve =>
            setTimeout(resolve, 5000)
        );
    }

    throw ultimoErro ?? new Error(
        `Não foi possível acessar ${url}`
    );
}
const PORT = process.env.PORT || 3005;

if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não configurada.");
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    return res.json({
        servico: "AI Service",
        status: "online"
    });
});

app.post("/assistente", async (req, res) => {
    try {
        const { pergunta } = req.body;

        if (
            !pergunta ||
            typeof pergunta !== "string" ||
            !pergunta.trim()
        ) {
            return res.status(400).json({
                erro: "A pergunta é obrigatória."
            });
        }

     const [
    respostaCRM,
    respostaERP,
    respostaFinanceiro
] = await Promise.all([
    fetchComRetry(`${CRM_SERVICE_URL}/oportunidades`),
    fetchComRetry(`${ERP_SERVICE_URL}/pedidos`),
    fetchComRetry(`${FINANCE_SERVICE_URL}/financeiro/resumo`)
]);

        if (
            !respostaCRM.ok ||
            !respostaERP.ok ||
            !respostaFinanceiro.ok
        ) {
            return res.status(503).json({
                erro: "Não foi possível consultar CRM, ERP ou Financeiro."
            });
        }

        const oportunidades = await respostaCRM.json();
        const pedidos = await respostaERP.json();
        const financeiro = await respostaFinanceiro.json();

        const contexto = {
            crm: {
                oportunidades
            },
            erp: {
                pedidos
            },
            financeiro
        };

        const respostaIA = await openai.responses.create({
            model: "gpt-5.6-luna",

            instructions: `
Você é o Assistente Empresarial do SmartFlow AI.

Responda sempre em português do Brasil.

Analise os dados reais fornecidos pelo SmartFlow.

Regras:
- Não invente clientes, valores, pedidos ou oportunidades.
- Quando a pergunta for sobre a empresa, use os dados fornecidos.
- Formate valores em reais.
- Seja objetivo e profissional.
- Destaque riscos, pendências e oportunidades quando forem relevantes.
- Se os dados forem insuficientes, diga claramente que não há informação suficiente.
            `.trim(),

            input: `
DADOS ATUAIS DO SMARTFLOW:

${JSON.stringify(contexto, null, 2)}

PERGUNTA DO USUÁRIO:

${pergunta}
            `.trim()
        });

        return res.json({
            pergunta,
            resposta: respostaIA.output_text
        });

    } catch (erro) {
        console.error("Erro no AI Service:", erro);

        return res.status(500).json({
            erro: "Erro interno ao consultar a IA."
        });
    }
});

app.listen(PORT, () => {
    console.log(`AI Service rodando na porta ${PORT}`);
});