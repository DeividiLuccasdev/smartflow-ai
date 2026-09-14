import { apiFetch } from "../services/api";
import { useEffect, useState } from "react";

type Oportunidade = {
  id: number;
  titulo: string;
  cliente: string | null;
  valor: string;
  status: string;
  responsavel: string | null;
  observacoes: string | null;
};

function CrmPage() {
  const [oportunidades, setOportunidades] = useState<Oportunidade[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [titulo, setTitulo] = useState("");
  const [cliente, setCliente] = useState("");
  const [valor, setValor] = useState("");
  const [status, setStatus] = useState("ABERTA");
  const [responsavel, setResponsavel] = useState("");
  const [observacoes, setObservacoes] = useState("");

  const moeda = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  function formatarValor(valorDigitado: string) {
  const apenasNumeros = valorDigitado.replace(/\D/g, "");

  if (!apenasNumeros) {
    setValor("");
    return;
  }

  const numero = Number(apenasNumeros) / 100;

  setValor(
    numero.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    })
  );
}

function converterValorParaNumero(valorFormatado: string) {
  return Number(
    valorFormatado
      .replace("R$", "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  );
}

  async function carregarOportunidades() {
    try {
      setCarregando(true);
      setErro("");

      const resposta = await apiFetch(
        "/crm/oportunidades"
      );

      if (!resposta.ok) {
        throw new Error("Erro ao carregar oportunidades.");
      }

      const dados = await resposta.json();

      setOportunidades(dados);
    } catch (erro) {
      console.error(erro);
      setErro("Não foi possível carregar as oportunidades.");
    } finally {
      setCarregando(false);
    }
  }

  async function cadastrarOportunidade(
    evento: React.FormEvent<HTMLFormElement>
  ) {
    evento.preventDefault();

    try {
      setSalvando(true);
      setErro("");
      setMensagem("");

      if (!titulo.trim() || !valor) {
        setErro("Título e valor são obrigatórios.");
        return;
      }

      const resposta = await apiFetch(
        "/crm/oportunidades",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            titulo,
            cliente,
            valor: converterValorParaNumero(valor),
            status,
            responsavel,
            observacoes,
          }),
        }
      );

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(
          dados.erro || "Erro ao cadastrar oportunidade."
        );
      }

      setMensagem("Oportunidade cadastrada com sucesso.");

      setTitulo("");
      setCliente("");
      setValor("");
      setStatus("ABERTA");
      setResponsavel("");
      setObservacoes("");

      setMostrarFormulario(false);

      await carregarOportunidades();
    } catch (erro) {
      console.error(erro);

      setErro(
        erro instanceof Error
          ? erro.message
          : "Não foi possível cadastrar a oportunidade."
      );
    } finally {
      setSalvando(false);
    }
  }

  async function atualizarStatus(
    id: number,
    novoStatus: string
  ) {
    try {
      setErro("");
      setMensagem("");

      const resposta = await apiFetch(
        `/crm/oportunidades/${id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: novoStatus,
          }),
        }
      );

      const dados = await resposta.json();

      if (!resposta.ok) {
        throw new Error(
          dados.erro || "Erro ao atualizar oportunidade."
        );
      }

      setMensagem(
        `Oportunidade #${id} atualizada para ${novoStatus}.`
      );

      await carregarOportunidades();
    } catch (erro) {
      console.error(erro);

      setErro(
        erro instanceof Error
          ? erro.message
          : "Não foi possível atualizar a oportunidade."
      );
    }
  }

  useEffect(() => {
    carregarOportunidades();
  }, []);

  return (
    <main className="content">
      <div className="topbar">
        <div>
          <p className="eyebrow">CRM</p>
          <h1>Gestão Comercial</h1>

          <p className="subtitle">
            Leads, oportunidades e funil de vendas.
          </p>
        </div>

        <div className="topbar-actions">
          <button
            className="secondary-button"
            onClick={() =>
              setMostrarFormulario(!mostrarFormulario)
            }
          >
            {mostrarFormulario
              ? "Fechar"
              : "+ Nova oportunidade"}
          </button>

          <button
            className="refresh-button"
            onClick={carregarOportunidades}
            disabled={carregando}
          >
            {carregando ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      </div>

      {erro && <div className="error-box">{erro}</div>}

      {mensagem && (
        <div className="success-box">
          {mensagem}
        </div>
      )}

      {mostrarFormulario && (
        <section className="panel form-panel">
          <div className="panel-header">
            <div>
              <h2>Nova oportunidade</h2>
              <p>Cadastre um novo negócio no CRM.</p>
            </div>

            <span className="service-tag">CRM</span>
          </div>

          <form
            className="opportunity-form"
            onSubmit={cadastrarOportunidade}
          >
            <div className="form-group">
              <label>Título *</label>

              <input
                type="text"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex.: Implantação SmartFlow"
                required
              />
            </div>

            <div className="form-group">
              <label>Cliente</label>

              <input
                type="text"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                placeholder="Nome do cliente"
              />
            </div>

            <div className="form-group">
              <label>Valor *</label>

              <input
              type="text"
              inputMode="numeric"
              value={valor}
              onChange={(e) => formatarValor(e.target.value)}
              placeholder="R$ 0,00"
              required
            />
            </div>

            <div className="form-group">
              <label>Status</label>

              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="ABERTA">ABERTA</option>
                <option value="PROPOSTA">PROPOSTA</option>
                <option value="NEGOCIACAO">NEGOCIAÇÃO</option>
                <option value="GANHA">GANHA</option>
                <option value="PERDIDA">PERDIDA</option>
              </select>
            </div>

            <div className="form-group">
              <label>Responsável</label>

              <input
                type="text"
                value={responsavel}
                onChange={(e) =>
                  setResponsavel(e.target.value)
                }
                placeholder="Responsável comercial"
              />
            </div>

            <div className="form-group form-full">
              <label>Observações</label>

              <textarea
                value={observacoes}
                onChange={(e) =>
                  setObservacoes(e.target.value)
                }
                placeholder="Informações adicionais"
                rows={4}
              />
            </div>

            <div className="form-actions form-full">
              <button
                type="submit"
                className="refresh-button"
                disabled={salvando}
              >
                {salvando
                  ? "Salvando..."
                  : "Cadastrar oportunidade"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="cards">
        <article className="card">
          <span>Total de oportunidades</span>
          <strong>{oportunidades.length}</strong>
          <small>Negócios cadastrados</small>
        </article>

        <article className="card">
          <span>Abertas</span>
          <strong>
            {
              oportunidades.filter(
                (o) => o.status === "ABERTA"
              ).length
            }
          </strong>
          <small>Em andamento</small>
        </article>

        <article className="card">
          <span>Ganhas</span>
          <strong>
            {
              oportunidades.filter(
                (o) => o.status === "GANHA"
              ).length
            }
          </strong>
          <small>Convertidas em vendas</small>
        </article>

        <article className="card">
          <span>Valor em oportunidades</span>

          <strong>
            {moeda.format(
              oportunidades.reduce(
                (total, oportunidade) =>
                  total +
                  Number(oportunidade.valor),
                0
              )
            )}
          </strong>

          <small>Valor total do funil</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Oportunidades</h2>
            <p>Gerencie o andamento das negociações.</p>
          </div>

          <span className="service-tag">CRM</span>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Cliente</th>
                <th>Título</th>
                <th>Responsável</th>
                <th>Valor</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {oportunidades.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Nenhuma oportunidade encontrada.
                  </td>
                </tr>
              ) : (
                oportunidades.map((oportunidade) => (
                  <tr key={oportunidade.id}>
                    <td>#{oportunidade.id}</td>

                    <td>
                      {oportunidade.cliente || "-"}
                    </td>

                    <td>{oportunidade.titulo}</td>

                    <td>
                      {oportunidade.responsavel || "-"}
                    </td>

                    <td>
                      {moeda.format(
                        Number(oportunidade.valor)
                      )}
                    </td>

                    <td>
                      <select
                        className="status-select"
                        value={oportunidade.status}
                        onChange={(evento) =>
                          atualizarStatus(
                            oportunidade.id,
                            evento.target.value
                          )
                        }
                      >
                        <option value="ABERTA">
                          ABERTA
                        </option>

                        <option value="PROPOSTA">
                          PROPOSTA
                        </option>

                        <option value="NEGOCIACAO">
                          NEGOCIAÇÃO
                        </option>

                        <option value="GANHA">
                          GANHA
                        </option>

                        <option value="PERDIDA">
                          PERDIDA
                        </option>
                      </select>
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

export default CrmPage;
