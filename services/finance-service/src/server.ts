import express from "express";
import cors from "cors";
import "dotenv/config";

import { prisma } from "./config/prisma.js";
import { exigirChaveInterna } from "./middlewares/chaveInterna.js";

const app = express();

const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(exigirChaveInterna);
app.use(express.json());

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
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao listar contas a receber."
        });
    }
});

app.post("/integracoes/erp/pedidos", async (req, res) => {
    try {
        const {
            pedidoId,
            clienteNome,
            valor
        } = req.body;

        const idPedido = Number(pedidoId);
        const valorConta = Number(valor);

        if (
            !Number.isInteger(idPedido) ||
            idPedido <= 0 ||
            !clienteNome ||
            Number.isNaN(valorConta) ||
            valorConta < 0
        ) {
            return res.status(400).json({
                erro: "Dados do pedido inválidos."
            });
        }

        const contaExistente = await prisma.contaReceber.findUnique({
            where: {
                pedidoId: idPedido
            }
        });

        if (contaExistente) {
            return res.status(200).json({
                mensagem: "Este pedido já possui uma conta a receber.",
                conta: contaExistente
            });
        }

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
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao integrar pedido com Financeiro."
        });
    }
});

// Chamado pelo ERP quando um pedido é cancelado.
// Cancela a conta a receber do pedido, se ela ainda estiver pendente.
app.post("/integracoes/erp/pedidos/:pedidoId/cancelar", async (req, res) => {
    try {
        const pedidoId = Number(req.params.pedidoId);

        if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
            return res.status(400).json({
                erro: "ID de pedido inválido."
            });
        }

        const conta = await prisma.contaReceber.findUnique({
            where: {
                pedidoId
            }
        });

        if (!conta) {
            return res.status(200).json({
                mensagem: "Este pedido não possui conta a receber."
            });
        }

        if (conta.status === "PAGO") {
            return res.status(409).json({
                erro: "A conta deste pedido já foi paga.",
                conta
            });
        }

        if (conta.status === "CANCELADO") {
            return res.status(200).json({
                mensagem: "A conta deste pedido já está cancelada.",
                conta
            });
        }

        const contaCancelada = await prisma.contaReceber.update({
            where: {
                id: conta.id
            },
            data: {
                status: "CANCELADO"
            }
        });

        return res.json({
            mensagem: "Conta a receber do pedido cancelada.",
            conta: contaCancelada
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao cancelar conta do pedido."
        });
    }
});

app.post("/contas-receber/:id/pagar", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const contaExistente = await prisma.contaReceber.findUnique({
            where: {
                id
            }
        });

        if (!contaExistente) {
            return res.status(404).json({
                erro: "Conta a receber não encontrada."
            });
        }

        if (contaExistente.status === "PAGO") {
            return res.status(200).json({
                mensagem: "Esta conta já está paga.",
                conta: contaExistente
            });
        }

        if (contaExistente.status === "CANCELADO") {
            return res.status(400).json({
                erro: "Conta cancelada não pode ser paga."
            });
        }

        const contaPaga = await prisma.contaReceber.update({
            where: {
                id
            },
            data: {
                status: "PAGO"
            }
        });

        return res.json({
            mensagem: "Conta marcada como paga com sucesso.",
            conta: contaPaga
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao registrar pagamento."
        });
    }
});
app.get("/financeiro/resumo", async (req, res) => {
    try {
        const contas = await prisma.contaReceber.findMany({
            select: {
                status: true,
                valor: true
            }
        });

        const resumo = {
            totalContas: 0,
            pendentes: 0,
            pagas: 0,
            canceladas: 0,
            valorPendente: 0,
            valorRecebido: 0
        };

        for (const conta of contas) {
            const valor = Number(conta.valor);

            resumo.totalContas++;

            if (conta.status === "PENDENTE") {
                resumo.pendentes++;
                resumo.valorPendente += valor;
            }

            if (conta.status === "PAGO") {
                resumo.pagas++;
                resumo.valorRecebido += valor;
            }

            if (conta.status === "CANCELADO") {
                resumo.canceladas++;
            }
        }

        return res.json(resumo);

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao gerar resumo financeiro."
        });
    }
});
app.post("/contas-receber/:id/cancelar", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const contaExistente = await prisma.contaReceber.findUnique({
            where: {
                id
            }
        });

        if (!contaExistente) {
            return res.status(404).json({
                erro: "Conta a receber não encontrada."
            });
        }

        if (contaExistente.status === "PAGO") {
            return res.status(400).json({
                erro: "Conta paga não pode ser cancelada."
            });
        }

        if (contaExistente.status === "CANCELADO") {
            return res.status(200).json({
                mensagem: "Esta conta já está cancelada.",
                conta: contaExistente
            });
        }

        const contaCancelada = await prisma.contaReceber.update({
            where: {
                id
            },
            data: {
                status: "CANCELADO"
            }
        });

        return res.json({
            mensagem: "Conta cancelada com sucesso.",
            conta: contaCancelada
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao cancelar conta."
        });
    }
});

app.listen(PORT, () => {
    console.log(`Finance Service rodando na porta ${PORT}`);
});