import express from "express";
import cors from "cors";
import "dotenv/config";

import { prisma } from "./config/prisma.js";

const app = express();

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
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    return res.json({
        servico: "ERP Service",
        status: "online"
    });
});

app.get("/produtos", async (req, res) => {
    try {
        const produtos = await prisma.produto.findMany({
            orderBy: {
                nome: "asc"
            }
        });

        return res.json(produtos);

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao buscar produtos."
        });
    }
});
app.post("/produtos", async (req, res) => {
    try {
        const {
            nome,
            sku,
            preco,
            estoque
        } = req.body;

        if (!nome || !sku || preco === undefined) {
            return res.status(400).json({
                erro: "Nome, SKU e preço são obrigatórios."
            });
        }

        const produtoExistente = await prisma.produto.findUnique({
            where: {
                sku
            }
        });

        if (produtoExistente) {
            return res.status(409).json({
                erro: "Já existe um produto cadastrado com este SKU."
            });
        }

        const produto = await prisma.produto.create({
            data: {
                nome,
                sku,
                preco,
                estoque: estoque ?? 0
            }
        });

        return res.status(201).json({
            mensagem: "Produto cadastrado com sucesso.",
            produto
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao cadastrar produto."
        });
    }
});
app.get("/produtos/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const produto = await prisma.produto.findUnique({
            where: {
                id
            }
        });

        if (!produto) {
            return res.status(404).json({
                erro: "Produto não encontrado."
            });
        }

        return res.json(produto);

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao buscar produto."
        });
    }
});
app.put("/produtos/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const produtoExistente = await prisma.produto.findUnique({
            where: {
                id
            }
        });

        if (!produtoExistente) {
            return res.status(404).json({
                erro: "Produto não encontrado."
            });
        }

        const {
            nome,
            sku,
            preco,
            estoque,
            ativo
        } = req.body;

        const produtoAtualizado = await prisma.produto.update({
            where: {
                id
            },
            data: {
                nome: nome ?? produtoExistente.nome,
                sku: sku ?? produtoExistente.sku,
                preco: preco ?? produtoExistente.preco,
                estoque: estoque ?? produtoExistente.estoque,
                ativo: ativo ?? produtoExistente.ativo
            }
        });

        return res.json({
            mensagem: "Produto atualizado com sucesso.",
            produto: produtoAtualizado
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao atualizar produto."
        });
    }
});
app.delete("/produtos/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const produtoExistente = await prisma.produto.findUnique({
            where: {
                id
            }
        });

        if (!produtoExistente) {
            return res.status(404).json({
                erro: "Produto não encontrado."
            });
        }

        await prisma.produto.delete({
            where: {
                id
            }
        });

        return res.json({
            mensagem: "Produto excluído com sucesso."
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao excluir produto."
        });
    }
});
app.get("/pedidos", async (req, res) => {
    try {
        const pedidos = await prisma.pedido.findMany({
            include: {
                itens: {
                    include: {
                        produto: true
                    }
                }
            },
            orderBy: {
                criadoEm: "desc"
            }
        });

        return res.json(pedidos);

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao buscar pedidos."
        });
    }
});
app.post("/pedidos", async (req, res) => {
    try {
        const {
            clienteNome,
            itens
        } = req.body;

        if (!clienteNome) {
            return res.status(400).json({
                erro: "Nome do cliente é obrigatório."
            });
        }

        if (!Array.isArray(itens) || itens.length === 0) {
            return res.status(400).json({
                erro: "O pedido precisa possuir pelo menos um item."
            });
        }

            const itensPedido: {
                produtoId: number;
                quantidade: number;
                precoUnit: number;
            }[] = [];
            let valorTotal = 0;

        for (const item of itens) {
            const produto = await prisma.produto.findUnique({
                where: {
                    id: Number(item.produtoId)
                }
            });

            if (!produto) {
                return res.status(404).json({
                    erro: `Produto ${item.produtoId} não encontrado.`
                });
            }

            if (!produto.ativo) {
                return res.status(400).json({
                    erro: `Produto ${produto.nome} está inativo.`
                });
            }

            const quantidade = Number(item.quantidade);

            if (!Number.isInteger(quantidade) || quantidade <= 0) {
                return res.status(400).json({
                    erro: "Quantidade inválida."
                });
            }

            if (produto.estoque < quantidade) {
                return res.status(400).json({
                    erro: `Estoque insuficiente para ${produto.nome}.`
                });
            }

            const precoUnit = Number(produto.preco);

            valorTotal += precoUnit * quantidade;

            itensPedido.push({
                produtoId: produto.id,
                quantidade,
                precoUnit
            });
        }

        const pedido = await prisma.$transaction(async (tx) => {
            const novoPedido = await tx.pedido.create({
                data: {
                    clienteNome,
                    valorTotal,
                    itens: {
                        create: itensPedido
                    }
                },
                include: {
                    itens: {
                        include: {
                            produto: true
                        }
                    }
                }
            });

            for (const item of itensPedido) {
                await tx.produto.update({
                    where: {
                        id: item.produtoId
                    },
                    data: {
                        estoque: {
                            decrement: item.quantidade
                        }
                    }
                });
            }

            return novoPedido;
        });

        return res.status(201).json({
            mensagem: "Pedido criado com sucesso.",
            pedido
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao criar pedido."
        });
    }
});
app.post("/pedidos/:id/confirmar", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const pedidoExistente = await prisma.pedido.findUnique({
            where: {
                id
            }
        });

        if (!pedidoExistente) {
            return res.status(404).json({
                erro: "Pedido não encontrado."
            });
        }

        if (pedidoExistente.status === "CANCELADO") {
            return res.status(400).json({
                erro: "Pedido cancelado não pode ser confirmado."
            });
        }

        if (pedidoExistente.status === "FATURADO") {
            return res.status(400).json({
                erro: "Pedido já está faturado."
            });
        }

        const pedidoConfirmado =
            pedidoExistente.status === "CONFIRMADO"
                ? pedidoExistente
                : await prisma.pedido.update({
                    where: {
                        id
                    },
                    data: {
                        status: "CONFIRMADO"
                    }
                });

        const respostaFinanceiro = await fetchComRetry(
            `${FINANCE_SERVICE_URL}/integracoes/erp/pedidos`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    pedidoId: pedidoConfirmado.id,
                    clienteNome: pedidoConfirmado.clienteNome,
                    valor: Number(pedidoConfirmado.valorTotal)
                })
            }
        );

        if (!respostaFinanceiro.ok) {
            const erroFinanceiro = await respostaFinanceiro.text();

            throw new Error(
                `Erro ao integrar pedido com Financeiro: ${erroFinanceiro}`
            );
        }

        return res.json({
            mensagem: "Pedido confirmado e enviado ao Financeiro.",
            pedido: pedidoConfirmado
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao confirmar pedido."
        });
    }
});
app.post("/pedidos/:id/cancelar", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const pedido = await prisma.pedido.findUnique({
            where: {
                id
            },
            include: {
                itens: true
            }
        });

        if (!pedido) {
            return res.status(404).json({
                erro: "Pedido não encontrado."
            });
        }

        if (pedido.status === "CANCELADO") {
            return res.status(400).json({
                erro: "Este pedido já está cancelado."
            });
        }

        await prisma.$transaction(async (tx) => {
            for (const item of pedido.itens) {
                await tx.produto.update({
                    where: {
                        id: item.produtoId
                    },
                    data: {
                        estoque: {
                            increment: item.quantidade
                        }
                    }
                });
            }

            await tx.pedido.update({
                where: {
                    id
                },
                data: {
                    status: "CANCELADO"
                }
            });
        });

        return res.json({
            mensagem: "Pedido cancelado e estoque devolvido com sucesso."
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao cancelar pedido."
        });
    }
    });
  app.post("/integracoes/crm/oportunidades", async (req, res) => {
    try {
        const {
            oportunidadeId,
            clienteNome,
            valorTotal
        } = req.body;

        const idOportunidade = Number(oportunidadeId);
        const valor = Number(valorTotal);

        if (
            !Number.isInteger(idOportunidade) ||
            idOportunidade <= 0 ||
            !clienteNome ||
            Number.isNaN(valor) ||
            valor < 0
        ) {
            return res.status(400).json({
                erro: "Dados da oportunidade inválidos."
            });
        }

        const pedidoExistente = await prisma.pedido.findUnique({
            where: {
                oportunidadeId: idOportunidade
            }
        });

        if (pedidoExistente) {
            return res.status(200).json({
                mensagem: "Esta oportunidade já possui um pedido.",
                pedido: pedidoExistente
            });
        }

        const pedido = await prisma.pedido.create({
            data: {
                clienteNome,
                valorTotal: valor,
                oportunidadeId: idOportunidade,
                origem: "CRM"
            }
        });

        return res.status(201).json({
            mensagem: "Pedido criado a partir da oportunidade do CRM.",
            pedido
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao integrar oportunidade com ERP."
        });
    }

});

app.listen(PORT, () => {
    console.log(`ERP Service rodando na porta ${PORT}`);
});