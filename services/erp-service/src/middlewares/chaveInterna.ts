import { timingSafeEqual } from "node:crypto";

import type {
    Request,
    Response,
    NextFunction
} from "express";

// Chave compartilhada entre o Gateway e os microsserviços.
// Sem ela, qualquer pessoa poderia chamar o serviço direto pela URL pública,
// sem passar pela autenticação do Gateway.
export const CHAVE_INTERNA = process.env.INTERNAL_API_KEY ?? "";

if (!CHAVE_INTERNA) {
    throw new Error("INTERNAL_API_KEY não configurada.");
}

export const CABECALHO_CHAVE_INTERNA = "x-internal-key";

export function cabecalhosInternos(): Record<string, string> {
    return {
        [CABECALHO_CHAVE_INTERNA]: CHAVE_INTERNA
    };
}

function chavesIguais(recebida: string, esperada: string) {
    const a = Buffer.from(recebida);
    const b = Buffer.from(esperada);

    return a.length === b.length && timingSafeEqual(a, b);
}

// Libera apenas a rota "/" (usada para acordar o serviço);
// todas as outras exigem a chave interna.
export function exigirChaveInterna(
    req: Request,
    res: Response,
    next: NextFunction
) {
    if (req.method === "GET" && req.path === "/") {
        return next();
    }

    const recebida = req.header(CABECALHO_CHAVE_INTERNA);

    if (!recebida || !chavesIguais(recebida, CHAVE_INTERNA)) {
        return res.status(403).json({
            erro: "Acesso permitido somente através do API Gateway."
        });
    }

    next();
}
