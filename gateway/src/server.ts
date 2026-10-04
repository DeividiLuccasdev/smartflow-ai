import express, {
    type Request,
    type Response,
    type NextFunction
} from "express";

import cors from "cors";
import "dotenv/config";
import type { ClientRequest } from "node:http";
import {
    createProxyMiddleware,
    type Options
} from "http-proxy-middleware";

const app = express();

const PORT = process.env.PORT || 3000;

const AUTH_SERVICE_URL =
    process.env.AUTH_SERVICE_URL || "http://localhost:3001";

const CRM_SERVICE_URL =
    process.env.CRM_SERVICE_URL || "http://localhost:3002";

const ERP_SERVICE_URL =
    process.env.ERP_SERVICE_URL || "http://localhost:3003";

const FINANCE_SERVICE_URL =
    process.env.FINANCE_SERVICE_URL || "http://localhost:3004";

const AI_SERVICE_URL =
    process.env.AI_SERVICE_URL || "http://localhost:3005";

// Chave compartilhada com os microsserviços: só quem a conhece
// (o Gateway e os próprios serviços) consegue chamá-los.
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

if (!INTERNAL_API_KEY) {
    throw new Error("INTERNAL_API_KEY não configurada.");
}

const CABECALHO_CHAVE_INTERNA = "x-internal-key";
const CABECALHO_USUARIO_ID = "x-usuario-id";
const CABECALHO_USUARIO_PERFIL = "x-usuario-perfil";

const CABECALHOS_INTERNOS = [
    CABECALHO_CHAVE_INTERNA,
    CABECALHO_USUARIO_ID,
    CABECALHO_USUARIO_PERFIL
];


const servicosAtivos = new Map<string, number>();

// Evita várias requisições tentando acordar
// o mesmo microsserviço ao mesmo tempo.
const verificacoesEmAndamento =
    new Map<string, Promise<boolean>>();

const CACHE_SERVICO_MS = 10 * 60 * 1000;

const esperar = (ms: number) =>
    new Promise(resolve => setTimeout(resolve, ms));


function obterRetryAfterMs(resposta: globalThis.Response) {
    const valor = resposta.headers.get("retry-after");

    if (!valor) {
        return null;
    }

    const segundos = Number(valor);

    if (Number.isFinite(segundos)) {
        return segundos * 1000;
    }

    const data = Date.parse(valor);

    if (!Number.isNaN(data)) {
        return Math.max(data - Date.now(), 0);
    }

    return null;
}


async function verificarServico(
    url: string
): Promise<boolean> {

    const agora = Date.now();

    const ativoAte =
        servicosAtivos.get(url) || 0;

    if (agora < ativoAte) {
        return true;
    }


    // Se outra requisição já estiver acordando
    // este serviço, aguarda a mesma Promise.
    const verificacaoExistente =
        verificacoesEmAndamento.get(url);

    if (verificacaoExistente) {
        return verificacaoExistente;
    }


    const verificacao = (async () => {

        // No plano gratuito do Render um serviço adormecido pode levar
        // mais de 1 minuto para subir: até ~3 min de espera no total.
        const maxTentativas = 8;

        const atrasos = [
            2000,
            4000,
            6000,
            8000,
            10000
        ];
        const obterAtraso = (tentativa: number): number => {
    const indice = Math.min(
        tentativa - 1,
        atrasos.length - 1
    );

    return atrasos[indice] ?? 10000;
};

        for (
            let tentativa = 1;
            tentativa <= maxTentativas;
            tentativa++
        ) {

            try {

                const resposta = await fetch(
                    url,
                    {
                        headers: {
                            Accept: "application/json"
                        },

                        signal:
                            AbortSignal.timeout(20000)
                    }
                );


                // Serviço respondeu normalmente.
                if (
                    resposta.status < 500 &&
                    resposta.status !== 429
                ) {

                    servicosAtivos.set(
                        url,
                        Date.now() + CACHE_SERVICO_MS
                    );

                    console.log(
                        `Serviço disponível: ${url}`
                    );

                    return true;
                }


                // Evita martelar um serviço
                // que respondeu 429.
                if (resposta.status === 429) {

                    const retryAfter =
                        obterRetryAfterMs(resposta);

                    const espera =
                    retryAfter ??
                    obterAtraso(tentativa);

                    console.log(
                        `Serviço ${url} retornou 429. ` +
                        `Aguardando ${espera}ms.`
                    );

                    if (
                        tentativa <
                        maxTentativas
                    ) {
                        await esperar(espera);
                    }

                    continue;
                }


                console.log(
                    `Serviço ${url} iniciando ` +
                    `(${resposta.status}) - ` +
                    `tentativa ${tentativa}/${maxTentativas}`
                );

            } catch (erro) {

                console.log(
                    `Aguardando ${url} - ` +
                    `tentativa ${tentativa}/${maxTentativas}`
                );

            }

if (
    tentativa <
    maxTentativas
) {
const espera =
    obterAtraso(tentativa);

await new Promise((resolve) =>
    setTimeout(resolve, espera)
);

} // fecha o if

} // fecha o laço de tentativas

return false;

})();

verificacoesEmAndamento.set(
    url,
    verificacao
);

try {

    return await verificacao;

} finally {

    verificacoesEmAndamento.delete(url);

}

}


function aguardarServico(url: string) {

    return async (
        _req: Request,
        res: Response,
        next: NextFunction
    ) => {

        const disponivel =
            await verificarServico(url);

        if (disponivel) {
            return next();
        }

        res.setHeader(
            "Retry-After",
            "5"
        );

        return res.status(503).json({
            erro:
                "Serviço iniciando. Aguarde alguns segundos e tente novamente.",
            codigo:
                "SERVICE_STARTING"
        });
    };
}


async function autenticar(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const authorization = req.headers.authorization;

    if (!authorization) {
        return res.status(401).json({
            erro: "Token não informado."
        });
    }

    try {
        const resposta = await fetch(
            `${AUTH_SERVICE_URL}/perfil`,
            {
                method: "GET",
                headers: {
                    Authorization: authorization,
                    [CABECALHO_CHAVE_INTERNA]: INTERNAL_API_KEY
                }
            }
        );

        if (!resposta.ok) {
            return res.status(401).json({
                erro: "Token inválido ou expirado."
            });
        }

        const dados = await resposta.json() as {
            usuario?: {
                usuarioId?: number;
                perfil?: string;
            };
        };

        res.locals.usuario = dados.usuario;

        next();

    } catch (erro) {
        console.error(erro);

        return res.status(503).json({
            erro: "Serviço de autenticação indisponível."
        });
    }
}


function autorizarPerfis(...perfisPermitidos: string[]) {
    return (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        const perfil = res.locals.usuario?.perfil;

        if (!perfil || !perfisPermitidos.includes(perfil)) {
            return res.status(403).json({
                erro: "Acesso negado para este perfil."
            });
        }

        next();
    };
}


// Cria o proxy para um microsserviço, enviando a chave interna
// e os dados do usuário autenticado pelo Gateway.
function proxyPara(
    target: string,
    pathRewrite: Options<Request, Response>["pathRewrite"]
) {
    return createProxyMiddleware<Request, Response>({
        target,
        changeOrigin: true,
        ...(pathRewrite ? { pathRewrite } : {}),
        on: {
            proxyReq: (proxyReq: ClientRequest, _req, res) => {
                proxyReq.setHeader(
                    CABECALHO_CHAVE_INTERNA,
                    INTERNAL_API_KEY
                );

                const usuario = res.locals.usuario;

                if (usuario?.usuarioId !== undefined) {
                    proxyReq.setHeader(
                        CABECALHO_USUARIO_ID,
                        String(usuario.usuarioId)
                    );
                }

                if (usuario?.perfil) {
                    proxyReq.setHeader(
                        CABECALHO_USUARIO_PERFIL,
                        usuario.perfil
                    );
                }
            }
        }
    });
}


const URLS_SERVICOS = [
    AUTH_SERVICE_URL,
    CRM_SERVICE_URL,
    ERP_SERVICE_URL,
    FINANCE_SERVICE_URL,
    AI_SERVICE_URL
];

// Começa a acordar todos os microsserviços em paralelo, sem esperar.
// Assim, quando o usuário terminar o login, CRM, ERP, Financeiro e IA
// já estão subindo, em vez de acordarem um por vez a cada tela aberta.
function acordarTodos() {
    for (const url of URLS_SERVICOS) {
        void verificarServico(url).catch(() => false);
    }
}


app.use(cors());

// Chamado pelo frontend ao abrir a tela de login.
// No plano gratuito o Render pode responder 429 às chamadas que o
// Gateway faz para acordar os outros serviços, mas aceita as do
// navegador: por isso as URLs voltam para o frontend chamar também.
// Só a rota "/" de cada serviço é pública; o resto exige a chave interna.
app.get("/acordar", (_req, res) => {
    acordarTodos();

    return res.status(202).json({
        mensagem: "Acordando os serviços.",
        servicos: URLS_SERVICOS.filter((url) => url.startsWith("https://"))
    });
});

// Ignora cabeçalhos internos enviados pelo cliente:
// eles só podem ser definidos pelo próprio Gateway.
app.use((req, _res, next) => {
    for (const cabecalho of CABECALHOS_INTERNOS) {
        delete req.headers[cabecalho];
    }

    next();
});


// AUTH
app.use(
    "/auth",
    aguardarServico(AUTH_SERVICE_URL),
    proxyPara(AUTH_SERVICE_URL, {
        "^/auth": ""
    })
);


// CRM
app.use(
    "/crm",
    aguardarServico(AUTH_SERVICE_URL),
    aguardarServico(CRM_SERVICE_URL),
    autenticar,
    autorizarPerfis("ADMIN", "VENDEDOR", "ATENDENTE"),
    proxyPara(CRM_SERVICE_URL, {
        "^/crm": ""
    })
);


// ERP
app.use(
    "/erp",
    aguardarServico(AUTH_SERVICE_URL),
    aguardarServico(ERP_SERVICE_URL),
    autenticar,
    autorizarPerfis("ADMIN", "ATENDENTE"),
    proxyPara(ERP_SERVICE_URL, {
        "^/erp": ""
    })
);


// FINANCEIRO
app.use(
    "/financeiro",
    aguardarServico(AUTH_SERVICE_URL),
    aguardarServico(FINANCE_SERVICE_URL),
    autenticar,
    autorizarPerfis("ADMIN"),
    proxyPara(FINANCE_SERVICE_URL, (path) => {
        if (
            path === "/resumo" ||
            path.startsWith("/resumo?")
        ) {
            return `/financeiro${path}`;
        }

        return path;
    })
);


// IA
app.use(
    "/ia",
    aguardarServico(AUTH_SERVICE_URL),
    aguardarServico(AI_SERVICE_URL),
    autenticar,
    autorizarPerfis("ADMIN", "VENDEDOR"),
    proxyPara(AI_SERVICE_URL, {
        "^/ia": ""
    })
);


app.use(express.json());


app.get("/", (_req, res) => {
    return res.json({
        servico: "API Gateway",
        status: "online"
    });
});


app.listen(PORT, () => {
    console.log(`API Gateway rodando na porta ${PORT}`);

    // Se o Gateway acabou de acordar, os serviços quase certamente
    // também estão dormindo.
    acordarTodos();
});