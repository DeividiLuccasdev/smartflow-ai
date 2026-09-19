import express, {
    type Request,
    type Response,
    type NextFunction
} from "express";

import cors from "cors";
import "dotenv/config";
import { createProxyMiddleware } from "http-proxy-middleware";

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

        const maxTentativas = 6;

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
                            AbortSignal.timeout(12000)
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
                    Authorization: authorization
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


app.use(cors());


// AUTH
app.use(
    "/auth",
    aguardarServico(AUTH_SERVICE_URL),
    createProxyMiddleware({
        target: AUTH_SERVICE_URL,
        changeOrigin: true,
        pathRewrite: {
            "^/auth": ""
        }
    })
);


// CRM
app.use(
    "/crm",
    aguardarServico(AUTH_SERVICE_URL),
    aguardarServico(CRM_SERVICE_URL),
    autenticar,
    autorizarPerfis("ADMIN", "VENDEDOR", "ATENDENTE"),
    createProxyMiddleware({
        target: CRM_SERVICE_URL,
        changeOrigin: true,
        pathRewrite: {
            "^/crm": ""
        }
    })
);


// ERP
app.use(
    "/erp",
    aguardarServico(AUTH_SERVICE_URL),
    aguardarServico(ERP_SERVICE_URL),
    autenticar,
    autorizarPerfis("ADMIN", "ATENDENTE"),
    createProxyMiddleware({
        target: ERP_SERVICE_URL,
        changeOrigin: true,
        pathRewrite: {
            "^/erp": ""
        }
    })
);


// FINANCEIRO
app.use(
    "/financeiro",
    aguardarServico(AUTH_SERVICE_URL),
    aguardarServico(FINANCE_SERVICE_URL),
    autenticar,
    autorizarPerfis("ADMIN"),
    createProxyMiddleware({
        target: FINANCE_SERVICE_URL,
        changeOrigin: true,

        pathRewrite: (path) => {
            if (
                path === "/resumo" ||
                path.startsWith("/resumo?")
            ) {
                return `/financeiro${path}`;
            }

            return path;
        }
    })
);


// IA
app.use(
    "/ia",
    aguardarServico(AUTH_SERVICE_URL),
    aguardarServico(AI_SERVICE_URL),
    autenticar,
    autorizarPerfis("ADMIN", "VENDEDOR"),
    createProxyMiddleware({
        target: AI_SERVICE_URL,
        changeOrigin: true,
        pathRewrite: {
            "^/ia": ""
        }
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
});