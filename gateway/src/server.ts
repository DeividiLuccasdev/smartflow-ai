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


app.use(
    "/auth",
    createProxyMiddleware({
        target: AUTH_SERVICE_URL,
        changeOrigin: true,
        pathRewrite: {
            "^/auth": ""
        }
    })
);


app.use(
    "/crm",
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


app.use(
    "/erp",
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


app.use(
    "/financeiro",
    autenticar,
    autorizarPerfis("ADMIN"),
    createProxyMiddleware({
        target: FINANCE_SERVICE_URL,
        changeOrigin: true,

        pathRewrite: (path) => {
            if (path === "/resumo" || path.startsWith("/resumo?")) {
                return `/financeiro${path}`;
            }

            return path;
        }
    })
);


app.use(
    "/ia",
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


app.get("/", (req, res) => {
    return res.json({
        servico: "API Gateway",
        status: "online"
    });
});


app.listen(PORT, () => {
    console.log(`API Gateway rodando na porta ${PORT}`);
});


