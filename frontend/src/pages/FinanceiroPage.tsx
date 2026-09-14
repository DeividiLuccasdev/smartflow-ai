import { apiFetch } from "../services/api";
import { useEffect, useMemo, useState } from "react";

type ContaReceber = {
  id: number;
  pedidoId: number;
  clienteNome: string;
  valor: string;
  status: "PENDENTE" | "PAGO" | "CANCELADO";
  origem: string;
  criadoEm: string;
  atualizadoEm: string;
};

type ResumoFinanceiro = {
  totalContas: number;
  pendentes: number;
  pagas: number;
  canceladas: number;
  valorPendente: number;
  valorRecebido: number;
};

const resumoInicial: ResumoFinanceiro = {
  totalContas: 0,
  pendentes: 0,
  pagas: 0,
  canceladas: 0,
  valorPendente: 0,
  valorRecebido: 0,
};

function FinanceiroPage() {
  const [contas, setContas] = useState<ContaReceber[]>([]);
  const [resumo, setResumo] =
    useState<ResumoFinanceiro>(resumoInicial);

  const [carregando, setCarregando] = useState(true);
  const [processando, setProcessando] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");

  const moeda = useMemo(
    () =>
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }),
    []
  );

  async function carregarFinanceiro() {
    try {
      setCarregando(true);
      setErro("");

      const [resContas, resResumo] = await Promise.all([
        apiFetch("/financeiro/contas-receber"),
        apiFetch("/financeiro/resumo"),
      ]);

      if (!resContas.ok || !resResumo.ok) {
        throw new Error("Erro ao carregar dados financeiros.");
      }

      const dadosContas = await resContas.json();
      const dadosResumo = await resResumo.json();

      setContas(dadosContas);
      setResumo(dadosResumo);
    } catch (erro) {
      console.error(erro);
      setErro("Não foi possível carregar o Financeiro.");
    } finally {
      setCarregando(false);
    }
  }

  async function pagarConta(id: number) {
    const confirmar = window.confirm(
      `Confirmar o pagamento da conta #${id}?`
    );

    if (!confirmar) {
      return;
    }

    try {
      setProcessando(id);
      setErro("");
      setMensagem("");

      const resposta = await apiFetch(
        `/financeiro/contas-receber/${id}/pagar`,
        {
          method: "POST",
        }
      );

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(
          dados.erro || "Erro ao registrar pagamento."
        );
      }

      setMensagem(`Conta #${id} marcada como paga.`);

      await carregarFinanceiro();
    } catch (erro) {
      console.error(erro);

      setErro(
        erro instanceof Error
          ? erro.message
          : "Não foi possível registrar o pagamento."
      );
    } finally {
      setProcessando(null);
    }
  }

  async function cancelarConta(id: number) {
    const confirmar = window.confirm(
      `Deseja realmente cancelar a conta #${id}?`
    );

    if (!confirmar) {
      return;
    }

    try {
      setProcessando(id);
      setErro("");
      setMensagem("");

      const resposta = await apiFetch(
        `/financeiro/contas-receber/${id}/cancelar`,
        {
          method: "POST",
        }
      );

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(
          dados.erro || "Erro ao cancelar conta."
        );
      }

      setMensagem(`Conta #${id} cancelada.`);

      await carregarFinanceiro();
    } catch (erro) {
      console.error(erro);

      setErro(
        erro instanceof Error
          ? erro.message
          : "Não foi possível cancelar a conta."
      );
    } finally {
      setProcessando(null);
    }
  }

  useEffect(() => {
    carregarFinanceiro();
  }, []);

  return (
    <main className="content">
      <div className="topbar">
        <div>
          <p className="eyebrow">Financeiro</p>
          <h1>Contas a Receber</h1>

          <p className="subtitle">
            Pagamentos, pendências e recebimentos do SmartFlow.
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={carregarFinanceiro}
          disabled={carregando}
        >
          {carregando ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {erro && <div className="error-box">{erro}</div>}

      {mensagem && (
        <div className="success-box">
          {mensagem}
        </div>
      )}

      <section className="cards">
        <article className="card">
          <span>Total de contas</span>
          <strong>{resumo.totalContas}</strong>
          <small>Contas geradas pelo ERP</small>
        </article>

        <article className="card">
          <span>A receber</span>
          <strong>
            {moeda.format(resumo.valorPendente)}
          </strong>
          <small>{resumo.pendentes} pendente(s)</small>
        </article>

        <article className="card destaque">
          <span>Recebido</span>
          <strong>
            {moeda.format(resumo.valorRecebido)}
          </strong>
          <small>{resumo.pagas} conta(s) paga(s)</small>
        </article>

        <article className="card">
          <span>Canceladas</span>
          <strong>{resumo.canceladas}</strong>
          <small>Contas canceladas</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Contas a receber</h2>
            <p>
              Lançamentos financeiros originados dos pedidos.
            </p>
          </div>

          <span className="service-tag">
            FINANCEIRO
          </span>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Origem</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>

            <tbody>
              {contas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Nenhuma conta encontrada.
                  </td>
                </tr>
              ) : (
                contas.map((conta) => (
                  <tr key={conta.id}>
                    <td>#{conta.id}</td>

                    <td>#{conta.pedidoId}</td>

                    <td>{conta.clienteNome}</td>

                    <td>{conta.origem}</td>

                    <td>
                      {moeda.format(Number(conta.valor))}
                    </td>

                    <td>
                      <span
                        className={`badge ${conta.status.toLowerCase()}`}
                      >
                        {conta.status}
                      </span>
                    </td>

                    <td>
                      <div className="action-buttons">
                        {conta.status === "PENDENTE" && (
                          <>
                            <button
                              className="button-confirm"
                              disabled={
                                processando === conta.id
                              }
                              onClick={() =>
                                pagarConta(conta.id)
                              }
                            >
                              Marcar paga
                            </button>

                            <button
                              className="button-cancel"
                              disabled={
                                processando === conta.id
                              }
                              onClick={() =>
                                cancelarConta(conta.id)
                              }
                            >
                              Cancelar
                            </button>
                          </>
                        )}

                        {conta.status === "PAGO" && (
                          <span className="action-text">
                            Pagamento concluído
                          </span>
                        )}

                        {conta.status === "CANCELADO" && (
                          <span className="action-text">
                            Cancelada
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default FinanceiroPage;
