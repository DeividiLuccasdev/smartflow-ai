import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import CrmPage from "./pages/CrmPage";
import ErpPage from "./pages/ErpPage";
import FinanceiroPage from "./pages/FinanceiroPage";
import AiPage from "./pages/AiPage";
import LoginPage from "./pages/LoginPage";
import UsuariosPage from "./pages/UsuariosPage";
import { apiFetch, obterToken, obterUsuario, removerToken } from "./services/api";

type Oportunidade = {
  id: number;
  titulo: string;
  cliente: string;
  valor: string;
  status: string;
};

type Pedido = {
  id: number;
  clienteNome: string;
  status: string;
  valorTotal: string;
  oportunidadeId: number | null;
  origem: string | null;
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

function SistemaApp() {
  const usuario = obterUsuario();
  const perfil = usuario?.perfil;

  const podeIA =
    perfil === "ADMIN" || perfil === "VENDEDOR";

  const podeCRM =
    perfil === "ADMIN" ||
    perfil === "VENDEDOR" ||
    perfil === "ATENDENTE";

  const podeERP =
    perfil === "ADMIN" || perfil === "ATENDENTE";

  const podeFinanceiro =
    perfil === "ADMIN";

  const podeUsuarios =
    perfil === "ADMIN";
  const [oportunidades, setOportunidades] = useState<Oportunidade[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [financeiro, setFinanceiro] =
    useState<ResumoFinanceiro>(resumoInicial);

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const moeda = useMemo(
    () =>
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }),
    []
  );
  async function carregarDashboard() {
    try {
      setCarregando(true);
      setErro("");

      const [resCRM, resERP, resFinanceiro] = await Promise.all([
        apiFetch("/crm/oportunidades"),
        podeERP
          ? apiFetch("/erp/pedidos")
          : Promise.resolve(null),
        podeFinanceiro
          ? apiFetch("/financeiro/resumo")
          : Promise.resolve(null),
      ]);

      if (!resCRM.ok) {
        throw new Error("CRM não respondeu corretamente.");
      }

      if (resERP && !resERP.ok) {
        throw new Error("ERP não respondeu corretamente.");
      }

      if (resFinanceiro && !resFinanceiro.ok) {
        throw new Error("Financeiro não respondeu corretamente.");
      }

      const dadosCRM = await resCRM.json();

      const dadosERP = resERP
        ? await resERP.json()
        : [];

      const dadosFinanceiro = resFinanceiro
        ? await resFinanceiro.json()
        : resumoInicial;

      setOportunidades(dadosCRM);
      setPedidos(dadosERP);
      setFinanceiro(dadosFinanceiro);

    } catch (erro) {
      console.error(erro);

      setErro(
        "Não foi possível carregar os dados disponíveis para este perfil."
      );
    } finally {
      setCarregando(false);
    }
  }


  useEffect(() => {
    carregarDashboard();
  }, []);

  const oportunidadesGanhas = oportunidades.filter(
    (oportunidade) => oportunidade.status === "GANHA"
  ).length;

  const pedidosConfirmados = pedidos.filter(
    (pedido) => pedido.status === "CONFIRMADO"
  ).length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div>
          <div className="brand">
            <div className="brand-icon">S</div>

            <div>
              <strong>SmartFlow</strong>
              <span>AI Business</span>
            </div>
          </div>

          <nav>
  <NavLink
    to="/"
    end
    className={({ isActive }) =>
      `menu-item ${isActive ? "active" : ""}`
    }
  >
    Dashboard
  </NavLink>

  <NavLink
  to="/ia"
  className={({ isActive }) =>
    isActive ? "menu-item active" : "menu-item"
  }
>
  Assistente IA
</NavLink>

  <NavLink
    to="/crm"
    className={({ isActive }) =>
      `menu-item ${isActive ? "active" : ""}`
    }
  >
    CRM
  </NavLink>

  <NavLink
    to="/erp"
    className={({ isActive }) =>
      `menu-item ${isActive ? "active" : ""}`
    }
  >
    ERP
  </NavLink>

  <NavLink
    to="/financeiro"
    className={({ isActive }) =>
      `menu-item ${isActive ? "active" : ""}`
    }
  >
    Financeiro
  </NavLink>

            {podeUsuarios && (
              <NavLink
                to="/usuarios"
                className={({ isActive }) =>
                  `menu-item ${isActive ? "active" : ""}`
                }
              >
                Usuários
              </NavLink>
            )}
</nav>
        </div>

        <div className="sidebar-user">
          <strong>{usuario?.nome || "Usuário"}</strong>
          <span>{usuario?.perfil || "SEM PERFIL"}</span>
        </div>

        <div className="sidebar-footer">
          <span>SmartFlow AI</span>
          <small>v1.0</small>
        </div>
      <button
        className="logout-button"
        onClick={() => {
          removerToken();
          window.location.href = "/";
        }}
      >
        Sair
      </button>

      </aside>

      <Routes>
        <Route path="/ia" element={podeIA ? <AiPage /> : <Navigate to="/" replace />} />
  <Route
    path="/"
    element={
<main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Visão geral</p>
            <h1>Dashboard</h1>
            <p className="subtitle">
              Acompanhe CRM, ERP e Financeiro em tempo real.
            </p>
          </div>

          <button
            className="refresh-button"
            onClick={carregarDashboard}
            disabled={carregando}
          >
            {carregando ? "Atualizando..." : "Atualizar"}
          </button>
        </header>

        {erro && <div className="error-box">{erro}</div>}

        <section className="cards">
          <article className="card">
            <span>Oportunidades</span>
            <strong>{oportunidades.length}</strong>
            <small>{oportunidadesGanhas} ganhas</small>
          </article>

          <article className="card">
            <span>Pedidos</span>
            <strong>{pedidos.length}</strong>
            <small>{pedidosConfirmados} confirmados</small>
          </article>

          <article className="card">
            <span>Contas pendentes</span>
            <strong>{financeiro.pendentes}</strong>
            <small>{moeda.format(financeiro.valorPendente)}</small>
          </article>

          <article className="card destaque">
            <span>Valor recebido</span>
            <strong>{moeda.format(financeiro.valorRecebido)}</strong>
            <small>{financeiro.pagas} conta(s) paga(s)</small>
          </article>
        </section>

        <section className="grid">
          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Oportunidades recentes</h2>
                <p>Dados do CRM</p>
              </div>

              <span className="service-tag">CRM</span>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Status</th>
                    <th>Valor</th>
                  </tr>
                </thead>

                <tbody>
                  {oportunidades.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="empty">
                        Nenhuma oportunidade encontrada.
                      </td>
                    </tr>
                  ) : (
                    oportunidades.slice(0, 5).map((oportunidade) => (
                      <tr key={oportunidade.id}>
                        <td>{oportunidade.cliente}</td>

                        <td>
                          <span
                            className={`badge ${oportunidade.status.toLowerCase()}`}
                          >
                            {oportunidade.status}
                          </span>
                        </td>

                        <td>{moeda.format(Number(oportunidade.valor))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>

          {podeERP && (
          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Pedidos recentes</h2>
                <p>Dados do ERP</p>
              </div>

              <span className="service-tag">ERP</span>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Status</th>
                    <th>Valor</th>
                  </tr>
                </thead>

                <tbody>
                  {pedidos.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="empty">
                        Nenhum pedido encontrado.
                      </td>
                    </tr>
                  ) : (
                    pedidos.slice(0, 5).map((pedido) => (
                      <tr key={pedido.id}>
                        <td>{pedido.clienteNome}</td>

                        <td>
                          <span
                            className={`badge ${pedido.status.toLowerCase()}`}
                          >
                            {pedido.status}
                          </span>
                        </td>

                        <td>{moeda.format(Number(pedido.valorTotal))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>
          )}
        </section>

        {podeFinanceiro && (
        <section className="finance-panel">
          <div>
            <p>Financeiro</p>
            <h2>Resumo das contas a receber</h2>
          </div>

          <div className="finance-numbers">
            <div>
              <span>Pagas</span>
              <strong>{financeiro.pagas}</strong>
            </div>

            <div>
              <span>Pendentes</span>
              <strong>{financeiro.pendentes}</strong>
            </div>

            <div>
              <span>Canceladas</span>
              <strong>{financeiro.canceladas}</strong>
            </div>

            <div>
              <span>Total recebido</span>
              <strong>{moeda.format(financeiro.valorRecebido)}</strong>
            </div>
          </div>
        </section>
        )}
      </main>
    }
  />

  <Route path="/crm" element={podeCRM ? <CrmPage /> : <Navigate to="/" replace />} />
  <Route path="/erp" element={podeERP ? <ErpPage /> : <Navigate to="/" replace />} />
  <Route path="/financeiro" element={podeFinanceiro ? <FinanceiroPage /> : <Navigate to="/" replace />} />
  <Route path="/usuarios" element={podeUsuarios ? <UsuariosPage /> : <Navigate to="/" replace />} />
</Routes>
    </div>
  );
}


function App() {
  const token = obterToken();

  if (!token) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return <SistemaApp />;
}
export default App;
















