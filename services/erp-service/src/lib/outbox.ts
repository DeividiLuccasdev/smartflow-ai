import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { cabecalhosInternos } from "../middlewares/chaveInterna.js";

// Outbox transacional
// -------------------
// Problema: mudar o status no banco e avisar outro serviço por HTTP são
// duas operações separadas. Se o serviço cair entre elas (ou o outro
// serviço estiver fora do ar), os dois lados ficam inconsistentes.
//
// Solução: o evento é gravado na tabela EventoOutbox na MESMA transação
// que muda o status. Depois do commit, o relay entrega o evento por HTTP
// e só o marca como enviado quando o destino responde 2xx; em caso de
// falha, tenta de novo com espera crescente.
//
// A entrega é "pelo menos uma vez": o mesmo evento pode chegar duas vezes
// ao destino, por isso os endpoints de integração são idempotentes
// (ContaReceber.pedidoId e Pedido.oportunidadeId são únicos).
// Eventos do mesmo agregado (ex.: "pedido:12") são entregues em ordem.

const LEASE_MS = 30_000;
const MAX_TENTATIVAS = 10;
const TIMEOUT_MS = 10_000;

const destinos: Record<string, string> = {};

export function configurarDestinoOutbox(servico: string, urlBase: string) {
    destinos[servico] = urlBase;
}

export type NovoEvento = {
    agregado: string;
    tipo: string;
    servico: string;
    caminho: string;
    payload: Prisma.InputJsonValue;
};

export function registrarEvento(
    tx: Prisma.TransactionClient,
    evento: NovoEvento
) {
    return tx.eventoOutbox.create({
        data: evento
    });
}

function esperaAposFalha(tentativas: number) {
    return Math.min(2 ** tentativas * 1000, 5 * 60 * 1000);
}

type Evento = Awaited<
    ReturnType<typeof prisma.eventoOutbox.findMany>
>[number];

// Tenta entregar um evento. Retorna true se ele foi entregue.
async function entregar(evento: Evento): Promise<boolean> {
    const agora = new Date();

    // "Aluga" o evento para que duas instâncias (ou o relay e uma entrega
    // sob demanda) não o enviem ao mesmo tempo.
    const aluguel = await prisma.eventoOutbox.updateMany({
        where: {
            id: evento.id,
            enviadoEm: null,
            falhouEm: null,
            OR: [
                { bloqueadoAte: null },
                { bloqueadoAte: { lt: agora } }
            ]
        },
        data: {
            bloqueadoAte: new Date(agora.getTime() + LEASE_MS)
        }
    });

    if (aluguel.count === 0) {
        return false;
    }

    const urlBase = destinos[evento.servico];

    try {
        if (!urlBase) {
            throw new Error(`Destino ${evento.servico} não configurado.`);
        }

        const resposta = await fetch(`${urlBase}${evento.caminho}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...cabecalhosInternos()
            },
            body: JSON.stringify(evento.payload),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });

        if (resposta.ok) {
            await prisma.eventoOutbox.update({
                where: {
                    id: evento.id
                },
                data: {
                    enviadoEm: new Date(),
                    bloqueadoAte: null,
                    ultimoErro: null
                }
            });

            return true;
        }

        const texto = await resposta.text();

        // 4xx (exceto 408/429) não melhora com novas tentativas:
        // o evento fica marcado como falho para análise manual.
        const definitivo =
            resposta.status >= 400 &&
            resposta.status < 500 &&
            resposta.status !== 408 &&
            resposta.status !== 429;

        throw Object.assign(
            new Error(`HTTP ${resposta.status}: ${texto.slice(0, 500)}`),
            { definitivo }
        );

    } catch (erro) {
        const tentativas = evento.tentativas + 1;
        const definitivo =
            (erro as { definitivo?: boolean }).definitivo === true ||
            tentativas >= MAX_TENTATIVAS;

        console.error(
            `Falha ao entregar evento ${evento.id} (${evento.tipo}), tentativa ${tentativas}:`,
            erro instanceof Error ? erro.message : erro
        );

        await prisma.eventoOutbox.update({
            where: {
                id: evento.id
            },
            data: {
                tentativas,
                bloqueadoAte: null,
                ultimoErro: String(
                    erro instanceof Error ? erro.message : erro
                ).slice(0, 1000),
                proximaTentativaEm: new Date(
                    Date.now() + esperaAposFalha(tentativas)
                ),
                falhouEm: definitivo ? new Date() : null
            }
        });

        return false;
    }
}

// Processa os eventos pendentes. Com "agregado", entrega na hora os
// eventos daquele agregado, ignorando a espera entre tentativas.
export async function processarOutbox(
    opcoes: { agregado?: string; limite?: number } = {}
) {
    const eventos = await prisma.eventoOutbox.findMany({
        where: {
            enviadoEm: null,
            falhouEm: null,
            ...(opcoes.agregado
                ? { agregado: opcoes.agregado }
                : { proximaTentativaEm: { lte: new Date() } })
        },
        orderBy: {
            id: "asc"
        },
        take: opcoes.limite ?? 50
    });

    // Se um evento de um agregado falhar, os seguintes do mesmo agregado
    // esperam, para não chegarem fora de ordem.
    const bloqueados = new Set<string>();
    let entregues = 0;

    for (const evento of eventos) {
        if (bloqueados.has(evento.agregado)) {
            continue;
        }

        if (await entregar(evento)) {
            entregues++;
        } else {
            bloqueados.add(evento.agregado);
        }
    }

    return entregues;
}

// Entrega agora os eventos de um agregado. Retorna true se não sobrou
// nenhum evento pendente (ou seja, o destino já está atualizado).
export async function entregarPendentes(agregado: string) {
    for (let rodada = 0; rodada < 5; rodada++) {
        await processarOutbox({ agregado });

        const pendentes = await prisma.eventoOutbox.findMany({
            where: {
                agregado,
                enviadoEm: null,
                falhouEm: null
            },
            select: {
                bloqueadoAte: true
            }
        });

        if (pendentes.length === 0) {
            return true;
        }

        // Só vale esperar se outro processo está entregando agora
        const outroEntregando = pendentes.some(
            (evento) =>
                evento.bloqueadoAte !== null &&
                evento.bloqueadoAte > new Date()
        );

        if (!outroEntregando) {
            return false;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return false;
}

// Relay em segundo plano: tenta os eventos pendentes periodicamente.
export function iniciarRelayOutbox(intervaloMs = 5000) {
    let executando = false;

    const timer = setInterval(async () => {
        if (executando) {
            return;
        }

        executando = true;

        try {
            await processarOutbox();
        } catch (erro) {
            console.error("Erro no relay do outbox:", erro);
        } finally {
            executando = false;
        }
    }, intervaloMs);

    timer.unref();

    return () => clearInterval(timer);
}
