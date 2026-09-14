import { apiFetch } from "../services/api";
import { useEffect, useMemo, useState } from "react";

type Pedido = {
  id: number;
  clienteNome: string;
  status: string;
  valorTotal: string;
  oportunidadeId: number | null;
  origem: string | null;
  criadoEm: string;
};

function ErpPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
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

  async function carregarPedidos() {
    try {
      setCarregando(true);
      setErro("");

      const resposta = await apiFetch("/erp/pedidos");

      if (!resposta.ok) {
        throw new Error("Erro ao carregar pedidos.");
      }

      const dados = await resposta.json();

      setPedidos(dados);
    } catch (erro) {
      console.error(erro);
      setErro("Não foi possível carregar os pedidos do ERP.");
    } finally {
      setCarregando(false);
    }
  }

  async function confirmarPedido(id: number) {
    try {
      setProcessando(id);
      setErro("");
      setMensagem("");

      const resposta = await apiFetch(
        `/erp/pedidos/${id}/confirmar`,
        {
          method: "POST",
        }
      );

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(dados.erro || "Erro ao confirmar pedido.");
      }

      setMensagem(`Pedido #${id} confirmado e enviado ao Financeiro.`);

      await carregarPedidos();
    } catch (erro) {
      console.error(erro);

      setErro(
        erro instanceof Error
          ? erro.message
          : "Não foi possível confirmar o pedido."
      );
    } finally {
      setProcessando(null);
    }
  }

  async function cancelarPedido(id: number) {
    const confirmar = window.confirm(
      `Deseja realmente cancelar o pedido #${id}?`
    );

    if (!confirmar) {
      return;
    }

    try {
      setProcessando(id);
      setErro("");
      setMensagem("");

      const resposta = await apiFetch(
        `/erp/pedidos/${id}/cancelar`,
        {
          method: "POST",
        }
      );

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(dados.erro || "Erro ao cancelar pedido.");
      }

      setMensagem(`Pedido #${id} cancelado com sucesso.`);

      await carregarPedidos();
    } catch (erro) {
      console.error(erro);

      setErro(
        erro instanceof Error
          ? erro.message
          : "Não foi possível cancelar o pedido."
      );
    } finally {
      setProcessando(null);
    }
  }

  useEffect(() => {
    carregarPedidos();
  }, []);

  const pendentes = pedidos.filter(
    (pedido) => pedido.status === "PENDENTE"
  ).length;

  const confirmados = pedidos.filter(
    (pedido) => pedido.status === "CONFIRMADO"
  ).length;

  const cancelados = pedidos.filter(
    (pedido) => pedido.status === "CANCELADO"
  ).length;

  const valorTotal = pedidos
    .filter((pedido) => pedido.status !== "CANCELADO")
    .reduce((total, pedido) => total + Number(pedido.valorTotal), 0);

  return (
    <main className="content">
      <div className="topbar">
        <div>
          <p className="eyebrow">ERP</p>
          <h1>Pedidos</h1>

          <p className="subtitle">
            Gerencie pedidos e integração com o Financeiro.
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={carregarPedidos}
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
          <span>Total de pedidos</span>
          <strong>{pedidos.length}</strong>
          <small>Pedidos cadastrados</small>
        </article>

        <article className="card">
          <span>Pendentes</span>
          <strong>{pendentes}</strong>
          <small>Aguardando confirmação</small>
        </article>

        <article className="card">
          <span>Confirmados</span>
          <strong>{confirmados}</strong>
          <small>Enviados ao Financeiro</small>
        </article>

        <article className="card destaque">
          <span>Valor ativo</span>
          <strong>{moeda.format(valorTotal)}</strong>
          <small>{cancelados} pedido(s) cancelado(s)</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Pedidos</h2>
            <p>Pedidos cadastrados no ERP.</p>
          </div>

          <span className="service-tag">ERP</span>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Cliente</th>
                <th>Origem</th>
                <th>Oportunidade</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>

            <tbody>
              {pedidos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Nenhum pedido encontrado.
                  </td>
                </tr>
              ) : (
                pedidos.map((pedido) => (
                  <tr key={pedido.id}>
                    <td>#{pedido.id}</td>

                    <td>{pedido.clienteNome}</td>

                    <td>{pedido.origem || "-"}</td>

                    <td>
                      {pedido.oportunidadeId
                        ? `#${pedido.oportunidadeId}`
                        : "-"}
                    </td>

                    <td>
                      {moeda.format(Number(pedido.valorTotal))}
                    </td>

                    <td>
                      <span
                        className={`badge ${pedido.status.toLowerCase()}`}
                      >
                        {pedido.status}
                      </span>
                    </td>

                    <td>
                      <div className="action-buttons">
                        {pedido.status === "PENDENTE" && (
                          <>
                            <button
                              className="button-confirm"
                              disabled={processando === pedido.id}
                              onClick={() =>
                                confirmarPedido(pedido.id)
                              }
                            >
                              Confirmar
                            </button>

                            <button
                              className="button-cancel"
                              disabled={processando === pedido.id}
                              onClick={() =>
                                cancelarPedido(pedido.id)
                              }
                            >
                              Cancelar
                            </button>
                          </>
                        )}

                        {pedido.status === "CONFIRMADO" && (
                          <span className="action-text">
                            Financeiro gerado
                          </span>
                        )}

                        {pedido.status === "CANCELADO" && (
                          <span className="action-text">
                            Cancelado
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

export default ErpPage;
