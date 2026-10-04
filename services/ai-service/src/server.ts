import express from "express";
import cors from "cors";
import "dotenv/config";
import OpenAI from "openai";
import {
    CABECALHO_CHAVE_INTERNA,
    CHAVE_INTERNA,
    exigirChaveInterna
} from "./middlewares/chaveInterna.js";

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
            const headers = new Headers(init.headers);
            headers.set(CABECALHO_CHAVE_INTERNA, CHAVE_INTERNA);

            const resposta = await fetch(url, {
                ...init,
                headers,
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
app.use(exigirChaveInterna);
app.use(express.json());

app.get("/", (req, res) => {
    return res.json({
        servico: "AI Service",
        status: "online"
    });
});

// Dados que cada perfil pode consultar pela IA, seguindo as mesmas
// regras de acesso do Gateway (o CRM é liberado para todos que usam a IA).
const ACESSO_POR_PERFIL: Record<string, { erp: boolean; financeiro: boolean }> = {
    ADMIN: { erp: true, financeiro: true },
    VENDEDOR: { erp: false, financeiro: false }
};

async function lerJson(url: string) {
    const resposta = await fetchComRetry(url);

    if (!resposta.ok) {
        throw new Error(`Falha ao consultar ${url}: ${resposta.status}`);
    }

    return resposta.json();
}

app.post("/assistente", async (req, res) => {
    try {
        const { pergunta } = req.body ?? {};

        // Perfil do usuário autenticado, enviado pelo Gateway
        const perfil = req.header("x-usuario-perfil") ?? "";
        const acesso = ACESSO_POR_PERFIL[perfil];

        if (!acesso) {
            return res.status(403).json({
                erro: "Seu perfil não tem acesso ao assistente."
            });
        }

        if (
            !pergunta ||
            typeof pergunta !== "string" ||
            !pergunta.trim()
        ) {
            return res.status(400).json({
                erro: "A pergunta é obrigatória."
            });
        }

        let contexto: Record<string, unknown>;

        try {
            const [
                oportunidades,
                pedidos,
                financeiro
            ] = await Promise.all([
                lerJson(`${CRM_SERVICE_URL}/oportunidades`),
                acesso.erp
                    ? lerJson(`${ERP_SERVICE_URL}/pedidos`)
                    : null,
                acesso.financeiro
                    ? lerJson(`${FINANCE_SERVICE_URL}/financeiro/resumo`)
                    : null
            ]);

            contexto = {
                crm: {
                    oportunidades
                },
                ...(acesso.erp ? { erp: { pedidos } } : {}),
                ...(acesso.financeiro ? { financeiro } : {})
            };

        } catch (erro) {
            console.error(erro);

            return res.status(503).json({
                erro: "Não foi possível consultar os dados do SmartFlow."
            });
        }

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
- Você só recebe os módulos que o perfil do usuário pode acessar. Se a pergunta
  for sobre um módulo ausente nos dados, informe que o perfil não tem acesso a ele.
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