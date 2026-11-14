import express from "express";
import cors from "cors";
import "dotenv/config";

import { prisma } from "./config/prisma.js";
import { Prisma } from "./generated/prisma/client.js";
import { exigirChaveInterna } from "./middlewares/chaveInterna.js";
import {
    codigoErroPrisma,
    responderErro
} from "./lib/prismaErros.js";

export const app = express();

app.use(cors());
app.use(exigirChaveInterna);
app.use(express.json());

function lerId(valor: unknown) {
    const id = Number(valor);

    return Number.isInteger(id) && id > 0 ? id : null;
}

function lerDecimal(valor: unknown) {
    if (
        (typeof valor !== "number" && typeof valor !== "string") ||
        valor === ""
    ) {
        return null;
    }

    try {
        const decimal = new Prisma.Decimal(valor);

        return decimal.isFinite() ? decimal : null;
    } catch {
        return null;
    }
}

// As transições de status da conta são condicionais
// (UPDATE ... WHERE status = 'PENDENTE'). Se "pagar" e "cancelar" chegarem
// ao mesmo tempo, o banco serializa as duas e só a primeira altera a linha;
// a outra vê count = 0 e responde de acordo com o status final.
type StatusConta = "PENDENTE" | "PAGO" | "CANCELADO";

async function transicionarPendente(
    where: Prisma.ContaReceberWhereInput,
    novoStatus: Exclude<StatusConta, "PENDENTE">
) {
    const transicao = await prisma.contaReceber.updateMany({
        where: {
            ...where,
            status: "PENDENTE"
        },
        data: {
            status: novoStatus
        }
    });

    const conta = await prisma.contaReceber.findFirst({
        where
    });

    return {
        alterou: transicao.count > 0,
        conta
    };
}

app.get("/", (req, res) => {
    return res.json({
        servico: "Finance Service",
        status: "online"
    });
});

app.get("/contas-receber", async (req, res) => {
    try {
        const contas = await prisma.contaReceber.findMany({
            orderBy: {
                criadoEm: "desc"
            }
        });

        return res.json(contas);

    } catch (erro) {
        return responderErro(
            res,
            erro,
            "Erro interno ao listar contas a receber."
        );
    }
});

// Chamado pelo ERP (via outbox) quando um pedido é confirmado.
// Idempotente: pedidoId é único, então uma entrega repetida devolve a
// conta já criada em vez de duplicá-la.
app.post("/integracoes/erp/pedidos", async (req, res) => {
    try {
        const {
            pedidoId,
            clienteNome,
            valor
        } = req.body;

        const idPedido = lerId(pedidoId);
        const valorConta = lerDecimal(valor);

        if (
            !idPedido ||
            !clienteNome ||
            !valorConta ||
            valorConta.isNegative()
        ) {
            return res.status(400).json({
                erro: "Dados do pedido inválidos."
            });
        }

        try {
            const conta = await prisma.contaReceber.create({
                data: {
                    pedidoId: idPedido,
                    clienteNome,
                    valor: valorConta,
                    origem: "ERP"
                }
            });

            return res.status(201).json({
                mensagem: "Conta a receber criada a partir do pedido do ERP.",
                conta
            });

        } catch (erro) {
            if (codigoErroPrisma(erro) !== "P2002") {
                throw erro;
            }

            const contaExistente = await prisma.contaReceber.findUniqueOrThrow({
                where: {
                    pedidoId: idPedido
                }
            });

            return res.status(200).json({
                mensagem: "Este pedido já possui uma conta a receber.",
                conta: contaExistente
            });
        }

    } catch (erro) {
        return responderErro(
            res,
            erro,
            "Erro interno ao integrar pedido com Financeiro."
        );
    }
});

// Chamado pelo ERP quando um pedido é cancelado.
// Cancela a conta a receber do pedido, se ela ainda estiver pendente.
app.post("/integracoes/erp/pedidos/:pedidoId/cancelar", async (req, res) => {
    try {
        const pedidoId = lerId(req.params.pedidoId);

        if (!pedidoId) {
            return res.status(400).json({
                erro: "ID de pedido inválido."
            });
        }

        const { alterou, conta } = await transicionarPendente(
            { pedidoId },
            "CANCELADO"
        );

        if (!conta) {
            return res.status(200).json({
                mensagem: "Este pedido não possui conta a receber."
            });
        }

        if (alterou) {
            return res.json({
                mensagem: "Conta a receber do pedido cancelada.",
                conta
            });
        }

        if (conta.status === "PAGO") {
            return res.status(409).json({
                erro: "A conta deste pedido já foi paga.",
                conta
            });
        }

        return res.status(200).json({
            mensagem: "A conta deste pedido já está cancelada.",
            conta
        });

    } catch (erro) {
        return responderErro(
            res,
            erro,
            "Erro interno ao cancelar conta do pedido."
        );
    }
});

app.post("/contas-receber/:id/pagar", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const { alterou, conta } = await transicionarPendente(
            { id },
            "PAGO"
        );

        if (!conta) {
            return res.status(404).json({
                erro: "Conta a receber não encontrada."
            });
        }

        if (alterou) {
            return res.json({
                mensagem: "Conta marcada como paga com sucesso.",
                conta
            });
        }

        if (conta.status === "PAGO") {
            return res.status(200).json({
                mensagem: "Esta conta já está paga.",
                conta
            });
        }

        return res.status(409).json({
            erro: "Conta cancelada não pode ser paga.",
            conta
        });

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao registrar pagamento.");
    }
});

// Totais calculados pelo banco (SUM em NUMERIC), sem somar floats no JS.
app.get("/financeiro/resumo", async (req, res) => {
    try {
        const grupos = await prisma.contaReceber.groupBy({
            by: ["status"],
            _count: {
                _all: true
            },
            _sum: {
                valor: true
            }
        });

        const porStatus = (status: StatusConta) =>
            grupos.find((grupo) => grupo.status === status);

        const quantidade = (status: StatusConta) =>
            porStatus(status)?._count._all ?? 0;

        const soma = (status: StatusConta) =>
            (porStatus(status)?._sum.valor ?? new Prisma.Decimal(0))
                .toDecimalPlaces(2)
                .toNumber();

        return res.json({
            totalContas: grupos.reduce(
                (total, grupo) => total + grupo._count._all,
                0
            ),
            pendentes: quantidade("PENDENTE"),
            pagas: quantidade("PAGO"),
            canceladas: quantidade("CANCELADO"),
            valorPendente: soma("PENDENTE"),
            valorRecebido: soma("PAGO")
        });

    } catch (erro) {
        return responderErro(
            res,
            erro,
            "Erro interno ao gerar resumo financeiro."
        );
    }
});

app.post("/contas-receber/:id/cancelar", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const { alterou, conta } = await transicionarPendente(
            { id },
            "CANCELADO"
        );

        if (!conta) {
            return res.status(404).json({
                erro: "Conta a receber não encontrada."
            });
        }

        if (alterou) {
            return res.json({
                mensagem: "Conta cancelada com sucesso.",
                conta
            });
        }

        if (conta.status === "CANCELADO") {
            return res.status(200).json({
                mensagem: "Esta conta já está cancelada.",
                conta
            });
        }

        return res.status(409).json({
            erro: "Conta paga não pode ser cancelada.",
            conta
        });

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao cancelar conta.");
    }
});
