import express from "express";
import cors from "cors";
import "dotenv/config";
import { prisma } from "./config/prisma.js";

const app = express();

const ERP_SERVICE_URL =
    process.env.ERP_SERVICE_URL || "http://localhost:3003";


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
const PORT = process.env.PORT || 3002;

app.use(cors());
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
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao buscar clientes."
        });
    }
});
app.post("/clientes", async (req, res) => {
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

        const cliente = await prisma.cliente.create({
            data: {
                nome,
                email: email || null,
                telefone: telefone || null,
                empresa: empresa || null
            }
        });

        return res.status(201).json({
            mensagem: "Cliente cadastrado com sucesso.",
            cliente
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao cadastrar cliente."
        });
    }
});
app.get("/clientes/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
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
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao buscar cliente."
        });
    }
});
app.put("/clientes/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
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

        const clienteExistente = await prisma.cliente.findUnique({
            where: {
                id
            }
        });

        if (!clienteExistente) {
            return res.status(404).json({
                erro: "Cliente não encontrado."
            });
        }

        const clienteAtualizado = await prisma.cliente.update({
            where: {
                id
            },
            data: {
                nome: nome ?? clienteExistente.nome,
                email: email ?? clienteExistente.email,
                telefone: telefone ?? clienteExistente.telefone,
                empresa: empresa ?? clienteExistente.empresa,
                ativo: ativo ?? clienteExistente.ativo
            }
        });

        return res.json({
            mensagem: "Cliente atualizado com sucesso.",
            cliente: clienteAtualizado
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao atualizar cliente."
        });
    }
});
app.delete("/clientes/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const clienteExistente = await prisma.cliente.findUnique({
            where: {
                id
            }
        });

        if (!clienteExistente) {
            return res.status(404).json({
                erro: "Cliente não encontrado."
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
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao excluir cliente."
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
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao buscar leads."
        });
    }
});
app.post("/leads", async (req, res) => {
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

        const statusLead =
            status === "NOVO" ||
            status === "CONTATO" ||
            status === "QUALIFICADO" ||
            status === "PERDIDO" ||
            status === "CONVERTIDO"
                ? status
                : "NOVO";

        const lead = await prisma.lead.create({
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

        return res.status(201).json({
            mensagem: "Lead cadastrado com sucesso.",
            lead
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao cadastrar lead."
        });
    }
});
app.get("/leads/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
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
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao buscar lead."
        });
    }
});
app.put("/leads/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const leadExistente = await prisma.lead.findUnique({
            where: {
                id
            }
        });

        if (!leadExistente) {
            return res.status(404).json({
                erro: "Lead não encontrado."
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

        const statusPermitidos = [
            "NOVO",
            "CONTATO",
            "QUALIFICADO",
            "PERDIDO",
            "CONVERTIDO"
        ];

        if (status && !statusPermitidos.includes(status)) {
            return res.status(400).json({
                erro: "Status de lead inválido."
            });
        }

        const leadAtualizado = await prisma.lead.update({
            where: {
                id
            },
            data: {
                nome: nome ?? leadExistente.nome,
                email: email ?? leadExistente.email,
                telefone: telefone ?? leadExistente.telefone,
                empresa: empresa ?? leadExistente.empresa,
                origem: origem ?? leadExistente.origem,
                status: status ?? leadExistente.status,
                observacoes: observacoes ?? leadExistente.observacoes
            }
        });

        return res.json({
            mensagem: "Lead atualizado com sucesso.",
            lead: leadAtualizado
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao atualizar lead."
        });
    }
});
app.delete("/leads/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
            return res.status(400).json({
                erro: "ID inválido."
            });
        }

        const leadExistente = await prisma.lead.findUnique({
            where: {
                id
            }
        });

        if (!leadExistente) {
            return res.status(404).json({
                erro: "Lead não encontrado."
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
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao excluir lead."
        });
    }
});app.get("/oportunidades", async (req, res) => {
    try {
        const oportunidades = await prisma.oportunidade.findMany({
            orderBy: {
                criadoEm: "desc"
            }
        });

        return res.json(oportunidades);

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao buscar oportunidades."
        });
    }
});
app.post("/oportunidades", async (req, res) => {
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

        const statusPermitidos = [
            "ABERTA",
            "PROPOSTA",
            "NEGOCIACAO",
            "GANHA",
            "PERDIDA"
        ];

        const statusOportunidade =
            status && statusPermitidos.includes(status)
                ? status
                : "ABERTA";

        const oportunidade = await prisma.oportunidade.create({
            data: {
                titulo,
                cliente: cliente || null,
                valor,
                status: statusOportunidade,
                responsavel: responsavel || null,
                observacoes: observacoes || null
            }
        });

        return res.status(201).json({
            mensagem: "Oportunidade cadastrada com sucesso.",
            oportunidade
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao cadastrar oportunidade."
        });
    }
});
app.get("/oportunidades/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
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
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao buscar oportunidade."
        });
    }
});
app.put("/oportunidades/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
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
            observacoes
        } = req.body;

        const statusPermitidos = [
            "ABERTA",
            "PROPOSTA",
            "NEGOCIACAO",
            "GANHA",
            "PERDIDA"
        ];

        if (status && !statusPermitidos.includes(status)) {
            return res.status(400).json({
                erro: "Status de oportunidade inválido."
            });
        }

               const oportunidadeAtualizada = await prisma.oportunidade.update({
            where: {
                id
            },
            data: {
                titulo: titulo ?? oportunidadeExistente.titulo,
                cliente: cliente ?? oportunidadeExistente.cliente,
                valor: valor ?? oportunidadeExistente.valor,
                status: status ?? oportunidadeExistente.status,
                responsavel: responsavel ?? oportunidadeExistente.responsavel,
                observacoes: observacoes ?? oportunidadeExistente.observacoes
            }
        });

        if (oportunidadeAtualizada.status === "GANHA") {
            const respostaERP = await fetchComRetry(
                `${ERP_SERVICE_URL}/integracoes/crm/oportunidades`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        oportunidadeId: oportunidadeAtualizada.id,
                        clienteNome: oportunidadeAtualizada.cliente,
                        valorTotal: Number(oportunidadeAtualizada.valor)
                    })
                }
            );

            if (!respostaERP.ok) {
                const erroERP = await respostaERP.text();

                throw new Error(
                    `Erro ao integrar oportunidade com ERP: ${erroERP}`
                );
            }
        }

        return res.json({
            mensagem: "Oportunidade atualizada com sucesso.",
            oportunidade: oportunidadeAtualizada
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao atualizar oportunidade."
        });
    }
});
app.delete("/oportunidades/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
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

        await prisma.oportunidade.delete({
            where: {
                id
            }
        });

        return res.json({
            mensagem: "Oportunidade excluída com sucesso."
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao excluir oportunidade."
        });
    }
});
app.post("/leads/:id/converter", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (Number.isNaN(id)) {
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

        if (lead.status === "CONVERTIDO") {
            return res.status(400).json({
                erro: "Este lead já foi convertido."
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

        const resultado = await prisma.$transaction(async (tx) => {
            const oportunidade = await tx.oportunidade.create({
                data: {
                    titulo,
                    cliente: lead.nome,
                    valor,
                    status: "ABERTA",
                    responsavel: responsavel || null,
                    observacoes: `Oportunidade originada do lead ${lead.nome}`
                }
            });

            const leadAtualizado = await tx.lead.update({
                where: {
                    id
                },
                data: {
                    status: "CONVERTIDO"
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
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao converter lead."
        });
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
        console.error(erro);

        return res.status(500).json({
            erro: "Erro interno ao buscar funil de vendas."
        });
    }
});
app.listen(PORT, () => {
    console.log(`CRM Service rodando na porta ${PORT}`);
});
