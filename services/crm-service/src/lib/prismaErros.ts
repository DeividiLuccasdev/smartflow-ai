import type { Response } from "express";

import { Prisma } from "../generated/prisma/client.js";

// Erros do Prisma que representam conflito de dados, e não falha do
// servidor. Tratar aqui evita o padrão "consulta e depois cria", que
// tem corrida: a restrição do banco é a única checagem confiável.
//   P2002 → violou restrição única (ex.: SKU ou e-mail repetido)
//   P2003 → violou chave estrangeira (ex.: produto com pedidos)
//   P2025 → registro não encontrado (ex.: excluído por outra requisição)
type CodigoTratado = "P2002" | "P2003" | "P2025";

const STATUS_POR_CODIGO: Record<CodigoTratado, number> = {
    P2002: 409,
    P2003: 409,
    P2025: 404
};

const MENSAGEM_PADRAO: Record<CodigoTratado, string> = {
    P2002: "Já existe um registro com estes dados.",
    P2003: "O registro está vinculado a outros dados.",
    P2025: "Registro não encontrado."
};

export function codigoErroPrisma(erro: unknown): string | undefined {
    return erro instanceof Prisma.PrismaClientKnownRequestError
        ? erro.code
        : undefined;
}

// Responde o erro com o status HTTP adequado. Erros desconhecidos
// viram 500 com a mensagem genérica informada.
export function responderErro(
    res: Response,
    erro: unknown,
    mensagemInterna: string,
    mensagens: Partial<Record<CodigoTratado, string>> = {}
) {
    const codigo = codigoErroPrisma(erro);

    if (codigo && codigo in STATUS_POR_CODIGO) {
        const tratado = codigo as CodigoTratado;

        return res.status(STATUS_POR_CODIGO[tratado]).json({
            erro: mensagens[tratado] ?? MENSAGEM_PADRAO[tratado]
        });
    }

    console.error(erro);

    return res.status(500).json({
        erro: mensagemInterna
    });
}
