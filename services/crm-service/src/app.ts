import express from "express";
import cors from "cors";
import "dotenv/config";

import { prisma } from "./config/prisma.js";
import { Prisma } from "./generated/prisma/client.js";
import { exigirChaveInterna } from "./middlewares/chaveInterna.js";
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

const ERP_SERVICE_URL =
    process.env.ERP_SERVICE_URL || "http://localhost:3003";

configurarDestinoOutbox("ERP", ERP_SERVICE_URL);

const STATUS_LEAD = [
    "NOVO",
    "CONTATO",
    "QUALIFICADO",
    "PERDIDO",
    "CONVERTIDO"
] as const;

const STATUS_OPORTUNIDADE = [
    "ABERTA",
    "PROPOSTA",
    "NEGOCIACAO",
    "GANHA",
    "PERDIDA"
] as const;

type StatusOportunidade = typeof STATUS_OPORTUNIDADE[number];

function statusOportunidadeValido(
    status: unknown
): status is StatusOportunidade {
    return STATUS_OPORTUNIDADE.includes(status as StatusOportunidade);
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

        return decimal.isFinite() && !decimal.isNegative()
            ? decimal
            : null;
    } catch {
        return null;
    }
}

const agregadoOportunidade = (id: number) => `oportunidade:${id}`;

// Oportunidade ganha gera um pedido no ERP. O evento vai para o outbox
// na mesma transação que grava o status GANHA: ou as duas coisas
// acontecem, ou nenhuma. O relay entrega ao ERP, que é idempotente
// (Pedido.oportunidadeId é único).
function registrarOportunidadeGanha(
    tx: Prisma.TransactionClient,
    oportunidade: { id: number; cliente: string | null; valor: Prisma.Decimal }
) {
    return registrarEvento(tx, {
        agregado: agregadoOportunidade(oportunidade.id),
        tipo: "OPORTUNIDADE_GANHA",
        servico: "ERP",
        caminho: "/integracoes/crm/oportunidades",
        payload: {
            oportunidadeId: oportunidade.id,
            clienteNome: oportunidade.cliente,
            valorTotal: oportunidade.valor.toString()
        }
    });
}

function clientePreenchido(cliente: unknown) {
    return typeof cliente === "string" && cliente.trim() !== "";
}

app.use(cors());
app.use(exigirChaveInterna);
app.use(express.json());

app.get("/", (req, res) => {
    return res.json({
        servico: "CRM Service",
        status: "online"
    });
});

app.get("/clientes", async (req, res) => {
    try {
        const clientes = await prisma.cliente.findMany({
            orderBy: {
                nome: "asc"
            }
        });

        return res.json(clientes);

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao buscar clientes.");
    }
});

app.post("/clientes", idempotente, async (req, res) => {
    try {
        const {
            nome,
            email,
            telefone,
            empresa
        } = req.body;

        if (!nome) {
            return res.status(400).json({
                erro: "Nome é obrigatório."
            });
        }

        // E-mail repetido é barrado pela restrição única (P2002 → 409)
        const corpo = await prisma.$transaction(async (tx) => {
            const cliente = await tx.cliente.create({
                data: {
                    nome,
                    email: email || null,
                    telefone: telefone || null,
                    empresa: empresa || null
                }
            });

            const corpo = {
                mensagem: "Cliente cadastrado com sucesso.",
                cliente
            };

            await concluirIdempotencia(tx, res, 201, corpo);

            return corpo;
        });

        return res.status(201).json(corpo);

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao cadastrar cliente.", {
            P2002: "Já existe um cliente cadastrado com este e-mail."
        });
    }
});

app.get("/clientes/:id", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const cliente = await prisma.cliente.findUnique({
            where: {
                id
            }
        });

        if (!cliente) {
            return res.status(404).json({
                erro: "Cliente não encontrado."
            });
        }

        return res.json(cliente);

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao buscar cliente.");
    }
});

// Atualiza só os campos enviados, sem reescrever os demais com valores
// lidos antes (que outra requisição pode ter alterado nesse meio tempo).
app.put("/clientes/:id", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const {
            nome,
            email,
            telefone,
            empresa,
            ativo
        } = req.body;

        const dados: Prisma.ClienteUpdateInput = {};

        if (nome !== undefined) dados.nome = nome;
        if (email !== undefined) dados.email = email || null;
        if (telefone !== undefined) dados.telefone = telefone || null;
        if (empresa !== undefined) dados.empresa = empresa || null;
        if (ativo !== undefined) dados.ativo = ativo;

        const clienteAtualizado = await prisma.cliente.update({
            where: {
                id
            },
            data: dados
        });

        return res.json({
            mensagem: "Cliente atualizado com sucesso.",
            cliente: clienteAtualizado
        });

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao atualizar cliente.", {
            P2025: "Cliente não encontrado.",
            P2002: "Já existe um cliente cadastrado com este e-mail."
        });
    }
});

app.delete("/clientes/:id", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        await prisma.cliente.delete({
            where: {
                id
            }
        });

        return res.json({
            mensagem: "Cliente excluído com sucesso."
        });

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao excluir cliente.", {
            P2025: "Cliente não encontrado."
        });
    }
});

app.get("/leads", async (req, res) => {
    try {
        const leads = await prisma.lead.findMany({
            orderBy: {
                criadoEm: "desc"
            }
        });

        return res.json(leads);

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao buscar leads.");
    }
});

app.post("/leads", idempotente, async (req, res) => {
    try {
        const {
            nome,
            email,
            telefone,
            empresa,
            origem,
            status,
            observacoes
        } = req.body;

        if (!nome) {
            return res.status(400).json({
                erro: "Nome é obrigatório."
            });
        }

        const statusLead = STATUS_LEAD.includes(status) ? status : "NOVO";

        const corpo = await prisma.$transaction(async (tx) => {
            const lead = await tx.lead.create({
                data: {
                    nome,
                    email: email || null,
                    telefone: telefone || null,
                    empresa: empresa || null,
                    origem: origem || null,
                    status: statusLead,
                    observacoes: observacoes || null
                }
            });

            const corpo = {
                mensagem: "Lead cadastrado com sucesso.",
                lead
            };

            await concluirIdempotencia(tx, res, 201, corpo);

            return corpo;
        });

        return res.status(201).json(corpo);

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao cadastrar lead.");
    }
});

app.get("/leads/:id", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const lead = await prisma.lead.findUnique({
            where: {
                id
            }
        });

        if (!lead) {
            return res.status(404).json({
                erro: "Lead não encontrado."
            });
        }

        return res.json(lead);

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao buscar lead.");
    }
});

app.put("/leads/:id", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const {
            nome,
            email,
            telefone,
            empresa,
            origem,
            status,
            observacoes
        } = req.body;

        if (status && !STATUS_LEAD.includes(status)) {
            return res.status(400).json({
                erro: "Status de lead inválido."
            });
        }

        const dados: Prisma.LeadUpdateInput = {};

        if (nome !== undefined) dados.nome = nome;
        if (email !== undefined) dados.email = email || null;
        if (telefone !== undefined) dados.telefone = telefone || null;
        if (empresa !== undefined) dados.empresa = empresa || null;
        if (origem !== undefined) dados.origem = origem || null;
        if (status) dados.status = status;
        if (observacoes !== undefined) dados.observacoes = observacoes || null;

        const leadAtualizado = await prisma.lead.update({
            where: {
                id
            },
            data: dados
        });

        return res.json({
            mensagem: "Lead atualizado com sucesso.",
            lead: leadAtualizado
        });

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao atualizar lead.", {
            P2025: "Lead não encontrado."
        });
    }
});

app.delete("/leads/:id", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        await prisma.lead.delete({
            where: {
                id
            }
        });

        return res.json({
            mensagem: "Lead excluído com sucesso."
        });

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao excluir lead.", {
            P2025: "Lead não encontrado."
        });
    }
});

app.get("/oportunidades", async (req, res) => {
    try {
        const oportunidades = await prisma.oportunidade.findMany({
            orderBy: {
                criadoEm: "desc"
            }
        });

        return res.json(oportunidades);

    } catch (erro) {
        return responderErro(
            res,
            erro,
            "Erro interno ao buscar oportunidades."
        );
    }
});

app.post("/oportunidades", idempotente, async (req, res) => {
    try {
        const {
            titulo,
            cliente,
            valor,
            status,
            responsavel,
            observacoes
        } = req.body;

        if (!titulo || valor === undefined) {
            return res.status(400).json({
                erro: "Título e valor são obrigatórios."
            });
        }

        const valorDecimal = lerDecimal(valor);

        if (!valorDecimal) {
            return res.status(400).json({
                erro: "Valor inválido."
            });
        }

        const statusOportunidade = statusOportunidadeValido(status)
            ? status
            : "ABERTA";

        if (statusOportunidade === "GANHA" && !clientePreenchido(cliente)) {
            return res.status(400).json({
                erro: "Informe o cliente antes de marcar a oportunidade como ganha."
            });
        }

        const corpo = await prisma.$transaction(async (tx) => {
            const oportunidade = await tx.oportunidade.create({
                data: {
                    titulo,
                    cliente: cliente || null,
                    valor: valorDecimal,
                    status: statusOportunidade,
                    responsavel: responsavel || null,
                    observacoes: observacoes || null
                }
            });

            if (statusOportunidade === "GANHA") {
                await registrarOportunidadeGanha(tx, oportunidade);
            }

            const corpo = {
                mensagem: "Oportunidade cadastrada com sucesso.",
                oportunidade
            };

            await concluirIdempotencia(tx, res, 201, corpo);

            return corpo;
        });

        if (statusOportunidade === "GANHA") {
            await entregarPendentes(
                agregadoOportunidade(corpo.oportunidade.id)
            );
        }

        return res.status(201).json(corpo);

    } catch (erro) {
        return responderErro(
            res,
            erro,
            "Erro interno ao cadastrar oportunidade."
        );
    }
});

app.get("/oportunidades/:id", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const oportunidade = await prisma.oportunidade.findUnique({
            where: {
                id
            }
        });

        if (!oportunidade) {
            return res.status(404).json({
                erro: "Oportunidade não encontrada."
            });
        }

        return res.json(oportunidade);

    } catch (erro) {
        return responderErro(
            res,
            erro,
            "Erro interno ao buscar oportunidade."
        );
    }
});

class VersaoDesatualizada extends Error {}

// Atualização com controle de concorrência otimista.
//
// O cliente envia a "versao" que leu. O UPDATE só acontece se a versão no
// banco ainda for essa (UPDATE ... WHERE id = ? AND versao = ?) e a
// incrementa. Se outra pessoa salvou antes, a versão mudou: responde 409
// em vez de sobrescrever a alteração dela ("lost update").
// Sem "versao" no corpo, usa a versão lida aqui, o que ainda protege a
// combinação dos campos enviados com os campos lidos.
//
// GANHA é um estado final: a oportunidade já gerou um pedido no ERP, então
// não volta para outro status nem muda cliente/valor.
app.put("/oportunidades/:id", idempotente, async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const oportunidadeExistente = await prisma.oportunidade.findUnique({
            where: {
                id
            }
        });

        if (!oportunidadeExistente) {
            return res.status(404).json({
                erro: "Oportunidade não encontrada."
            });
        }

        const {
            titulo,
            cliente,
            valor,
            status,
            responsavel,
            observacoes,
            versao
        } = req.body;

        if (status !== undefined && !statusOportunidadeValido(status)) {
            return res.status(400).json({
                erro: "Status de oportunidade inválido."
            });
        }

        if (versao !== undefined && !Number.isInteger(versao)) {
            return res.status(400).json({
                erro: "Versão inválida."
            });
        }

        const versaoEsperada: number =
            versao ?? oportunidadeExistente.versao;

        if (versaoEsperada !== oportunidadeExistente.versao) {
            return res.status(409).json({
                erro: "Esta oportunidade foi alterada por outra pessoa. Recarregue e tente novamente.",
                oportunidade: oportunidadeExistente
            });
        }

        let valorDecimal: Prisma.Decimal | undefined;

        if (valor !== undefined) {
            const lido = lerDecimal(valor);

            if (!lido) {
                return res.status(400).json({
                    erro: "Valor inválido."
                });
            }

            valorDecimal = lido;
        }

        if (oportunidadeExistente.status === "GANHA") {
            const mudaStatus = status !== undefined && status !== "GANHA";
            const mudaCliente =
                cliente !== undefined &&
                (cliente || null) !== oportunidadeExistente.cliente;
            const mudaValor =
                valorDecimal !== undefined &&
                !valorDecimal.equals(oportunidadeExistente.valor);

            if (mudaStatus || mudaCliente || mudaValor) {
                return res.status(409).json({
                    erro: "Oportunidade ganha já gerou pedido no ERP: status, cliente e valor não podem mais ser alterados."
                });
            }
        }

        const dados: Prisma.OportunidadeUpdateManyMutationInput = {
            versao: {
                increment: 1
            }
        };

        if (titulo !== undefined) dados.titulo = titulo;
        if (cliente !== undefined) dados.cliente = cliente || null;
        if (valorDecimal !== undefined) dados.valor = valorDecimal;
        if (status !== undefined) dados.status = status;
        if (responsavel !== undefined) dados.responsavel = responsavel || null;
        if (observacoes !== undefined) dados.observacoes = observacoes || null;

        const ficaraGanha =
            status === "GANHA" &&
            oportunidadeExistente.status !== "GANHA";

        if (ficaraGanha) {
            const clienteFinal =
                cliente !== undefined ? cliente : oportunidadeExistente.cliente;

            if (!clientePreenchido(clienteFinal)) {
                return res.status(400).json({
                    erro: "Informe o cliente antes de marcar a oportunidade como ganha."
                });
            }
        }

        let oportunidadeAtualizada;

        try {
            oportunidadeAtualizada = await prisma.$transaction(async (tx) => {
                const atualizacao = await tx.oportunidade.updateMany({
                    where: {
                        id,
                        versao: versaoEsperada
                    },
                    data: dados
                });

                if (atualizacao.count === 0) {
                    throw new VersaoDesatualizada();
                }

                const oportunidade = await tx.oportunidade.findUniqueOrThrow({
                    where: {
                        id
                    }
                });

                if (ficaraGanha) {
                    await registrarOportunidadeGanha(tx, oportunidade);
                }

                return oportunidade;
            });

        } catch (erro) {
            if (erro instanceof VersaoDesatualizada) {
                return res.status(409).json({
                    erro: "Esta oportunidade foi alterada por outra pessoa. Recarregue e tente novamente."
                });
            }

            throw erro;
        }

        let mensagem = "Oportunidade atualizada com sucesso.";

        if (ficaraGanha) {
            const enviado = await entregarPendentes(agregadoOportunidade(id));

            mensagem = enviado
                ? "Oportunidade ganha e pedido gerado no ERP."
                : "Oportunidade ganha. O pedido será gerado no ERP assim que ele responder.";
        }

        return res.json({
            mensagem,
            oportunidade: oportunidadeAtualizada
        });

    } catch (erro) {
        return responderErro(
            res,
            erro,
            "Erro interno ao atualizar oportunidade."
        );
    }
});

app.delete("/oportunidades/:id", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        await prisma.oportunidade.delete({
            where: {
                id
            }
        });

        return res.json({
            mensagem: "Oportunidade excluída com sucesso."
        });

    } catch (erro) {
        return responderErro(
            res,
            erro,
            "Erro interno ao excluir oportunidade.",
            {
                P2025: "Oportunidade não encontrada."
            }
        );
    }
});

class LeadJaConvertido extends Error {}

// Converte o lead em oportunidade uma única vez.
// A troca de status (UPDATE ... WHERE status <> 'CONVERTIDO') vem primeiro
// dentro da transação: com duas conversões simultâneas, só uma altera a
// linha e cria a oportunidade; a outra recebe 409.
app.post("/leads/:id/converter", async (req, res) => {
    try {
        const id = lerId(req.params.id);

        if (!id) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const {
            titulo,
            valor,
            responsavel
        } = req.body;

        if (!titulo || valor === undefined) {
            return res.status(400).json({
                erro: "Título e valor são obrigatórios."
            });
        }

        const valorDecimal = lerDecimal(valor);

        if (!valorDecimal) {
            return res.status(400).json({
                erro: "Valor inválido."
            });
        }

        const lead = await prisma.lead.findUnique({
            where: {
                id
            }
        });

        if (!lead) {
            return res.status(404).json({
                erro: "Lead não encontrado."
            });
        }

        try {
            const resultado = await prisma.$transaction(async (tx) => {
                const conversao = await tx.lead.updateMany({
                    where: {
                        id,
                        status: {
                            not: "CONVERTIDO"
                        }
                    },
                    data: {
                        status: "CONVERTIDO"
                    }
                });

                if (conversao.count === 0) {
                    throw new LeadJaConvertido();
                }

                const oportunidade = await tx.oportunidade.create({
                    data: {
                        titulo,
                        cliente: lead.nome,
                        valor: valorDecimal,
                        status: "ABERTA",
                        responsavel: responsavel || null,
                        observacoes: `Oportunidade originada do lead ${lead.nome}`
                    }
                });

                const leadAtualizado = await tx.lead.findUniqueOrThrow({
                    where: {
                        id
                    }
                });

                return {
                    oportunidade,
                    lead: leadAtualizado
                };
            });

            return res.status(201).json({
                mensagem: "Lead convertido em oportunidade com sucesso.",
                ...resultado
            });

        } catch (erro) {
            if (erro instanceof LeadJaConvertido) {
                return res.status(409).json({
                    erro: "Este lead já foi convertido."
                });
            }

            throw erro;
        }

    } catch (erro) {
        return responderErro(res, erro, "Erro interno ao converter lead.");
    }
});

app.get("/funil", async (req, res) => {
    try {
        const funil = await prisma.oportunidade.groupBy({
            by: ["status"],

            _count: {
                id: true
            },

            _sum: {
                valor: true
            }
        });

        return res.json(funil);

    } catch (erro) {
        return responderErro(
            res,
            erro,
            "Erro interno ao buscar funil de vendas."
        );
    }
});
