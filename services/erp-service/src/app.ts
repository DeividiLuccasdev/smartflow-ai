import express from "express";
import cors from "cors";
import "dotenv/config";

import { prisma } from "./config/prisma.js";
import { Prisma } from "./generated/prisma/client.js";
import {
    CABECALHO_CHAVE_INTERNA,
    CHAVE_INTERNA,
    exigirChaveInterna
} from "./middlewares/chaveInterna.js";
import {
    concluirIdempotencia,
    idempotente
} from "./lib/idempotencia.js";
import {
    configurarDestinoOutbox,
    entregarPendentes,
    registrarEvento
} from "./lib/outbox.js";
import { responderErro } from "./lib/prismaErros.js";

export const app = express();

const FINANCE_SERVICE_URL =
    process.env.FINANCE_SERVICE_URL || "http://localhost:3004";

configurarDestinoOutbox("FINANCE", FINANCE_SERVICE_URL);

const ESPERA_ENTRE_TENTATIVAS_MS = Number(
    process.env.ESPERA_ENTRE_TENTATIVAS_MS ?? 5000
);

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
            setTimeout(resolve, ESPERA_ENTRE_TENTATIVAS_MS)
        );
    }

    throw ultimoErro ?? new Error(
        `Não foi possível acessar ${url}`
    );
}

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

const agregadoPedido = (id: number) => `pedido:${id}`;

app.use(cors());
app.use(exigirChaveInterna);
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
        return responderErro(res, erro, "Erro interno ao buscar produtos.");
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

        const precoDecimal = lerDecimal(preco);

        if (!precoDecimal || precoDecimal.isNegative()) {
            return res.status(400).json({
                erro: "Preço inválido."
            });
        }

        const estoqueInicial = estoque === undefined ? 0 : Number(estoque);

        if (!Number.isInteger(estoqueInicial) || estoqueInicial < 0) {
            return res.status(400).json({
                erro: "Estoque inválido."
            });
        }

        // Sem consulta prévia: a restrição única do SKU decide (P2002 → 409).
        const produto = await prisma.produto.create({
            data: {
                nome,
                sku,
                preco: precoDecimal,
                estoque: estoqueInicial
            }
        });

        return res.status(201).json({
            mensagem: "Produto cadastrado com sucesso.",
            produto
        });

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao cadastrar produto.", {
            P2002: "Já existe um produto cadastrado com este SKU."
        });
    }
});

app.get("/produtos/:id", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
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
        return responderErro(res, erro, "Erro interno ao buscar produto.");
    }
});

// Atualiza só os campos enviados. O estoque não é sobrescrito com um valor
// absoluto (que viria de uma leitura possivelmente desatualizada): ele muda
// apenas por "ajusteEstoque", aplicado como incremento/decremento atômico.
app.put("/produtos/:id", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const {
            nome,
            sku,
            preco,
            estoque,
            ajusteEstoque,
            ativo
        } = req.body;

        if (estoque !== undefined) {
            return res.status(400).json({
                erro: "O estoque não pode ser definido diretamente. Use \"ajusteEstoque\" (ex.: 5 ou -2)."
            });
        }

        const dados: Prisma.ProdutoUpdateManyMutationInput = {};

        if (nome !== undefined) {
            dados.nome = nome;
        }

        if (sku !== undefined) {
            dados.sku = sku;
        }

        if (preco !== undefined) {
            const precoDecimal = lerDecimal(preco);

            if (!precoDecimal || precoDecimal.isNegative()) {
                return res.status(400).json({
                    erro: "Preço inválido."
                });
            }

            dados.preco = precoDecimal;
        }

        if (ativo !== undefined) {
            if (typeof ativo !== "boolean") {
                return res.status(400).json({
                    erro: "Campo ativo inválido."
                });
            }

            dados.ativo = ativo;
        }

        let ajuste = 0;

        if (ajusteEstoque !== undefined) {
            ajuste = Number(ajusteEstoque);

            if (!Number.isInteger(ajuste)) {
                return res.status(400).json({
                    erro: "Ajuste de estoque inválido."
                });
            }

            if (ajuste !== 0) {
                dados.estoque = {
                    increment: ajuste
                };
            }
        }

        // Uma única instrução UPDATE: o decremento só acontece se houver
        // saldo, sem janela entre a leitura e a escrita.
        const atualizacao = await prisma.produto.updateMany({
            where: {
                id,
                ...(ajuste < 0
                    ? { estoque: { gte: -ajuste } }
                    : {})
            },
            data: dados
        });

        const produtoAtualizado = await prisma.produto.findUnique({
            where: {
                id
            }
        });

        if (!produtoAtualizado) {
            return res.status(404).json({
                erro: "Produto não encontrado."
            });
        }

        if (atualizacao.count === 0) {
            return res.status(400).json({
                erro: "Estoque insuficiente para o ajuste informado."
            });
        }

        return res.json({
            mensagem: "Produto atualizado com sucesso.",
            produto: produtoAtualizado
        });

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao atualizar produto.", {
            P2002: "Já existe um produto cadastrado com este SKU."
        });
    }
});

app.delete("/produtos/:id", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
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
        return responderErro(res, erro, "Erro interno ao excluir produto.", {
            P2025: "Produto não encontrado.",
            P2003: "Produto possui pedidos vinculados e não pode ser excluído. Desative-o."
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
        return responderErro(res, erro, "Erro interno ao buscar pedidos.");
    }
});

class EstoqueInsuficiente extends Error {
    constructor(public produtoId: number) {
        super(`Estoque insuficiente para o produto ${produtoId}.`);
    }
}

app.post("/pedidos", idempotente, async (req, res) => {
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

        // Soma as quantidades por produto: o mesmo produto em dois itens
        // precisa ser conferido contra o estoque pelo total.
        const quantidadesPorProduto = new Map<number, number>();

        for (const item of itens) {
            const produtoId = Number(item?.produtoId);
            const quantidade = Number(item?.quantidade);

            if (!Number.isInteger(produtoId) || produtoId <= 0) {
                return res.status(400).json({
                    erro: "Produto inválido."
                });
            }

            if (!Number.isInteger(quantidade) || quantidade <= 0) {
                return res.status(400).json({
                    erro: "Quantidade inválida."
                });
            }

            quantidadesPorProduto.set(
                produtoId,
                (quantidadesPorProduto.get(produtoId) ?? 0) + quantidade
            );
        }

        const itensPedido: {
            produtoId: number;
            quantidade: number;
            precoUnit: Prisma.Decimal;
        }[] = [];

        // Valores em Decimal: somar floats do JS gera erros de centavos
        // (ex.: 0.1 + 0.2 = 0.30000000000000004).
        let valorTotal = new Prisma.Decimal(0);

        for (const [produtoId, quantidade] of quantidadesPorProduto) {
            const produto = await prisma.produto.findUnique({
                where: {
                    id: produtoId
                }
            });

            if (!produto) {
                return res.status(404).json({
                    erro: `Produto ${produtoId} não encontrado.`
                });
            }

            if (!produto.ativo) {
                return res.status(400).json({
                    erro: `Produto ${produto.nome} está inativo.`
                });
            }

            if (produto.estoque < quantidade) {
                return res.status(400).json({
                    erro: `Estoque insuficiente para ${produto.nome}.`
                });
            }

            valorTotal = valorTotal.add(produto.preco.mul(quantidade));

            itensPedido.push({
                produtoId: produto.id,
                quantidade,
                precoUnit: produto.preco
            });
        }

        let resposta;

        try {
            resposta = await prisma.$transaction(async (tx) => {
                // Baixa o estoque só se ainda houver saldo: evita estoque
                // negativo quando dois pedidos são feitos ao mesmo tempo.
                for (const item of itensPedido) {
                    const baixa = await tx.produto.updateMany({
                        where: {
                            id: item.produtoId,
                            estoque: {
                                gte: item.quantidade
                            }
                        },
                        data: {
                            estoque: {
                                decrement: item.quantidade
                            }
                        }
                    });

                    if (baixa.count === 0) {
                        throw new EstoqueInsuficiente(item.produtoId);
                    }
                }

                const pedido = await tx.pedido.create({
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

                const corpo = {
                    mensagem: "Pedido criado com sucesso.",
                    pedido
                };

                // A resposta da Idempotency-Key é gravada junto com o pedido
                await concluirIdempotencia(tx, res, 201, corpo);

                return corpo;
            });

        } catch (erro) {
            if (erro instanceof EstoqueInsuficiente) {
                return res.status(400).json({
                    erro: `Estoque insuficiente para o produto ${erro.produtoId}.`
                });
            }

            throw erro;
        }

        return res.status(201).json(resposta);

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao criar pedido.");
    }
});

// Confirma o pedido e agenda a criação da conta a receber no Financeiro.
//
// A troca de status é condicional (só sai de PENDENTE): se um cancelamento
// chegar ao mesmo tempo, apenas uma das duas operações vence. O evento para
// o Financeiro é gravado no outbox na mesma transação, então nunca existe
// pedido confirmado sem conta a receber agendada (nem conta para pedido
// que não foi confirmado).
app.post("/pedidos/:id/confirmar", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const confirmado = await prisma.$transaction(async (tx) => {
            const transicao = await tx.pedido.updateMany({
                where: {
                    id,
                    status: "PENDENTE"
                },
                data: {
                    status: "CONFIRMADO"
                }
            });

            if (transicao.count === 0) {
                return null;
            }

            const pedido = await tx.pedido.findUniqueOrThrow({
                where: {
                    id
                }
            });

            await registrarEvento(tx, {
                agregado: agregadoPedido(id),
                tipo: "PEDIDO_CONFIRMADO",
                servico: "FINANCE",
                caminho: "/integracoes/erp/pedidos",
                payload: {
                    pedidoId: pedido.id,
                    clienteNome: pedido.clienteNome,
                    valor: pedido.valorTotal.toString()
                }
            });

            return pedido;
        });

        const pedido = confirmado ?? await prisma.pedido.findUnique({
            where: {
                id
            }
        });

        if (!pedido) {
            return res.status(404).json({
                erro: "Pedido não encontrado."
            });
        }

        if (pedido.status === "CANCELADO") {
            return res.status(409).json({
                erro: "Pedido cancelado não pode ser confirmado."
            });
        }

        if (pedido.status === "FATURADO") {
            return res.status(409).json({
                erro: "Pedido já está faturado."
            });
        }

        // Tenta entregar já; se o Financeiro estiver fora, o relay do
        // outbox continua tentando em segundo plano.
        const enviado = await entregarPendentes(agregadoPedido(id));

        return res.json({
            mensagem: enviado
                ? "Pedido confirmado e enviado ao Financeiro."
                : "Pedido confirmado. A conta a receber será criada assim que o Financeiro responder.",
            pedido
        });

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao confirmar pedido.");
    }
});

class PedidoAlterado extends Error {}

// Cancela o pedido e devolve o estoque UMA única vez.
//
// A devolução acontece na mesma transação da troca condicional de status
// (UPDATE ... WHERE status = <status lido>). Se dois cancelamentos chegarem
// juntos, só um altera a linha; o outro vê count = 0 e não devolve nada.
//
// Pedido já confirmado: a conta a receber é cancelada antes no Financeiro,
// que decide de forma atômica entre "pagar" e "cancelar". Se a conta já
// foi paga, o pedido não é cancelado. Se o ERP falhar depois disso, o
// pedido continua CONFIRMADO com a conta cancelada; repetir o cancelamento
// é seguro (o Financeiro responde "já cancelada") e conclui a operação.
app.post("/pedidos/:id/cancelar", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        // O status pode mudar entre a leitura e a transação (ex.: alguém
        // confirmou o pedido). Nesse caso, reavalia com o status novo.
        for (let tentativa = 0; tentativa < 3; tentativa++) {
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
                return res.status(200).json({
                    mensagem: "Este pedido já está cancelado.",
                    pedido
                });
            }

            if (
                pedido.status === "CONFIRMADO" ||
                pedido.status === "FATURADO"
            ) {
                // Garante que a conta a receber já chegou ao Financeiro;
                // senão ela poderia ser criada depois do cancelamento.
                const sincronizado = await entregarPendentes(
                    agregadoPedido(id)
                );

                if (!sincronizado) {
                    return res.status(503).json({
                        erro: "Financeiro indisponível no momento. Tente cancelar novamente em instantes."
                    });
                }

                const respostaFinanceiro = await fetchComRetry(
                    `${FINANCE_SERVICE_URL}/integracoes/erp/pedidos/${pedido.id}/cancelar`,
                    {
                        method: "POST"
                    }
                );

                if (respostaFinanceiro.status === 409) {
                    return res.status(409).json({
                        erro: "Pedido com conta a receber já paga não pode ser cancelado."
                    });
                }

                if (!respostaFinanceiro.ok) {
                    const erroFinanceiro = await respostaFinanceiro.text();

                    throw new Error(
                        `Erro ao cancelar conta no Financeiro: ${erroFinanceiro}`
                    );
                }
            }

            try {
                const cancelado = await prisma.$transaction(async (tx) => {
                    const transicao = await tx.pedido.updateMany({
                        where: {
                            id,
                            status: pedido.status
                        },
                        data: {
                            status: "CANCELADO"
                        }
                    });

                    if (transicao.count === 0) {
                        throw new PedidoAlterado();
                    }

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

                    return tx.pedido.findUniqueOrThrow({
                        where: {
                            id
                        }
                    });
                });

                return res.json({
                    mensagem: "Pedido cancelado e estoque devolvido com sucesso.",
                    pedido: cancelado
                });

            } catch (erro) {
                if (!(erro instanceof PedidoAlterado)) {
                    throw erro;
                }
            }
        }

        return res.status(409).json({
            erro: "O pedido foi alterado por outra operação. Tente novamente."
        });

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao cancelar pedido.");
    }
});

// Chamado pelo CRM (via outbox) quando uma oportunidade é ganha.
// Idempotente: oportunidadeId é único, então uma entrega repetida
// devolve o pedido já criado.
app.post("/integracoes/crm/oportunidades", async (req, res) => {
    try {
        const {
            oportunidadeId,
            clienteNome,
            valorTotal
        } = req.body;

        const idOportunidade = lerId(oportunidadeId);
        const valor = lerDecimal(valorTotal);

        if (
            !idOportunidade ||
            !clienteNome ||
            !valor ||
            valor.isNegative()
        ) {
            return res.status(400).json({
                erro: "Dados da oportunidade inválidos."
            });
        }

        try {
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
            if (
                !(erro instanceof Prisma.PrismaClientKnownRequestError) ||
                erro.code !== "P2002"
            ) {
                throw erro;
            }

            const pedidoExistente = await prisma.pedido.findUniqueOrThrow({
                where: {
                    oportunidadeId: idOportunidade
                }
            });

            return res.status(200).json({
                mensagem: "Esta oportunidade já possui um pedido.",
                pedido: pedidoExistente
            });
        }

    } catch (erro) {
        return responderErro(
            res,
            erro,
            "Erro interno ao integrar oportunidade com ERP."
        );
    }
});
