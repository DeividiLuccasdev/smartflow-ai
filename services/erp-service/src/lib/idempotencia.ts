import { createHash } from "node:crypto";

import type {
    NextFunction,
    Request,
    Response
} from "express";

import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { codigoErroPrisma } from "./prismaErros.js";

// Idempotency-Key: o cliente gera uma chave por ação (ex.: um clique em
// "Criar pedido") e a reenvia em todas as tentativas. Assim, se a resposta
// se perder na rede e o cliente repetir a requisição, o servidor devolve a
// resposta guardada em vez de criar o registro de novo.
//
//   mesma chave + mesmo corpo     → resposta guardada (Idempotent-Replayed)
//   mesma chave + corpo diferente → 422
//   mesma chave ainda em execução → 409 (o cliente tenta de novo depois)
//
// A chave vale por usuário (cabeçalho x-usuario-id, definido pelo Gateway).
export const CABECALHO_IDEMPOTENCIA = "idempotency-key";

// Se a requisição original travar (ex.: o processo caiu), outra tentativa
// pode assumir a chave depois deste prazo.
const PRAZO_EM_ANDAMENTO_MS = 60_000;

type EstadoIdempotencia = {
    id: number;
};

function hashRequisicao(req: Request) {
    return createHash("sha256")
        .update(`${req.method} ${req.baseUrl}${req.path}\n`)
        .update(JSON.stringify(req.body ?? null))
        .digest("hex");
}

function paraJson(corpo: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(corpo ?? null));
}

export async function idempotente(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const chave = req.header(CABECALHO_IDEMPOTENCIA);

    if (chave === undefined) {
        return next();
    }

    // Até 255 caracteres ASCII visíveis (ex.: um UUID)
    if (!/^[\x21-\x7e]{1,255}$/.test(chave)) {
        return res.status(400).json({
            erro: "Idempotency-Key inválida."
        });
    }

    const usuario = req.header("x-usuario-id") || "anonimo";
    const hash = hashRequisicao(req);

    try {
        let registroId: number;

        try {
            const registro = await prisma.chaveIdempotencia.create({
                data: {
                    usuario,
                    chave,
                    hash
                }
            });

            registroId = registro.id;

        } catch (erro) {
            if (codigoErroPrisma(erro) !== "P2002") {
                throw erro;
            }

            const existente = await prisma.chaveIdempotencia.findUnique({
                where: {
                    usuario_chave: {
                        usuario,
                        chave
                    }
                }
            });

            if (!existente) {
                // A tentativa anterior falhou e liberou a chave agora mesmo
                return res.status(409).set("Retry-After", "1").json({
                    erro: "Requisição em processamento. Tente novamente."
                });
            }

            if (existente.hash !== hash) {
                return res.status(422).json({
                    erro: "Esta Idempotency-Key já foi usada com outros dados."
                });
            }

            if (
                existente.status === "CONCLUIDA" &&
                existente.codigoResposta !== null
            ) {
                res.setHeader("Idempotent-Replayed", "true");

                return res
                    .status(existente.codigoResposta)
                    .json(existente.corpoResposta);
            }

            const assumida = await prisma.chaveIdempotencia.updateMany({
                where: {
                    id: existente.id,
                    status: "EM_ANDAMENTO",
                    atualizadoEm: {
                        lt: new Date(Date.now() - PRAZO_EM_ANDAMENTO_MS)
                    }
                },
                data: {
                    atualizadoEm: new Date()
                }
            });

            if (assumida.count === 0) {
                return res.status(409).set("Retry-After", "2").json({
                    erro: "Uma requisição com esta Idempotency-Key ainda está em processamento."
                });
            }

            registroId = existente.id;
        }

        const estado: EstadoIdempotencia = {
            id: registroId
        };

        res.locals.idempotencia = estado;

        // Guarda a resposta antes de enviá-la: uma nova tentativa que
        // chegue logo em seguida já encontra a resposta pronta.
        // Erros 5xx liberam a chave para que o cliente possa tentar de novo.
        const jsonOriginal = res.json.bind(res);
        let respondido = false;

        res.json = (corpo: unknown) => {
            if (respondido) {
                return jsonOriginal(corpo);
            }

            respondido = true;

            const status = res.statusCode;

            const gravacao = status >= 500
                ? prisma.chaveIdempotencia.deleteMany({
                    where: {
                        id: estado.id
                    }
                })
                : prisma.chaveIdempotencia.update({
                    where: {
                        id: estado.id
                    },
                    data: {
                        status: "CONCLUIDA",
                        codigoResposta: status,
                        corpoResposta: paraJson(corpo)
                    }
                });

            gravacao
                .catch((erro) => {
                    console.error("Falha ao gravar Idempotency-Key:", erro);
                })
                .finally(() => {
                    jsonOriginal(corpo);
                });

            return res;
        };

        return next();

    } catch (erro) {
        return next(erro);
    }
}

// Grava a resposta da chave dentro da mesma transação que criou o
// registro. Se o processo cair depois do commit e antes de responder,
// a nova tentativa recebe a resposta guardada e não duplica o registro.
export async function concluirIdempotencia(
    tx: Prisma.TransactionClient,
    res: Response,
    status: number,
    corpo: unknown
) {
    const estado = res.locals.idempotencia as EstadoIdempotencia | undefined;

    if (!estado) {
        return;
    }

    await tx.chaveIdempotencia.update({
        where: {
            id: estado.id
        },
        data: {
            status: "CONCLUIDA",
            codigoResposta: status,
            corpoResposta: paraJson(corpo)
        }
    });
}
